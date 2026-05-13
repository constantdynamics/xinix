// xinix-trade-background — dagelijkse paper-trading engine.
//
// Strategie (vast tijdvenster):
// - Universe = active watchlist met current price + score
// - BUY-criteria: score >= ENTRY_MIN_SCORE OF actief rood-signaal,
//   EN current price <= buy_limit * (1 + ENTRY_LIMIT_BUFFER),
//   EN nog niet in open positie
// - Positie-grootte: $POSITION_SIZE, max TARGET_POSITIONS open
// - EXIT-criteria:
//   * stop-loss: price <= avg_price * (1 - STOP_LOSS)
//   * tijdvenster: vandaag >= scheduled_exit_date (entry + HOLD_DAYS)
// - Daarna: equity snapshot wegschrijven
//
// Wordt aangeroepen door cron `xinix-trade-daily` (22:00 UTC, na US close).
// Geen ntfy — alles wordt in de DB bijgehouden en zichtbaar op de
// "Xinix" tab.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> {
  const sb = getServiceClient();
  const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single();
  const id = row?.id as number | undefined;
  try {
    const r = await fn();
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id);
    throw e;
  }
}
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }

// ── Strategie-config ──────────────────────────────────────────────
const TARGET_POSITIONS = 8;        // 8 open posities = ~$1200 elk
const POSITION_SIZE_USD = 1200;    // initieel bedrag per koop
const CASH_RESERVE_USD = 200;      // minimaal aanhouden voor nieuwe kansen
const HOLD_DAYS = 60;              // vast tijdvenster
const STOP_LOSS = 0.15;            // -15% triggert stop-loss
const ENTRY_MIN_SCORE = 65;        // BUY-criterium op goud_score
const ENTRY_LIMIT_BUFFER = 0.10;   // koers mag tot 10% boven buy_limit zitten
const RED_SEVERITY_QUALIFIES = true;

// Heat-bijdrage per signaal type — alleen positieve buy-triggers tellen
// (zelfde set als dashboard).
const POSITIVE_SIGNAL_TYPES = new Set([
  "fda_approval", "topline_positive", "phase_success", "breakthrough_designation",
  "buyout_definitive", "bonanza_au", "discovery_announcement", "permit", "first_pour",
  "buy_limit_hit", "buy_limit_close", "buy_limit_warmup",
  "bonanza_ag", "bonanza_cu", "licensing_deal", "resource_update",
  "pea", "pfs", "dfs", "step_out_drill", "trial_status_change",
  "jv_strategic", "macro_tide",
  "pre_catalyst_7d", "pre_catalyst_14d", "pre_catalyst_30d", "pre_catalyst_60d",
  "near5y_low_gem", "loser_gem",
]);

interface Position {
  id: number;
  ticker: string;
  qty: number;
  avg_price: number;
  entry_date: string;
  scheduled_exit_date: string;
  stop_loss_price: number;
  entry_signal_types: string[];
  entry_sector: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401 });
  try {
    const r = await logRun("xinix-trade", run);
    return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});

async function run(): Promise<RunResult> {
  const sb = getServiceClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 1) State + open posities + huidige prijzen ophalen.
  const [stateRes, posRes, summaryRes, tickersRes, signalsRes] = await Promise.all([
    sb.from("xinix_paper_state").select("*").eq("id", 1).single(),
    sb.from("xinix_paper_positions").select("id, ticker, qty, avg_price, entry_date, scheduled_exit_date, stop_loss_price, entry_signal_types, entry_sector").is("closed_at", null),
    sb.from("signal_price_summary").select("ticker, last_close"),
    sb.from("signal_tickers").select("ticker, company, sector, goud_score, buy_limit, active, price_benched").eq("active", true).eq("price_benched", false),
    sb.from("signal_events").select("ticker, signal_type, severity, detected_at").or("expires_at.is.null,expires_at.gt." + now.toISOString()).order("detected_at", { ascending: false }).limit(2000),
  ]);

  if (stateRes.error || !stateRes.data) throw new Error(`state: ${stateRes.error?.message ?? "no state"}`);
  let cash = Number(stateRes.data.cash);
  const positions = (posRes.data ?? []) as Position[];
  const priceByTicker = new Map<string, number>();
  for (const p of (summaryRes.data ?? [])) {
    if (p.last_close != null) priceByTicker.set(p.ticker as string, Number(p.last_close));
  }
  const allTickers = (tickersRes.data ?? []) as Array<{
    ticker: string; company: string | null; sector: string | null;
    goud_score: number | null; buy_limit: number | null;
  }>;
  const signalsByTicker = new Map<string, Array<{ signal_type: string; severity: string }>>();
  for (const s of (signalsRes.data ?? [])) {
    const arr = signalsByTicker.get(s.ticker as string) ?? [];
    arr.push({ signal_type: s.signal_type as string, severity: s.severity as string });
    signalsByTicker.set(s.ticker as string, arr);
  }

  // 2) Exit-checks op open posities.
  let closedCount = 0;
  let closedRealizedUsd = 0;
  for (const p of positions) {
    const price = priceByTicker.get(p.ticker);
    if (price == null) continue; // geen prijs vandaag → laat de positie staan
    const stopTriggered = price <= Number(p.stop_loss_price);
    const timeTriggered = now >= new Date(p.scheduled_exit_date);
    if (!stopTriggered && !timeTriggered) continue;

    const exitPrice = price; // altijd werkelijke marktprijs; stop-loss is de trigger, niet de fill
    const proceeds = Number(p.qty) * exitPrice;
    const cost = Number(p.qty) * Number(p.avg_price);
    const returnUsd = proceeds - cost;
    const returnPct = cost > 0 ? (returnUsd / cost) * 100 : 0;
    const holdDays = Math.max(0, Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000));
    const reason = stopTriggered
      ? `Stop-loss (-15% gehaald: koers ${exitPrice.toFixed(price < 10 ? 3 : 2)} ≤ stop ${Number(p.stop_loss_price).toFixed(price < 10 ? 3 : 2)})`
      : `Tijdvenster ${HOLD_DAYS}d verstreken — automatische exit`;

    const { error } = await sb.from("xinix_paper_positions").update({
      closed_at: now.toISOString(),
      closed_price: exitPrice,
      closed_reason: reason,
      return_pct: returnPct,
      return_usd: returnUsd,
      hold_days: holdDays,
    }).eq("id", p.id);
    if (error) throw new Error(`close ${p.ticker}: ${error.message}`);

    cash += proceeds;
    closedCount++;
    closedRealizedUsd += returnUsd;
  }

  // 3) Welke tickers nog open?
  const openTickers = new Set<string>();
  {
    const { data: stillOpen } = await sb.from("xinix_paper_positions").select("ticker").is("closed_at", null);
    for (const r of (stillOpen ?? [])) openTickers.add(r.ticker as string);
  }
  const slotsAvailable = Math.max(0, TARGET_POSITIONS - openTickers.size);

  // 4) BUY-kandidaten zoeken.
  interface Candidate {
    ticker: string; company: string | null; sector: string | null;
    price: number; score: number; buyLimit: number | null;
    signals: Array<{ signal_type: string; severity: string }>;
    rankScore: number; reason: string;
  }
  const candidates: Candidate[] = [];
  for (const t of allTickers) {
    if (openTickers.has(t.ticker)) continue;
    const price = priceByTicker.get(t.ticker);
    if (price == null || price <= 0) continue;
    const score = t.goud_score ?? 0;
    const sigs = signalsByTicker.get(t.ticker) ?? [];
    const hasRed = RED_SEVERITY_QUALIFIES && sigs.some((s) => s.severity === "red" && POSITIVE_SIGNAL_TYPES.has(s.signal_type));
    const scoreOk = score >= ENTRY_MIN_SCORE;
    if (!scoreOk && !hasRed) continue;
    // Limit-check: prijs mag tot ENTRY_LIMIT_BUFFER boven buy_limit zitten.
    if (t.buy_limit != null && price > Number(t.buy_limit) * (1 + ENTRY_LIMIT_BUFFER)) continue;

    const positiveSignals = sigs.filter((s) => POSITIVE_SIGNAL_TYPES.has(s.signal_type));
    const redCount = positiveSignals.filter((s) => s.severity === "red").length;
    const orangeCount = positiveSignals.filter((s) => s.severity === "orange").length;
    // Ranking: score + bonus per signal-severity (red >> orange >> yellow).
    const rankScore = score + redCount * 25 + orangeCount * 10;
    const reasonParts: string[] = [];
    if (scoreOk) reasonParts.push(`score ${score}/100`);
    if (redCount > 0) reasonParts.push(`${redCount}× rood signaal`);
    if (orangeCount > 0) reasonParts.push(`${orangeCount}× oranje signaal`);
    if (t.buy_limit != null && price <= Number(t.buy_limit)) reasonParts.push("op/onder buy_limit");
    const reason = reasonParts.join(" · ") || "kwalificeert";
    candidates.push({
      ticker: t.ticker, company: t.company, sector: t.sector,
      price, score, buyLimit: t.buy_limit != null ? Number(t.buy_limit) : null,
      signals: positiveSignals, rankScore, reason,
    });
  }
  candidates.sort((a, b) => b.rankScore - a.rankScore);

  // 5) BUY uitvoeren tot we slots vol hebben.
  let bought = 0;
  const buyReasons: string[] = [];
  for (const c of candidates) {
    if (bought >= slotsAvailable) break;
    if (cash - POSITION_SIZE_USD < CASH_RESERVE_USD) break; // kasreserve respecteren
    if (c.price <= 0) continue;
    const qty = Math.floor((POSITION_SIZE_USD / c.price) * 1000) / 1000; // 3 decimalen
    if (qty <= 0) continue;
    const cost = qty * c.price;
    if (cash - cost < CASH_RESERVE_USD) continue;
    const stopLoss = Number((c.price * (1 - STOP_LOSS)).toFixed(c.price < 1 ? 4 : c.price < 10 ? 3 : 2));
    const exitDate = new Date(now.getTime() + HOLD_DAYS * 86_400_000);
    const signalTypes = [...new Set(c.signals.map((s) => s.signal_type))];

    const { error } = await sb.from("xinix_paper_positions").insert({
      ticker: c.ticker, qty, avg_price: c.price,
      entry_date: now.toISOString(),
      entry_reason: c.reason,
      entry_signal_types: signalTypes,
      entry_score: c.score || null,
      entry_sector: c.sector,
      scheduled_exit_date: exitDate.toISOString(),
      stop_loss_price: stopLoss,
    });
    if (error) throw new Error(`buy ${c.ticker}: ${error.message}`);

    cash -= cost;
    bought++;
    openTickers.add(c.ticker);
    buyReasons.push(`${c.ticker} @ ${c.price.toFixed(c.price < 10 ? 3 : 2)} (${c.reason})`);
  }

  // 6) State updaten + equity-snapshot wegschrijven.
  const { error: stateUpdErr } = await sb.from("xinix_paper_state").update({
    cash, last_run_at: now.toISOString(),
  }).eq("id", 1);
  if (stateUpdErr) throw new Error(`state update: ${stateUpdErr.message}`);

  // Equity snapshot: cash + alle open posities aan huidige koersen.
  let positionsValue = 0;
  let openCount = 0;
  {
    const { data: openNow } = await sb.from("xinix_paper_positions").select("ticker, qty, avg_price").is("closed_at", null);
    for (const p of (openNow ?? [])) {
      const px = priceByTicker.get(p.ticker as string) ?? Number(p.avg_price);
      positionsValue += Number(p.qty) * px;
      openCount++;
    }
  }
  const totalEquity = cash + positionsValue;
  await sb.from("xinix_paper_equity").upsert({
    date: today, cash, positions_value: positionsValue,
    total_equity: totalEquity, positions_count: openCount, computed_at: now.toISOString(),
  }, { onConflict: "date" });

  const msg = `${closedCount} gesloten (${closedRealizedUsd >= 0 ? "+" : ""}$${closedRealizedUsd.toFixed(0)} gerealiseerd), ${bought} gekocht, ${openCount} open, equity $${totalEquity.toFixed(0)}, cash $${cash.toFixed(0)}`;
  return {
    ok: true,
    message: msg,
    metrics: {
      closed: closedCount, bought, open_positions: openCount,
      cash: Number(cash.toFixed(2)), positions_value: Number(positionsValue.toFixed(2)),
      total_equity: Number(totalEquity.toFixed(2)), realized_usd: Number(closedRealizedUsd.toFixed(2)),
      candidates_qualified: candidates.length,
    },
  };
}
