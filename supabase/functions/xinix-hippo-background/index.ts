// xinix-hippo-background — "Hippos": welke favorieten hebben nú de grootste kans
// om binnen 14 dagen minimaal +50% te stijgen? Stuurt een ntfy-melding zodra
// die kans boven signal_settings.hippo_alert_min_prob komt (standaard 80%).
//
// ── Hoe de kans wordt gemeten ────────────────────────────────────────────────
// De gebeurtenis: vanaf een handelsdag t haalt de slotkoers in de 10
// handelsdagen daarna (≈ 14 kalenderdagen) minimaal +50%, en de dag ná dat
// moment staat de koers nog ≥ +20% (anders is het een 1-dags data-piek).
//
// 1. Scan (gebudgetteerd, ~100 favorieten per run, herscan per 30 dagen):
//    10 jaar dagkoersen per favoriet bij Yahoo. Per dag: gebeurde het? Plus
//    vijf toestandskenmerken van die dag, in buckets. Per bucket tellen we
//    n en treffers. Alleen tellingen worden opgeslagen, geen koersen.
// 2. Score (elke run, op verse koersen uit signal_price_summary):
//    basiskans p0 = alle treffers / alle dagen over alle favorieten.
//    Per bucket een lift = gemeten kans in die bucket / p0 (gekrompen naar 1
//    bij weinig waarnemingen). Eigen historie van het aandeel telt als extra
//    lift. Modelkans = odds(p0) × eigen-lift × Π bucket-lifts.
// 3. Kalibratie: de kenmerken overlappen (een aandeel midden in een sprint
//    scoort op alles tegelijk), dus die vermenigvuldiging overdrijft. Bij elke
//    herscan wordt de modelkans voor élke historische dag uitgerekend en per
//    kansbucket geteld hoe vaak het écht gebeurde. De getoonde kans is die
//    gemeten frequentie — niet wat het model roept.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function runBackground(job: string, fn: () => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401, headers: cors(req) });
    try {
      const r = await logRun(job, fn);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { ...cors(req), "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
    }
  };
}

// ── ntfy + links (zelfde aanpak als xinix-fav-alerts) ────────────────────────
interface Settings { ntfy_topic: string | null; ntfy_server: string; quiet_hours_start: number | null; quiet_hours_end: number | null; hippo_alert_min_prob: number | null; }
function inQuietHours(s: Settings): boolean { if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false; const h = new Date().getUTCHours(); const start = s.quiet_hours_start; const end = s.quiet_hours_end; if (start === end) return false; if (start < end) return h >= start && h < end; return h >= start || h < end; }
async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
  if (clickUrl) payload.click = clickUrl;
  const res = await fetch(server.replace(/\/$/, ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) { const text = await res.text(); return { ok: false, error: `ntfy ${res.status}: ${text}` }; }
  return { ok: true };
}
function safeTickerDisplay(ticker: string): string { return ticker.replace(/\./g, "​."); }
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO", L: "LON", DE: "ETR", F: "FRA", SW: "SWX", PA: "EPA", AS: "AMS", BR: "EBR", MI: "BIT", MC: "BME", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", HK: "HKG", T: "TYO", AX: "ASX", NZ: "NZE", TA: "TLV", JO: "JSE", SA: "BVMF", MX: "BMV" };
function googleExchangeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.includes("nasdaq") || e === "nms" || e === "ngm" || e === "ncm") return "NASDAQ";
  if (e.includes("arca") || e === "pcx") return "NYSEARCA";
  if (e.includes("amex") || e === "ase" || e.includes("nyse mkt") || e.includes("nyse american")) return "NYSEAMERICAN";
  if (e === "nyse" || e === "nyq" || e === "new york stock exchange") return "NYSE";
  if (e.includes("cboe") || e.includes("bats") || e === "bts" || e === "bzx") return "BATS";
  if (e.includes("otc") || e.includes("pink") || e === "pnk") return "OTCMKTS";
  if (e.includes("toronto") && e.includes("vent")) return "CVE";
  if (e === "toronto") return "TSE";
  return null;
}
function googleFinanceUrl(ticker: string, exchange?: string | null): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) { const code = googleExchangeCode(exchange) ?? "NASDAQ"; return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${code}`; }
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}
function yahooFinanceUrl(ticker: string): string { return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.trim().toUpperCase())}`; }
function favAppUrl(ticker: string): string { return `https://constantdynamics.github.io/xinix/?review=${encodeURIComponent(ticker.trim().toUpperCase())}`; }

// ── Parameters ───────────────────────────────────────────────────────────────
const EVENT_MULT = 1.5;       // +50%
const FWD_BARS = 10;          // 10 handelsdagen ≈ 14 kalenderdagen
const HOLD_MULT = 1.2;        // de dag erna nog ≥ +20%, anders een 1-dags data-piek
const MIN_PRICE = 0.10;       // sub-dime-koersen zijn ruis (zelfde grens als poefies)
const MAX_BAR_JUMP = 5;       // bar ≥5× de vorige én meteen terug = data-fout
const MIN_BARS = 120;
// Yahoo kost ~0,35 s per ticker, maar de echte grens is de CPU-limiet van de
// edge runtime (2 s per aanroep): een batch van 250 werd na ~160 tickers
// afgebroken. 100 is gemeten veilig; het tijdsbudget is de tweede vangrail.
const BATCH_SIZE = 100;
const RESCAN_DAYS = 30;
const BUDGET_MS = 95_000;
const SLEEP_MS = 250;
const K_BUCKET = 300;         // krimp van een bucket-lift naar 1 (in dagen)
const K_OWN = 750;            // krimp van de eigen historie naar p0 (~3 jaar)
const K_CALIB = 100;          // krimp van de kalibratie naar de modelkans
const LIFT_MIN = 0.2, LIFT_MAX = 5;
const PROB_CAP = 90;
const REALERT_DAYS = 14;      // opnieuw melden: na 14 dagen, of …
const REALERT_GAIN = 10;      // … als de kans ≥10 punten hoger is dan bij de vorige melding
const MAX_ALERTS = 10;
const DAY = 86400000;

// Vijf toestandskenmerken, elk in buckets. De bucket-sleutel is de index in de
// randen-lijst; het label wordt daaruit afgeleid zodat UI en backend nooit
// uit de pas lopen.
interface FeatureDef { key: string; label: string; edges: number[]; unit: string; nullLabel?: string }
const FEATURES: FeatureDef[] = [
  { key: "r5",    label: "5-daags rendement",        edges: [-30, -15, -5, 5, 15, 30, 50], unit: "%" },
  { key: "r22",   label: "22-daags rendement",       edges: [-40, -20, -5, 10, 30, 60, 100], unit: "%" },
  { key: "vol",   label: "Volume vs 30d-gemiddelde", edges: [0.5, 1, 2, 4, 8], unit: "×" },
  { key: "since", label: "Dagen sinds vorige +50%-piek", edges: [14, 45, 120, 365], unit: "d", nullLabel: "nooit" },
  { key: "hi",    label: "Onder de 1-jaarstop",      edges: [20, 50, 80], unit: "%" },
];
function bucketKey(v: number | null, f: FeatureDef): string {
  if (v == null || !Number.isFinite(v)) return "null";
  let i = 0;
  while (i < f.edges.length && v >= f.edges[i]) i++;
  return String(i);
}
function bucketLabel(key: string, f: FeatureDef): string {
  if (key === "null") return f.nullLabel ?? "onbekend";
  const i = Number(key);
  const fmt = (x: number) => `${x}${f.unit}`;
  if (i === 0) return `< ${fmt(f.edges[0])}`;
  if (i >= f.edges.length) return `≥ ${fmt(f.edges[f.edges.length - 1])}`;
  return `${fmt(f.edges[i - 1])} … ${fmt(f.edges[i])}`;
}
// Kansbuckets voor de kalibratie (modelkans in %).
const CALIB_EDGES = [1, 2, 3, 5, 8, 12, 20, 30, 50];
function calibKey(probPct: number): string { let i = 0; while (i < CALIB_EDGES.length && probPct >= CALIB_EDGES[i]) i++; return String(i); }
function calibRange(key: string): { lo: number; hi: number } { const i = Number(key); return { lo: i === 0 ? 0 : CALIB_EDGES[i - 1], hi: i >= CALIB_EDGES.length ? 100 : CALIB_EDGES[i] }; }

type Counts = Record<string, { n: number; h: number }>;
function bump(c: Counts, key: string, hit: boolean) { const e = c[key] ?? (c[key] = { n: 0, h: 0 }); e.n++; if (hit) e.h++; }

// ── Gepoolde lifts uit alle histories ────────────────────────────────────────
interface Pooled {
  p0: number;                       // fractie
  n: number; hits: number; tickers: number;
  lifts: Record<string, Record<string, { n: number; h: number; rate: number; lift: number }>>;
  calib: Counts;
}
function clampLift(x: number) { return Math.min(LIFT_MAX, Math.max(LIFT_MIN, x)); }
function poolHistories(rows: HistoryRow[]): Pooled | null {
  const ok = rows.filter((r) => r.ok && r.days_n > 0);
  if (!ok.length) return null;
  let n = 0, hits = 0;
  const sums: Record<string, Counts> = {};
  const calib: Counts = {};
  for (const r of ok) {
    n += r.days_n; hits += r.hits;
    const b = (r.buckets ?? {}) as Record<string, Counts>;
    for (const f of FEATURES) {
      const dst = sums[f.key] ?? (sums[f.key] = {});
      for (const [k, v] of Object.entries(b[f.key] ?? {})) { const e = dst[k] ?? (dst[k] = { n: 0, h: 0 }); e.n += v.n; e.h += v.h; }
    }
    for (const [k, v] of Object.entries((r.calib ?? {}) as Counts)) { const e = calib[k] ?? (calib[k] = { n: 0, h: 0 }); e.n += v.n; e.h += v.h; }
  }
  if (!(hits > 0)) return null;
  const p0 = hits / n;
  const lifts: Pooled["lifts"] = {};
  for (const f of FEATURES) {
    lifts[f.key] = {};
    for (const [k, v] of Object.entries(sums[f.key] ?? {})) {
      const rate = (v.h + K_BUCKET * p0) / (v.n + K_BUCKET);
      lifts[f.key][k] = { n: v.n, h: v.h, rate, lift: clampLift(rate / p0) };
    }
  }
  return { p0, n, hits, tickers: ok.length, lifts, calib };
}
interface Features { r5: number | null; r22: number | null; vol: number | null; since: number | null; hi: number | null }
function rawProb(pool: Pooled, ownLift: number, feats: Features): { prob: number; parts: Array<{ key: string; bucket: string; lift: number; n: number }> } {
  let odds = pool.p0 / (1 - pool.p0) * ownLift;
  const parts: Array<{ key: string; bucket: string; lift: number; n: number }> = [];
  for (const f of FEATURES) {
    const k = bucketKey((feats as unknown as Record<string, number | null>)[f.key], f);
    const e = pool.lifts[f.key]?.[k];
    const lift = e?.lift ?? 1;
    odds *= lift;
    parts.push({ key: f.key, bucket: k, lift, n: e?.n ?? 0 });
  }
  const p = odds / (1 + odds);
  return { prob: Math.min(PROB_CAP, p * 100), parts };
}
function ownLiftOf(pool: Pooled, hits: number, days: number): { lift: number; rate: number } {
  const rate = (hits + K_OWN * pool.p0) / (days + K_OWN);
  return { lift: clampLift(rate / pool.p0), rate };
}
function calibrate(pool: Pooled, raw: number): { prob: number; n: number; observed: number | null } {
  const e = pool.calib[calibKey(raw)];
  if (!e || e.n === 0) return { prob: raw, n: 0, observed: null };
  const obs = (100 * e.h) / e.n;
  const prob = (100 * e.h + K_CALIB * raw) / (e.n + K_CALIB);
  return { prob: Math.min(PROB_CAP, prob), n: e.n, observed: obs };
}

// ── Yahoo ────────────────────────────────────────────────────────────────────
interface Bar { date: string; ms: number; close: number; vol: number }
async function fetchYahoo10y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HippoBot/1.0; +https://github.com)" }, signal: controller.signal });
  } finally { clearTimeout(timeoutId); }
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ meta?: { firstTradeDate?: number | null }; timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[]; volume?: (number | null)[] }> } }>; error?: { description?: string } | null } };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? [];
  const raw = r.indicators.quote[0]?.close ?? [];
  const vols = r.indicators.quote[0]?.volume ?? [];
  const firstTradeDate = r.meta?.firstTradeDate ? new Date(r.meta.firstTradeDate * 1000).toISOString().slice(0, 10) : null;
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = Number.isFinite(adj[i] as number) && (adj[i] as number) > 0 ? (adj[i] as number) : raw[i];
    if (!Number.isFinite(c as number) || !((c as number) > 0)) continue;
    const ms = ts[i] * 1000;
    const date = new Date(ms).toISOString().slice(0, 10);
    if (firstTradeDate && date < firstTradeDate) continue;
    const v = vols[i];
    bars.push({ date, ms, close: c as number, vol: Number.isFinite(v as number) && (v as number) >= 0 ? (v as number) : 0 });
  }
  // 1-dags data-fouten (≥5× omhoog en meteen weer terug) weggooien.
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const prev = out.length ? out[out.length - 1].close : NaN;
    const next = i + 1 < bars.length ? bars[i + 1].close : NaN;
    if (Number.isFinite(prev) && bars[i].close >= prev * MAX_BAR_JUMP && Number.isFinite(next) && next < prev * 1.5) continue;
    out.push(bars[i]);
  }
  return out;
}

// ── Historie meten ───────────────────────────────────────────────────────────
interface HistoryRow {
  ticker: string; scanned_at: string; ok: boolean; error: string | null;
  bars: number; days_n: number; hits: number; hits_2y: number; days_2y: number;
  peak_count: number; last_peak_date: string | null; first_date: string | null;
  buckets: Record<string, Counts>; calib: Counts;
}
function analyze(ticker: string, bars: Bar[], pool: Pooled | null, nowMs: number): HistoryRow {
  const n = bars.length;
  const row: HistoryRow = { ticker, scanned_at: new Date().toISOString(), ok: true, error: null, bars: n, days_n: 0, hits: 0, hits_2y: 0, days_2y: 0, peak_count: 0, last_peak_date: null, first_date: n ? bars[0].date : null, buckets: {}, calib: {} };
  if (n < MIN_BARS) { row.ok = false; row.error = `te weinig historie (${n} dagen)`; return row; }
  for (const f of FEATURES) row.buckets[f.key] = {};

  // Piekdagen: dag j waarop de koers ≥ +50% staat t.o.v. een van de 10 dagen ervoor.
  const isPeak = new Array<boolean>(n).fill(false);
  for (let j = 1; j < n; j++) {
    for (let k = 1; k <= FWD_BARS && j - k >= 0; k++) {
      const base = bars[j - k].close;
      if (base >= MIN_PRICE && bars[j].close >= base * EVENT_MULT) { isPeak[j] = true; break; }
    }
  }
  // Een sprint telt één keer: opeenvolgende piekdagen horen bij dezelfde beweging.
  let peakCount = 0, lastPeakIdx = -1;
  for (let j = 0; j < n; j++) if (isPeak[j]) { if (!(j > 0 && isPeak[j - 1])) peakCount++; lastPeakIdx = j; }
  row.peak_count = peakCount;
  row.last_peak_date = lastPeakIdx >= 0 ? bars[lastPeakIdx].date : null;

  // Per dag: de vijf kenmerken op die dag + of de gebeurtenis daarna volgde.
  // Alleen dagen met een volledig venster van 10 handelsdagen vooruit tellen.
  const twoYearsAgo = nowMs - 730 * DAY;
  const days: Array<{ feats: Features; hit: boolean; ms: number }> = [];
  let volSum = 0;                                // lopende som van vol[t-30..t-1]
  let lastPeakBefore = -1;
  // Glijdend maximum over de 252 bars vóór t (monotone deque van indexen),
  // zodat de 1-jaarstop O(1) per dag kost — de CPU-limiet van de edge
  // runtime is krap.
  const dq: number[] = [];
  for (let t = 0; t + FWD_BARS <= n - 1; t++) {
    if (isPeak[t]) lastPeakBefore = t;
    if (t >= 30) volSum -= bars[t - 30].vol;
    while (dq.length && dq[0] < t - 252) dq.shift();
    const c = bars[t].close;
    if (t >= 30 && c >= MIN_PRICE) {
      let hit = false;
      for (let j = t + 1; j <= t + FWD_BARS; j++) {
        if (bars[j].close < c * EVENT_MULT) continue;
        if (j + 1 >= n || bars[j + 1].close >= c * HOLD_MULT) { hit = true; break; }
      }
      const hi = dq.length ? Math.max(c, bars[dq[0]].close) : c;
      const avgVol = volSum / 30;
      days.push({
        ms: bars[t].ms, hit,
        feats: {
          r5: (c / bars[t - 5].close - 1) * 100,
          r22: (c / bars[t - 22].close - 1) * 100,
          vol: avgVol > 0 ? bars[t].vol / avgVol : null,
          since: lastPeakBefore >= 0 ? Math.round((bars[t].ms - bars[lastPeakBefore].ms) / DAY) : null,
          hi: (1 - c / hi) * 100,
        },
      });
    }
    volSum += bars[t].vol;
    while (dq.length && bars[dq[dq.length - 1]].close <= c) dq.pop();
    dq.push(t);
  }

  for (const d of days) {
    row.days_n++; if (d.hit) row.hits++;
    if (d.ms >= twoYearsAgo) { row.days_2y++; if (d.hit) row.hits_2y++; }
    for (const f of FEATURES) bump(row.buckets[f.key], bucketKey((d.feats as unknown as Record<string, number | null>)[f.key], f), d.hit);
  }
  // Kalibratie: wat zei het model (met de lifts van vóór deze batch) op elke
  // historische dag, en wat gebeurde er? De eigen lift komt uit de volledige
  // eigen historie — dezelfde waarde die het scoren straks gebruikt.
  if (pool && row.days_n > 0) {
    const own = ownLiftOf(pool, row.hits, row.days_n).lift;
    for (const d of days) bump(row.calib, calibKey(rawProb(pool, own, d.feats).prob), d.hit);
  }
  return row;
}

async function fetchAll<T>(sb: ReturnType<typeof getServiceClient>, table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = sb.from(table).select(cols).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
async function chunkedIn<T>(sb: ReturnType<typeof getServiceClient>, table: string, cols: string, tickers: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tickers.length; i += 300) {
    const { data, error } = await sb.from(table).select(cols).in("ticker", tickers.slice(i, i + 300));
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data ?? []) out.push(r as T);
  }
  return out;
}
function num(v: unknown): number | null { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtPct(v: number | null): string { if (v == null) return "?"; return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`; }
function fmtPrice(v: number | null): string { if (v == null) return "?"; if (v < 1) return `$${v.toFixed(4)}`; if (v < 10) return `$${v.toFixed(3)}`; return `$${v.toFixed(2)}`; }
function ratingStr(r: number | null): string { if (!r || r < 1) return "geen sterren"; return `${"★".repeat(r)} (${r}/5)`; }
function r1(x: number) { return Math.round(x * 10) / 10; }

interface Factor { label: string; detail: string; mult: number }

Deno.serve(runBackground("xinix-hippos", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();
  const nowMs = startMs;
  const runStart = new Date(nowMs).toISOString();
  const errors: string[] = [];

  const favs = await fetchAll<{ ticker: string; rating: unknown }>(sb, "xinix_favorites", "ticker, rating");
  if (!favs.length) return { ok: true, message: "geen favorieten" };
  const favSet = new Set(favs.map((f) => f.ticker));
  const ratingBy = new Map(favs.map((f) => [f.ticker, num(f.rating)]));

  // ── 1. Scan een batch favorieten bij Yahoo ────────────────────────────────
  let histories = await fetchAll<HistoryRow>(sb, "xinix_hippo_history", "*");
  const histBy = new Map(histories.map((h) => [h.ticker, h]));
  // De lifts van vóór deze batch: nodig om per historische dag de modelkans
  // te kunnen uitrekenen (kalibratie). Bij de allereerste runs is er nog
  // niets, dan blijft de kalibratie leeg tot de volgende herscan.
  const poolBefore = poolHistories(histories.filter((h) => favSet.has(h.ticker)));
  const cutoffMs = nowMs - RESCAN_DAYS * DAY;
  const due = favs
    .map((f) => ({ ticker: f.ticker, at: histBy.get(f.ticker)?.scanned_at ?? null }))
    .filter((x) => !x.at || Date.parse(x.at) < cutoffMs)
    .sort((a, b) => (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0))
    .slice(0, BATCH_SIZE);
  // Yahoo-fouten (geschrapte ticker, 404) zijn geen run-fout: ze worden als
  // ok=false in de historie gezet en over 30 dagen opnieuw geprobeerd. Alleen
  // als vrijwel de hele batch faalt is er echt iets mis.
  let scanned = 0, scanErrors = 0;
  const scanErrMsgs: string[] = [];
  for (const d of due) {
    if (Date.now() - startMs > BUDGET_MS) break;
    scanned++;
    let row: HistoryRow;
    try {
      const bars = await fetchYahoo10y(d.ticker);
      row = analyze(d.ticker, bars, poolBefore, nowMs);
    } catch (e) {
      scanErrors++;
      const msg = e instanceof Error ? e.message : String(e);
      if (scanErrMsgs.length < 3) scanErrMsgs.push(`${d.ticker}: ${msg}`);
      row = { ticker: d.ticker, scanned_at: new Date().toISOString(), ok: false, error: msg, bars: 0, days_n: 0, hits: 0, hits_2y: 0, days_2y: 0, peak_count: 0, last_peak_date: null, first_date: null, buckets: {}, calib: {} };
    }
    const { error } = await sb.from("xinix_hippo_history").upsert(row, { onConflict: "ticker" });
    if (error) errors.push(`history ${d.ticker}: ${error.message}`);
    else histBy.set(d.ticker, row);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  histories = [...histBy.values()];

  // ── 2. Scoren op verse koersen ────────────────────────────────────────────
  const pool = poolHistories(histories.filter((h) => favSet.has(h.ticker)));
  if (!pool) {
    return { ok: errors.length === 0, message: `gescand ${scanned} (fouten ${scanErrors}); nog geen historie om op te scoren`, metrics: { scanned, scan_errors: scanErrors } };
  }
  const tickers = favs.map((f) => f.ticker);
  const [tk, pr, prevScores] = await Promise.all([
    chunkedIn<any>(sb, "signal_tickers", "ticker, company, exchange, sector, yahoo_sector", tickers),
    chunkedIn<any>(sb, "signal_price_summary", "ticker, last_close, last_volume, avg_volume_30d, volume_ratio, pct_change_5d, pct_change_22d, high_1y, updated_at", tickers),
    chunkedIn<any>(sb, "xinix_hippo_scores", "ticker, alerted_at, alerted_prob", tickers),
  ]);
  const tkBy = new Map(tk.map((r) => [r.ticker, r]));
  const prBy = new Map(pr.map((r) => [r.ticker, r]));
  const prevBy = new Map(prevScores.map((r) => [r.ticker, r]));

  const scored: any[] = [];
  for (const f of favs) {
    const h = histBy.get(f.ticker);
    if (!h || !h.ok || h.days_n === 0) continue;
    const p = prBy.get(f.ticker);
    const lastClose = num(p?.last_close);
    if (!p || lastClose == null || !(lastClose > 0)) continue;
    const t = tkBy.get(f.ticker);

    const r5 = num(p.pct_change_5d), r22 = num(p.pct_change_22d);
    const lastVol = num(p.last_volume), avgVol = num(p.avg_volume_30d);
    const vol = lastVol != null && avgVol != null && avgVol > 0 ? lastVol / avgVol : num(p.volume_ratio);
    const high1y = num(p.high_1y);
    const hi = high1y != null && high1y > 0 ? Math.max(0, (1 - lastClose / high1y) * 100) : null;
    let since: number | null = h.last_peak_date ? Math.round((nowMs - Date.parse(h.last_peak_date + "T00:00:00Z")) / DAY) : null;
    if (r5 != null && r5 >= 50) since = 0;    // sprint loopt nu; de scan kan tot 30 dagen achterlopen
    const feats: Features = { r5, r22, vol, since, hi };

    const own = ownLiftOf(pool, h.hits, h.days_n);
    const raw = rawProb(pool, own.lift, feats);
    const cal = calibrate(pool, raw.prob);

    const factors: Factor[] = [];
    factors.push({ label: "Basiskans", detail: `${r1(pool.p0 * 100)}% van alle favoriet-dagen begon een +50%-sprint (${pool.hits.toLocaleString("nl-NL")} van ${pool.n.toLocaleString("nl-NL")})`, mult: 1 });
    factors.push({ label: "Eigen historie", detail: h.hits > 0 ? `${r1((100 * h.hits) / h.days_n)}% van de eigen dagen (${h.hits}× in ${Math.round(h.days_n / 252)} jaar, ${h.peak_count} sprint${h.peak_count === 1 ? "" : "s"}${h.hits_2y ? `, ${h.hits_2y} dag${h.hits_2y === 1 ? "" : "en"} in de laatste 2 jaar` : ""})` : `nooit +50% in 14 dagen gedaan in ${Math.round(h.days_n / 252)} jaar`, mult: r1(own.lift) });
    for (const part of raw.parts) {
      const fd = FEATURES.find((x) => x.key === part.key)!;
      const v = (feats as unknown as Record<string, number | null>)[part.key];
      const shown = v == null ? (fd.nullLabel ?? "onbekend") : part.key === "vol" ? `${v.toFixed(1)}×` : part.key === "since" ? `${Math.round(v)} dagen` : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
      const e = pool.lifts[part.key]?.[part.bucket];
      factors.push({ label: fd.label, detail: `${shown} → bucket ${bucketLabel(part.bucket, fd)}${e ? `: ${r1(e.rate * 100)}% gemeten op ${e.n.toLocaleString("nl-NL")} dagen` : ""}`, mult: r1(part.lift) });
    }
    factors.push({ label: "Kalibratie", detail: cal.n > 0 ? `model zegt ${r1(raw.prob)}%; op ${cal.n.toLocaleString("nl-NL")} historische dagen met zo'n modelkans gebeurde het in ${r1(cal.observed!)}%` : `model zegt ${r1(raw.prob)}%; nog geen kalibratiedata voor deze kansbucket`, mult: raw.prob > 0 ? r1(cal.prob / raw.prob) : 1 });

    const dollarVol = avgVol != null ? avgVol * lastClose : null;
    const flags: string[] = [];
    let tradeable = true;
    if (lastClose < 0.02 || (dollarVol != null && dollarVol < 2000)) { flags.push("onhandelbaar"); tradeable = false; }
    else if (dollarVol != null && dollarVol < 20000) { flags.push("illiquide"); tradeable = false; }
    if (r5 != null && r5 >= 50) flags.push("sprint loopt nu");
    if (p.updated_at && nowMs - Date.parse(p.updated_at) > 7 * DAY) flags.push("koers ouder dan een week");

    scored.push({
      ticker: f.ticker,
      prob: r1(cal.prob), raw_prob: r1(raw.prob), base_rate: r1(pool.p0 * 100), own_rate: r1(own.rate * 100),
      company: t?.company ?? null, sector: t?.yahoo_sector ?? t?.sector ?? null, exchange: t?.exchange ?? null,
      last_close: lastClose, dollar_volume: dollarVol != null ? Math.round(dollarVol) : null,
      pct_change_5d: r5, pct_change_22d: r22, volume_ratio: vol != null ? r1(vol) : null,
      days_since_peak: since, pct_below_high1y: hi != null ? r1(hi) : null,
      peak_count: h.peak_count, rating: ratingBy.get(f.ticker) ?? null,
      tradeable, factors, flags, scanned_at: h.scanned_at, computed_at: runStart,
    });
  }
  scored.sort((a, b) => b.prob - a.prob || b.raw_prob - a.raw_prob);
  scored.forEach((r, i) => { r.rank = i + 1; });

  for (let i = 0; i < scored.length; i += 500) {
    const { error } = await sb.from("xinix_hippo_scores").upsert(scored.slice(i, i + 500), { onConflict: "ticker" });
    if (error) throw new Error(`scores upsert: ${error.message}`);
  }
  const { error: delErr } = await sb.from("xinix_hippo_scores").delete().lt("computed_at", runStart);
  if (delErr) errors.push(`opruimen: ${delErr.message}`);

  const liftsOut: Record<string, unknown> = {};
  for (const f of FEATURES) {
    liftsOut[f.key] = { label: f.label, buckets: Object.entries(pool.lifts[f.key] ?? {}).sort(([a], [b]) => (a === "null" ? 1 : b === "null" ? -1 : Number(a) - Number(b))).map(([k, v]) => ({ bucket: bucketLabel(k, f), n: v.n, hits: v.h, rate_pct: r1(v.rate * 100), lift: r1(v.lift) })) };
  }
  const calibOut = Object.entries(pool.calib).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => ({ bucket: k, ...calibRange(k), n: v.n, hits: v.h, rate_pct: v.n ? r1((100 * v.h) / v.n) : null }));
  const { error: calErr } = await sb.from("xinix_hippo_calibration").upsert({
    id: 1, computed_at: runStart, base_rate: r1(pool.p0 * 100), days_n: pool.n, hits: pool.hits,
    tickers_scanned: pool.tickers, favorites: favs.length, lifts: liftsOut, calib: calibOut,
    max_prob: scored.length ? scored[0].prob : null,
  }, { onConflict: "id" });
  if (calErr) errors.push(`kalibratie: ${calErr.message}`);

  // ── 3. Melden ─────────────────────────────────────────────────────────────
  let notified = 0, candidates = 0, blocked = 0;
  const { data: settingsRow } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server, quiet_hours_start, quiet_hours_end, hippo_alert_min_prob").eq("id", 1).single();
  const settings = settingsRow as Settings | null;
  const threshold = num(settings?.hippo_alert_min_prob) ?? 80;
  if (settings?.ntfy_topic && threshold > 0 && !inQuietHours(settings)) {
    const cands = scored.filter((s) => s.prob >= threshold && s.tradeable);
    candidates = cands.length;
    if (cands.length) {
      const ct = cands.map((c) => c.ticker);
      const [mutes, seen] = await Promise.all([
        chunkedIn<{ ticker: string; muted_until: string | null }>(sb, "xinix_notify_mute", "ticker, muted_until", ct),
        chunkedIn<{ ticker: string }>(sb, "xinix_seen", "ticker", ct),
      ]);
      const mutedSet = new Set(mutes.filter((m) => !m.muted_until || Date.parse(m.muted_until) > nowMs).map((m) => m.ticker.toUpperCase()));
      const seenSet = new Set(seen.map((s) => s.ticker.toUpperCase()));
      const toSend: any[] = [];
      for (const c of cands) {
        const up = c.ticker.toUpperCase();
        if (mutedSet.has(up) || seenSet.has(up)) { blocked++; continue; }
        const prev = prevBy.get(c.ticker);
        const lastMs = prev?.alerted_at ? Date.parse(prev.alerted_at) : null;
        const lastProb = num(prev?.alerted_prob);
        // Eigen dedup i.p.v. de globale cooldown: een sprint van 14 dagen kan
        // niet 100 dagen wachten. Demping en "gezien" gelden wél.
        if (lastMs != null && nowMs - lastMs < REALERT_DAYS * DAY && !(lastProb != null && c.prob >= lastProb + REALERT_GAIN)) { blocked++; continue; }
        toSend.push(c);
      }
      const notifyLog: Array<{ ticker: string; source: string; alert_key: string; priority: number }> = [];
      for (const c of toSend.slice(0, MAX_ALERTS)) {
        const top = (c.factors as Factor[]).filter((f) => f.mult > 1.05 && f.label !== "Kalibratie").sort((a, b) => b.mult - a.mult).slice(0, 3);
        const title = `🦛 ${safeTickerDisplay(c.ticker)} · ${Math.round(c.prob)}% kans op +50% in 14 dagen`.slice(0, 120);
        const lines = [
          `${safeTickerDisplay(c.ticker)}${c.company ? ` · ${c.company}` : ""}`,
          `🦛 Kans op +50% binnen 14 dagen: ${Math.round(c.prob)}% (model ${Math.round(c.raw_prob)}%, drempel ${Math.round(threshold)}%)`,
          `⭐ Sterren: ${ratingStr(c.rating)}`,
          `💲 Koers ${fmtPrice(c.last_close)} · 5d ${fmtPct(c.pct_change_5d)} · 22d ${fmtPct(c.pct_change_22d)}${c.volume_ratio != null ? ` · volume ${c.volume_ratio.toFixed(1)}×` : ""}`,
          `🔗 ${googleFinanceUrl(c.ticker, c.exchange)}`,
          `🔁 ${yahooFinanceUrl(c.ticker)}`,
          `📲 ${favAppUrl(c.ticker)}`,
          "",
          "Waarom:",
          ...top.map((f) => `• ×${f.mult} ${f.label}: ${f.detail}`),
        ];
        const r = await sendNtfy(settings.ntfy_server, settings.ntfy_topic, title, lines.join("\n"), 5, ["hippopotamus"], googleFinanceUrl(c.ticker, c.exchange));
        if (r.ok) {
          notified++;
          notifyLog.push({ ticker: c.ticker, source: "hippos", alert_key: "hippo_50_14d", priority: 5 });
          const { error } = await sb.from("xinix_hippo_scores").update({ alerted_at: new Date().toISOString(), alerted_prob: c.prob }).eq("ticker", c.ticker);
          if (error) errors.push(`alert-state ${c.ticker}: ${error.message}`);
        } else errors.push(`${c.ticker}: ${r.error}`);
      }
      if (notifyLog.length) {
        const { error } = await sb.rpc("xinix_notify_record", { p_items: notifyLog });
        if (error) errors.push(`notify-log: ${error.message}`);
      }
    }
  }

  const top5 = scored.slice(0, 5).map((s) => `${s.ticker} ${s.prob}%`).join(", ");
  const scanBroken = scanned > 0 && scanErrors >= Math.max(1, Math.ceil(scanned / 2));
  return {
    ok: errors.length === 0 && !scanBroken,
    message: `gescand ${scanned}/${due.length} (fouten ${scanErrors}), gescoord ${scored.length}/${favs.length}, basiskans ${r1(pool.p0 * 100)}%, hoogste ${scored[0]?.prob ?? "—"}%, drempel ${threshold}%, gemeld ${notified}` + (scanErrMsgs.length ? `; yahoo: ${scanErrMsgs.join("; ")}` : "") + (errors.length ? `; fouten: ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { scanned, scan_errors: scanErrors, scored: scored.length, favorites: favs.length, tickers_with_history: pool.tickers, base_rate_pct: r1(pool.p0 * 100), days_n: pool.n, hits: pool.hits, max_prob: scored[0]?.prob ?? null, threshold, candidates, blocked, notified, top5, errors: errors.length },
  };
}));
