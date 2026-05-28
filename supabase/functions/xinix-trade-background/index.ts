// xinix-trade-background — dagelijkse paper-trading engine (enkelvoudige portefeuille).
//
// Strategie (vast tijdvenster met slimme exits):
// - Universe = active watchlist met current price + score
// - BUY-criteria: score >= ENTRY_MIN_SCORE OF actief rood-signaal,
//   EN current price <= buy_limit * (1 + ENTRY_LIMIT_BUFFER),
//   EN nog niet in open positie
// - Positie-grootte: $POSITION_SIZE, max TARGET_POSITIONS open
// - EXIT-criteria:
//   * trailing stop: stop_loss_price ratchets mee omhoog — beschermt winsten
//   * deelwinst: verkoop helft bij +PARTIAL_TP_PCT winst (vergrendel deels)
//   * signaalverval: alle entry-signalen verlopen + verlies ≥ SIGNAL_DECAY_PCT → vroegtijdig uit
//   * tijdvenster: vandaag >= scheduled_exit_date (entry + HOLD_DAYS)
// - Transactiekosten: TX_COST_PCT per transactie (koop én verkoop) — marktconform
//
// Wordt aangeroepen door cron `xinix-trade-daily` (22:00 UTC, na US close).

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

// TX_COST en RED_SEVERITY_QUALIFIES zijn niet instelbaar via de DB — zij blijven constant.
const TX_COST = 0.001;
const RED_SEVERITY_QUALIFIES = true;

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

interface PartialExit {
  qty_sold: number; net_proceeds: number; at: string; reason: string;
}
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
  partial_exits: PartialExit[];
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

  // 1a) Laad dynamische config (met fallback naar vaste defaults als tabel ontbreekt).
  const { data: cfgRow } = await sb.from("xinix_paper_config").select("*").eq("id", 1).maybeSingle();
  const _cfg = (cfgRow ?? {}) as Record<string, unknown>;
  const TARGET_POSITIONS      = Number(_cfg.target_positions     ?? 8);
  const POSITION_SIZE_USD     = Number(_cfg.position_size_usd    ?? 1200);
  const CASH_RESERVE_USD      = Number(_cfg.cash_reserve_usd     ?? 200);
  const HOLD_DAYS             = Number(_cfg.hold_days            ?? 60);
  const STOP_LOSS             = Number(_cfg.stop_loss            ?? 0.15);
  const PARTIAL_TP_PCT        = Number(_cfg.partial_tp_pct       ?? 0.25);
  const ENTRY_MIN_SCORE       = Number(_cfg.entry_min_score      ?? 65);
  const ENTRY_LIMIT_BUFFER    = Number(_cfg.entry_limit_buffer   ?? 0.10);
  const SIGNAL_DECAY_LOSS_PCT = Number(_cfg.signal_decay_loss_pct ?? -3);
  // Per CLAUDE.md spec: held ≥ max(14d, holdDays × 0.33). Schaalt automatisch mee
  // met HOLD_DAYS zodat korte/lange holds dezelfde verhouding krijgen.
  const SIGNAL_DECAY_MIN_DAYS = Math.max(14, Math.round(HOLD_DAYS * 0.33));

  // 1b) State + open posities + marktdata ophalen.
  const [stateRes, posRes, summaryRes, tickersRes, signalsRes, regimeRes, stratPosRes] = await Promise.all([
    sb.from("xinix_paper_state").select("*").eq("id", 1).single(),
    sb.from("xinix_paper_positions")
      .select("id, ticker, qty, avg_price, entry_date, scheduled_exit_date, stop_loss_price, entry_signal_types, entry_sector, partial_exits")
      .is("closed_at", null),
    sb.from("signal_price_summary").select("ticker, last_close"),
    sb.from("signal_tickers").select("ticker, company, sector, goud_score, buy_limit, active, price_benched, first_price_date").eq("active", true).eq("price_benched", false),
    sb.from("signal_events").select("ticker, signal_type, severity, detected_at")
      .or("expires_at.is.null,expires_at.gt." + now.toISOString())
      .order("detected_at", { ascending: false }).limit(2000),
    sb.from("market_regime").select("is_bull, regime, updated_at").eq("id", 1).maybeSingle(),
    // Hoeveel strategieën houden momenteel elk ticker? → consensus-signaal
    sb.from("xinix_strategy_positions").select("ticker").is("closed_at", null),
  ]);

  if (stateRes.error || !stateRes.data) throw new Error(`state: ${stateRes.error?.message ?? "no state"}`);
  let cash = Number(stateRes.data.cash);

  // Marktregime: 3 staten. Bij ontbrekende/verouderde data (>3d) → standaard strong_bull.
  const regimeRow  = regimeRes.data;
  const regimeAgeD = regimeRow?.updated_at
    ? (now.getTime() - new Date(regimeRow.updated_at).getTime()) / 86400000
    : 999;
  const regime        = regimeAgeD < 3 ? (regimeRow?.regime ?? "strong_bull") : "strong_bull";
  const isBullMarket  = regime !== "bear";
  // weak_bull: 60% positiegrootte; bear: geen aankopen
  const regimePosScale    = regime === "strong_bull" ? 1.0 : regime === "weak_bull" ? 0.6 : 0.0;
  // In bear/weak_bull: trailing stop ratchets dichter bij de koers → snellere exit
  const stopTightenFactor = regime === "strong_bull" ? 1.0 : regime === "weak_bull" ? 0.75 : 0.5;

  // Consensus: tel hoeveel strategieën elk ticker momenteel houden.
  const consensusByTicker = new Map<string, number>();
  for (const p of (stratPosRes.data ?? [])) {
    const t = p.ticker as string;
    consensusByTicker.set(t, (consensusByTicker.get(t) ?? 0) + 1);
  }
  const positions = (posRes.data ?? []) as Position[];
  const priceByTicker = new Map<string, number>();
  for (const p of (summaryRes.data ?? [])) {
    if (p.last_close != null) priceByTicker.set(p.ticker as string, Number(p.last_close));
  }
  const allTickers = (tickersRes.data ?? []) as Array<{
    ticker: string; company: string | null; sector: string | null;
    goud_score: number | null; buy_limit: number | null; first_price_date: string | null;
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
  let partialCount = 0;
  const closedIds = new Set<number>();

  for (const p of positions) {
    const price = priceByTicker.get(p.ticker);
    if (price == null) continue;

    const fmtPrc = (n: number) => n.toFixed(price < 1 ? 4 : price < 10 ? 3 : 2);

    // Trailing stop: vergelijk met geratchete stop uit DB (gezet in vorige runs)
    const stopTriggered = price <= Number(p.stop_loss_price);
    const timeTriggered = now >= new Date(p.scheduled_exit_date);

    // Deelwinst: verkoop helft bij PARTIAL_TP_PCT, maar alleen 1× per positie
    if (!stopTriggered && !timeTriggered) {
      const alreadyPartial = (p.partial_exits ?? []).length > 0;
      if (!alreadyPartial && price >= Number(p.avg_price) * (1 + PARTIAL_TP_PCT)) {
        const soldQty = Math.floor(Number(p.qty) / 2 * 1000) / 1000;
        const remainingQty = Number(p.qty) - soldQty;
        if (soldQty > 0 && remainingQty > 0) {
          const netProceeds = soldQty * price * (1 - TX_COST);
          const peEntry: PartialExit = {
            qty_sold: soldQty,
            net_proceeds: +netProceeds.toFixed(4),
            at: now.toISOString(),
            reason: `Deelwinst +${((price / Number(p.avg_price) - 1) * 100).toFixed(1)}% — helft verkocht`,
          };
          const { error } = await sb.from("xinix_paper_positions").update({
            qty: remainingQty,
            partial_exits: [...(p.partial_exits ?? []), peEntry],
          }).eq("id", p.id);
          if (error) throw new Error(`partial sell ${p.ticker}: ${error.message}`);
          cash += netProceeds;
          partialCount++;
          continue; // positie blijft open met resterende helft
        }
      }
    }

    // Signaalverval-exit: alle entry-signalen verlopen + verlies → eerder uitstappen
    let signalDecayExit = false;
    if (!stopTriggered && !timeTriggered) {
      const entrySigs = p.entry_signal_types ?? [];
      if (entrySigs.length > 0) {
        const heldDays = Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000);
        if (heldDays >= SIGNAL_DECAY_MIN_DAYS) {
          const retPct = (price - Number(p.avg_price)) / Number(p.avg_price) * 100;
          if (retPct < SIGNAL_DECAY_LOSS_PCT) {
            const activeSigsForTicker = new Set(
              (signalsByTicker.get(p.ticker) ?? [])
                .filter(s => POSITIVE_SIGNAL_TYPES.has(s.signal_type))
                .map(s => s.signal_type)
            );
            signalDecayExit = entrySigs.every(sig => !activeSigsForTicker.has(sig));
          }
        }
      }
    }

    if (!stopTriggered && !timeTriggered && !signalDecayExit) {
      // Trailing stop ratchet: in zwakkere markt dichter bij de koers → snellere exit
      const effectiveStop = STOP_LOSS * stopTightenFactor;
      const newStop = +fmtPrc(price * (1 - effectiveStop));
      if (newStop > Number(p.stop_loss_price)) {
        await sb.from("xinix_paper_positions").update({ stop_loss_price: newStop }).eq("id", p.id);
      }
      continue;
    }

    // ── Positie volledig sluiten ────────────────────────────────────────────────
    const prevPartials = p.partial_exits ?? [];
    let returnUsd: number, returnPct: number, netProceeds: number;

    if (prevPartials.length > 0) {
      const origQty = Number(p.qty) + prevPartials.reduce((s, pe) => s + pe.qty_sold, 0);
      const origCost = origQty * Number(p.avg_price) * (1 + TX_COST);
      const partialProc = prevPartials.reduce((s, pe) => s + pe.net_proceeds, 0);
      netProceeds = Number(p.qty) * price * (1 - TX_COST);
      returnUsd = partialProc + netProceeds - origCost;
      returnPct = origCost > 0 ? (returnUsd / origCost) * 100 : 0;
    } else {
      netProceeds = Number(p.qty) * price * (1 - TX_COST);
      const cost = Number(p.qty) * Number(p.avg_price) * (1 + TX_COST);
      returnUsd = netProceeds - cost;
      returnPct = cost > 0 ? (returnUsd / cost) * 100 : 0;
    }

    const holdDays = Math.max(0, Math.round((now.getTime() - new Date(p.entry_date).getTime()) / 86_400_000));
    const curRetPct = (price - Number(p.avg_price)) / Number(p.avg_price) * 100;
    const reason = stopTriggered
      ? `Trailing stop -${(STOP_LOSS * 100).toFixed(0)}% (koers ${fmtPrc(price)} ≤ stop ${fmtPrc(Number(p.stop_loss_price))})`
      : signalDecayExit
      ? `Signaalthesis verlopen + verlies ${curRetPct.toFixed(1)}%`
      : `Tijdvenster ${HOLD_DAYS}d verstreken — automatische exit`;

    const { error } = await sb.from("xinix_paper_positions").update({
      closed_at: now.toISOString(),
      closed_price: price,
      closed_reason: reason,
      return_pct: +returnPct.toFixed(4),
      return_usd: +returnUsd.toFixed(4),
      hold_days: holdDays,
    }).eq("id", p.id);
    if (error) throw new Error(`close ${p.ticker}: ${error.message}`);

    cash += netProceeds;
    closedIds.add(p.id);
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
  const twoYearsAgo = new Date(Date.now() - 2 * 365.25 * 24 * 3600 * 1000);
  const candidates: Candidate[] = [];
  for (const t of allTickers) {
    if (openTickers.has(t.ticker)) continue;
    // Aandelen jonger dan 2 jaar overslaan (te weinig koershistorie)
    if (t.first_price_date != null && new Date(t.first_price_date) > twoYearsAgo) continue;
    const price = priceByTicker.get(t.ticker);
    if (price == null || price <= 0) continue;
    const score = t.goud_score ?? 0;
    const sigs = signalsByTicker.get(t.ticker) ?? [];
    const hasRed = RED_SEVERITY_QUALIFIES && sigs.some((s) => s.severity === "red" && POSITIVE_SIGNAL_TYPES.has(s.signal_type));
    const scoreOk = score >= ENTRY_MIN_SCORE;
    if (!scoreOk && !hasRed) continue;
    if (t.buy_limit != null && price > Number(t.buy_limit) * (1 + ENTRY_LIMIT_BUFFER)) continue;

    const positiveSignals = sigs.filter((s) => POSITIVE_SIGNAL_TYPES.has(s.signal_type));
    const redCount = positiveSignals.filter((s) => s.severity === "red").length;
    const orangeCount = positiveSignals.filter((s) => s.severity === "orange").length;
    // Consensus-bonus: elke extra strategie die dit ticker houdt geeft +2 (max +20).
    // Tickers die door veel strategieën worden gehouden hebben hogere prioriteit.
    const consensusBonus = Math.min((consensusByTicker.get(t.ticker) ?? 0) * 2, 20);
    const rankScore = score + redCount * 25 + orangeCount * 10 + consensusBonus;
    const reasonParts: string[] = [];
    if (scoreOk) reasonParts.push(`score ${score}/100`);
    if (redCount > 0) reasonParts.push(`${redCount}× rood signaal`);
    if (orangeCount > 0) reasonParts.push(`${orangeCount}× oranje signaal`);
    if (t.buy_limit != null && price <= Number(t.buy_limit)) reasonParts.push("op/onder buy_limit");
    candidates.push({
      ticker: t.ticker, company: t.company, sector: t.sector,
      price, score, buyLimit: t.buy_limit != null ? Number(t.buy_limit) : null,
      signals: positiveSignals, rankScore, reason: reasonParts.join(" · ") || "kwalificeert",
    });
  }
  candidates.sort((a, b) => b.rankScore - a.rankScore);

  // 5) BUY uitvoeren (transactiekosten inbegrepen).
  // Bear: geen aankopen. Weak_bull: 60% positiegrootte.
  const effectivePositionSize = Math.round(POSITION_SIZE_USD * regimePosScale);
  let bought = 0;
  const buyReasons: string[] = [];
  for (const c of isBullMarket ? candidates : []) {
    if (bought >= slotsAvailable) break;
    if (c.price <= 0) continue;
    const qty = Math.floor((effectivePositionSize / c.price) * 1000) / 1000;
    if (qty <= 0) continue;
    const actualCost = qty * c.price * (1 + TX_COST); // totaal uit kas incl. transactiekosten
    if (cash - actualCost < CASH_RESERVE_USD) continue;
    // Initiële stop = startpunt voor trailing stop (ratchets omhoog in latere runs)
    const fmtP = (n: number) => n.toFixed(c.price < 1 ? 4 : c.price < 10 ? 3 : 2);
    const stopLoss = +fmtP(c.price * (1 - STOP_LOSS));
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

    cash -= actualCost;
    bought++;
    openTickers.add(c.ticker);
    buyReasons.push(`${c.ticker} @ ${c.price.toFixed(c.price < 10 ? 3 : 2)} (${c.reason})`);
  }

  // 6) State updaten + equity-snapshot wegschrijven.
  const { error: stateUpdErr } = await sb.from("xinix_paper_state").update({
    cash, last_run_at: now.toISOString(),
  }).eq("id", 1);
  if (stateUpdErr) throw new Error(`state update: ${stateUpdErr.message}`);

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

  const regimeLabel = regime === "strong_bull" ? "strong bull" : regime === "weak_bull" ? "weak bull (60% pos)" : "bear (geen aankopen)";
  const msg = `${closedCount} gesloten (${closedRealizedUsd >= 0 ? "+" : ""}$${closedRealizedUsd.toFixed(0)}), ${partialCount} deelwinst, ${bought} gekocht, ${openCount} open, equity $${totalEquity.toFixed(0)}, cash $${cash.toFixed(0)} [markt: ${regimeLabel}]`;
  return {
    ok: true,
    message: msg,
    metrics: {
      closed: closedCount, partial_sells: partialCount, bought, open_positions: openCount,
      cash: Number(cash.toFixed(2)), positions_value: Number(positionsValue.toFixed(2)),
      total_equity: Number(totalEquity.toFixed(2)), realized_usd: Number(closedRealizedUsd.toFixed(2)),
      candidates_qualified: candidates.length,
    },
  };
}
