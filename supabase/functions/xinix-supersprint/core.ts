// xinix-supersprint/core — rekenkern van SUPERsprinters. Geen Deno-afhankelijkheden, zodat hij ook
// onder Node te testen is (scripts/supersprinters/test_core.ts).
//
// Een sprinter = het h14-event van de explosie-motor: binnen 10 handelsdagen een slot van minstens
// +50% boven het slot van de voorspeldag, en de handelsdag daarna nog minstens +20%.
//
// Het model is een verzameling beslisbomen (LightGBM), getraind op 10 jaar dagkoersen van ~20.000
// aandelen op de Saxo-beurzen. Het gebruikt alleen velden die de TradingView-scanner per aandeel
// levert, plus het marktklimaat van de regio. Elke definitie hieronder is tegen de scanner
// gecontroleerd (zie docs/supersprinters-rapport.md); verander ze niet zonder opnieuw te trainen.

export const MODEL_URL = "https://constantdynamics.github.io/xinix/ss-model.json";
export const MODEL_SHA256 = "32e40ffe85de1dc1ec91f6f3a0076b99f01b5248d35ad07413b18ff06694d6a6";
export const DAY = 86400000;

// ── Markten ─────────────────────────────────────────────────────────────────
// Saxo's eigen overzicht (prijslijst van 13 juli 2026 en helpcenter, geraadpleegd op 13 november
// 2026) noemt voor Canada alleen de Toronto Stock Exchange en de TSX Venture: de Canadian Securities
// Exchange (.CN) en Cboe Canada/NEO (.NE) doen daarom niet mee.
export const MARKET_EX: Record<string, Record<string, string>> = {
  america: { NASDAQ: "", NYSE: "", AMEX: "" },
  canada: { TSX: ".TO", TSXV: ".V" },
  uk: { LSE: ".L" },
  germany: { XETR: ".DE", FWB: ".F" },
  france: { EURONEXT: ".PA" },
  netherlands: { EURONEXT: ".AS" },
  belgium: { EURONEXT: ".BR" },
  italy: { MIL: ".MI" },
  spain: { BME: ".MC" },
  portugal: { EURONEXT: ".LS" },
  poland: { GPW: ".WA" },
  switzerland: { SIX: ".SW" },
  sweden: { OMXSTO: ".ST" },
  norway: { OSL: ".OL" },
  denmark: { OMXCOP: ".CO" },
  finland: { OMXHEX: ".HE" },
  australia: { ASX: ".AX" },
  hongkong: { HKEX: ".HK" },
  japan: { TSE: ".T" },
  singapore: { SGX: ".SI" },
};
// Drie rondes per handelsdag, elk kort na het slot van de eigen beurzen.
export const ROUNDS: Record<string, string[]> = {
  apac: ["japan", "hongkong", "singapore", "australia"],
  europa: ["uk", "germany", "france", "netherlands", "belgium", "italy", "spain", "portugal", "poland", "switzerland", "sweden", "norway", "denmark", "finland"],
  amerika: ["america", "canada"],
};
const APAC = new Set(ROUNDS.apac);
/** Regio zoals het model hem kent: 0 = VS, 1 = Canada, 2 = Europa, 3 = Azië-Pacific. */
export function regionOf(market: string): number {
  return market === "america" ? 0 : market === "canada" ? 1 : APAC.has(market) ? 3 : 2;
}
export const REGION_NL = ["VS", "Canada", "Europa", "Azië-Pacific"];
const US_EXCHANGE: Record<string, string> = { NASDAQ: "NASDAQ", NYSE: "NYSE", AMEX: "NYSE American" };

/** TradingView-symbool → Yahoo-ticker (zelfde afspraak als de rest van Xinix). null = doet niet mee. */
export function yahooSymbol(market: string, exchange: string, name: string): string | null {
  const sfx = MARKET_EX[market]?.[exchange];
  if (sfx == null) return null;
  let sym = name.toUpperCase().replace(/\.$/, "").replace(/[._]/g, "-");   // Londen: "BP." → BP.L
  if (!sym) return null;
  if (market === "hongkong") sym = sym.padStart(4, "0");
  if (market === "uk" && /^[0-9][0-9A-Z]{3}$/.test(sym)) return null;      // IOB-spooknoteringen
  return `${sym}${sfx}`;
}

// ── TradingView ─────────────────────────────────────────────────────────────
export const TV_COLS = [
  "name", "description", "close", "currency", "change", "open", "high", "low", "volume",
  "average_volume_10d_calc", "average_volume_30d_calc", "average_volume_90d_calc", "relative_volume_10d_calc",
  "Perf.1M", "Volatility.W", "Volatility.M", "price_52_week_high", "price_52_week_low",
  "High.6M", "High.3M", "Low.3M", "High.1M", "Low.1M",
  "market_cap_basic", "fundamental_currency_code", "float_shares_outstanding", "sector", "exchange",
];
export interface TvRow {
  ticker: string; tv_symbol: string; market: string; region: number; exchange: string; name: string | null;
  currency: string | null; sector: string | null;
  close: number; change: number; open: number; high: number; low: number; volume: number;
  av10: number; av30: number; av90: number; rv10: number; perf1m: number; volW: number; volM: number;
  hi52: number; lo52: number; hi6m: number; hi3m: number; lo3m: number; hi1m: number; lo1m: number;
  mcap: number; mcapCur: string | null; float: number;
}
const N = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function parseTvRow(market: string, row: { s: string; d: unknown[] }): TvRow | null {
  const d = row.d;
  const exchange = String(d[27] ?? "");
  const ticker = yahooSymbol(market, exchange, String(d[0] ?? ""));
  if (!ticker) return null;
  const close = N(d[2]);
  if (!(close > 0)) return null;
  return {
    ticker, tv_symbol: row.s, market, region: regionOf(market),
    exchange, name: (d[1] as string) || null, currency: (d[3] as string) || null, sector: (d[26] as string) || null,
    close, change: N(d[4]), open: N(d[5]), high: N(d[6]), low: N(d[7]), volume: N(d[8]),
    av10: N(d[9]), av30: N(d[10]), av90: N(d[11]), rv10: N(d[12]), perf1m: N(d[13]), volW: N(d[14]), volM: N(d[15]),
    hi52: N(d[16]), lo52: N(d[17]), hi6m: N(d[18]), hi3m: N(d[19]), lo3m: N(d[20]), hi1m: N(d[21]), lo1m: N(d[22]),
    mcap: N(d[23]), mcapCur: (d[24] as string) || null, float: N(d[25]),
  };
}

export async function tvPost(market: string, body: unknown, timeoutMs = 25000): Promise<{ totalCount: number; data: Array<{ s: string; d: unknown[] }> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://scanner.tradingview.com/${market}/scan`, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TradingView ${market} HTTP ${res.status}`);
    // deno-lint-ignore no-explicit-any
    const j = (await res.json()) as any;
    return { totalCount: Number(j.totalCount ?? 0), data: j.data ?? [] };
  } finally { clearTimeout(timer); }
}

/** Alle primaire gewone aandelen van één markt (zelfde filter als de explosie-motor). */
export async function tvMarket(market: string): Promise<{ rows: TvRow[]; requests: number }> {
  const out: TvRow[] = [];
  const PAGE = 3000;
  let requests = 0;
  for (let from = 0; from < 20000; from += PAGE) {
    const r = await tvPost(market, {
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "is_primary", operation: "equal", right: true },
        { left: "subtype", operation: "in_range", right: ["common", "foreign-issuer", ""] },
        { left: "exchange", operation: "in_range", right: Object.keys(MARKET_EX[market]) },
        { left: "close", operation: "greater", right: 0 },
      ],
      options: { lang: "en" },
      columns: TV_COLS,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [from, from + PAGE],
    });
    requests++;
    for (const row of r.data) { const t = parseTvRow(market, row); if (t) out.push(t); }
    if (from + PAGE >= r.totalCount || r.data.length === 0) break;
  }
  return { rows: out, requests };
}

// ── Valuta ──────────────────────────────────────────────────────────────────
/** Dollars per eenheid, uit de ECB-koersen (eenheden per euro). Pence, cent en agorot zijn 1/100. */
export function usdPer(currency: string | null, perEur: Record<string, number>): number | null {
  if (!currency || currency === "USD") return 1;
  const usd = perEur.USD;
  if (!(usd > 0)) return null;
  const sub: Record<string, string> = { GBX: "GBP", GBp: "GBP", ZAc: "ZAR", ZAC: "ZAR", ILA: "ILS" };
  const base = sub[currency] ?? currency;
  const r = perEur[base];
  if (!(r > 0)) return null;
  return (usd / r) * (sub[currency] ? 0.01 : 1);
}

// ── Filters ─────────────────────────────────────────────────────────────────
const SPAC_RE = /\b(acquisition|acquisitions)\s+(corp|corporation|co|company|inc|ltd|limited|holdings|plc|partners)\b|\bSPAC\b|blank[\s-]?check|\bcapital pool\b/i;
/** SPAC zonder eigen bedrijf: herkenbaar aan de naam. */
export function isSpac(name: string | null): boolean { return !!name && SPAC_RE.test(name); }

export interface Eligibility { ok: boolean; pxUsd: number; dvolUsd: number }
/** Koers ≥ $0,50 en omzet (slot × gemiddeld volume over 30 dagen) ≥ $10.000 per dag. */
export function eligible(r: TvRow, usd: number, minPx: number, minDvol: number): Eligibility {
  const pxUsd = r.close * usd;
  const dvolUsd = r.av30 * r.close * usd;
  const ok = pxUsd >= minPx && dvolUsd >= minDvol && Number.isFinite(r.change);
  return { ok, pxUsd, dvolUsd };
}

// ── Marktklimaat ────────────────────────────────────────────────────────────
// Per regio het aandeel van de meedoende aandelen dat vandaag of deze maand hard gaat.
export const BREADTH_KEYS = ["b1_20", "b1_10", "bm_50", "bm_100", "bvw_15"] as const;
export const BREADTH_NAMES = ["b1_20", "b1_10", "bm_50", "bm_100", "bvw_15", "b1_20_m5", "b1_10_m5", "b1_20_m22"];
export const MIN_BREADTH_N = 200;
export interface BreadthDay { day: string; n: number; b1_20: number; b1_10: number; bm_50: number; bm_100: number; bvw_15: number }

export function breadthOf(day: string, rows: TvRow[]): BreadthDay {
  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (const r of rows) {
    if (r.change >= 20) a++;
    if (r.change >= 10) b++;
    if (r.perf1m >= 50) c++;
    if (r.perf1m >= 100) d++;
    if (r.volW >= 15) e++;
  }
  const n = rows.length || 1;
  return { day, n: rows.length, b1_20: a / n, b1_10: b / n, bm_50: c / n, bm_100: d / n, bvw_15: e / n };
}
/** De acht klimaatwaarden van de laatste sessie in `hist` (oplopend op dag), met voortschrijdende gemiddelden. */
export function breadthVector(hist: BreadthDay[]): number[] {
  if (!hist.length) return new Array(BREADTH_NAMES.length).fill(NaN);
  const last = hist[hist.length - 1];
  const mean = (k: "b1_20" | "b1_10", w: number, minp: number) => {
    const part = hist.slice(-w);
    if (part.length < minp) return NaN;
    let s = 0; for (const h of part) s += h[k];
    return s / part.length;
  };
  return [last.b1_20, last.b1_10, last.bm_50, last.bm_100, last.bvw_15, mean("b1_20", 5, 1), mean("b1_10", 5, 1), mean("b1_20", 22, 5)];
}

// ── Kenmerken ───────────────────────────────────────────────────────────────
/** De kenmerken van één aandeel, op naam. `usd` = dollars per eenheid van de noteringsmunt. */
export function stockFeatures(r: TvRow, usd: number): Record<string, number> {
  const c = r.close;
  const prev = c / (1 + r.change / 100);
  // Zonder handel vandaag levert de scanner soms geen open/hoog/laag: dan gelijk aan het slot.
  const o = r.open > 0 ? r.open : c, hRaw = r.high > 0 ? r.high : c, lRaw = r.low > 0 ? r.low : c;
  const h = Math.max(hRaw, lRaw, c), l = Math.min(hRaw, lRaw, c);
  const pos = (v: number) => (v > 0 ? v : NaN);
  return {
    r1: r.change / 100,
    gap: o / prev - 1,
    intra: c / o - 1,
    clv: h > l ? (c - l) / (h - l) : 0.5,
    wick: h / c - 1,
    lpx: Math.log10(Math.max(c * usd, 1e-6)),
    t_p1m: r.perf1m / 100,
    t_vd: h / l - 1,
    t_vw: r.volW / 100,
    t_vm: r.volM / 100,
    t_rv10: r.rv10,
    t_v10_30: r.av10 / pos(r.av30),
    t_v30_90: r.av30 / pos(r.av90),
    t_v_30: r.volume / pos(r.av30),
    t_dd52: 1 - c / pos(r.hi52),
    t_up52: Math.log(c / pos(r.lo52)),
    t_dd6m: 1 - c / pos(r.hi6m),
    t_dd3m: 1 - c / pos(r.hi3m),
    t_up3m: Math.log(c / pos(r.lo3m)),
    t_pos3m: r.hi3m > r.lo3m ? (c - r.lo3m) / (r.hi3m - r.lo3m) : (Number.isFinite(r.hi3m) && Number.isFinite(r.lo3m) ? 0.5 : NaN),
    t_dd1m: 1 - c / pos(r.hi1m),
    t_up1m: Math.log(c / pos(r.lo1m)),
    t_ldv30: Math.log10(Math.max(r.av30 * c * usd, 1)),
    t_ldv1: Math.log10(Math.max(r.volume * c * usd, 1)),
  };
}

// ── Model ───────────────────────────────────────────────────────────────────
export interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; d: number[]; m: number[]; v: number[] }
export interface Model {
  version: string; trained_through: string; rounds: number; leaves: number;
  features: string[]; trees: Tree[];
  curve: { b: number; coef: number[]; knots: number[] };
  shrink_from: number; shrink: number; mult_seed: number;
  codes: { exch: Record<string, number>; sector: Record<string, number> };
  feature_median: Record<string, number | null>;
  base_rate_pct: number; min_px_usd: number; min_dvol_usd: number;
  holdout: unknown;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
let cached: Model | null = null;
/** Haalt het model op (één keer per instantie) en weigert een bestand dat niet bij deze code hoort. */
export async function loadModel(url = MODEL_URL, expectSha: string | null = MODEL_SHA256): Promise<Model> {
  if (cached) return cached;
  const res = await fetch(url, { headers: { "User-Agent": "xinix-supersprint" } });
  if (!res.ok) throw new Error(`model: HTTP ${res.status} bij ${url}`);
  const text = await res.text();
  if (expectSha) {
    const got = await sha256Hex(text);
    if (got !== expectSha) throw new Error(`model: controlegetal klopt niet (${got.slice(0, 12)}… in plaats van ${expectSha.slice(0, 12)}…)`);
  }
  cached = JSON.parse(text) as Model;
  return cached;
}
export function parseModel(text: string): Model { return JSON.parse(text) as Model; }
/** Voor tests: het model van schijf aanreiken in plaats van ophalen. */
export function setModel(m: Model | null): void { cached = m; }

/** Modeluitkomst (0–1) vóór ijking. Zelfde regels voor ontbrekende waarden als LightGBM. */
export function rawScore(m: Model, x: ArrayLike<number>): number {
  let s = 0;
  for (const t of m.trees) {
    if (!t.f.length) { s += t.v[0]; continue; }
    let i = 0;
    for (;;) {
      let v = x[t.f[i]];
      const mt = t.m[i];
      if (v !== v && mt !== 2) v = 0;
      const byDefault = (mt === 1 && Math.abs(v) <= 1e-35) || (mt === 2 && v !== v);
      const next = byDefault ? (t.d[i] ? t.l[i] : t.r[i]) : (v <= t.t[i] ? t.l[i] : t.r[i]);
      if (next < 0) { s += t.v[-next - 1]; break; }
      i = next;
    }
  }
  return 1 / (1 + Math.exp(-s));
}
const clip = (p: number) => Math.min(1 - 1e-7, Math.max(1e-7, p));
export const logit = (p: number) => { const q = clip(p); return Math.log(q / (1 - q)); };
/** IJklijn: stuksgewijs lineair in de logit, gemeten op testjaren die het model niet zag. */
export function curveProb(m: Model, raw: number): number {
  const z = logit(raw);
  let s = m.curve.b + m.curve.coef[0] * z;
  for (let i = 0; i < m.curve.knots.length; i++) s += m.curve.coef[i + 1] * Math.max(z - logit(m.curve.knots[i]), 0);
  return 1 / (1 + Math.exp(-s));
}
/** Bijsturing met het eigen track record (×mult op de odds) en demping van de allerhoogste kansen. */
export function finalProb(m: Model, base: number, mult: number): number {
  const o = (base / (1 - base)) * mult;
  let p = o / (1 + o);
  if (p > m.shrink_from) p = m.shrink_from + m.shrink * (p - m.shrink_from);
  return p;
}

export interface Scored { row: TvRow; pxUsd: number; dvolUsd: number; x: Float64Array; raw: number; base: number; prob: number }
/** Vult de kenmerkvector in de volgorde van het model. */
export function vectorOf(m: Model, r: TvRow, usd: number, breadth: Record<string, number>): Float64Array {
  const f = stockFeatures(r, usd);
  const x = new Float64Array(m.features.length);
  for (let i = 0; i < m.features.length; i++) {
    const k = m.features[i];
    let v: number;
    if (k === "region") v = r.region;
    else if (k === "exch_rank") v = m.codes.exch[r.exchange] ?? NaN;
    else if (k === "sector_rank") v = m.codes.sector[r.sector ?? "?"] ?? m.codes.sector["?"] ?? NaN;
    else if (k in f) v = f[k];
    else v = breadth[k] ?? NaN;
    x[i] = v;
  }
  return x;
}

// ── Uitleg: welke groep kenmerken trekt de kans omhoog of omlaag ─────────────
// Per groep worden de waarden van dit aandeel vervangen door die van een doorsnee aandeel van
// vandaag; het verschil in de modeluitkomst (als factor op de odds) is het effect van die groep.
export const GROUPS: Array<{ key: string; label: string; feats: string[] }> = [
  { key: "beweeglijk", label: "Beweeglijkheid", feats: ["t_vd", "t_vw", "t_vm"] },
  { key: "volume", label: "Volume", feats: ["t_rv10", "t_v10_30", "t_v30_90", "t_v_30"] },
  { key: "verloop", label: "Koersverloop", feats: ["r1", "gap", "intra", "clv", "wick", "t_p1m"] },
  { key: "plek", label: "Plek in de grafiek", feats: ["t_dd52", "t_up52", "t_dd6m", "t_dd3m", "t_up3m", "t_pos3m", "t_dd1m", "t_up1m"] },
  { key: "koers", label: "Koersniveau", feats: ["lpx"] },
  { key: "omzet", label: "Omzet", feats: ["t_ldv30", "t_ldv1"] },
  { key: "klimaat", label: "Marktklimaat", feats: [...BREADTH_NAMES, ...BREADTH_NAMES.map((n) => "us_" + n)] },
  { key: "beurs", label: "Beurs en sector", feats: ["region", "exch_rank", "sector_rank"] },
];
export interface Reason { g: string; label: string; f: number; t: string }
const pct = (v: number, d = 0) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d).replace(".", ",")}%`;
const num1 = (v: number) => v.toFixed(1).replace(".", ",");
export function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${num1(v / 1e9)} mrd`;
  if (v >= 1e6) return `$${num1(v / 1e6)} mln`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}
function factText(g: string, s: Scored, breadth: Record<string, number>): string {
  const r = s.row;
  switch (g) {
    case "beweeglijk": return `beweegt gemiddeld ${num1(r.volM)}% per dag deze maand, ${num1(r.volW)}% deze week`;
    case "volume": return Number.isFinite(r.rv10) ? `volume vandaag ${num1(r.rv10)}× het gemiddelde van 10 dagen` : "volume onbekend";
    case "verloop": return `${pct(r.change, 1)} vandaag, ${Number.isFinite(r.perf1m) ? pct(r.perf1m) : "—"} in een maand`;
    case "plek": return `${Math.round((1 - r.close / r.hi52) * 100)}% onder de jaartop, ${Number.isFinite(r.lo3m) && r.lo3m > 0 ? pct((r.close / r.lo3m - 1) * 100) : "—"} boven de bodem van 3 maanden`;
    case "koers": return `koers $${s.pxUsd < 10 ? s.pxUsd.toFixed(2).replace(".", ",") : Math.round(s.pxUsd)}`;
    case "omzet": return `omzet ${fmtUsd(s.dvolUsd)} per dag`;
    case "klimaat": return `${num1((breadth.b1_20 ?? 0) * 100)}% van de aandelen in ${REGION_NL[r.region]} steeg vandaag 20% of meer`;
    default: return `${r.exchange}${r.sector ? ` · ${r.sector}` : ""}`;
  }
}
export function explain(m: Model, s: Scored, ref: Float64Array, breadth: Record<string, number>, max = 5): Reason[] {
  const idx = new Map(m.features.map((k, i) => [k, i]));
  const z0 = logit(s.raw);
  const out: Reason[] = [];
  const x = new Float64Array(s.x);
  for (const g of GROUPS) {
    const cols = g.feats.map((k) => idx.get(k)).filter((i): i is number => i != null);
    if (!cols.length) continue;
    for (const i of cols) x[i] = ref[i];
    const f = Math.exp(z0 - logit(rawScore(m, x)));
    for (const i of cols) x[i] = s.x[i];
    if (f >= 1.25 || f <= 0.8) out.push({ g: g.key, label: g.label, f: Math.round(f * 100) / 100, t: factText(g.key, s, breadth) });
  }
  out.sort((a, b) => Math.abs(Math.log(b.f)) - Math.abs(Math.log(a.f)));
  return out.slice(0, max);
}
/** Vergelijkingspunt voor de uitleg: het doorsnee aandeel van deze ronde (mediaan per kenmerk). */
export function medianVector(m: Model, xs: Float64Array[]): Float64Array {
  const ref = new Float64Array(m.features.length);
  const fixed = new Set(GROUPS.filter((g) => g.key === "klimaat" || g.key === "beurs").flatMap((g) => g.feats));
  for (let i = 0; i < ref.length; i++) {
    const k = m.features[i];
    if (fixed.has(k)) { ref[i] = m.feature_median[k] ?? NaN; continue; }   // klimaat en beurs: langjarig gemiddelde
    const vals: number[] = [];
    for (const x of xs) if (x[i] === x[i]) vals.push(x[i]);
    vals.sort((a, b) => a - b);
    ref[i] = vals.length ? vals[vals.length >> 1] : NaN;
  }
  return ref;
}

// ── Uitkomst na 10 handelsdagen (Yahoo) ─────────────────────────────────────
export interface YBars { day: number[]; close: number[]; currency: string | null }
export async function yahooBars(ticker: string, range: string, timeoutMs = 12000): Promise<YBars> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d&events=split`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try { res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; XinixEngine/1.0; +https://github.com)" }, signal: ctl.signal }); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const j = (await res.json()) as any;
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${j?.chart?.error?.description ?? "geen resultaat"}`);
  const meta = r.meta ?? {};
  if (meta.symbol && String(meta.symbol).toUpperCase() !== ticker.toUpperCase()) throw new Error(`Yahoo ${ticker}: gaf ${meta.symbol} terug`);
  const ts: number[] = r.timestamp ?? [];
  const cl: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const adj: (number | null)[] = r.indicators?.adjclose?.[0]?.adjclose ?? [];
  const day: number[] = [], close: number[] = [];
  // Datum in de tijdzone van de beurs: Yahoo geeft het begin van de sessie in UTC, en dat is voor
  // Sydney in de zomertijd 23:00 uur van de dag ervóór. De lopende koers komt er als extra bar achteraan.
  const off = Number(meta.gmtoffset ?? 0) || 0;
  for (let i = 0; i < ts.length; i++) {
    const c = cl[i];
    if (c == null || !(c > 0)) continue;
    const a = adj[i] != null && (adj[i] as number) > 0 ? (adj[i] as number) : c;
    const d = Math.floor((ts[i] + off) / 86400);
    if (day.length && day[day.length - 1] === d) { close[close.length - 1] = a; continue; }   // dubbele dag: laatste telt
    day.push(d); close.push(a);
  }
  return { day, close, currency: typeof meta.currency === "string" ? meta.currency : null };
}
export const dayNumber = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY);

export type Outcome = { hit: boolean; touched: boolean } | { error: string } | null;
/**
 * Kwam de voorspelling van dag `madeOn` uit? Instap = het laatste slot op of vóór die dag.
 * null = de 10 handelsdagen plus de controle-dag zijn nog niet voorbij.
 */
export function outcome10(b: YBars, madeOn: string): Outcome {
  const made = dayNumber(madeOn);
  let t = -1;
  for (let i = 0; i < b.day.length; i++) { if (b.day[i] <= made) t = i; else break; }
  if (t < 0) return { error: "geen koers op de voorspeldag" };
  if (t + 11 > b.day.length - 1) return null;
  // Een sprong van 40× of meer in het venster is een eenheidsfout (pence/pond), geen koers.
  for (let j = t + 1; j <= t + 11; j++) {
    const q = b.close[j] / b.close[j - 1];
    if (q >= 40 || q <= 1 / 40) return { error: "koerssprong van 40× of meer: eenheidsfout" };
  }
  const v = b.close[t];
  let touched = false;
  for (let j = t + 1; j <= t + 10; j++) {
    if (b.close[j] < v * 1.5) continue;
    touched = true;
    if (b.close[j + 1] >= v * 1.2) return { hit: true, touched };
  }
  return { hit: false, touched };
}

// ── Nieuws ──────────────────────────────────────────────────────────────────
export const NEWS_GROUPS: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "emissie", label: "Uitgifte van aandelen", re: /\b(offering|registered direct|private placement|at[- ]the[- ]market|shelf|warrants?|convertible|dilut|raises? \$|pricing of|capital raise|placing|rights issue)\b/i },
  { key: "medisch", label: "Medisch nieuws (FDA, studie)", re: /\b(fda|ema|approval|approved|clearance|phase [1-3i]+|trial|topline|top-line|pdufa|breakthrough|orphan|clinical|study results)\b/i },
  { key: "overname", label: "Overname of fusie", re: /\b(acquir|acquisition|merger|merge|buyout|takeover|tender offer|to be acquired|going private|strategic alternatives)\b/i },
  { key: "contract", label: "Contract of samenwerking", re: /\b(contract|agreement|partnership|collaborat|order|award|licens|supply deal|joint venture)\b/i },
  { key: "cijfers", label: "Cijfers", re: /\b(earnings|results|revenue|quarter|q[1-4]|guidance|profit|loss|sales)\b/i },
  { key: "crypto", label: "Crypto", re: /\b(bitcoin|btc|ethereum|crypto|token|treasury strategy|blockchain|stablecoin|solana)\b/i },
  { key: "ai", label: "AI", re: /\b(artificial intelligence|\bai\b|data ?cent(er|re)|gpu|nvidia)\b/i },
  { key: "split", label: "Omgekeerde split of noteringsbrief", re: /\b(reverse (stock )?split|share consolidation|delist|minimum bid|compliance|deficiency)\b/i },
];
export function newsGroup(title: string): string {
  for (const g of NEWS_GROUPS) if (g.re.test(title)) return g.key;
  return "overig";
}
export interface NewsItem { t: string; u: string | null; p: string | null; d: string; g: string }
/** Recente koppen bij Yahoo. Yahoo hangt nieuws aan veel aandelen tegelijk: de kop moet de ticker of de bedrijfsnaam noemen. */
export async function yahooNews(ticker: string, name: string | null, nowMs: number, maxAgeDays = 14): Promise<NewsItem[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=8`,
      { headers: { "User-Agent": "Mozilla/5.0 (compatible; XinixEngine/1.0; +https://github.com)" }, signal: ctl.signal });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`Yahoo-nieuws ${ticker} HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const j = (await res.json()) as any;
  const base = ticker.split(".")[0].replace(/-/g, "");
  const word = (name ?? "").split(/[\s,.]+/).find((w) => w.length >= 4 && !/^(the|inc|corp|corporation|company|holdings|group|limited|plc)$/i.test(w)) ?? "";
  const out: NewsItem[] = [];
  // deno-lint-ignore no-explicit-any
  for (const n of (j?.news ?? []) as any[]) {
    const title = String(n.title ?? "");
    const at = Number(n.providerPublishTime ?? 0) * 1000;
    if (!title || !(at > 0) || nowMs - at > maxAgeDays * DAY) continue;
    const related: string[] = Array.isArray(n.relatedTickers) ? n.relatedTickers : [];
    const names = new RegExp(`\\b${base.replace(/[^A-Z0-9]/gi, "")}\\b`, "i").test(title) || (word && title.toLowerCase().includes(word.toLowerCase()));
    if (!names || (related.length > 0 && !related.some((t) => String(t).toUpperCase() === ticker.toUpperCase()))) continue;
    out.push({ t: title.slice(0, 160), u: typeof n.link === "string" ? n.link : null, p: typeof n.publisher === "string" ? n.publisher : null, d: new Date(at).toISOString().slice(0, 10), g: newsGroup(title) });
  }
  out.sort((a, b) => b.d.localeCompare(a.d));
  return out.slice(0, 3);
}

// ── Links en opmaak ─────────────────────────────────────────────────────────
const SUFFIX_TO_GOOGLE: Record<string, string> = { TO: "TSE", V: "CVE", L: "LON", DE: "ETR", F: "FRA", SW: "SWX", PA: "EPA", AS: "AMS", BR: "EBR", MI: "BIT", MC: "BME", LS: "ELI", WA: "WSE", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", HK: "HKG", T: "TYO", AX: "ASX", SI: "SGX" };
export function googleFinanceUrl(ticker: string, exchange: string | null): string {
  const t = ticker.toUpperCase();
  const dot = t.lastIndexOf(".");
  if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${exchange === "NYSE" ? "NYSE" : exchange === "AMEX" ? "NYSEAMERICAN" : "NASDAQ"}`;
  const ex = SUFFIX_TO_GOOGLE[t.slice(dot + 1)];
  return ex ? `https://www.google.com/finance/quote/${encodeURIComponent(t.slice(0, dot))}:${ex}` : `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
}
export function appUrl(ticker: string): string {
  return `https://constantdynamics.github.io/xinix/?tab=favorieten&sub=supersprinters&t=${encodeURIComponent(ticker.toUpperCase())}`;
}
export const safeTicker = (t: string) => t.replace(/\./g, "​.");
export function fmtPrice(v: number | null): string { if (v == null || !Number.isFinite(v)) return "—"; return v < 1 ? v.toFixed(4) : v < 10 ? v.toFixed(3) : v.toFixed(2); }
export const watchlistExchange = (exchange: string, ticker: string) => (ticker.includes(".") ? null : (US_EXCHANGE[exchange] ?? exchange));
export function watchlistSector(tvSector: string | null, name: string | null): "biotech" | "mining" | "other" {
  if (tvSector === "Health Technology" && /pharma|therap|bio|genom|oncolog|vaccin|medic/i.test(name ?? "")) return "biotech";
  if (tvSector === "Non-Energy Minerals") return "mining";
  return "other";
}
