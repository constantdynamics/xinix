// scan-fallen-phoenix-background — gerichte feniks-jacht. Anders dan
// scan-bottoms (die generiek naar 5y-bodems zoekt en op medailles/feniks
// kwalificeert) zoekt deze functie specifiek het FENIKS-profiel:
//   • ooit een echte run gemaakt: ≥40× met een piek ≥ $1
//   • nu ≥90% onder die piek gevallen (de "gevallen feniks")
// Dat laatste mist scan-bottoms juist: die eist "binnen 10% van de 5y-low",
// terwijl een gevallen feniks al van zijn bodem kan zijn weggebounced en tóch
// 90% onder de piek staat. Door op het run+drawdown-profiel te filteren is élke
// treffer per definitie een feniks — veel hogere hitrate dan de generieke scans.
//
// Goedkoop: TradingView's all-time-high-kolom (High.All) dient als voorfilter
// (≥90% onder een ATH ≥ $1) zodat we alleen kansrijke kandidaten bij Yahoo
// verifiëren. De échte run-detectie gebeurt op de Yahoo 10y-bars (hasPhoenixRun
// + drawdown), conform de afgesproken definitie in compute-phoenix-background.

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

// ───────────── config ─────────────
const PHOENIX_MULT = 40;            // run moet ≥40× zijn (afgesproken feniks-drempel)
const PHOENIX_MIN_PEAK = 1.0;       // piek moet ≥ $1 raken (geen sub-penny nep-feniks)
const PHOENIX_MAX_BAR_JUMP = 5;     // enkele bar ≥5× vorige = split/ruis-artefact, overslaan
const ATH_MIN = 1.0;                // all-time-high moet ≥ $1 zijn geweest
const MAX_FRACTION_OF_PEAK = 0.10;  // huidige koers ≤ 10% van de piek = ≥90% gevallen
const PERF5Y_TOPN = 300;            // brede pool per markt (slechtste 5y-performers)
const MAX_CANDIDATES = 240;         // harde cap op Yahoo-checks per run
const BUDGET_MS = 132_000;
const SLEEP_MS = 230;

// Saxo-achtige beurzen, verdeeld over de week (getUTCDay 0=zo … 6=za) — zelfde
// rotatie als scan-bottoms, zodat de hele universe wekelijks langskomt.
interface Mkt { region: string; suffix: string }
const MARKETS_BY_DAY: Record<number, Mkt[]> = {
  0: [{ region: "america", suffix: "" }, { region: "canada", suffix: ".TO" }],
  1: [{ region: "uk", suffix: ".L" }, { region: "germany", suffix: ".DE" }, { region: "france", suffix: ".PA" }],
  2: [{ region: "netherlands", suffix: ".AS" }, { region: "belgium", suffix: ".BR" }, { region: "italy", suffix: ".MI" }, { region: "spain", suffix: ".MC" }, { region: "portugal", suffix: ".LS" }, { region: "poland", suffix: ".WA" }],
  3: [{ region: "switzerland", suffix: ".SW" }, { region: "sweden", suffix: ".ST" }, { region: "norway", suffix: ".OL" }, { region: "denmark", suffix: ".CO" }, { region: "finland", suffix: ".HE" }],
  4: [{ region: "australia", suffix: ".AX" }, { region: "hongkong", suffix: ".HK" }],
  5: [{ region: "japan", suffix: ".T" }, { region: "singapore", suffix: ".SI" }],
  6: [{ region: "america", suffix: "" }, { region: "canada", suffix: ".TO" }],
};
const SKIP = " ";
const PREFIX_OVERRIDE: Record<string, string> = {
  TSX: ".TO", TSXV: ".V", CSE: ".CN", NEO: ".NE", CBOECA: ".NE",
  OTC: SKIP, OTCMKTS: SKIP, PINK: SKIP, OTCQB: SKIP, OTCQX: SKIP, GREY: SKIP,
};

const ETP_RE = /\b(leverage\s*shares|direxion|wisdomtree|proshares|invesco|graniteshares|boost\s*etp|roundhill)\b|\b[2-9]x\s+(long|short|bull|bear)\b|\betp\b|\betf\b/i;
function isEtp(name: string): boolean { return ETP_RE.test(name); }

// London IOB "ghost"-noteringen: 4-tekens code beginnend met een cijfer (bv.
// 0JI3.L) van buitenlandse bedrijven. Duplicaat-listings zonder liquiditeit.
const LONDON_IOB_RE = /^[0-9][0-9A-Z]{3}\.L$/i;
function isLondonIOB(yahoo: string): boolean { return LONDON_IOB_RE.test(yahoo); }

const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO",
  L: "LON", AX: "ASX", NZ: "NZE", SW: "SWX",
  DE: "ETR", PA: "EPA", AS: "AMS", MI: "BIT", MC: "BME",
  ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", WA: "WSE",
  BR: "EBR", LS: "ELI", HK: "HKG", T: "TYO", SI: "SGX",
};
function googleFinanceUrl(yahoo: string): string {
  const t = yahoo.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:NASDAQ`;
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}

const MINING_RE = /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|drill(?:ing)?|royalt(?:y|ies)|streaming|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tin|tungsten|molybdenum|rare\s*earth|potash|iron\s*ore|coal)\b/i;
const BIOTECH_RE = /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|gene(?:tic|ric)?|oncolog(?:y|ic)|immuno(?:logy|therap)|cell\s*(?:therap|technolog)|gene\s*therap|medicines?|medical|laboratories|labs|sciences|clinical|antibody|antibodies|vaccines?|RNA|DNA|protein)\b/i;
function inferSector(name: string | null | undefined): "biotech" | "mining" | "other" {
  if (!name) return "other";
  if (MINING_RE.test(name)) return "mining";
  if (BIOTECH_RE.test(name)) return "biotech";
  return "other";
}

interface Cand { yahoo: string; name: string; exch: string }
// TradingView: slechtste 5y-performers per markt, met all-time-high als
// goedkope voorfilter. Alleen rijen die ≥90% onder een ATH ≥ $1 staan gaan
// door naar de (dure) Yahoo-verificatie. Rijen zonder bruikbare High.All
// laten we voor de zekerheid door — Yahoo beslist dan alsnog.
async function tvScan(region: string, topN: number, suffix: string): Promise<Cand[]> {
  const body = {
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "close", operation: "in_range", right: [0.02, 50] },
      { left: "volume", operation: "egreater", right: 5000 },
    ],
    options: { lang: "en" },
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "description", "close", "High.All", "exchange"],
    sort: { sortBy: "Perf.5Y", sortOrder: "asc" },
    range: [0, topN],
  };
  const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TV ${region} HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ s?: string; d?: unknown[] }> };
  const out: Cand[] = [];
  for (const row of json.data ?? []) {
    const s = String(row.s ?? "");
    const colon = s.indexOf(":");
    if (colon === -1) continue;
    const prefix = s.slice(0, colon).toUpperCase();
    const sym = s.slice(colon + 1).toUpperCase().replace(/\./g, "-");
    const ov = PREFIX_OVERRIDE[prefix];
    if (ov === SKIP) continue;
    const sfx = ov ?? suffix;
    const d = (row.d ?? []) as unknown[];
    const name = (d[1] as string) || (d[0] as string) || sym;
    const close = typeof d[2] === "number" ? (d[2] as number) : null;
    const athAll = typeof d[3] === "number" ? (d[3] as number) : null;
    if (isEtp(name)) continue;
    // Voorfilter op all-time-high (indien beschikbaar): ATH ≥ $1 én ≥90% gevallen.
    if (athAll != null && athAll > 0 && close != null) {
      if (athAll < ATH_MIN) continue;
      if (close > athAll * MAX_FRACTION_OF_PEAK) continue;
    }
    const yahoo = `${sym}${sfx}`;
    if (isLondonIOB(yahoo)) continue;
    out.push({ yahoo, name, exch: prefix });
  }
  return out;
}

interface Bar { date: string; close: number }
async function fetchYahoo10y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalFallenPhoenixBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

// Feniks-run, in lijn met compute-phoenix-background: ≥40× vanaf een lopend
// minimum, piek ≥ $1, en enkele bar ≥5× de vorige (split/ruis) overgeslagen.
function hasPhoenixRun(closes: number[]): boolean {
  const clean: number[] = [];
  let prev = NaN;
  for (const c of closes) {
    if (Number.isFinite(prev) && prev > 0 && c >= prev * PHOENIX_MAX_BAR_JUMP) { prev = c; continue; }
    clean.push(c); prev = c;
  }
  let minSoFar = Infinity;
  for (const c of clean) {
    if (c < minSoFar) { minSoFar = c; continue; }
    if (minSoFar > 0 && c >= minSoFar * PHOENIX_MULT && c >= PHOENIX_MIN_PEAK) return true;
  }
  return false;
}

async function sendNtfy(server: string, topic: string, title: string, body: string, clickUrl?: string): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = { topic, title, message: body, priority: 4, tags: ["bird", "chart_with_downwards_trend"] };
    if (clickUrl) payload.click = clickUrl;
    const res = await fetch((server || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

Deno.serve(runBackground("scan-fallen-phoenix", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();
  const markets = MARKETS_BY_DAY[new Date().getUTCDay()] ?? MARKETS_BY_DAY[0];

  // 1) Kandidaten per markt (slechtste 5y-performers, voorgefilterd op ATH).
  const candMap = new Map<string, { name: string; exch: string }>();
  const tvErrors: string[] = [];
  for (const m of markets) {
    try {
      const rows = await tvScan(m.region, PERF5Y_TOPN, m.suffix);
      for (const c of rows) if (!candMap.has(c.yahoo)) candMap.set(c.yahoo, { name: c.name, exch: c.exch });
    } catch (e) {
      tvErrors.push(`${m.region}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const allCands = [...candMap.entries()].map(([yahoo, v]) => ({ yahoo, name: v.name, exch: v.exch }));

  // 2) Al in de watchlist? Overslaan.
  const existing = new Set<string>();
  const allSyms = allCands.map((c) => c.yahoo);
  for (let i = 0; i < allSyms.length; i += 200) {
    const { data } = await sb.from("signal_tickers").select("ticker").in("ticker", allSyms.slice(i, i + 200));
    for (const r of data ?? []) existing.add(r.ticker as string);
  }
  const candidates = allCands.filter((c) => !existing.has(c.yahoo)).slice(0, MAX_CANDIDATES);

  // 3) Per kandidaat: 10y koers ophalen, feniks-run + ≥90%-drawdown verifiëren.
  const gems: Array<{ yahoo: string; name: string; sector: string; lastClose: number; peak: number; peakDate: string; low5y: number; drawdownPct: number; exch: string; firstPriceDate: string | null }> = [];
  let checked = 0;
  const yErrors: string[] = [];
  for (const c of candidates) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    try {
      const bars = await fetchYahoo10y(c.yahoo);
      if (bars.length < 20) continue;
      const closes = bars.map((b) => b.close);
      if (!hasPhoenixRun(closes)) continue; // geen echte ≥40×-run met piek ≥$1
      const lastClose = closes[closes.length - 1];
      let peak = -Infinity, peakIdx = 0;
      for (let k = 0; k < closes.length; k++) if (closes[k] > peak) { peak = closes[k]; peakIdx = k; }
      if (peak <= 0) continue;
      const fraction = lastClose / peak;
      if (fraction > MAX_FRACTION_OF_PEAK) continue; // niet ≥90% gevallen
      const bars5y = bars.slice(-260);
      const low5y = Math.min(...bars5y.map((b) => b.close));
      gems.push({
        yahoo: c.yahoo, name: c.name, sector: inferSector(c.name),
        lastClose, peak, peakDate: bars[peakIdx]?.date ?? "", low5y,
        drawdownPct: (1 - fraction) * 100, exch: c.exch,
        firstPriceDate: bars[0]?.date ?? null,
      });
    } catch (e) {
      if (yErrors.length < 5) yErrors.push(`${c.yahoo}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  // 4) Toevoegen + signal_event + notificatie.
  let added = 0;
  if (gems.length) {
    const nowIso = new Date().toISOString();
    const rows = gems.map((g) => {
      // Initiële buy_limit = de échte 5y-low, zodat 'ie pas alerteert als het
      // aandeel zijn meerjarige bodem raakt (niet meteen).
      const smartLimit = g.low5y > 0 ? Number(g.low5y.toFixed(g.low5y < 1 ? 4 : g.low5y < 10 ? 3 : 2)) : null;
      const exchange = g.yahoo.includes(".") ? null : g.exch;
      return {
        ticker: g.yahoo, company: g.name, sector: g.sector, active: true,
        exchange, buy_limit: smartLimit,
        is_phoenix: true,
        first_price_date: g.firstPriceDate ?? null,
        notes: `Auto-toegevoegd: gevallen feniks — ${g.drawdownPct.toFixed(0)}% onder piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} (${g.peakDate}); run ≥${PHOENIX_MULT}×. Wordt door compute-phoenix nog strikt geverifieerd.`,
      };
    });
    const { error } = await sb.from("signal_tickers").upsert(rows, { onConflict: "ticker", ignoreDuplicates: false });
    if (!error) added = rows.length;

    for (const g of gems) {
      await sb.from("signal_events").insert({
        ticker: g.yahoo, signal_type: "fallen_phoenix_gem", severity: "yellow",
        title: `${g.yahoo} — gevallen feniks · -${g.drawdownPct.toFixed(0)}% onder piek`,
        detail: `${g.name} · koers ~${g.lastClose.toFixed(g.lastClose < 5 ? 3 : 2)}, piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} (${g.peakDate}). Ooit ≥${PHOENIX_MULT}× gestegen en nu ${g.drawdownPct.toFixed(0)}% gevallen. Auto-toegevoegd aan de watchlist.`,
        payload: { source: "tradingview_fallen_phoenix", last_close: g.lastClose, peak: g.peak, peak_date: g.peakDate, drawdown_pct: g.drawdownPct, low_5y: g.low5y },
        alerted: true,
        expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    const { data: settings } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).single();
    const topic = settings?.ntfy_topic as string | null | undefined;
    if (topic) {
      const sorted = gems.sort((a, b) => b.drawdownPct - a.drawdownPct);
      const lines = sorted.map((g) => {
        const url = googleFinanceUrl(g.yahoo);
        return `\u{1F985} ${g.yahoo} — ${g.name}\n   piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} → nu ~${g.lastClose.toFixed(g.lastClose < 5 ? 3 : 2)} (-${g.drawdownPct.toFixed(0)}%)\n${url}`;
      });
      await sendNtfy(
        (settings?.ntfy_server as string) ?? "https://ntfy.sh",
        topic,
        `\u{1F985} ${gems.length} gevallen feniks${gems.length > 1 ? "en" : ""} toegevoegd (ooit ≥${PHOENIX_MULT}×, nu ≥90% gevallen)`,
        lines.join("\n\n") + `\n\nGescreend over ${markets.map((m) => m.region).join(", ")}; nu in je watchlist.`,
        googleFinanceUrl(sorted[0].yahoo),
      );
    }
  }

  const errs = [...tvErrors, ...yErrors];
  return {
    ok: tvErrors.length < markets.length, // alleen fout als (vrijwel) alle markten faalden
    message: `markten: ${markets.map((m) => m.region).join("/")}; ${allCands.length} kandidaten (voorgefilterd), ${candidates.length} nieuw, ${checked} gecheckt, ${gems.length} gevallen feniks(en), ${added} toegevoegd` + (errs.length ? `; ${errs.slice(0, 3).join("; ")}` : ""),
    metrics: { day: new Date().getUTCDay(), markets: markets.map((m) => m.region), candidates_total: allCands.length, candidates_new: candidates.length, checked, gems: gems.length, added },
  };
}));
