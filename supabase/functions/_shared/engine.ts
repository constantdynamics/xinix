// Explosie-motor — gedeelde rekenkern van xinix-engine (deep-scan en
// dagelijkse sweep).
//
// Eén Yahoo-fetch van 10 jaar dagkoersen per aandeel levert álles op wat de
// onderdelen nodig hebben: hikkertje-spikes, poefie-incidenten, feniks-run,
// 5-sterren-fit, en per handelsdag de toestand (kenmerken) plus of er daarna
// een explosie volgde (events). Alleen tellingen worden bewaard, geen koersen.
//
// ── Events (definities liggen vast, zie CLAUDE.md) ──────────────────────────
//   h7/h14/h21  hippo: binnen 5/10/15 handelsdagen ≥ +50%, dag erna nog ≥ +20%
//   k30/k90     hikkertje-spike binnen 21/63 handelsdagen: één dag ≥ +55% die
//               3 handelsdagen boven die drempel blijft
//   p30/p90     poefie begint binnen 21/63 handelsdagen: ≥ 2,25× (+125%) binnen
//               7 kalenderdagen vanaf een basis ≥ 0,10 (piek ≥ 0,20)
//   rk          raket: binnen 6 maanden (126 handelsdagen) begint een maand
//               (22 handelsdagen) met ≥ +150%, dag erna nog ≥ +100%
//
// ── Kenmerken ───────────────────────────────────────────────────────────────
// Kandidaten die zowel historisch uit de koersbalken te meten zijn als live af
// te leiden (TradingView-sweep of signal_price_summary). Per event wordt
// gemeten welke er toe doen: een kenmerk telt alleen mee als minstens één
// bucket (met genoeg waarnemingen) ≥ 1,5× of ≤ 1/1,5× de basiskans geeft.
// Wat eronder blijft wordt wel getoond, maar niet gebruikt.
//
// Alles draait op typed arrays met vaste indexen: de edge runtime heeft een
// CPU-limiet van ~2 s per aanroep, en objecten met string-sleutels waren daar
// een factor tien te traag voor.

export const LAYOUT = 1;
export const DAY = 86400000;

// ── Events ──────────────────────────────────────────────────────────────────
export interface EventDef {
  key: string; label: string; short: string;
  group: 0 | 1;          // 0 = kort venster (26 bars vooruit nodig), 1 = lang (150)
  days: number;          // kalenderdagen die de horizon benadert
}
export const EVENTS: EventDef[] = [
  { key: "h7",  label: "+50% binnen 7 dagen",               short: "hippo 7d",  group: 0, days: 7 },
  { key: "h14", label: "+50% binnen 14 dagen",              short: "hippo 14d", group: 0, days: 14 },
  { key: "h21", label: "+50% binnen 21 dagen",              short: "hippo 21d", group: 0, days: 21 },
  { key: "k30", label: "nieuwe hikkertje-spike binnen 30 dagen", short: "spike 30d", group: 0, days: 30 },
  { key: "k90", label: "nieuwe hikkertje-spike binnen 90 dagen", short: "spike 90d", group: 1, days: 90 },
  { key: "p30", label: "nieuwe poefie binnen 30 dagen",     short: "poefie 30d", group: 0, days: 30 },
  { key: "p90", label: "nieuwe poefie binnen 90 dagen",     short: "poefie 90d", group: 1, days: 90 },
  { key: "rk",  label: "maand met +150% binnen 6 maanden",  short: "raket 6m",  group: 1, days: 182 },
];
export const NE = EVENTS.length;
export const EV = Object.fromEntries(EVENTS.map((e, i) => [e.key, i])) as Record<string, number>;
const GROUP_FWD = [26, 150];   // bars vooruit die een dag nodig heeft om mee te tellen

// Hippo
const HIPPO_MULT = 1.5, HIPPO_HOLD = 1.2, HIPPO_BARS = [5, 10, 15];
const PEAK_BARS = 10;          // "+50%-piek" voor het since-kenmerk (zoals hippos)
// Hikkertje (zelfde regels als compute-hikkertjes-background)
export const SPIKE_GAIN = 0.55, SPIKE_HOLD = 3, HIKK_MIN_SPIKES = 2;
const K_BARS = [21, 63];
// Poefie (zelfde regels als compute-poefies-background)
export const POEFIE_MULT = 2.25, POEFIE_MAX_DAYS = 7, POEFIE_MIN_BASE = 0.10, POEFIE_MIN_PEAK = 0.20;
const POEFIE_MAX_SPLIT = 5, POEFIE_MAX_HIST_PEAK = 50_000, POEFIE_MAX_INCIDENTS = 500, POEFIE_MIN_GAP_DAYS = 7;
export const POEFIE_DEACTIVATE_PEAK = 500_000;
const P_BARS = [21, 63];
// Raket
const ROCKET_MULT = 2.5, ROCKET_HOLD = 2.0, ROCKET_WIN = 22, ROCKET_BARS = 126;
// Feniks (zelfde regels als scan-fallen-phoenix: ≥40× vanaf een lopend minimum,
// piek ≥ 1, enkele bar ≥5× de vorige overgeslagen; nu ≥90% onder de top)
export const PHOENIX_MULT = 40, PHOENIX_MIN_PEAK = 1.0, PHOENIX_MAX_FRACTION = 0.10;

const MIN_PRICE_USD = 0.10;    // sub-dime dagen doen niet mee (tick-ruis)
const MAX_BAR_JUMP = 5;        // bar ≥5× de vorige én meteen terug = data-fout
export const MIN_BARS = 120;

// ── Kenmerken ───────────────────────────────────────────────────────────────
export interface FeatureDef { key: string; label: string; edges: number[]; unit: string; nullLabel?: string; labels?: string[] }
export const FEATURES: FeatureDef[] = [
  { key: "r1",     label: "1-daags rendement",        edges: [-20, -10, -3, 3, 10, 20, 50], unit: "%" },
  { key: "r5",     label: "5-daags rendement",        edges: [-30, -15, -5, 5, 15, 30, 50], unit: "%" },
  { key: "r22",    label: "22-daags rendement",       edges: [-40, -20, -5, 10, 30, 60, 100], unit: "%" },
  { key: "r6mo",   label: "6-maands rendement",       edges: [-70, -40, -10, 30, 100, 300], unit: "%" },
  { key: "vol",    label: "Volume vs 30d-gemiddelde", edges: [0.5, 1, 2, 4, 8], unit: "×" },
  { key: "since",  label: "Dagen sinds vorige +50%-piek", edges: [14, 45, 120, 365], unit: "d", nullLabel: "nooit" },
  { key: "hi",     label: "Onder de 1-jaarstop",      edges: [20, 50, 80], unit: "%" },
  { key: "dd5y",   label: "Onder de 5-jaarstop",      edges: [30, 60, 85, 95], unit: "%" },
  { key: "rng",    label: "Positie in de 90-daagse bandbreedte", edges: [10, 25, 50, 75], unit: "%" },
  { key: "lo1y",   label: "Boven de 1-jaarsbodem",    edges: [10, 30, 100, 300], unit: "%" },
  { key: "volat",  label: "Dagelijkse beweeglijkheid (22d)", edges: [2, 4, 7, 12, 20], unit: "%" },
  { key: "dvol",   label: "Dollarvolume per dag",     edges: [1e4, 1e5, 1e6, 1e7], unit: "$" },
  { key: "price",  label: "Koers in dollars",         edges: [0.25, 0.5, 1, 2, 5, 20], unit: "$" },
  { key: "hikk",   label: "Hikkertje-spikes afgelopen jaar", edges: [1, 2, 3], unit: "", labels: ["0", "1", "2", "3 of meer"] },
  { key: "poef",   label: "Dagen sinds vorige poefie", edges: [90, 365, 730], unit: "d", nullLabel: "nooit" },
  { key: "star",   label: "5-sterren-DNA (fit)",      edges: [1, 2, 3, 4], unit: "", nullLabel: "onbekend", labels: ["poorten niet gehaald", "fit < 65", "fit 65–80", "fit 80–90", "fit ≥ 90"] },
  { key: "phx",    label: "Gevallen feniks",          edges: [1], unit: "", labels: ["nee", "ja"] },
  { key: "iwm200", label: "Small caps (IWM) boven 200d-gemiddelde", edges: [1], unit: "", nullLabel: "onbekend", labels: ["nee", "ja"] },
  { key: "iwm22",  label: "Small caps (IWM) 22-daags rendement", edges: [-8, -3, 3, 8], unit: "%", nullLabel: "onbekend" },
];
export const NF = FEATURES.length;
export const FI = Object.fromEntries(FEATURES.map((f, i) => [f.key, i])) as Record<string, number>;
export const SLOTS = 10;       // max 9 buckets + null
export const NULL_SLOT = 9;
const FS = NF * SLOTS;

export function slotOf(f: number, v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return NULL_SLOT;
  const e = FEATURES[f].edges;
  let i = 0;
  while (i < e.length && v >= e[i]) i++;
  return i;
}
export function slotLabel(f: number, s: number): string {
  const d = FEATURES[f];
  if (s === NULL_SLOT) return d.nullLabel ?? "onbekend";
  if (d.labels) return d.labels[s] ?? String(s);
  const fmt = (x: number) => d.unit === "$" ? (x >= 1e6 ? `$${x / 1e6} mln` : x >= 1e3 ? `$${x / 1e3}k` : `$${x}`) : `${x}${d.unit}`;
  if (s === 0) return `< ${fmt(d.edges[0])}`;
  if (s >= d.edges.length) return `≥ ${fmt(d.edges[d.edges.length - 1])}`;
  return `${fmt(d.edges[s - 1])} … ${fmt(d.edges[s])}`;
}

// ── Tellingen-layout (int4[] in xinix_event_history) ─────────────────────────
//   [0, 2·FS)            n per groep × kenmerk × slot
//   [2·FS, 2·FS+NE·FS)   treffers per event × kenmerk × slot
//   daarna               kalibratie per event × kansbucket × (n, h)
export const CALIB_EDGES = [1, 2, 3, 5, 8, 12, 20, 30, 50];
export const NCB = CALIB_EDGES.length + 1;
export const OFF_N = 0, OFF_H = 2 * FS, OFF_C = OFF_H + NE * FS;
export const LEN = OFF_C + NE * NCB * 2;
export const idxN = (g: number, f: number, s: number) => OFF_N + g * FS + f * SLOTS + s;
export const idxH = (e: number, f: number, s: number) => OFF_H + e * FS + f * SLOTS + s;
export const idxC = (e: number, b: number, hit: 0 | 1) => OFF_C + (e * NCB + b) * 2 + hit;
export function calibBucket(probPct: number): number { let i = 0; while (i < CALIB_EDGES.length && probPct >= CALIB_EDGES[i]) i++; return i; }
export function calibRange(b: number): { lo: number; hi: number } { return { lo: b === 0 ? 0 : CALIB_EDGES[b - 1], hi: b >= CALIB_EDGES.length ? 100 : CALIB_EDGES[b] }; }

// ── Valuta ──────────────────────────────────────────────────────────────────
// Benaderde koersen (USD per eenheid). Alleen gebruikt voor grove buckets
// (koers, dollarvolume) en de ondergrens van $0,10; een paar procent ernaast
// verandert daar niets aan.
const FX: Record<string, number> = {
  USD: 1, CAD: 0.73, AUD: 0.66, NZD: 0.6, GBP: 1.33, GBX: 0.0133, GBp: 0.0133, EUR: 1.12, CHF: 1.2,
  SEK: 0.105, NOK: 0.098, DKK: 0.15, PLN: 0.27, HKD: 0.128, JPY: 0.0068, SGD: 0.77,
  ZAR: 0.055, ZAc: 0.00055, ILS: 0.27, ILA: 0.0027, KRW: 0.00072, CNY: 0.14, MYR: 0.23,
  INR: 0.012, BRL: 0.18, MXN: 0.052, IDR: 0.000062, TWD: 0.031,
};
export function fxUsd(currency: string | null | undefined): number {
  if (!currency) return 1;
  return FX[currency] ?? FX[currency.toUpperCase()] ?? 1;
}

// ── Koersbalken ─────────────────────────────────────────────────────────────
export interface Split { ms: number; ratio: number }
export interface Bars {
  n: number;
  ms: Float64Array; day: Int32Array;     // dagnummer (ms / DAY) voor uitlijning met IWM
  close: Float64Array;                    // gecorrigeerd voor splits/dividend
  raw: Float64Array;                      // echte slotkoers van die dag
  high: Float64Array; low: Float64Array;  // ruwe dagrange (alleen de verhouding telt)
  vol: Float64Array;
  splits: Split[];
  currency: string | null;
}
interface RawBar { ms: number; adj: number; raw: number; high: number; low: number; vol: number }

function toBars(list: RawBar[], splits: Split[], currency: string | null): Bars {
  const n = list.length;
  const b: Bars = {
    n, ms: new Float64Array(n), day: new Int32Array(n), close: new Float64Array(n), raw: new Float64Array(n),
    high: new Float64Array(n), low: new Float64Array(n), vol: new Float64Array(n), splits, currency,
  };
  for (let i = 0; i < n; i++) {
    const r = list[i];
    b.ms[i] = r.ms; b.day[i] = Math.floor(r.ms / DAY); b.close[i] = r.adj; b.raw[i] = r.raw;
    b.high[i] = r.high; b.low[i] = r.low; b.vol[i] = r.vol;
  }
  return b;
}

export interface Fetched { all: Bars; clean: Bars }
/**
 * 10 jaar dagkoersen bij Yahoo, met splits. `all` is de ongefilterde reeks
 * (voor de poefie-incidenten, die hun eigen opschoning hebben), `clean` is
 * zonder 1-dags data-fouten (voor de per-dag analyse).
 */
export async function fetchYahoo10y(ticker: string, range = "10y"): Promise<Fetched> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&events=split`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; XinixEngine/1.0; +https://github.com)" }, signal: controller.signal });
  } finally { clearTimeout(timeoutId); }
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const json = (await res.json()) as any;
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json?.chart?.error?.description ?? "no result"}`);
  const meta = r.meta ?? {};
  // Yahoo valt bij een onbekend symbool soms stil terug op een ander bedrijf.
  if (meta.symbol && String(meta.symbol).toUpperCase() !== ticker.toUpperCase()) throw new Error(`Yahoo ${ticker}: gaf ${meta.symbol} terug`);
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const adj: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? [];
  const cl: (number | null)[] = q.close ?? [];
  const hi: (number | null)[] = q.high ?? [];
  const lo: (number | null)[] = q.low ?? [];
  const vo: (number | null)[] = q.volume ?? [];
  const firstMs = meta.firstTradeDate ? meta.firstTradeDate * 1000 - DAY : 0;
  const list: RawBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = cl[i];
    if (c == null || !(c > 0)) continue;
    const a = adj[i] != null && (adj[i] as number) > 0 ? (adj[i] as number) : c;
    const ms = ts[i] * 1000;
    if (ms < firstMs) continue;
    const h = hi[i] != null && (hi[i] as number) > 0 ? (hi[i] as number) : c;
    const l = lo[i] != null && (lo[i] as number) > 0 ? (lo[i] as number) : c;
    const v = vo[i] != null && (vo[i] as number) >= 0 ? (vo[i] as number) : 0;
    list.push({ ms, adj: a, raw: c, high: Math.max(h, l), low: Math.min(h, l), vol: v });
  }
  const splits: Split[] = Object.values((r.events?.splits ?? {}) as Record<string, { date: number; numerator: number; denominator: number }>)
    .map((s) => ({ ms: s.date * 1000, ratio: s.denominator > 0 ? s.numerator / s.denominator : 1 }));
  const clean: RawBar[] = [];
  for (let i = 0; i < list.length; i++) {
    const prev = clean.length ? clean[clean.length - 1].adj : NaN;
    const next = i + 1 < list.length ? list[i + 1].adj : NaN;
    if (Number.isFinite(prev) && list[i].adj >= prev * MAX_BAR_JUMP && Number.isFinite(next) && next < prev * 1.5) continue;
    clean.push(list[i]);
  }
  const currency = typeof meta.currency === "string" ? meta.currency : null;
  return { all: toBars(list, splits, currency), clean: toBars(clean, splits, currency) };
}

/** Small caps (IWM): per dagnummer boven/onder het 200-daags gemiddelde en het 22-daags rendement. */
export interface Regime { above200: Map<number, number>; r22: Map<number, number> }
export function regimeFrom(b: Bars): Regime {
  const above200 = new Map<number, number>(), r22 = new Map<number, number>();
  let sum = 0;
  for (let i = 0; i < b.n; i++) {
    sum += b.close[i];
    if (i >= 200) sum -= b.close[i - 200];
    if (i >= 199) above200.set(b.day[i], b.close[i] > sum / 200 ? 1 : 0);
    if (i >= 22) r22.set(b.day[i], (b.close[i] / b.close[i - 22] - 1) * 100);
  }
  return { above200, r22 };
}

// ── Detectoren ──────────────────────────────────────────────────────────────
/** Hikkertje-spikes: indexen j met close[j] ≥ 1,55 × close[j-1] die 3 bars boven die drempel blijven. */
export function findSpikes(close: Float64Array, n: number): number[] {
  const out: number[] = [];
  let i = 1;
  while (i + SPIKE_HOLD <= n) {
    const prev = close[i - 1];
    if (prev > 0 && close[i] / prev >= 1 + SPIKE_GAIN) {
      const thr = prev * (1 + SPIKE_GAIN);
      let held = true;
      for (let j = i; j < i + SPIKE_HOLD; j++) if (close[j] < thr) { held = false; break; }
      if (held) { out.push(i); i += SPIKE_HOLD; continue; }
    }
    i++;
  }
  return out;
}

export interface PoefieIncident {
  baseline_date: string; baseline_close: number; peak_date: string; peak_close: number;
  days_to_peak: number; peak_mult: number; growth_pct: number; raw_mult: number;
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function suspiciousSplit(splits: Split[], fromMs: number, toMs: number): boolean {
  for (const s of splits) {
    if (s.ms < fromMs || s.ms > toMs) continue;
    const r = s.ratio >= 1 ? s.ratio : s.ratio > 0 ? 1 / s.ratio : 1;
    if (r >= POEFIE_MAX_SPLIT) return true;
  }
  return false;
}
/** Exact de incident-detectie van compute-poefies-background (incl. zijn opschoning). */
export function findPoefieIncidents(b: Bars): { incidents: PoefieIncident[]; histPeak: number } {
  // compute-poefies houdt bars ≥5× de vorige wél, maar laat ze niet als
  // "vorige" meetellen; dat verandert alleen wat als data-fout geldt, niet de reeks.
  let histPeak = 0;
  for (let i = 0; i < b.n; i++) { if (b.close[i] > histPeak) histPeak = b.close[i]; if (b.raw[i] > histPeak) histPeak = b.raw[i]; }
  if (b.n < 5 || histPeak > POEFIE_MAX_HIST_PEAK) return { incidents: [], histPeak };
  const inc: PoefieIncident[] = [];
  let i = 0;
  while (i < b.n && inc.length < POEFIE_MAX_INCIDENTS) {
    const base = b.close[i];
    if (base < POEFIE_MIN_BASE) { i++; continue; }
    let best = -1, bestDays = 0, bestMult = 0;
    for (let j = i + 1; j < b.n; j++) {
      const days = Math.round((b.ms[j] - b.ms[i]) / DAY);
      if (days > POEFIE_MAX_DAYS) break;
      if (days < 1 || b.close[j] < POEFIE_MIN_PEAK) continue;
      const m = b.close[j] / base;
      if (m < POEFIE_MULT) continue;
      if (best < 0 || m > bestMult) { best = j; bestDays = days; bestMult = m; }
    }
    if (best < 0) { i++; continue; }
    if (suspiciousSplit(b.splits, b.ms[i], b.ms[best])) { i = best + 1; continue; }
    if (bestDays === 1 && best + 1 < b.n && b.close[best + 1] < base * 1.5) { i = best + 1; continue; }
    const rawMult = b.raw[i] > 0 ? b.raw[best] / b.raw[i] : 0;
    inc.push({
      baseline_date: iso(b.ms[i]), baseline_close: Math.round(base * 10000) / 10000,
      peak_date: iso(b.ms[best]), peak_close: Math.round(b.close[best] * 10000) / 10000,
      days_to_peak: bestDays, peak_mult: Math.round(bestMult * 100) / 100,
      growth_pct: Math.round((bestMult - 1) * 1000) / 10, raw_mult: Math.round(rawMult * 100) / 100,
    });
    const gapMs = b.ms[best] + POEFIE_MIN_GAP_DAYS * DAY;
    let next = best + 1;
    while (next < b.n && b.ms[next] < gapMs) next++;
    i = Math.max(next, best + 1);
  }
  return { incidents: inc, histPeak };
}

/** Poefie-velden zoals compute-poefies-background ze op signal_tickers zet. */
export function poefieFields(incidents: PoefieIncident[], nowMs: number): Record<string, unknown> {
  const within = (d: number) => incidents.filter((x) => Date.parse(x.peak_date) >= nowMs - d * DAY).length;
  const isP = incidents.length > 0;
  const sortedDates = incidents.map((x) => x.peak_date).sort();
  const days = incidents.map((x) => x.days_to_peak).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const md = days.length ? (days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2) : null;
  return {
    is_poefie: isP,
    is_poefie_at: new Date(nowMs).toISOString(),
    poefie_last_date: isP ? incidents[incidents.length - 1].peak_date : null,
    poefie_incident_count: isP ? incidents.length : null,
    poefie_median_date: isP ? sortedDates[Math.floor(sortedDates.length / 2)] : null,
    poefie_max_growth_pct: isP ? Math.max(...incidents.map((x) => x.growth_pct)) : null,
    poefie_days_to_peak: md != null ? Math.round(md) : null,
    poefie_count_6m: isP ? within(182) : null,
    poefie_count_1y: isP ? within(365) : null,
    poefie_count_2y: isP ? within(730) : null,
    poefie_count_5y: isP ? within(1825) : null,
    poefie_incidents: isP ? incidents : null,
  };
}

// ── 5-sterren-DNA (fitScore van xinix-star-scan, zonder medaille-bonus) ─────
// De medailles zijn historisch niet na te rekenen; om backtest en live
// hetzelfde te laten meten, telt de motor zonder. De scanner zelf houdt ze.
export const STAR = { MIN_PRICE: 0.10, MIN_MCAP: 20e6, MAX_MCAP: 15e9, MIN_RANGE: 8, MIN_CRASH: 40, MIN_DVOL: 200_000, MIN_SCORE: 80 };
export function starFit(rangeMult: number, crashPct: number, chg22: number | null, mcap: number, dollarVol: number, priceUsd: number): number | null {
  if (!(priceUsd >= STAR.MIN_PRICE && mcap >= STAR.MIN_MCAP && mcap <= STAR.MAX_MCAP && rangeMult >= STAR.MIN_RANGE &&
    crashPct >= STAR.MIN_CRASH && crashPct < 100 && dollarVol >= STAR.MIN_DVOL)) return null;
  const expl = rangeMult >= 20 ? 25 : rangeMult >= 10 ? 15 + ((rangeMult - 10) / 10) * 10 : 10;
  let crash = crashPct >= 75 && crashPct <= 95 ? 25 : crashPct >= 60 ? (crashPct < 75 ? 15 + ((crashPct - 60) / 15) * 10 : 20) : 10;
  if (crashPct > 99) crash = 10;
  let dip = 0;
  if (chg22 != null) dip = chg22 <= -40 ? 14 : chg22 <= -20 ? 20 : chg22 <= -10 ? 12 : chg22 < 0 ? 5 : 0;
  let sub = mcap >= 100e6 && mcap <= 3e9 ? 15 : mcap > 3e9 && mcap <= 10e9 ? 12 : mcap >= 25e6 ? 10 : 6;
  if (mcap > 10e9) sub = 6;
  const liq = dollarVol >= 5e6 ? 10 : dollarVol >= 1e6 ? 8 : dollarVol >= 500e3 ? 5 : 2;
  return Math.round((expl + crash + dip + sub + liq) * 10) / 10;
}
/** Slot van het star-kenmerk: 0 = poorten niet gehaald, 1 = <65, 2 = 65–80, 3 = 80–90, 4 = ≥90. */
export function starSlotValue(fit: number | null, mcapKnown: boolean): number | null {
  if (!mcapKnown) return null;
  if (fit == null) return 0;
  return fit >= 90 ? 4 : fit >= 80 ? 3 : fit >= 65 ? 2 : 1;
}

// ── Uitkomsten per dag ──────────────────────────────────────────────────────
interface EventPrep { spikes: number[]; spikePre: Int32Array; poefPre: Int32Array; rkPre: Int32Array }
/** Prefixtellingen waarmee "gebeurde X binnen H bars na dag t" O(1) is. */
function prepEvents(b: Bars, fx: number, poefOk: boolean): EventPrep {
  const n = b.n, c = b.close;
  const spikes = findSpikes(c, n);
  const spikePre = new Int32Array(n + 1);
  { let k = 0; for (let i = 0; i < n; i++) { spikePre[i] = k; if (spikes[k] === i) k++; } spikePre[n] = k; }
  // Poefie-start per basisdag: zelfde regels als de incidenten, maar zonder
  // de gretige overslag, zodat elke dag eerlijk beoordeeld wordt.
  const poefPre = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    let start = 0;
    const base = c[i];
    if (poefOk && base >= POEFIE_MIN_BASE) {
      let best = -1, bestDays = 0, bestMult = 0;
      for (let j = i + 1; j < n; j++) {
        const days = Math.round((b.ms[j] - b.ms[i]) / DAY);
        if (days > POEFIE_MAX_DAYS) break;
        if (days < 1 || c[j] < POEFIE_MIN_PEAK) continue;
        const m = c[j] / base;
        if (m >= POEFIE_MULT && (best < 0 || m > bestMult)) { best = j; bestDays = days; bestMult = m; }
      }
      if (best >= 0 && !suspiciousSplit(b.splits, b.ms[i], b.ms[best]) &&
          !(bestDays === 1 && best + 1 < n && c[best + 1] < base * 1.5)) start = 1;
    }
    poefPre[i + 1] = poefPre[i] + start;
  }
  // Raket-start per dag: binnen 22 bars ≥ 2,5×, de bar erna nog ≥ 2×.
  const rkPre = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    let start = 0;
    if (c[i] * fx >= MIN_PRICE_USD) {
      const lim = Math.min(n - 1, i + ROCKET_WIN);
      for (let k = i + 1; k <= lim; k++) {
        if (c[k] >= c[i] * ROCKET_MULT && (k + 1 >= n || c[k + 1] >= c[i] * ROCKET_HOLD)) { start = 1; break; }
      }
    }
    rkPre[i + 1] = rkPre[i] + start;
  }
  return { spikes, spikePre, poefPre, rkPre };
}
/** Bitmasker van de events die na dag t volgden (bit e = EVENTS[e]). */
function bitsAt(b: Bars, ev: EventPrep, t: number, withLong: boolean): number {
  const c = b.close, n = b.n, v = c[t];
  let bits = 0;
  // Hippo: eerste dag met +50% die de dag erna nog ≥ +20% staat.
  let firstHit = -1;
  for (let j = t + 1; j <= Math.min(n - 1, t + 15); j++) {
    if (c[j] < v * HIPPO_MULT) continue;
    if (j + 1 >= n || c[j + 1] >= v * HIPPO_HOLD) { firstHit = j - t; break; }
  }
  for (let h = 0; h < 3; h++) if (firstHit > 0 && firstHit <= HIPPO_BARS[h]) bits |= 1 << h;
  const pre = (a: Int32Array, lo: number, hi: number) => a[Math.min(n, hi)] - a[Math.min(n, lo)];
  if (pre(ev.spikePre, t + 1, t + K_BARS[0] + 1) > 0) bits |= 1 << EV.k30;
  if (pre(ev.poefPre, t, t + P_BARS[0]) > 0) bits |= 1 << EV.p30;
  if (withLong) {
    if (pre(ev.spikePre, t + 1, t + K_BARS[1] + 1) > 0) bits |= 1 << EV.k90;
    if (pre(ev.poefPre, t, t + P_BARS[1]) > 0) bits |= 1 << EV.p90;
    if (pre(ev.rkPre, t, t + ROCKET_BARS) > 0) bits |= 1 << EV.rk;
  }
  return bits;
}
/**
 * Track record: kwam een voorspelling van dag `madeOn` uit? Geeft per event
 * true/false, of null als de horizon in de data nog niet verstreken is.
 * Instap = de laatste slotkoers op of vóór madeOn — dezelfde dag die het model zag.
 */
export function outcomeFor(f: Fetched, fx: number, madeOn: string, event: number): boolean | null {
  const b = f.clean;
  const madeMs = Date.parse(madeOn + "T23:59:59Z");
  let t = -1;
  for (let i = 0; i < b.n; i++) { if (b.ms[i] <= madeMs) t = i; else break; }
  if (t < 0) return null;
  const need = EVENTS[event].group === 0 ? GROUP_FWD[0] : GROUP_FWD[1];
  if (t + need > b.n - 1) return null;
  const ev = prepEvents(b, fx, findPoefieIncidents(f.all).histPeak <= POEFIE_MAX_HIST_PEAK);
  return ((bitsAt(b, ev, t, true) >> event) & 1) === 1;
}

// ── Analyse van één aandeel ─────────────────────────────────────────────────
export interface Summary {
  bars: number; first_date: string | null; last_date: string | null;
  last_close: number | null; last_raw: number | null; currency: string | null; fx: number;
  last_peak_date: string | null; peak_count: number;
  spikes_1y: number; last_spike_date: string | null; spike_dates_1y: string[];
  poefie_count: number; poefie_count_2y: number; last_poefie_date: string | null; poefie_max_growth: number | null;
  hist_peak: number;
  hi5y: number | null; lo5y: number | null;
  phoenix: boolean; phoenix_peak: number | null; phoenix_peak_date: string | null;
  volat22: number | null; dvol30: number | null;
  own_n: number[]; own_h: number[];        // eigen dagen per groep en treffers per event
}
export interface Analysis { ok: boolean; error: string | null; counts: Int32Array; summary: Summary; incidents: PoefieIncident[] }

export interface Model {
  e: number; p0: number; n: number; hits: number;
  lift: Float64Array;       // FS: gemeten (gekrompen) lift per kenmerk×slot
  logLift: Float64Array;    // FS: ln(lift) voor gebruikte kenmerken, anders 0
  selected: boolean[];
  maxLift: Float64Array;    // NF: sterkste ruwe lift per kenmerk (voor de selectie-uitleg)
  minLift: Float64Array;
  calib: Array<{ n: number; h: number }>;
  ceiling: number | null;
}

const K_BUCKET = 300, K_OWN = 750, K_CALIB = 100;
const LIFT_MIN = 0.2, LIFT_MAX = 5, PROB_CAP = 90;
export const SEL_LIFT = 1.5, SEL_MIN_N = 3000, SEL_MIN_H = 20;

export function ownLift(m: Model, h: number, n: number): number {
  const rate = (h + K_OWN * m.p0) / (n + K_OWN);
  return Math.min(LIFT_MAX, Math.max(LIFT_MIN, rate / m.p0));
}
export function ownRate(m: Model, h: number, n: number): number { return (h + K_OWN * m.p0) / (n + K_OWN); }

/** Modelkans (%) vóór kalibratie. slots: Uint8Array(NF). */
export function rawProb(m: Model, own: number, slots: ArrayLike<number>): number {
  let logit = Math.log(m.p0 / (1 - m.p0)) + Math.log(own);
  for (let f = 0; f < NF; f++) logit += m.logLift[f * SLOTS + slots[f]];
  const odds = Math.exp(logit);
  return Math.min(PROB_CAP, (odds / (1 + odds)) * 100);
}
export function calibrate(m: Model, raw: number): { prob: number; n: number; observed: number | null } {
  const c = m.calib[calibBucket(raw)];
  if (!c || c.n === 0) return { prob: raw, n: 0, observed: null };
  return { prob: Math.min(PROB_CAP, (100 * c.h + K_CALIB * raw) / (c.n + K_CALIB)), n: c.n, observed: (100 * c.h) / c.n };
}

/** Bouw per event het model uit de gepoolde tellingen. */
export function buildModels(pool: ArrayLike<number>): Array<Model | null> {
  const out: Array<Model | null> = [];
  for (let e = 0; e < NE; e++) {
    const g = EVENTS[e].group;
    // Elke dag valt in precies één slot van kenmerk 0: dat geeft de totalen.
    let n = 0, hits = 0;
    for (let s = 0; s < SLOTS; s++) { n += Number(pool[idxN(g, 0, s)]); hits += Number(pool[idxH(e, 0, s)]); }
    if (!(n > 0 && hits > 0)) { out.push(null); continue; }
    const p0 = hits / n;
    const lift = new Float64Array(FS), logLift = new Float64Array(FS);
    const maxLift = new Float64Array(NF), minLift = new Float64Array(NF);
    const selected: boolean[] = [];
    for (let f = 0; f < NF; f++) {
      let mx = 0, mn = Infinity;
      for (let s = 0; s < SLOTS; s++) {
        const bn = Number(pool[idxN(g, f, s)]), bh = Number(pool[idxH(e, f, s)]);
        const rate = (bh + K_BUCKET * p0) / (bn + K_BUCKET);
        lift[f * SLOTS + s] = Math.min(LIFT_MAX, Math.max(LIFT_MIN, rate / p0));
        if (bn >= SEL_MIN_N && bh >= SEL_MIN_H) { const r = bh / bn / p0; if (r > mx) mx = r; if (r < mn) mn = r; }
        // Een bucket met genoeg dagen maar (bijna) geen treffers is ook informatief.
        else if (bn >= SEL_MIN_N * 3 && bh < SEL_MIN_H) { const r = (bh + 1) / bn / p0; if (r < mn) mn = r; }
      }
      maxLift[f] = mx; minLift[f] = Number.isFinite(mn) ? mn : 0;
      const sel = mx >= SEL_LIFT || (Number.isFinite(mn) && mn > 0 && mn <= 1 / SEL_LIFT);
      selected.push(sel);
      if (sel) for (let s = 0; s < SLOTS; s++) logLift[f * SLOTS + s] = Math.log(lift[f * SLOTS + s]);
    }
    const calib: Array<{ n: number; h: number }> = [];
    let ceiling: number | null = null;
    for (let b = 0; b < NCB; b++) {
      const cn = Number(pool[idxC(e, b, 0)]), ch = Number(pool[idxC(e, b, 1)]);
      calib.push({ n: cn, h: ch });
      if (cn >= 1000) { const r = (100 * ch) / cn; if (ceiling == null || r > ceiling) ceiling = r; }
    }
    out.push({ e, p0, n, hits, lift, logLift, selected, maxLift, minLift, calib, ceiling });
  }
  return out;
}

/**
 * Meet de historie van één aandeel: per handelsdag de kenmerken, per event of
 * het volgde, en (als er al een model is) de modelkans voor de kalibratie.
 */
export function analyze(f: Fetched, opts: { nowMs: number; fx: number; mcapNow: number | null; regime: Regime | null; models: Array<Model | null> | null }): Analysis {
  const b = f.clean;
  const n = b.n;
  const counts = new Int32Array(LEN);
  const sum: Summary = {
    bars: n, first_date: n ? iso(b.ms[0]) : null, last_date: n ? iso(b.ms[n - 1]) : null,
    last_close: n ? b.close[n - 1] : null, last_raw: n ? b.raw[n - 1] : null, currency: b.currency, fx: opts.fx,
    last_peak_date: null, peak_count: 0, spikes_1y: 0, last_spike_date: null, spike_dates_1y: [],
    poefie_count: 0, poefie_count_2y: 0, last_poefie_date: null, poefie_max_growth: null, hist_peak: 0,
    hi5y: null, lo5y: null, phoenix: false, phoenix_peak: null, phoenix_peak_date: null,
    volat22: null, dvol30: null, own_n: [0, 0], own_h: new Array(NE).fill(0),
  };
  // Poefie-incidenten op de ongefilterde reeks, net als compute-poefies.
  const pf = findPoefieIncidents(f.all);
  sum.hist_peak = pf.histPeak;
  sum.poefie_count = pf.incidents.length;
  sum.poefie_count_2y = pf.incidents.filter((x) => Date.parse(x.peak_date) >= opts.nowMs - 730 * DAY).length;
  sum.last_poefie_date = pf.incidents.length ? pf.incidents[pf.incidents.length - 1].peak_date : null;
  sum.poefie_max_growth = pf.incidents.length ? Math.max(...pf.incidents.map((x) => x.growth_pct)) : null;
  if (n < MIN_BARS) return { ok: false, error: `te weinig historie (${n} dagen)`, counts, summary: sum, incidents: pf.incidents };

  const c = b.close, fx = opts.fx;
  // Hippo-pieken: dag j staat ≥ +50% boven een van de 10 dagen ervoor.
  const isPeak = new Uint8Array(n);
  for (let j = 1; j < n; j++) {
    for (let k = 1; k <= PEAK_BARS && j - k >= 0; k++) {
      const base = c[j - k];
      if (base * fx >= MIN_PRICE_USD && c[j] >= base * HIPPO_MULT) { isPeak[j] = 1; break; }
    }
  }
  let lastPeak = -1;
  for (let j = 0; j < n; j++) if (isPeak[j]) { if (!(j > 0 && isPeak[j - 1])) sum.peak_count++; lastPeak = j; }
  sum.last_peak_date = lastPeak >= 0 ? iso(b.ms[lastPeak]) : null;

  const ev = prepEvents(b, fx, pf.histPeak <= POEFIE_MAX_HIST_PEAK);
  const { spikes, spikePre } = ev;
  const yearAgo = opts.nowMs - 365 * DAY;
  for (const j of spikes) if (b.ms[j] >= yearAgo) { sum.spikes_1y++; sum.spike_dates_1y.push(iso(b.ms[j])); }
  sum.last_spike_date = spikes.length ? iso(b.ms[spikes[spikes.length - 1]]) : null;
  // Laatste bekende poefie-piek per dag (voor het "dagen sinds"-kenmerk).
  const incPeakMs = pf.incidents.map((x) => Date.parse(x.peak_date + "T00:00:00Z"));

  // Feniks: lopend minimum op opgeschoonde bars (bar ≥5× de vorige overgeslagen).
  const phx = new Uint8Array(n);
  {
    let minSoFar = Infinity, prev = NaN, runFound = false, maxSoFar = 0, peakIdx = -1;
    for (let t = 0; t < n; t++) {
      const v = c[t];
      if (v > maxSoFar) { maxSoFar = v; peakIdx = t; }
      if (Number.isFinite(prev) && prev > 0 && v >= prev * MAX_BAR_JUMP) { prev = v; }
      else {
        prev = v;
        if (v < minSoFar) minSoFar = v;
        else if (minSoFar > 0 && v >= minSoFar * PHOENIX_MULT && v >= PHOENIX_MIN_PEAK) runFound = true;
      }
      if (runFound && v <= maxSoFar * PHOENIX_MAX_FRACTION) phx[t] = 1;
      if (t === n - 1 && runFound) {
        sum.phoenix = v <= maxSoFar * PHOENIX_MAX_FRACTION;
        sum.phoenix_peak = maxSoFar; sum.phoenix_peak_date = iso(b.ms[peakIdx]);
      }
    }
  }

  // ── Per dag: kenmerken en uitkomsten ──────────────────────────────────────
  const slots = new Uint8Array(n * NF);
  const inS = new Uint8Array(n), inL = new Uint8Array(n);
  const hitBits = new Uint8Array(n);                  // bit e = event e volgde
  const dq1y: number[] = [], dqLo1y: number[] = [], dq5y: number[] = [], dqLo5y: number[] = [], dqHi90: number[] = [], dqLo90: number[] = [];
  let volSum = 0, dvolSum = 0, rangeSum = 0, lastPeakBefore = -1, poefIdx = -1;
  const mcapScale = opts.mcapNow != null && opts.mcapNow > 0 && b.raw[n - 1] > 0 ? opts.mcapNow / b.raw[n - 1] : null;
  const pushMax = (dq: number[], t: number) => { while (dq.length && c[dq[dq.length - 1]] <= c[t]) dq.pop(); dq.push(t); };
  const pushMin = (dq: number[], t: number) => { while (dq.length && c[dq[dq.length - 1]] >= c[t]) dq.pop(); dq.push(t); };
  const trim = (dq: number[], lo: number) => { while (dq.length && dq[0] < lo) dq.shift(); };

  for (let t = 0; t < n; t++) {
    if (isPeak[t]) lastPeakBefore = t;
    while (poefIdx + 1 < incPeakMs.length && incPeakMs[poefIdx + 1] <= b.ms[t]) poefIdx++;
    if (t >= 30) { volSum -= b.vol[t - 30]; dvolSum -= b.vol[t - 30] * b.raw[t - 30]; }
    if (t >= 22) rangeSum -= (b.high[t - 22] - b.low[t - 22]) / b.low[t - 22];
    rangeSum += (b.high[t] - b.low[t]) / b.low[t];
    trim(dq1y, t - 252); trim(dqLo1y, t - 252); trim(dq5y, t - 1260); trim(dqLo5y, t - 1260); trim(dqHi90, t - 63); trim(dqLo90, t - 63);
    const v = c[t];
    const fwdS = t + GROUP_FWD[0] <= n - 1, fwdL = t + GROUP_FWD[1] <= n - 1;
    if (t >= 30 && v * fx >= MIN_PRICE_USD && (fwdS || t === n - 1)) {
      const hi1 = dq1y.length ? Math.max(v, c[dq1y[0]]) : v;
      const lo1 = dqLo1y.length ? Math.min(v, c[dqLo1y[0]]) : v;
      const hi5 = dq5y.length ? Math.max(v, c[dq5y[0]]) : v;
      const lo5 = dqLo5y.length ? Math.min(v, c[dqLo5y[0]]) : v;
      const hi90 = dqHi90.length ? Math.max(v, c[dqHi90[0]]) : v;
      const lo90 = dqLo90.length ? Math.min(v, c[dqLo90[0]]) : v;
      const avgVol = volSum / 30;
      const dvol = (dvolSum / 30) * fx;
      const r22 = (v / c[t - 22] - 1) * 100;
      let star: number | null = null;
      // Historische marktkap ≈ huidige × koersverhouding. Verwatering maakt
      // dat voor het verleden te hoog; zie de toelichting in CLAUDE.md.
      if (mcapScale != null && t >= 252) {
        star = starSlotValue(starFit(hi5 / lo5, (1 - v / hi5) * 100, r22, mcapScale * b.raw[t], dvol, b.raw[t] * fx), true);
      }
      const reg = opts.regime;
      const o = t * NF;
      slots[o + 0] = slotOf(0, (v / c[t - 1] - 1) * 100);
      slots[o + 1] = slotOf(1, (v / c[t - 5] - 1) * 100);
      slots[o + 2] = slotOf(2, r22);
      slots[o + 3] = slotOf(3, t >= 126 ? (v / c[t - 126] - 1) * 100 : null);
      slots[o + 4] = slotOf(4, avgVol > 0 ? b.vol[t] / avgVol : null);
      slots[o + 5] = slotOf(5, lastPeakBefore >= 0 ? Math.round((b.ms[t] - b.ms[lastPeakBefore]) / DAY) : null);
      slots[o + 6] = slotOf(6, (1 - v / hi1) * 100);
      slots[o + 7] = slotOf(7, (1 - v / hi5) * 100);
      slots[o + 8] = slotOf(8, hi90 > lo90 ? ((v - lo90) / (hi90 - lo90)) * 100 : null);
      slots[o + 9] = slotOf(9, (v / lo1 - 1) * 100);
      slots[o + 10] = slotOf(10, t >= 22 ? (rangeSum / 22) * 100 : null);
      slots[o + 11] = slotOf(11, dvol);
      slots[o + 12] = slotOf(12, b.raw[t] * fx);
      slots[o + 13] = slotOf(13, t >= 2 ? spikePre[t - 1] - spikePre[Math.max(0, t - 251)] : 0);
      slots[o + 14] = slotOf(14, poefIdx >= 0 ? Math.round((b.ms[t] - incPeakMs[poefIdx]) / DAY) : null);
      slots[o + 15] = slotOf(15, star);
      slots[o + 16] = slotOf(16, phx[t]);
      slots[o + 17] = slotOf(17, reg ? reg.above200.get(b.day[t]) ?? null : null);
      slots[o + 18] = slotOf(18, reg ? reg.r22.get(b.day[t]) ?? null : null);
      if (t === n - 1) {
        sum.hi5y = hi5; sum.lo5y = lo5; sum.volat22 = t >= 22 ? (rangeSum / 22) * 100 : null; sum.dvol30 = dvol;
      }
      if (fwdS) {
        inS[t] = 1;
        if (fwdL) inL[t] = 1;
        const bits = bitsAt(b, ev, t, fwdL);
        hitBits[t] = bits;
        for (let ff = 0; ff < NF; ff++) {
          const s = slots[o + ff];
          counts[idxN(0, ff, s)]++;
          if (fwdL) counts[idxN(1, ff, s)]++;
        }
        if (bits) for (let e = 0; e < NE; e++) {
          if (!(bits & (1 << e))) continue;
          for (let ff = 0; ff < NF; ff++) counts[idxH(e, ff, slots[o + ff])]++;
        }
        sum.own_n[0]++; if (fwdL) sum.own_n[1]++;
        for (let e = 0; e < NE; e++) if (bits & (1 << e)) sum.own_h[e]++;
      }
    }
    // Pas ná de dag zelf in de vensters, zodat "vóór t" ook echt vóór t is.
    pushMax(dq1y, t); pushMin(dqLo1y, t); pushMax(dq5y, t); pushMin(dqLo5y, t); pushMax(dqHi90, t); pushMin(dqLo90, t);
    volSum += b.vol[t]; dvolSum += b.vol[t] * b.raw[t];
  }

  // Kalibratie: wat zei het model (met de lifts van vóór deze scan) op elke
  // historische dag, en gebeurde het? De eigen lift komt uit de volledige
  // eigen historie — dezelfde waarde die het scoren gebruikt.
  if (opts.models) {
    for (let e = 0; e < NE; e++) {
      const m = opts.models[e];
      if (!m) continue;
      const g = EVENTS[e].group;
      const ownN = sum.own_n[g];
      if (!ownN) continue;
      const own = ownLift(m, sum.own_h[e], ownN);
      const base = Math.log(m.p0 / (1 - m.p0)) + Math.log(own);
      const ll = m.logLift;
      for (let t = 0; t < n; t++) {
        if (!(g === 0 ? inS[t] : inL[t])) continue;
        const o = t * NF;
        let logit = base;
        for (let ff = 0; ff < NF; ff++) logit += ll[ff * SLOTS + slots[o + ff]];
        const odds = Math.exp(logit);
        const p = Math.min(PROB_CAP, (odds / (1 + odds)) * 100);
        const hit = (hitBits[t] >> e) & 1;
        counts[idxC(e, calibBucket(p), 0)]++;
        if (hit) counts[idxC(e, calibBucket(p), 1)]++;
      }
    }
  }
  return { ok: true, error: null, counts, summary: sum, incidents: pf.incidents };
}

// ── Live kenmerken ──────────────────────────────────────────────────────────
export interface Live {
  close: number | null; fx: number;
  r1: number | null; r5: number | null; r22: number | null; r6mo: number | null;
  vol: number | null; hi52: number | null; lo52: number | null; hi5y: number | null;
  hi90: number | null; lo90: number | null; volat: number | null; avgVol30: number | null;
  mcapUsd: number | null;
  lastPeakDate: string | null; spikeDates1y: string[] | null; lastPoefieDate: string | null;
  phoenixPeak: number | null; phoenixRun: boolean; lo5y: number | null;
  iwm200: number | null; iwm22: number | null;
}
export interface LiveOut { slots: Uint8Array; values: Record<string, number | null>; star: number | null; spikes1y: number; since: number | null; poefAge: number | null }
/** Zet de actuele toestand om naar dezelfde buckets als de historie. */
export function liveSlots(L: Live, nowMs: number): LiveOut {
  const slots = new Uint8Array(NF);
  const v: Record<string, number | null> = {};
  const c = L.close;
  const pct = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? (1 - a / b) * 100 : null);
  const daysSince = (d: string | null) => (d ? Math.max(0, Math.round((nowMs - Date.parse(d + "T00:00:00Z")) / DAY)) : null);
  let since = daysSince(L.lastPeakDate);
  if (L.r5 != null && L.r5 >= 50) since = 0;          // sprint loopt nu; de scan kan achterlopen
  // Een spike van vandaag telt pas mee als hij 3 dagen standhield; dat ziet de
  // volgende deep-scan (die wordt door de sweep naar voren gehaald).
  const spikes = (L.spikeDates1y ?? []).filter((d) => Date.parse(d + "T00:00:00Z") >= nowMs - 365 * DAY).length;
  let poefAge = daysSince(L.lastPoefieDate);
  if (L.r5 != null && L.r5 >= (POEFIE_MULT - 1) * 100) poefAge = 0;
  const hi5 = c != null ? Math.max(c, L.hi5y ?? 0, L.hi52 ?? 0) : null;
  const lo5 = c != null && L.lo5y != null ? Math.min(c, L.lo5y, L.lo52 ?? Infinity) : null;
  const priceUsd = c != null ? c * L.fx : null;
  const dvol = L.avgVol30 != null && c != null ? L.avgVol30 * c * L.fx : null;
  let star: number | null = null;
  let starSlot: number | null = null;
  if (L.mcapUsd != null && hi5 != null && lo5 != null && lo5 > 0 && c != null) {
    star = starFit(hi5 / lo5, (1 - c / hi5) * 100, L.r22, L.mcapUsd, dvol ?? 0, priceUsd ?? 0);
    starSlot = starSlotValue(star, true);
  }
  const phx = L.phoenixRun && c != null && L.phoenixPeak != null ? (c <= L.phoenixPeak * PHOENIX_MAX_FRACTION ? 1 : 0) : 0;
  v.r1 = L.r1; v.r5 = L.r5; v.r22 = L.r22; v.r6mo = L.r6mo; v.vol = L.vol; v.since = since;
  v.hi = pct(c, L.hi52 != null && c != null ? Math.max(L.hi52, c) : null);
  v.dd5y = pct(c, hi5);
  v.rng = c != null && L.hi90 != null && L.lo90 != null && L.hi90 > L.lo90 ? Math.min(100, Math.max(0, ((c - L.lo90) / (L.hi90 - L.lo90)) * 100)) : null;
  v.lo1y = c != null && L.lo52 != null && L.lo52 > 0 ? Math.max(0, (c / L.lo52 - 1) * 100) : null;
  v.volat = L.volat; v.dvol = dvol; v.price = priceUsd; v.hikk = spikes; v.poef = poefAge;
  v.star = starSlot; v.phx = phx; v.iwm200 = L.iwm200; v.iwm22 = L.iwm22;
  for (let f = 0; f < NF; f++) slots[f] = slotOf(f, v[FEATURES[f].key] ?? null);
  return { slots, values: v, star, spikes1y: spikes, since, poefAge };
}

export interface ScoreOut { prob: number; raw: number; own: number; ownRate: number; calN: number; calObs: number | null }
export function scoreEvent(m: Model, slots: Uint8Array, ownN: number, ownH: number): ScoreOut {
  const own = ownN > 0 ? ownLift(m, ownH, ownN) : 1;
  const raw = rawProb(m, own, slots);
  const cal = calibrate(m, raw);
  return { prob: cal.prob, raw, own, ownRate: ownN > 0 ? ownRate(m, ownH, ownN) : m.p0, calN: cal.n, calObs: cal.observed };
}

/** Samenvatting van een model voor opslag/weergave. */
export function modelSummary(m: Model, pool: ArrayLike<number>) {
  const g = EVENTS[m.e].group;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const features = FEATURES.map((fd, f) => ({
    key: fd.key, label: fd.label, used: m.selected[f],
    max_lift: Math.round(m.maxLift[f] * 100) / 100, min_lift: Math.round(m.minLift[f] * 100) / 100,
    buckets: Array.from({ length: SLOTS }, (_, s) => s)
      .filter((s) => Number(pool[idxN(g, f, s)]) > 0)
      .map((s) => {
        const n = Number(pool[idxN(g, f, s)]), h = Number(pool[idxH(m.e, f, s)]);
        return { slot: s, bucket: slotLabel(f, s), n, hits: h, rate_pct: Math.round((1000 * h) / n) / 10, lift: Math.round(m.lift[f * SLOTS + s] * 100) / 100 };
      }),
  }));
  const calib = m.calib.map((c, b) => ({ bucket: b, ...calibRange(b), n: c.n, hits: c.h, rate_pct: c.n ? r1((100 * c.h) / c.n) : null }));
  return { base_rate: Math.round(m.p0 * 10000) / 100, days_n: m.n, hits: m.hits, features, calib, ceiling: m.ceiling != null ? r1(m.ceiling) : null };
}
