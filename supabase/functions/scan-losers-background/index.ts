// scan-losers-background — eens per dag de "biggest losers of the day" van
// TradingView per markt ophalen, en voor de aandelen die nog niet in de
// watchlist staan de 5y koers-runs (medailleklassement) berekenen. Zit er
// >=2x goud op? Dan automatisch toevoegen aan de watchlist en een ntfy-
// notificatie sturen. Verder vuurt 'ie ook een signal_event ('loser_gem')
// zodat het op het dashboard verschijnt — dispatch-alerts laat dat type met
// rust (notificatie gaat al rechtstreeks vanuit deze functie).

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

// ───────────────────────── config ─────────────────────────
const MARKETS = ["america", "canada", "australia", "uk"]; // TradingView scanner regio's
const LOSERS_PER_MARKET = 40; // top-N grootste dalers per markt bekijken
const MAX_CANDIDATES = 140; // harde cap op aantal Yahoo-checks per run
// Toevoegcriteria — OR-conditie: één van deze drie volstaat.
const MIN_GOLD = 1;
const MIN_SILVER = 1;
const MIN_GOLD_ALT = 2; // OR ≥2× goud
const MIN_SILVER_ALT = 3; // OR ≥3× zilver
const BUDGET_MS = 130_000;
const SLEEP_MS = 250; // langzaam langs Yahoo

// TradingView exchange-prefix -> Yahoo suffix ("" = US, geen suffix).
// Bewust GEEN OTC/PINK: dat zijn de gemanipuleerde pink-sheet shells.
const TV_EXCHANGE_TO_YAHOO_SUFFIX: Record<string, string> = {
  NASDAQ: "", NYSE: "", AMEX: "", BATS: "",
  TSX: ".TO", TSXV: ".V", CSE: ".CN", NEO: ".NE",
  ASX: ".AX",
  LSE: ".L", AQSE: ".L",
};

// ───────────────────────── helpers ─────────────────────────
const MINING_RE = /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|drill(?:ing)?|royalt(?:y|ies)|streaming|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tin|tungsten|molybdenum|rare\s*earth|potash|iron\s*ore|coal)\b/i;
const BIOTECH_RE = /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|gene(?:tic|ric)?|oncolog(?:y|ic)|immuno(?:logy|therap)|cell\s*(?:therap|technolog)|gene\s*therap|medicines?|medical|laboratories|labs|sciences|clinical|antibody|antibodies|vaccines?|RNA|DNA|protein)\b/i;
function inferSector(name: string | null | undefined): "biotech" | "mining" | "other" {
  if (!name) return "other";
  if (MINING_RE.test(name)) return "mining";
  if (BIOTECH_RE.test(name)) return "biotech";
  return "other";
}

interface LoserRow { yahoo: string; name: string; changePct: number | null; close: number | null; exch: string }
async function fetchMarketLosers(market: string): Promise<LoserRow[]> {
  const body = {
    filter: [
      { left: "type", operation: "equal", right: "stock" }, // alleen gewone aandelen, geen ETF/ETN/ETP/fund
      { left: "change", operation: "nempty" },
      { left: "close", operation: "in_range", right: [0.05, 100000] },
      { left: "volume", operation: "egreater", right: 10000 },
    ],
    options: { lang: "en" },
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "description", "change", "close", "exchange"],
    sort: { sortBy: "change", sortOrder: "asc" },
    range: [0, LOSERS_PER_MARKET],
  };
  const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TradingView ${market} HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ s?: string; d?: unknown[] }> };
  const out: LoserRow[] = [];
  for (const row of json.data ?? []) {
    const s = String(row.s ?? "");
    const dot = s.indexOf(":");
    if (dot === -1) continue;
    const exch = s.slice(0, dot).toUpperCase();
    let sym = s.slice(dot + 1).toUpperCase();
    // TradingView gebruikt "." soms voor share classes (BRK.B); Yahoo wil "-".
    sym = sym.replace(/\./g, "-");
    const suffix = TV_EXCHANGE_TO_YAHOO_SUFFIX[exch];
    if (suffix === undefined) continue; // onbekende beurs -> overslaan
    const yahoo = `${sym}${suffix}`;
    const d = (row.d ?? []) as unknown[];
    const name = (d[1] as string) || (d[0] as string) || sym;
    const changePct = typeof d[2] === "number" ? (d[2] as number) : null;
    const close = typeof d[3] === "number" ? (d[3] as number) : null;
    if (changePct != null && changePct >= 0) continue; // alleen dalers
    out.push({ yahoo, name, changePct, close, exch });
  }
  return out;
}

interface Bar { date: string; close: number; }
async function fetchYahoo5y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalLosersBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

// === Medailleklassement — identiek aan compute-extremes-background ===
function classifyLeg(closes: number[], lowIdx: number, highIdx: number): "gold" | "silver" | "bronze" | null {
  if (highIdx <= lowIdx) return null;
  const low = closes[lowIdx];
  const high = closes[highIdx];
  if (low <= 0) return null;
  const gain = (high - low) / low;
  const tiers: Array<[number, "gold" | "silver" | "bronze"]> = [[5.0, "gold"], [2.5, "silver"], [1.0, "bronze"]];
  for (const [thresh, tier] of tiers) {
    if (gain < thresh) continue;
    const level = low * (1 + thresh);
    let barsAbove = 0;
    for (let k = lowIdx; k <= highIdx; k++) if (closes[k] >= level) barsAbove++;
    if (barsAbove >= 2) return tier;
  }
  return null;
}
function countMedals(barsArr: Bar[]): { gold: number; silver: number; bronze: number } {
  const closes = barsArr.map((b) => b.close);
  if (closes.length < 3) return { gold: 0, silver: 0, bronze: 0 };
  let g = 0, s = 0, b = 0;
  let low = closes[0], lowIdx = 0, high = closes[0], highIdx = 0;
  const RETRACE = 0.50;
  function award() {
    const tier = classifyLeg(closes, lowIdx, highIdx);
    if (tier === "gold") g++;
    else if (tier === "silver") s++;
    else if (tier === "bronze") b++;
  }
  for (let i = 1; i < closes.length; i++) {
    const c = closes[i];
    if (highIdx > lowIdx && high > 0 && c <= high * (1 - RETRACE)) { award(); low = c; lowIdx = i; high = c; highIdx = i; continue; }
    if (c < low) { low = c; lowIdx = i; high = c; highIdx = i; continue; }
    if (c > high) { high = c; highIdx = i; }
  }
  award();
  return { gold: g, silver: s, bronze: b };
}

async function sendNtfy(server: string, topic: string, title: string, body: string): Promise<boolean> {
  try {
    const res = await fetch((server || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, title, message: body, priority: 4, tags: ["medal"] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ───────────────────────── main ─────────────────────────
Deno.serve(runBackground("scan-losers", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // 1) Dalers per markt ophalen.
  const losers: LoserRow[] = [];
  const marketErrors: string[] = [];
  for (const m of MARKETS) {
    try {
      const rows = await fetchMarketLosers(m);
      losers.push(...rows);
    } catch (e) {
      marketErrors.push(`${m}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // dedup op yahoo-symbool
  const seen = new Set<string>();
  const uniqueLosers = losers.filter((l) => (seen.has(l.yahoo) ? false : (seen.add(l.yahoo), true)));

  // 2) Welke staan al in de watchlist? Die overslaan.
  const allSymbols = uniqueLosers.map((l) => l.yahoo);
  const existing = new Set<string>();
  if (allSymbols.length) {
    // in() in chunks van 200 ivm URL-lengte
    for (let i = 0; i < allSymbols.length; i += 200) {
      const { data } = await sb.from("signal_tickers").select("ticker").in("ticker", allSymbols.slice(i, i + 200));
      for (const r of data ?? []) existing.add(r.ticker as string);
    }
  }
  const candidates = uniqueLosers.filter((l) => !existing.has(l.yahoo)).slice(0, MAX_CANDIDATES);

  // 3) Per kandidaat: 5y koers ophalen, medailles tellen.
  const gems: Array<{ yahoo: string; name: string; sector: string; gold: number; silver: number; bronze: number; changePct: number | null; exch: string; low5y: number | null }> = [];
  let checked = 0;
  const yahooErrors: string[] = [];
  for (const c of candidates) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    try {
      const bars = await fetchYahoo5y(c.yahoo);
      if (bars.length < 3) continue;
      const medals = countMedals(bars);
      const ok = (medals.gold >= MIN_GOLD && medals.silver >= MIN_SILVER)
              || medals.gold >= MIN_GOLD_ALT
              || medals.silver >= MIN_SILVER_ALT;
      if (ok) {
        const low5y = bars.length ? Math.min(...bars.map((b) => b.close)) : null;
        gems.push({ yahoo: c.yahoo, name: c.name, sector: inferSector(c.name), ...medals, changePct: c.changePct, exch: c.exch, low5y });
      }
    } catch (e) {
      if (yahooErrors.length < 5) yahooErrors.push(`${c.yahoo}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  // 4) Toevoegen + signal_event + notificatie.
  let added = 0;
  if (gems.length) {
    const nowIso = new Date().toISOString();
    const rows = gems.map((g) => {
      // Slimme initiële buy_limit: 10% boven 5y-low (zelfde formule als
      // backfill voor handmatige tickers). Voor US-tickers slaan we de TV
      // exchange-prefix op zodat Google-Finance links direct werken;
      // suffix-tickers regelt googleFinanceUrl zelf via SUFFIX_TO_EXCHANGE.
      const smartLimit = g.low5y != null && g.low5y > 0
        ? Number((g.low5y * 1.10).toFixed(g.low5y < 1 ? 4 : g.low5y < 10 ? 3 : 2))
        : null;
      const exchange = g.yahoo.includes(".") ? null : g.exch;
      return {
        ticker: g.yahoo, company: g.name, sector: g.sector, active: true,
        medal_gold: g.gold, medal_silver: g.silver, medal_bronze: g.bronze, medals_computed_at: nowIso,
        exchange,
        buy_limit: smartLimit,
        notes: `Auto-toegevoegd: biggest-loser-van-de-dag met ${g.gold}× goud + ${g.silver}× zilver (5y koers-runs)${g.changePct != null ? ` — dag ${g.changePct.toFixed(1)}%` : ""}.`,
      };
    });
    const { error } = await sb.from("signal_tickers").upsert(rows, { onConflict: "ticker", ignoreDuplicates: false });
    if (!error) added = rows.length;

    // signal_event zodat het op het dashboard verschijnt (1 per gem)
    for (const g of gems) {
      await sb.from("signal_events").insert({
        ticker: g.yahoo, signal_type: "loser_gem", severity: "yellow",
        title: `${g.yahoo} — grote daler · 🏆${g.gold} \u{1F948}${g.silver} (5y koers-runs)`,
        detail: `${g.name}${g.changePct != null ? ` · vandaag ${g.changePct.toFixed(1)}%` : ""}. Auto-toegevoegd aan de watchlist (≥1g+1s OF ≥${MIN_GOLD_ALT}g OF ≥${MIN_SILVER_ALT}s).`,
        payload: { source: "tradingview_losers", gold: g.gold, silver: g.silver, bronze: g.bronze, change_pct: g.changePct },
        // markeer meteen als alerted: de notificatie gaat hieronder rechtstreeks, niet via dispatch-alerts
        alerted: true,
        expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ntfy
    const { data: settings } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).single();
    const topic = settings?.ntfy_topic as string | null | undefined;
    if (topic) {
      const lines = gems
        .sort((a, b) => b.gold - a.gold || b.silver - a.silver)
        .map((g) => `🏆${g.gold} \u{1F948}${g.silver} ${g.yahoo} — ${g.name}${g.changePct != null ? ` (${g.changePct.toFixed(1)}%)` : ""}`);
      await sendNtfy(
        (settings?.ntfy_server as string) ?? "https://ntfy.sh",
        topic,
        `🏆 ${gems.length} grote daler${gems.length > 1 ? "s" : ""} met medaille-track-record toegevoegd`,
        lines.join("\n") + "\n\nUit de TradingView 'biggest losers' van vandaag; nu in je watchlist.",
      );
    }
  }

  const errs = [...marketErrors, ...yahooErrors];
  return {
    ok: marketErrors.length < MARKETS.length, // alleen fout als ALLE markten faalden
    message: `${uniqueLosers.length} dalers, ${candidates.length} nieuw, ${checked} gecheckt, ${gems.length} met ≥1g+1s OF ≥2g OF ≥3s, ${added} toegevoegd` + (errs.length ? `; ${errs.slice(0, 3).join("; ")}` : ""),
    metrics: { losers: uniqueLosers.length, candidates: candidates.length, checked, gems: gems.length, added, market_errors: marketErrors.length },
  };
}));
