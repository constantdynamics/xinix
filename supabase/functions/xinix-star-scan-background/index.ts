// xinix-star-scan-background — weekend-scan (za + zo via pg_cron) die de hele
// watchlist langs het "5-sterren-DNA" haalt: aandelen die lijken op de
// favorieten die de gebruiker 5 sterren gaf. Profiel (docs/scan-briefing-5sterren.md):
//   • bewezen explosiviteit: 5y top/bodem-ratio ≥ 10× (ideaal ≥ 20×)
//   • diep gecrasht: 60–99% onder de 5-jaarstop (mediaan van de 5★-set: -85%)
//   • verse dip: -20% tot -40% in de laatste ~22 handelsdagen
//   • substantie: market cap $25 mln – $10 mrd (zoet punt $100 mln – $3 mrd)
//   • liquiditeit: voldoende dollarvolume
// Elke kandidaat krijgt een fit-score 0–100 + archetype en wordt geüpsert in
// xinix_star_scan_results. De ranking blijft tussen runs staan (first_seen_at
// toont wanneer iets voor het eerst opdook); wie niet meer voldoet of favoriet
// is geworden krijgt qualifies=false en verdwijnt uit de weergave.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
function runBackground(job: string, fn: () => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401 });
    try {
      const r = await logRun(job, fn);
      return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}

// ── Harde poorten (moet állemaal slagen om überhaupt mee te doen) ─────────────
const MIN_PRICE = 0.10;            // sub-dime = tick-ruis en delisting-territorium
const MIN_MCAP = 20_000_000;       // $20 mln absolute vloer
const MAX_MCAP = 15_000_000_000;   // $15 mrd absolute plafond
const MIN_RANGE_5Y = 8;            // top/bodem-ratio: vloer (scoort pas echt vanaf 10×)
const MIN_CRASH_PCT = 40;          // minstens 40% onder de 5-jaarstop (archetype 1 zit op 40–75%)
const MIN_DOLLAR_VOL = 200_000;    // $200k gemiddeld dagvolume in dollars

// Alleen goed-passende kandidaten worden getoond ("alleen aandelen die er
// goed aan voldoen"): fit-score moet minimaal deze drempel halen.
// Op 65 kwalificeerde ~13% van de watchlist (480 stuks) — te ruim; op 80
// blijft ongeveer het beste kwart daarvan over.
const MIN_SCORE = 80;

// Ntfy-melding voor nieuwkomers: alleen wanneer een ticker die nog niet op de
// lijst stond binnenkomt met een fit-score van minimaal deze drempel.
const NOTIFY_MIN_SCORE = 90;

const PAGE = 1000;

interface TickerRow {
  ticker: string; company: string | null; sector: string | null; exchange: string | null;
  yahoo_industry: string | null; market_cap_usd: number | null;
  medal_gold: number | null; medal_silver: number | null;
}
interface PriceRow {
  ticker: string; last_close: number | null; high_5y: number | null; low_5y: number | null;
  pct_change_22d: number | null; avg_volume_30d: number | null;
}

function num(v: unknown): number | null { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

// Gepagineerd ophalen — de PostgREST 10k-rijencap geldt ook hier, en de
// watchlist telt 3700+ tickers, dus altijd in pagina's lezen.
async function fetchAll<T>(sb: ReturnType<typeof getServiceClient>, table: string, cols: string, activeOnly = false): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).order("ticker").range(from, from + PAGE - 1);
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${(error as { message?: string }).message ?? String(error)}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ── Fit-score 0–100 ───────────────────────────────────────────────────────────
// Gewichten volgen het 5★-profiel: explosiviteit en crash-diepte zijn de kern
// (samen 50), verse dip is de timing (20), substantie + liquiditeit de
// kwaliteitsfilters (25), medailles een kleine bonus (5).
interface Scored {
  score: number;
  breakdown: Record<string, number>;
}
function fitScore(rangeMult: number, crashPct: number, chg22d: number | null, mcap: number, dollarVol: number, gold: number, silver: number): Scored {
  // Explosiviteit (max 25): ≥20× vol, 10–20× lineair 15→25, 8–10× karig.
  let explosiviteit: number;
  if (rangeMult >= 20) explosiviteit = 25;
  else if (rangeMult >= 10) explosiviteit = 15 + ((rangeMult - 10) / 10) * 10;
  else explosiviteit = 10;

  // Crash-diepte (max 25): zoete zone 75–95% onder de top; 60–75% lineair
  // 15→25; 95–99% iets minder (bijna dood); >99% en 40–60% karig.
  let crash: number;
  if (crashPct >= 75 && crashPct <= 95) crash = 25;
  else if (crashPct >= 60) crash = crashPct < 75 ? 15 + ((crashPct - 60) / 15) * 10 : 20; // >95–99
  else crash = 10; // 40–60%
  if (crashPct > 99) crash = 10;

  // Verse dip (max 20): -20..-40% in ~22d is het patroon waarop de gebruiker
  // 5 sterren geeft; lichtere dips tellen minder, stijgers niets.
  let dip = 0;
  if (chg22d != null) {
    if (chg22d <= -40) dip = 14;
    else if (chg22d <= -20) dip = 20;
    else if (chg22d <= -10) dip = 12;
    else if (chg22d < 0) dip = 5;
  }

  // Substantie (max 15): zoet punt $100 mln – $3 mrd.
  let substantie: number;
  if (mcap >= 100e6 && mcap <= 3e9) substantie = 15;
  else if (mcap > 3e9 && mcap <= 10e9) substantie = 12;
  else if (mcap >= 25e6) substantie = 10;
  else substantie = 6; // 20–25 mln
  if (mcap > 10e9) substantie = 6;

  // Liquiditeit (max 10).
  let liquiditeit: number;
  if (dollarVol >= 5e6) liquiditeit = 10;
  else if (dollarVol >= 1e6) liquiditeit = 8;
  else if (dollarVol >= 500e3) liquiditeit = 5;
  else liquiditeit = 2;

  // Medaille-bonus (max 5): bewezen koersruns in het track-record.
  let medailles = 0;
  if (gold >= 2) medailles = 5;
  else if (gold === 1) medailles = 3;
  else if (silver >= 2) medailles = 2;

  const breakdown = { explosiviteit: Math.round(explosiviteit * 10) / 10, crash, dip, substantie, liquiditeit, medailles };
  const score = Math.round((explosiviteit + crash + dip + substantie + liquiditeit + medailles) * 10) / 10;
  return { score, breakdown };
}

// ── Ntfy (zelfde aanpak als xinix-fav-alerts) ────────────────────────────────
async function sendNtfy(server: string, topic: string, title: string, body: string, clickUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const payload: Record<string, unknown> = { topic, title, message: body, priority: 4, tags: ["star2"], click: clickUrl };
    const res = await fetch((server || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `ntfy ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
// Deze functie meldt in batch (één ping met meerdere nieuwkomers) en heeft dus
// geen eigen cooldown-poort nodig. Wel vastleggen wát er gepingd is, zodat de
// gedeelde cooldown (xinix_notify_gate) weet dat deze aandelen net langs zijn
// gekomen en de andere meldingsfuncties ze niet meteen opnieuw aankaarten.
async function notifyRecord(sb: ReturnType<typeof getServiceClient>, tickers: string[], alertKey: string, priority: number): Promise<void> {
  if (tickers.length === 0) return;
  await sb.rpc("xinix_notify_record", { p_items: tickers.map((ticker) => ({ ticker, source: "star-scan", alert_key: alertKey, priority })) });
}

// Zero-width space tussen base en suffix zodat ntfy .TO/.AX niet als TLD linkt.
function safeTickerDisplay(ticker: string): string { return ticker.replace(/\./g, "​."); }
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", L: "LON", AX: "ASX", HK: "HKG", DE: "ETR", PA: "EPA", AS: "AMS", ST: "STO", OL: "OSL", CO: "CPH", SW: "SWX", MI: "BIT" };
function googleExchangeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.includes("nasdaq") || e === "nms" || e === "ngm" || e === "ncm") return "NASDAQ";
  if (e.includes("amex") || e.includes("nyse american")) return "NYSEAMERICAN";
  if (e === "nyse" || e === "nyq") return "NYSE";
  return null;
}
function googleFinanceUrl(ticker: string, exchange: string | null): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) { const code = googleExchangeCode(exchange) ?? "NASDAQ"; return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${code}`; }
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(t.slice(0, dot))}:${exch}`;
}
function reviewUrl(ticker: string): string { return `https://constantdynamics.github.io/xinix/?review=${encodeURIComponent(ticker.trim().toUpperCase())}`; }

// Archetype-indeling, zelfde vier types als de briefing.
const CRYPTO_RE = /\b(bitcoin|crypto|blockchain|digital\s+(assets?|technolog|mining)|hut\s*8|terawulf|hive|miner)\b/i;
function archetypeOf(company: string | null, industry: string | null, mcap: number, xAboveLow: number, crashPct: number): string {
  const naam = `${company ?? ""} ${industry ?? ""}`;
  if (CRYPTO_RE.test(naam)) return "crypto_infra";
  if (mcap >= 1e9 && xAboveLow >= 8) return "herstelde_reus";
  if (crashPct >= 90 && xAboveLow <= 2) return "capitulatie";
  return "spike_machine";
}

Deno.serve(runBackground("xinix-star-scan", async () => {
  const sb = getServiceClient();

  const [tickers, prices, favRows] = await Promise.all([
    fetchAll<TickerRow>(sb, "signal_tickers", "ticker, company, sector, exchange, yahoo_industry, market_cap_usd, medal_gold, medal_silver", true),
    fetchAll<PriceRow>(sb, "signal_price_summary", "ticker, last_close, high_5y, low_5y, pct_change_22d, avg_volume_30d"),
    sb.from("xinix_favorites").select("ticker").then((r) => r.data ?? []),
  ]);
  const priceByTicker = new Map(prices.map((p) => [p.ticker, p]));
  const favSet = new Set(favRows.map((f) => (f.ticker as string).toUpperCase()));

  const nowIso = new Date().toISOString();
  let gatesFailed = 0, belowScore = 0, isFavorite = 0, noData = 0;
  const qualifying: Array<Record<string, unknown>> = [];

  for (const t of tickers) {
    const p = priceByTicker.get(t.ticker);
    const close = num(p?.last_close);
    const high5y = num(p?.high_5y);
    const low5y = num(p?.low_5y);
    const mcap = num(t.market_cap_usd);
    if (!p || close == null || high5y == null || low5y == null || low5y <= 0 || high5y <= 0 || mcap == null) { noData++; continue; }
    if (favSet.has(t.ticker.toUpperCase())) { isFavorite++; continue; }

    const rangeMult = high5y / low5y;
    const crashPct = ((high5y - close) / high5y) * 100;
    const xAboveLow = close / low5y;
    const chg22d = num(p.pct_change_22d);
    const avgVol = num(p.avg_volume_30d) ?? 0;
    const dollarVol = avgVol * close;

    const passesGates = close >= MIN_PRICE
      && mcap >= MIN_MCAP && mcap <= MAX_MCAP
      && rangeMult >= MIN_RANGE_5Y
      && crashPct >= MIN_CRASH_PCT && crashPct < 100
      && dollarVol >= MIN_DOLLAR_VOL;
    if (!passesGates) { gatesFailed++; continue; }

    const gold = t.medal_gold ?? 0;
    const silver = t.medal_silver ?? 0;
    const { score, breakdown } = fitScore(rangeMult, crashPct, chg22d, mcap, dollarVol, gold, silver);
    if (score < MIN_SCORE) { belowScore++; continue; }

    qualifying.push({
      ticker: t.ticker,
      qualifies: true,
      score,
      archetype: archetypeOf(t.company, t.yahoo_industry, mcap, xAboveLow, crashPct),
      reason: null,
      company: t.company,
      sector: t.sector,
      exchange: t.exchange,
      yahoo_industry: t.yahoo_industry,
      last_close: close,
      market_cap_usd: Math.round(mcap),
      range_5y: Math.round(rangeMult * 10) / 10,
      pct_vs_high5y: Math.round(-crashPct * 10) / 10,
      x_above_low5y: Math.round(xAboveLow * 10) / 10,
      pct_change_22d: chg22d,
      dollar_volume: Math.round(dollarVol),
      medal_gold: gold,
      medal_silver: silver,
      breakdown,
      last_seen_at: nowIso,
    });
  }

  // Upsert in twee stappen zodat first_seen_at en best_score behouden blijven:
  // bestaande rijen krijgen een update zonder first_seen_at; nieuwe rijen
  // krijgen alles. best_score = hoogste score ooit gezien.
  const existing = await fetchAll<{ ticker: string; best_score: number | null; qualifies: boolean | null }>(sb, "xinix_star_scan_results", "ticker, best_score, qualifies");
  const existingBest = new Map(existing.map((e) => [e.ticker, num(e.best_score) ?? 0]));
  // "Huidige lijst" vóór deze run: tickers die al zichtbaar waren. Nieuwkomers
  // (nog nooit gezien, of eerder afgevallen en nu terug) met fit ≥ 90 pingen.
  const wasOnList = new Set(existing.filter((e) => e.qualifies === true).map((e) => e.ticker));

  const errors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < qualifying.length; i += 200) {
    const chunk = qualifying.slice(i, i + 200).map((row) => ({
      ...row,
      best_score: Math.max(row.score as number, existingBest.get(row.ticker as string) ?? 0),
    }));
    const { error } = await sb.from("xinix_star_scan_results").upsert(chunk, { onConflict: "ticker", ignoreDuplicates: false });
    if (error) { errors.push(`upsert: ${(error as { message?: string }).message ?? String(error)}`); break; }
    upserted += chunk.length;
  }

  // Eerder gekwalificeerde tickers die deze run niet meer voldoen → qualifies=false.
  // Onderscheid in reason zodat de UI/het logboek kan zien waarom iets wegviel.
  const qualifyingSet = new Set(qualifying.map((q) => q.ticker as string));
  const dropped = existing.map((e) => e.ticker).filter((tk) => !qualifyingSet.has(tk));
  let deactivated = 0;
  for (let i = 0; i < dropped.length; i += 200) {
    const chunk = dropped.slice(i, i + 200);
    const favChunk = chunk.filter((tk) => favSet.has(tk.toUpperCase()));
    const restChunk = chunk.filter((tk) => !favSet.has(tk.toUpperCase()));
    if (favChunk.length) {
      const { error } = await sb.from("xinix_star_scan_results").update({ qualifies: false, reason: "favoriet geworden" }).in("ticker", favChunk).eq("qualifies", true);
      if (error) errors.push(`deactivate fav: ${(error as { message?: string }).message ?? String(error)}`);
      else deactivated += favChunk.length;
    }
    if (restChunk.length) {
      const { error } = await sb.from("xinix_star_scan_results").update({ qualifies: false, reason: "voldoet niet meer aan criteria" }).in("ticker", restChunk).eq("qualifies", true);
      if (error) errors.push(`deactivate: ${(error as { message?: string }).message ?? String(error)}`);
      else deactivated += restChunk.length;
    }
  }

  // Ntfy voor nieuwkomers met topscore. De zondagsrun herhaalt zaterdagse
  // vondsten niet: die staan dan al met qualifies=true in de tabel.
  const newcomers = qualifying
    .filter((q) => (q.score as number) >= NOTIFY_MIN_SCORE && !wasOnList.has(q.ticker as string))
    .sort((a, b) => (b.score as number) - (a.score as number));
  let notified = 0;
  if (newcomers.length > 0 && errors.length === 0) {
    const { data: settings } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).single();
    const topic = settings?.ntfy_topic as string | null | undefined;
    if (topic) {
      const server = (settings?.ntfy_server as string) ?? "https://ntfy.sh";
      const shown = newcomers.slice(0, 10);
      const lines = shown.map((q) => {
        const chg = num(q.pct_change_22d);
        return [
          `🌟 Fit ${(q.score as number).toFixed(0)} · ${safeTickerDisplay(q.ticker as string)} — ${q.company ?? "?"}`,
          `   ${q.pct_vs_high5y}% vs 5j-top · ${chg != null ? `${chg.toFixed(1)}% in 22d` : "22d onbekend"} · ${q.archetype}`,
          `   📲 ${reviewUrl(q.ticker as string)}`,
          `   🔗 ${googleFinanceUrl(q.ticker as string, (q.exchange as string | null) ?? null)}`,
        ].join("\n");
      });
      if (newcomers.length > shown.length) lines.push(`… en nog ${newcomers.length - shown.length} meer in het Scanner-tabblad.`);
      const clickUrl = shown.length === 1
        ? reviewUrl(shown[0].ticker as string)
        : "https://constantdynamics.github.io/xinix/?tab=favorieten";
      const r = await sendNtfy(
        server, topic,
        `🌟 ${newcomers.length} nieuwe 5-sterren-kandidaat${newcomers.length > 1 ? "en" : ""} (fit ≥ ${NOTIFY_MIN_SCORE})`,
        lines.join("\n\n") + "\n\nNieuw op de scanner-ranking dit weekend.",
        clickUrl,
      );
      if (r.ok) {
        notified = newcomers.length;
        await notifyRecord(sb, shown.map((q) => q.ticker as string), "star_scan_newcomer", 4);
      } else errors.push(`ntfy: ${r.error}`);
    }
  }

  return {
    ok: errors.length === 0,
    message: `${tickers.length} tickers gescand: ${qualifying.length} kwalificeren (score ≥ ${MIN_SCORE}), ${upserted} geüpsert, ${deactivated} gedeactiveerd, ${notified} genotificeerd (nieuw ≥ ${NOTIFY_MIN_SCORE}); ${gatesFailed} poorten, ${belowScore} score te laag, ${isFavorite} favoriet, ${noData} zonder data` + (errors.length ? `; fouten: ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { scanned: tickers.length, qualifying: qualifying.length, upserted, deactivated, notified, gates_failed: gatesFailed, below_score: belowScore, favorites_skipped: isFavorite, no_data: noData, errors: errors.length },
  };
}));
