// xinix-advice — Dagadvies: een papieren portefeuille van €10.000 bij DEGIRO,
// met koop- en verkoopadvies en een melding zodra er iets moet gebeuren.
//
//   GET  /xinix-advice                  overzicht voor het tabblad
//   POST /xinix-advice?mode=watch       elk kwartier: vullingen, stops, meetrekken, verkopen, nieuws, meldingen
//   POST /xinix-advice?mode=daily       werkdagen 23:10 UTC: wisselkoersen, kandidaten, orders, tijd-exits, equity, maandkeuze
//   POST /xinix-advice {action:"raise_limit", ticker, limit}   watchlist-limiet aanpassen (jij beslist)
//   POST /xinix-advice {action:"notify", on}                    meldingen aan/uit
//
// Zes boeken met elk €10.000 (zie 2026-09-29_xinix_advice.sql): 'live' krijgt
// de meldingen en volgt de bron met het beste track record; de vijf
// schaduwboeken (mix, potje, hippo, sprint, signaal) draaien dezelfde regels
// en vormen dat track record.
//
// Regels, voor elk boek gelijk:
// - Universum: actieve watchlist op beurzen die DEGIRO aanbiedt (geen OTC, geen
//   Hongkong: daar gelden lotgroottes die we niet kennen), ≥ $250k omzet per
//   dag, een verse koers, geen openstaande koersvlag en geen slecht nieuws.
// - Kooporder: GTC-limiet op min(aankooplimiet, slotkoers − 3%). Ligt die meer
//   dan 15% onder de koers, dan geen order maar een tip om de limiet te verhogen.
// - Grootte naar overtuiging: 10/15/20% van de portefeuille, nooit meer dan 20%
//   per aandeel en altijd ≥ 20% cash (open orders houden hun bedrag vast, net
//   als bij DEGIRO).
// - Direct na aankoop een GTC stop-loss op −20%. Staat de koers ≥ 25% boven de
//   instap, dan gaat de stop naar break-even en daarna mee (20/15/12% onder de
//   top); elke verhoging is een melding. Na 30 handelsdagen verkopen als hij niet
//   ≥ +10% staat, na 60 handelsdagen hoe dan ook; bij slecht nieuws meteen.
// - Kosten volgens DEGIRO (2026): VS en Canada €2, Europa/Londen/Azië €4,90,
//   Australië €5 per order; AutoFX 0,25% per omwisseling; €2,50 aansluitkosten
//   per beurs per jaar; zegelrecht Londen 0,5% bij aankoop (AIM is vrijgesteld,
//   we rekenen voorzichtig) en Hongkong 0,1%.
// - Een vulling telt pas als de koers de limiet raakt in een sessie die begon
//   nadat je de order kon plaatsen (de dagmelding komt om 06:00 UTC). De Potje-
//   sim kocht tegen de slotkoers van de vorige dag, wat te gunstig bleek (ZYBT).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { publishNtfy } from "../_shared/ntfy.ts";

type SB = SupabaseClient;
type Json = Record<string, unknown>;

const DAY = 86_400_000;
const CASH_FLOOR = 0.20;
const MIN_CONVICTION = 0.25;
const MIN_ORDER_EUR = 600;
const MIN_DOLLAR_VOL = 250_000;
const LIMIT_BELOW_CLOSE = 0.03;
const MAX_LIMIT_GAP = 0.15;
const ORDER_DAYS = 10;
const ORDER_MISSES = 3;
const MAX_NEW_ORDERS = 5;
const MAX_OPEN_ORDERS = 8;
const STOP_PCT = 0.20;
const TRAIL_FROM = 0.25;
const TIME_EXIT_DAYS = 30;
const TIME_EXIT_MIN_GAIN = 0.10;
const MAX_HOLD_DAYS = 60;
const RAISE_STEP = 1.08;
const SLIPPAGE = 0.005;
const AUTOFX = 0.0025;
const CONNECT_EUR = 2.5;
const DIGEST_HOUR_UTC = 6;
const NEWS_EVERY_MS = 2 * 3_600_000;
const NEWS_PER_RUN = 12;
const NEWS_MAX_AGE_MS = 3 * DAY;
const BLOCK_DAYS = 10;
const HINT_EVERY_DAYS = 14;
const MAX_HINTS_PER_DAY = 5;
const SWITCH_MARGIN = 0.02;
const SELECT_MIN_DAYS = 20;
const SELECT_MIN_TRADES = 3;
const HIPPO_CEILING_FALLBACK = 13;
const SPRINT_CEILING_FALLBACK = 21.8;
// ?tab= laadt de pagina altijd opnieuw (een #hash niet als Xinix al openstaat);
// de #hash erbij werkt ook met een oudere build die ?tab= nog niet kent.
const APP_URL = "https://constantdynamics.github.io/xinix/?tab=dagadvies#dagadvies";

const SOURCES = ["mix", "potje", "hippo", "sprint", "signaal"] as const;
type Source = typeof SOURCES[number];
const SOURCE_LABEL: Record<Source, string> = {
  mix: "Mix van alle bronnen", potje: "Potje-toppers", hippo: "Hippos", sprint: "Sprinters (≥4★)", signaal: "Signalen",
};

// Zelfde lijst als de Potje-sim (xinix-sim-background).
const POS_SIGNALS = [
  "fda_approval", "topline_positive", "phase_success", "breakthrough_designation",
  "buyout_definitive", "bonanza_au", "discovery_announcement", "permit", "first_pour",
  "buy_limit_hit", "buy_limit_close", "buy_limit_warmup", "bonanza_ag", "bonanza_cu",
  "licensing_deal", "resource_update", "pea", "pfs", "dfs", "step_out_drill",
  "trial_status_change", "jv_strategic", "macro_tide",
  "pre_catalyst_7d", "pre_catalyst_14d", "pre_catalyst_30d", "pre_catalyst_60d",
  "near5y_low_gem", "loser_gem",
];
const NEG_SIGNALS = ["trial_failed", "financing", "topline_mixed", "8k_material"];

// ── Algemeen ────────────────────────────────────────────────────────────────
function client(): SB {
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey, x-cron-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });
}
function isAdmin(req: Request): boolean {
  const t = Deno.env.get("ADMIN_TOKEN");
  return !!t && (req.headers.get("authorization") ?? "") === `Bearer ${t}`;
}
function isCron(req: Request): boolean {
  const t = Deno.env.get("CRON_SECRET");
  return !!t && (req.headers.get("x-cron-secret") ?? "") === t;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

// deno-lint-ignore no-explicit-any
async function fetchAll<T>(s: SB, table: string, cols: string, order: string, tweak?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    // deno-lint-ignore no-explicit-any
    let q: any = s.from(table).select(cols).order(order).range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}
async function chunkedIn<T>(s: SB, table: string, cols: string, values: string[], col = "ticker"): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await s.from(table).select(cols).in(col, values.slice(i, i + 200));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

// ── Beurzen, munten, sessies ────────────────────────────────────────────────
interface Mkt { region: string; exchange: string; tv: string; currency: string; lot: number }
const SUFFIX: Record<string, { region: string; ex: string; cur: string; lot?: number }> = {
  TO: { region: "canada", ex: "TSX", cur: "CAD" }, V: { region: "canada", ex: "TSXV", cur: "CAD" },
  CN: { region: "canada", ex: "CSE", cur: "CAD" }, NE: { region: "canada", ex: "NEO", cur: "CAD" },
  L: { region: "uk", ex: "LSE", cur: "GBp" },
  DE: { region: "germany", ex: "XETR", cur: "EUR" }, F: { region: "germany", ex: "FWB", cur: "EUR" },
  PA: { region: "france", ex: "EURONEXT", cur: "EUR" }, AS: { region: "netherlands", ex: "EURONEXT", cur: "EUR" },
  BR: { region: "belgium", ex: "EURONEXT", cur: "EUR" }, LS: { region: "portugal", ex: "EURONEXT", cur: "EUR" },
  MI: { region: "italy", ex: "MIL", cur: "EUR" }, MC: { region: "spain", ex: "BME", cur: "EUR" },
  WA: { region: "poland", ex: "GPW", cur: "PLN" }, SW: { region: "switzerland", ex: "SIX", cur: "CHF" },
  ST: { region: "sweden", ex: "OMXSTO", cur: "SEK" }, OL: { region: "norway", ex: "OSL", cur: "NOK" },
  CO: { region: "denmark", ex: "OMXCOP", cur: "DKK" }, HE: { region: "finland", ex: "OMXHEX", cur: "EUR" },
  AX: { region: "australia", ex: "ASX", cur: "AUD" },
  T: { region: "japan", ex: "TSE", cur: "JPY", lot: 100 }, SI: { region: "singapore", ex: "SGX", cur: "SGD", lot: 100 },
};
const US_EX = new Set(["NASDAQ", "NYSE", "AMEX"]);
function usExchange(ex: string | null): string | null {
  const e = (ex ?? "").toLowerCase();
  if (!e || e.includes("otc") || e.includes("pink")) return null;
  if (e.includes("nasdaq")) return "NASDAQ";
  if (e.includes("american") || e.includes("amex") || e.includes("mkt") || e.includes("arca")) return "AMEX";
  if (e.includes("nyse")) return "NYSE";
  return null;
}
/** Waar en in welke munt het aandeel bij DEGIRO te koop is; null = niet (OTC, Hongkong, onbekende beurs). */
function marketOf(ticker: string, exchange: string | null, priceCurrency: string | null, uni: { tv_symbol: string | null; market: string | null } | undefined): Mkt | null {
  const dot = ticker.lastIndexOf(".");
  const sfx = dot > 0 ? ticker.slice(dot + 1).toUpperCase() : "";
  if (!sfx) {
    const uniEx = uni?.market === "america" && uni.tv_symbol ? uni.tv_symbol.split(":")[0] : null;
    const ex = uniEx && US_EX.has(uniEx) ? uniEx : usExchange(exchange);
    if (!ex || (exchange && /otc|pink/i.test(exchange))) return null;
    return { region: "america", exchange: ex, tv: uni?.tv_symbol ?? `${ex}:${ticker.replace(/-/g, ".")}`, currency: "USD", lot: 1 };
  }
  const s = SUFFIX[sfx];
  if (!s) return null;
  const base = ticker.slice(0, dot).replace(/-/g, "_");
  const cur = priceCurrency && (priceCurrency === s.cur || sfx === "L") ? priceCurrency : s.cur;
  return { region: s.region, exchange: s.ex, tv: uni?.tv_symbol ?? `${s.ex}:${base}`, currency: cur, lot: s.lot ?? 1 };
}
// Subeenheden: koersen in pence (Londen), cent (Johannesburg), agorot (Tel Aviv).
const SUB: Record<string, { base: string; div: number }> = {
  GBp: { base: "GBP", div: 100 }, GBX: { base: "GBP", div: 100 },
  ZAc: { base: "ZAR", div: 100 }, ZAC: { base: "ZAR", div: 100 }, ILA: { base: "ILS", div: 100 },
};
/** Eenheden van de noteringsmunt per euro (pence per euro voor Londen). */
function perEur(cur: string, fx: Map<string, number>): number | null {
  if (cur === "EUR") return 1;
  const sub = SUB[cur];
  if (sub) { const b = fx.get(sub.base); return b ? b * sub.div : null; }
  return fx.get(cur.toUpperCase()) ?? null;
}
/** TradingView noteert Londen soms in pond: omrekenen naar onze eenheid. */
function unitFactor(tvCur: string | null, ours: string): number {
  if (!tvCur || tvCur === ours) return 1;
  const sub = SUB[ours], theirs = SUB[tvCur];
  if (sub && theirs) return 1;                        // GBX en GBp zijn allebei pence
  if (sub && tvCur === sub.base) return sub.div;      // TradingView in pond, wij in pence
  if (theirs && ours === theirs.base) return 1 / theirs.div;
  return 1;
}
const CUR_SIGN: Record<string, string> = { USD: "$", EUR: "€", CAD: "C$", AUD: "A$", HKD: "HK$", SGD: "S$", JPY: "¥", CHF: "CHF ", SEK: "SEK ", NOK: "NOK ", DKK: "DKK ", PLN: "PLN " };
const EX_LABEL: Record<string, string> = {
  NASDAQ: "Nasdaq", NYSE: "NYSE", AMEX: "NYSE American", TSX: "TSX", TSXV: "TSX Venture", CSE: "CSE", NEO: "Cboe Canada",
  LSE: "Londen", XETR: "Xetra", FWB: "Frankfurt", EURONEXT: "Euronext", MIL: "Milaan", BME: "Madrid", GPW: "Warschau",
  SIX: "Zwitserland", OMXSTO: "Stockholm", OSL: "Oslo", OMXCOP: "Kopenhagen", OMXHEX: "Helsinki", ASX: "Australië",
  TSE: "Tokio", SGX: "Singapore",
};
function fmtNl(x: number, dec: number, maxDec = dec): string {
  return x.toLocaleString("nl-NL", { minimumFractionDigits: dec, maximumFractionDigits: maxDec });
}
// Onder de 1 tot 4 decimalen (Amerikaanse ticks van $0,0001), anders 2.
function fmtPrice(p: number, cur: string): string {
  const s = p >= 1 ? fmtNl(p, 2) : fmtNl(p, 2, 4);
  if (cur === "GBp" || cur === "GBX") return `${s}p`;
  return `${CUR_SIGN[cur] ?? `${cur} `}${s}`;
}
const fmtEur = (x: number) => `€${fmtNl(x, Math.abs(x) >= 1000 ? 0 : 2)}`;
const fmtPct = (x: number) => `${x >= 0 ? "+" : "−"}${fmtNl(Math.abs(x), 1)}%`;

function tickSize(region: string, p: number): number {
  switch (region) {
    case "america": return p >= 1 ? 0.01 : 0.0001;
    case "canada": return p >= 0.5 ? 0.01 : 0.005;
    case "australia": return p >= 2 ? 0.01 : p >= 0.1 ? 0.005 : 0.001;
    case "uk": return p >= 1000 ? 1 : p >= 100 ? 0.5 : p >= 10 ? 0.05 : p >= 1 ? 0.01 : 0.001;
    case "japan": return p >= 3000 ? 1 : p >= 1000 ? 0.5 : 0.1;
    default: return p >= 10 ? 0.01 : p >= 1 ? 0.005 : 0.001;
  }
}
function roundTick(region: string, p: number): number {
  const t = tickSize(region, p);
  const dec = Math.max(0, Math.ceil(-Math.log10(t) - 1e-9));
  return Number((Math.floor(p / t + 1e-6) * t).toFixed(dec));
}

// Handelsuren per TradingView-regio, in minuten na lokale middernacht.
const SESSIONS: Record<string, { tz: string; open: number; close: number }> = {
  america: { tz: "America/New_York", open: 570, close: 960 },
  canada: { tz: "America/Toronto", open: 570, close: 960 },
  uk: { tz: "Europe/London", open: 480, close: 990 },
  germany: { tz: "Europe/Berlin", open: 540, close: 1050 },
  france: { tz: "Europe/Paris", open: 540, close: 1050 },
  netherlands: { tz: "Europe/Amsterdam", open: 540, close: 1050 },
  belgium: { tz: "Europe/Brussels", open: 540, close: 1050 },
  portugal: { tz: "Europe/Lisbon", open: 480, close: 990 },
  italy: { tz: "Europe/Rome", open: 540, close: 1050 },
  spain: { tz: "Europe/Madrid", open: 540, close: 1050 },
  poland: { tz: "Europe/Warsaw", open: 540, close: 1020 },
  switzerland: { tz: "Europe/Zurich", open: 540, close: 1050 },
  sweden: { tz: "Europe/Stockholm", open: 540, close: 1050 },
  norway: { tz: "Europe/Oslo", open: 540, close: 980 },
  denmark: { tz: "Europe/Copenhagen", open: 540, close: 1020 },
  finland: { tz: "Europe/Helsinki", open: 600, close: 1110 },
  australia: { tz: "Australia/Sydney", open: 600, close: 960 },
  japan: { tz: "Asia/Tokyo", open: 540, close: 930 },
  singapore: { tz: "Asia/Singapore", open: 540, close: 1020 },
};
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const partsCache = new Map<string, Intl.DateTimeFormat>();
function localParts(tz: string, ms: number) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short" });
    partsCache.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday };
}
function zonedToUtc(tz: string, y: number, m: number, d: number, minutes: number): number {
  const target = Date.UTC(y, m - 1, d, 0, minutes);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(tz, guess);
    const diff = target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi, p.s);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}
/** Opening van de meest recente sessie die al begonnen is. */
function lastOpen(region: string, ms: number): number {
  const s = SESSIONS[region] ?? SESSIONS.america;
  for (let k = 0; k < 10; k++) {
    const p = localParts(s.tz, ms - k * DAY);
    if (!WEEKDAYS.has(p.wd)) continue;
    const o = zonedToUtc(s.tz, p.y, p.m, p.d, s.open);
    if (o <= ms) return o;
  }
  return ms - 3 * DAY;
}
/** Opening van de eerste sessie ná dit moment. */
function nextOpen(region: string, ms: number): number {
  const s = SESSIONS[region] ?? SESSIONS.america;
  for (let k = 0; k < 10; k++) {
    const p = localParts(s.tz, ms + k * DAY);
    if (!WEEKDAYS.has(p.wd)) continue;
    const o = zonedToUtc(s.tz, p.y, p.m, p.d, s.open);
    if (o > ms) return o;
  }
  return ms + DAY;
}
/** Handelt de beurs nu (tot 20 minuten na de slotbel, zodat de slotkoers nog meetelt)? */
function inSession(region: string, ms: number): boolean {
  const s = SESSIONS[region];
  if (!s) return false;
  const p = localParts(s.tz, ms);
  if (!WEEKDAYS.has(p.wd)) return false;
  const min = p.hh * 60 + p.mi;
  return min >= s.open && min <= s.close + 20;
}
function nextDigest(ms: number): number {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DIGEST_HOUR_UTC);
  return t >= ms ? t : t + DAY;
}
function tradingDaysBetween(fromMs: number, toMs: number): number {
  let n = 0;
  const start = Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), new Date(fromMs).getUTCDate());
  for (let t = start + DAY; t <= toMs; t += DAY) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

// ── Kosten (DEGIRO, 2026) ───────────────────────────────────────────────────
function orderFee(region: string): number {
  if (region === "america" || region === "canada") return 2;      // €1 + €1 verwerkingskosten
  if (region === "australia") return 5;
  return 4.9;                                                      // €3,90 + €1
}
function taxRate(region: string, side: "buy" | "sell"): number {
  if (region === "uk") return side === "buy" ? 0.005 : 0;
  if (region === "hongkong") return 0.001;
  return 0;
}
function tradeCosts(region: string, currency: string, valueEur: number, side: "buy" | "sell") {
  const fee = orderFee(region);
  const fx = currency === "EUR" ? 0 : valueEur * AUTOFX;
  const tax = valueEur * taxRate(region, side);
  return { fee, fx, tax, total: fee + fx + tax };
}

// ── TradingView-koersen ────────────────────────────────────────────────────
interface Quote { open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; currency: string | null }
async function tvScan(region: string, symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  for (let i = 0; i < symbols.length; i += 300) {
    const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
      body: JSON.stringify({ symbols: { tickers: symbols.slice(i, i + 300) }, columns: ["open", "high", "low", "close", "volume", "currency"] }),
    });
    if (!res.ok) throw new Error(`TradingView ${region} HTTP ${res.status}`);
    const j = (await res.json()) as { data?: Array<{ s: string; d: unknown[] }> };
    for (const r of j.data ?? []) {
      out.set(r.s, { open: num(r.d[0]), high: num(r.d[1]), low: num(r.d[2]), close: num(r.d[3]), volume: num(r.d[4]), currency: (r.d[5] as string) || null });
    }
  }
  return out;
}
async function fetchQuotes(items: Array<{ tv: string | null; region: string | null }>, errors: string[]): Promise<Map<string, Quote>> {
  const byRegion = new Map<string, Set<string>>();
  for (const it of items) {
    if (!it.tv || !it.region) continue;
    if (!byRegion.has(it.region)) byRegion.set(it.region, new Set());
    byRegion.get(it.region)!.add(it.tv);
  }
  const out = new Map<string, Quote>();
  await Promise.all([...byRegion].map(async ([region, set]) => {
    try { for (const [k, v] of await tvScan(region, [...set])) out.set(k, v); }
    catch (e) { errors.push(msg(e)); }
  }));
  return out;
}
function quoteIn(q: Quote | undefined, ours: string): Quote | null {
  if (!q) return null;
  const f = unitFactor(q.currency, ours);
  if (f === 1) return q;
  const m = (x: number | null) => (x == null ? null : x * f);
  return { ...q, open: m(q.open), high: m(q.high), low: m(q.low), close: m(q.close) };
}
type Snap = { v: number | null; h: number | null; l: number | null } | null;
const snapOf = (q: Quote | null): Snap => (q ? { v: q.volume, h: q.high, l: q.low } : null);
/** Staat TradingView nog op de sessie van toen (feestdag, of nog niet geopend)? */
function sameSession(q: Quote, snap: Snap): boolean {
  return !!snap && snap.v === q.volume && snap.h === q.high && snap.l === q.low;
}

// ── Boeken ──────────────────────────────────────────────────────────────────
interface Book {
  book: string; label: string; source: string; source_since: string; cash_eur: number; start_eur: number; started_at: string;
  fees_eur: number; fx_cost_eur: number; tax_eur: number; connect_eur: number; exchanges_paid: Record<string, string[]>;
  last_daily_at: string | null; last_select_at: string | null;
}
interface Order {
  id: number; book: string; ticker: string; tv_symbol: string | null; market: string; exchange: string; currency: string;
  limit_price: number; qty: number; reserved_eur: number; close_at: number | null; watch_limit: number | null;
  conviction: number | null; source: string | null; reason: string | null; valid_from: string; snap: Snap; misses: number;
  status: string; created_at: string;
}
interface Position {
  id: number; book: string; ticker: string; tv_symbol: string | null; market: string; exchange: string; currency: string;
  qty: number; entry_price: number; entry_per_eur: number; cost_eur: number; stop_price: number | null; high_price: number | null;
  last_price: number | null; last_price_at: string | null; source: string | null; conviction: number | null; reason: string | null;
  opened_at: string; opened_session: string | null; snap: Snap; exit_pending: string | null; exit_pending_at: string | null;
  stop_noticed_at: string | null; closed_at: string | null;
}
function toBook(r: Json): Book {
  return {
    book: String(r.book), label: String(r.label), source: String(r.source), source_since: String(r.source_since),
    cash_eur: num(r.cash_eur) ?? 0, start_eur: num(r.start_eur) ?? 10000, started_at: String(r.started_at),
    fees_eur: num(r.fees_eur) ?? 0, fx_cost_eur: num(r.fx_cost_eur) ?? 0, tax_eur: num(r.tax_eur) ?? 0, connect_eur: num(r.connect_eur) ?? 0,
    exchanges_paid: (r.exchanges_paid as Record<string, string[]>) ?? {},
    last_daily_at: (r.last_daily_at as string) ?? null, last_select_at: (r.last_select_at as string) ?? null,
  };
}
function toOrder(r: Json): Order {
  return {
    id: Number(r.id), book: String(r.book), ticker: String(r.ticker), tv_symbol: (r.tv_symbol as string) ?? null,
    market: String(r.market ?? "america"), exchange: String(r.exchange ?? ""), currency: String(r.currency),
    limit_price: num(r.limit_price)!, qty: num(r.qty)!, reserved_eur: num(r.reserved_eur) ?? 0,
    close_at: num(r.close_at), watch_limit: num(r.watch_limit), conviction: num(r.conviction),
    source: (r.source as string) ?? null, reason: (r.reason as string) ?? null, valid_from: String(r.valid_from),
    snap: (r.snap as Snap) ?? null, misses: num(r.misses) ?? 0, status: String(r.status), created_at: String(r.created_at),
  };
}
function toPosition(r: Json): Position {
  return {
    id: Number(r.id), book: String(r.book), ticker: String(r.ticker), tv_symbol: (r.tv_symbol as string) ?? null,
    market: String(r.market ?? "america"), exchange: String(r.exchange ?? ""), currency: String(r.currency),
    qty: num(r.qty)!, entry_price: num(r.entry_price)!, entry_per_eur: num(r.entry_per_eur)!, cost_eur: num(r.cost_eur)!,
    stop_price: num(r.stop_price), high_price: num(r.high_price), last_price: num(r.last_price), last_price_at: (r.last_price_at as string) ?? null,
    source: (r.source as string) ?? null, conviction: num(r.conviction), reason: (r.reason as string) ?? null,
    opened_at: String(r.opened_at), opened_session: (r.opened_session as string) ?? null, snap: (r.snap as Snap) ?? null,
    exit_pending: (r.exit_pending as string) ?? null, exit_pending_at: (r.exit_pending_at as string) ?? null,
    stop_noticed_at: (r.stop_noticed_at as string) ?? null, closed_at: (r.closed_at as string) ?? null,
  };
}

interface Ctx {
  s: SB; now: number; nowIso: string; fx: Map<string, number>;
  books: Map<string, Book>; orders: Order[]; positions: Position[];
  companies: Map<string, string | null>;
  errors: string[]; counts: Record<string, number>;
}
function bump(ctx: Ctx, k: string, n = 1) { ctx.counts[k] = (ctx.counts[k] ?? 0) + n; }

async function loadState(s: SB, now: number): Promise<Ctx> {
  const [books, orders, positions, fxRows] = await Promise.all([
    s.from("xinix_advice_books").select("*"),
    s.from("xinix_advice_orders").select("*").eq("status", "open"),
    s.from("xinix_advice_positions").select("*").is("closed_at", null),
    s.from("xinix_fx_rates").select("currency, per_eur"),
  ]);
  for (const r of [books, orders, positions, fxRows]) if (r.error) throw new Error(r.error.message);
  const fx = new Map<string, number>();
  for (const r of (fxRows.data ?? []) as Json[]) fx.set(String(r.currency), num(r.per_eur)!);
  return {
    s, now, nowIso: new Date(now).toISOString(), fx,
    books: new Map(((books.data ?? []) as Json[]).map((r) => [String(r.book), toBook(r)])),
    orders: ((orders.data ?? []) as Json[]).map(toOrder),
    positions: ((positions.data ?? []) as Json[]).map(toPosition),
    companies: new Map(), errors: [], counts: {},
  };
}
async function saveBook(ctx: Ctx, b: Book) {
  const { error } = await ctx.s.from("xinix_advice_books").update({
    cash_eur: r2(b.cash_eur), fees_eur: r2(b.fees_eur), fx_cost_eur: r2(b.fx_cost_eur), tax_eur: r2(b.tax_eur),
    connect_eur: r2(b.connect_eur), exchanges_paid: b.exchanges_paid, source: b.source, source_since: b.source_since,
    last_daily_at: b.last_daily_at, last_select_at: b.last_select_at, updated_at: ctx.nowIso,
  }).eq("book", b.book);
  if (error) ctx.errors.push(`boek ${b.book}: ${error.message}`);
}
async function addEvent(ctx: Ctx, book: string, kind: string, ticker: string | null, message: string, urgent: boolean, payload?: Json, silent = false) {
  const { error } = await ctx.s.from("xinix_advice_events").insert({
    book, kind, ticker, message, urgent, payload: payload ?? null,
    // Schaduwboeken melden nooit; 'silent' is voor wat je al weet.
    notified_at: book !== "live" || silent ? ctx.nowIso : null,
  });
  if (error) ctx.errors.push(`event: ${error.message}`);
}
const tickerLabel = (ctx: Ctx, t: string, ex: string) => `${t}${ctx.companies.get(t) ? ` (${ctx.companies.get(t)}, ${EX_LABEL[ex] ?? ex})` : ` (${EX_LABEL[ex] ?? ex})`}`;

// ── Uitvoeren ───────────────────────────────────────────────────────────────
async function fillOrder(ctx: Ctx, o: Order, price: number, q: Quote) {
  const book = ctx.books.get(o.book);
  const per = perEur(o.currency, ctx.fx);
  if (!book || !per) return;
  const value = (o.qty * price) / per;
  const c = tradeCosts(o.market, o.currency, value, "buy");
  const year = String(new Date(ctx.now).getUTCFullYear());
  const connect = o.market !== "netherlands" && !(book.exchanges_paid[year] ?? []).includes(o.exchange) ? CONNECT_EUR : 0;
  const cost = value + c.total + connect;
  const stop = roundTick(o.market, price * (1 - STOP_PCT));
  const { data: pos, error } = await ctx.s.from("xinix_advice_positions").insert({
    book: o.book, ticker: o.ticker, tv_symbol: o.tv_symbol, market: o.market, exchange: o.exchange, currency: o.currency,
    qty: o.qty, entry_price: price, entry_per_eur: per, cost_eur: r2(cost), stop_price: stop, high_price: price,
    last_price: q.close ?? price, last_price_at: ctx.nowIso, source: o.source, conviction: o.conviction, reason: o.reason,
    opened_at: ctx.nowIso, opened_session: new Date(lastOpen(o.market, ctx.now)).toISOString(), snap: snapOf(q),
  }).select("*").single();
  if (error || !pos) { ctx.errors.push(`vulling ${o.ticker}: ${error?.message}`); return; }
  await ctx.s.from("xinix_advice_orders").update({ status: "filled", closed_at: ctx.nowIso, fill_price: price, position_id: pos.id }).eq("id", o.id);
  o.status = "filled";
  book.cash_eur -= cost;
  book.fees_eur += c.fee; book.fx_cost_eur += c.fx; book.tax_eur += c.tax; book.connect_eur += connect;
  if (connect) book.exchanges_paid[year] = [...(book.exchanges_paid[year] ?? []), o.exchange];
  await saveBook(ctx, book);
  ctx.positions.push(toPosition(pos as Json));
  bump(ctx, "fills");
  await addEvent(ctx, o.book, "fill", o.ticker,
    `✅ GEKOCHT ${tickerLabel(ctx, o.ticker, o.exchange)}: ${fmtNl(o.qty, 0)} × ${fmtPrice(price, o.currency)} (≈ ${fmtEur(cost)} incl. kosten). ` +
    `Zet nu een GTC stop-loss op ${fmtPrice(stop, o.currency)} (−${Math.round(STOP_PCT * 100)}%).`,
    true, { qty: o.qty, price, stop, cost_eur: r2(cost) });
}

async function closePosition(ctx: Ctx, p: Position, price: number, reason: string, kind: string, text: string, urgent: boolean, silent = false) {
  const book = ctx.books.get(p.book);
  if (!book) return;
  const per = perEur(p.currency, ctx.fx) ?? p.entry_per_eur;
  const gross = (p.qty * price) / per;
  const c = tradeCosts(p.market, p.currency, gross, "sell");
  const proceeds = gross - c.total;
  const pnl = proceeds - p.cost_eur;
  const pnlPct = (pnl / p.cost_eur) * 100;
  const { error } = await ctx.s.from("xinix_advice_positions").update({
    closed_at: ctx.nowIso, exit_price: price, exit_per_eur: per, proceeds_eur: r2(proceeds), pnl_eur: r2(pnl),
    pnl_pct: Math.round(pnlPct * 10) / 10, exit_reason: reason, exit_pending: null, last_price: price, last_price_at: ctx.nowIso,
  }).eq("id", p.id);
  if (error) { ctx.errors.push(`sluiten ${p.ticker}: ${error.message}`); return; }
  p.closed_at = ctx.nowIso;
  book.cash_eur += proceeds;
  book.fees_eur += c.fee; book.fx_cost_eur += c.fx; book.tax_eur += c.tax;
  await saveBook(ctx, book);
  bump(ctx, "closed");
  await addEvent(ctx, p.book, kind, p.ticker,
    `${text} ${tickerLabel(ctx, p.ticker, p.exchange)}: ${fmtNl(p.qty, 0)} × ~${fmtPrice(price, p.currency)} → ${pnl >= 0 ? "+" : "−"}${fmtEur(Math.abs(pnl))} (${fmtPct(pnlPct)}).`,
    urgent, { price, pnl_eur: r2(pnl), pnl_pct: pnlPct, reason }, silent);
}

/** Stop volgens de meetrekregels; nooit lager dan hij al stond. */
function trailStop(p: Position, high: number): number {
  const entry = p.entry_price;
  const gain = high / entry - 1;
  let s = p.stop_price ?? entry * (1 - STOP_PCT);
  if (gain >= TRAIL_FROM) s = Math.max(s, entry * 1.02, high * 0.80);
  if (gain >= 0.50) s = Math.max(s, high * 0.85);
  if (gain >= 1.00) s = Math.max(s, high * 0.88);
  return roundTick(p.market, s);
}

/** Vullingen, stops, meetrekken en uitgestelde verkopen op basis van verse koersen. */
async function processQuotes(ctx: Ctx, quotes: Map<string, Quote>, mode: "watch" | "daily") {
  const now = ctx.now;
  const live = (region: string) => mode === "daily" || inSession(region, now);

  for (const o of ctx.orders) {
    if (o.status !== "open" || !o.tv_symbol || !live(o.market)) continue;
    const q = quoteIn(quotes.get(o.tv_symbol), o.currency);
    if (!q || q.low == null) continue;
    if (lastOpen(o.market, now) < Date.parse(o.valid_from) - 60_000 || sameSession(q, o.snap)) continue;
    if (q.low > o.limit_price) continue;
    const price = q.open != null && q.open > 0 && q.open < o.limit_price ? q.open : o.limit_price;
    await fillOrder(ctx, o, price, q);
  }

  for (const p of ctx.positions) {
    if (p.closed_at || !p.tv_symbol || !live(p.market)) continue;
    const q = quoteIn(quotes.get(p.tv_symbol), p.currency);
    if (!q || q.close == null) continue;
    const stale = sameSession(q, p.snap);
    const laterSession = !stale && lastOpen(p.market, now) > Date.parse(p.opened_session ?? p.opened_at);

    // Stop-loss: in een latere sessie telt de dagbodem, in de sessie van de aankoop alleen de koers van nu.
    const low = laterSession ? (q.low ?? q.close) : q.close;
    if (p.stop_price != null && low <= p.stop_price && !stale) {
      const price = (laterSession && q.open != null && q.open > 0 && q.open < p.stop_price ? q.open : p.stop_price) * (1 - SLIPPAGE);
      await closePosition(ctx, p, price, "stop-loss", "stop_hit", "🛑 STOP GERAAKT", true);
      continue;
    }
    // Verkoopadvies (tijd of nieuws) dat nog uitgevoerd moet worden: in de kwartierronde tegen de koers
    // van dat moment, in de dagrun alleen als er sinds het advies een sessie is geweest.
    const pendingAt = p.exit_pending_at ? Date.parse(p.exit_pending_at) : NaN;
    if (p.exit_pending && now >= pendingAt && !stale && (mode === "watch" || lastOpen(p.market, now) >= pendingAt)) {
      await closePosition(ctx, p, q.close * (1 - SLIPPAGE), p.exit_pending, "sell_done", "Verkocht", false, true);
      continue;
    }
    // Meetrekken.
    const high = Math.max(p.high_price ?? p.entry_price, q.close);
    const upd: Json = { last_price: q.close, last_price_at: ctx.nowIso };
    if (high > (p.high_price ?? 0)) { upd.high_price = high; p.high_price = high; }
    p.last_price = q.close;
    if (!p.exit_pending && p.stop_price != null) {
      const ns = trailStop(p, high);
      const recent = p.stop_noticed_at && now - Date.parse(p.stop_noticed_at) < 20 * 3_600_000;
      if (ns >= p.stop_price * RAISE_STEP && !recent) {
        const old = p.stop_price;
        upd.stop_price = ns; upd.stop_noticed_at = ctx.nowIso;
        p.stop_price = ns; p.stop_noticed_at = ctx.nowIso;
        bump(ctx, "raises");
        await addEvent(ctx, p.book, "stop_raise", p.ticker,
          `⬆️ VERHOOG STOP ${tickerLabel(ctx, p.ticker, p.exchange)}: van ${fmtPrice(old, p.currency)} naar ${fmtPrice(ns, p.currency)} ` +
          `(koers ${fmtPrice(q.close, p.currency)}, ${fmtPct((q.close / p.entry_price - 1) * 100)} t.o.v. instap).`,
          mode === "watch", { old, new: ns, price: q.close });
      }
    }
    await ctx.s.from("xinix_advice_positions").update(upd).eq("id", p.id);
  }
}

// ── Nieuws ──────────────────────────────────────────────────────────────────
const SPAM = /\b(class action|investor alert|shareholder alert|law firm|securities fraud|investigation on behalf|reminds investors|lawsuit filed)\b/i;
const NEG: Array<[RegExp, string]> = [
  [/\b(prices?|pricing|priced|announces?|closes?|closing of)\b[^.]{0,80}\b(public|registered direct|underwritten|bought deal|best[- ]efforts|confidentially marketed)\s+(offering|placement)/i, "aandelenuitgifte"],
  [/\b(pricing of|prices|upsized?)\b[^.]{0,40}\boffering\b/i, "aandelenuitgifte"],
  [/\bat[- ]the[- ]market\b|\bATM (program|offering|facility)\b/i, "aandelenuitgifte"],
  [/\bchapter (7|11)\b|\bbankrupt|\binsolven|\breceivership\b|\bcreditor protection\b|\bCCAA\b/i, "faillissement"],
  [/\bgoing concern\b/i, "going concern"],
  [/\bcomplete response letter\b|\bCRL\b|\brefus(e|es|ed) to file\b/i, "afwijzing FDA"],
  [/\b(did not|failed to|fails to|missed)\s+(meet|achieve|reach)\b|\b(trial|study)\s+(halted|terminated|discontinued|stopped)\b|\bdiscontinu\w*\s+(the\s+)?(development|program|trial|study)\b/i, "studie mislukt"],
  [/\bdelist(ed|ing)?\b/i, "delisting"],
];
const LET_OP: Array<[RegExp, string]> = [
  [/\b(private placement|flow[- ]through|warrant (exercise|inducement)|equity financing)\b/i, "financiering"],
  [/\b(mixed )?shelf\b|\bS-3\b|\bF-3\b/i, "shelf-registratie"],
  [/\breverse (stock )?split\b|\bshare consolidation\b/i, "reverse split"],
  [/\b(minimum bid|deficiency|non-?compliance)\b/i, "notering in gevaar"],
  [/\b(resigns?|resigned|resignation|steps down)\b/i, "vertrek bestuurder"],
];
const POS: Array<[RegExp, string]> = [
  [/\bFDA\b[^.]{0,40}\b(approv|clear|grant)/i, "goedkeuring"],
  [/\b(statistically significant|met (its )?primary endpoint|primary endpoint (was )?met|positive (topline|top-line|interim|phase))\b/i, "positieve data"],
  [/\b(breakthrough therapy|fast track|orphan drug)\b/i, "designatie"],
  [/\b(to be acquired|definitive agreement|merger agreement|takeover|buyout)\b/i, "overname"],
  [/\b(awarded|contract|partnership|licens(e|ing) agreement|collaboration)\b/i, "deal"],
  [/\b(high[- ]grade|intercepts?|discovery)\b/i, "boorresultaat"],
];
function classify(title: string): { tone: string; kind: string | null } {
  if (SPAM.test(title) || /\bregain(s|ed)? compliance\b/i.test(title)) return { tone: "neutraal", kind: null };
  // Een beursbrief over de minimumkoers is een waarschuwing, nog geen delisting.
  if (/\b(notice|notification|deficiency|minimum bid|hearing|non-?compliance)\b/i.test(title) && /\b(nasdaq|nyse|listing|bid price)\b/i.test(title)) {
    return { tone: "let_op", kind: "notering in gevaar" };
  }
  for (const [re, k] of NEG) if (re.test(title)) return { tone: "negatief", kind: k };
  for (const [re, k] of LET_OP) if (re.test(title)) return { tone: "let_op", kind: k };
  for (const [re, k] of POS) if (re.test(title)) return { tone: "positief", kind: k };
  return { tone: "neutraal", kind: null };
}
const GENERIC = new Set(["the", "inc", "corp", "corporation", "ltd", "limited", "plc", "holdings", "holding", "group", "co", "company", "sa", "nv", "ag", "se", "ab", "asa", "oyj", "international", "global", "resources", "mining", "minerals", "metals", "gold", "silver", "energy", "therapeutics", "pharmaceuticals", "pharma", "biosciences", "bio", "technologies", "technology", "tech", "capital", "partners", "and", "new", "first"]);
function relevant(item: { title: string; relatedTickers?: string[] }, ticker: string, company: string | null): boolean {
  const base = ticker.split(".")[0].toUpperCase();
  const rel = (item.relatedTickers ?? []).map((x) => x.toUpperCase());
  if (rel.includes(ticker.toUpperCase()) || rel.includes(base)) return true;
  if (base.length >= 3 && new RegExp(`\\b${base.replace(/[^A-Z0-9]/g, "")}\\b`).test(item.title)) return true;
  const words = (company ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const key = words.find((w) => !GENERIC.has(w) && w.length >= 4);
  return !!key && item.title.toLowerCase().includes(key);
}
async function yahooNews(q: string): Promise<Array<{ title: string; link?: string; publisher?: string; providerPublishTime?: number; relatedTickers?: string[] }>> {
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=15&lang=en-US`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo nieuws HTTP ${res.status}`);
  const j = (await res.json()) as { news?: Array<{ title?: string; link?: string; publisher?: string; providerPublishTime?: number; relatedTickers?: string[] }> };
  return (j.news ?? []).filter((n) => !!n.title) as Array<{ title: string; link?: string; publisher?: string; providerPublishTime?: number; relatedTickers?: string[] }>;
}

/** Nieuw slecht nieuws: orders annuleren, bij 'negatief' ook verkopen. */
async function actOnNews(ctx: Ctx, ticker: string, tone: string, kind: string | null, title: string) {
  if (tone !== "negatief" && tone !== "let_op") return;
  for (const o of ctx.orders) {
    if (o.status !== "open" || o.ticker !== ticker) continue;
    await ctx.s.from("xinix_advice_orders").update({ status: "cancelled", closed_at: ctx.nowIso, cancel_reason: `nieuws: ${kind ?? tone}` }).eq("id", o.id);
    o.status = "cancelled";
    bump(ctx, "cancelled");
    await addEvent(ctx, o.book, "order_cancel", ticker,
      `⛔ ANNULEER je kooporder ${tickerLabel(ctx, ticker, o.exchange)} (limiet ${fmtPrice(o.limit_price, o.currency)}): ${kind ?? "nieuws"} — “${title}”.`,
      true, { title, kind });
  }
  if (tone !== "negatief") return;
  for (const p of ctx.positions) {
    if (p.closed_at || p.ticker !== ticker || p.exit_pending) continue;
    // Uitgevoerd bij de eerstvolgende controle in een handelssessie: zo lang duurt het ongeveer voor je hebt verkocht.
    p.exit_pending = `nieuws: ${kind ?? "negatief"}`; p.exit_pending_at = new Date(ctx.now + 10 * 60_000).toISOString();
    await ctx.s.from("xinix_advice_positions").update({ exit_pending: p.exit_pending, exit_pending_at: p.exit_pending_at }).eq("id", p.id);
    bump(ctx, "sell_advice");
    await addEvent(ctx, p.book, "sell_advice", ticker,
      `🔴 VERKOOP ${tickerLabel(ctx, ticker, p.exchange)} (${fmtNl(p.qty, 0)} stuks): ${kind ?? "slecht nieuws"} — “${title}”. Annuleer eerst je stop-loss, verkoop dan bestens of met een limiet net onder de koers.`,
      true, { title, kind });
  }
}

async function scanNews(ctx: Ctx) {
  const held = [...new Set([...ctx.positions.filter((p) => !p.closed_at).map((p) => p.ticker), ...ctx.orders.filter((o) => o.status === "open").map((o) => o.ticker)])];
  if (!held.length) return;
  // Signalen uit de eigen pijplijn (8-K, nieuws, studies) van de laatste 3 uur.
  const { data: sig } = await ctx.s.from("signal_events").select("ticker, signal_type, severity, title, detected_at")
    .in("ticker", held).in("signal_type", NEG_SIGNALS).gte("detected_at", new Date(ctx.now - 3 * 3_600_000).toISOString());
  const fromSignals: Json[] = [];
  for (const e of (sig ?? []) as Json[]) {
    const type = String(e.signal_type), title = String(e.title ?? type);
    let tone: string | null = null;
    if (type === "trial_failed") tone = "negatief";
    else if (type === "8k_material") tone = e.severity === "red" && /bankrupt|delist/i.test(title) ? "negatief" : null;
    else tone = "let_op";
    if (tone) fromSignals.push({ ticker: e.ticker, title, tone, kind: type, published_at: e.detected_at, publisher: "Xinix-signaal" });
  }
  // Yahoo-nieuws, per aandeel hoogstens eens per 2 uur, oudste eerst.
  const { data: ts } = await ctx.s.from("signal_tickers").select("ticker, company, advice_news_at").in("ticker", held);
  const due = ((ts ?? []) as Json[])
    .filter((t) => !t.advice_news_at || ctx.now - Date.parse(String(t.advice_news_at)) >= NEWS_EVERY_MS)
    .sort((a, b) => String(a.advice_news_at ?? "").localeCompare(String(b.advice_news_at ?? "")))
    .slice(0, NEWS_PER_RUN);
  const fromYahoo: Json[] = [];
  for (const t of due) {
    const ticker = String(t.ticker);
    try {
      for (const n of await yahooNews(ticker)) {
        const at = n.providerPublishTime ? n.providerPublishTime * 1000 : ctx.now;
        if (ctx.now - at > NEWS_MAX_AGE_MS || !relevant(n, ticker, (t.company as string) ?? null)) continue;
        const c = classify(n.title);
        fromYahoo.push({ ticker, title: n.title.slice(0, 500), link: n.link ?? null, publisher: n.publisher ?? null, published_at: new Date(at).toISOString(), tone: c.tone, kind: c.kind });
      }
    } catch (e) { ctx.errors.push(`nieuws ${ticker}: ${msg(e)}`); }
    await ctx.s.from("signal_tickers").update({ advice_news_at: ctx.nowIso }).eq("ticker", ticker);
  }
  bump(ctx, "news_scanned", due.length);
  const rows = [...fromSignals, ...fromYahoo];
  if (!rows.length) return;
  const { data: inserted, error } = await ctx.s.from("xinix_advice_news").upsert(rows, { onConflict: "ticker,title", ignoreDuplicates: true }).select("ticker, title, tone, kind");
  if (error) { ctx.errors.push(`nieuws opslaan: ${error.message}`); return; }
  for (const n of (inserted ?? []) as Json[]) {
    bump(ctx, "news_new");
    await actOnNews(ctx, String(n.ticker), String(n.tone), (n.kind as string) ?? null, String(n.title));
  }
}

// ── Meldingen (alleen het live-boek) ────────────────────────────────────────
function inQuiet(st: Json, ms: number): boolean {
  const a = num(st.quiet_hours_start), b = num(st.quiet_hours_end);
  if (a == null || b == null || a === b) return false;
  const h = new Date(ms).getUTCHours();
  return a < b ? h >= a && h < b : h >= a || h < b;
}
function sendNtfy(ctx: Ctx, server: string, topic: string, title: string, body: string, priority: number): Promise<string | null> {
  return publishNtfy(ctx.s, server, {
    topic, title, message: body, priority, tags: ["briefcase"], click: APP_URL,
    actions: [{ action: "view", label: "Alle adviezen", url: APP_URL, clear: true }],
  });
}
/** Eén regel met de hele portefeuille, zodat een melding over één aandeel niet het hele advies lijkt. */
function bookSummary(ctx: Ctx): string {
  const b = ctx.books.get("live");
  if (!b) return "";
  const { equity } = equityOf(ctx, "live");
  const held = ctx.positions.filter((p) => p.book === "live" && !p.closed_at).map((p) => p.ticker);
  const open = ctx.orders.filter((o) => o.book === "live" && o.status === "open").map((o) => o.ticker);
  return `📋 Portefeuille ${fmtEur(equity)} (${fmtPct((equity / b.start_eur - 1) * 100)}) · ` +
    `posities: ${held.length ? held.join(", ") : "geen"} · orders: ${open.length ? open.join(", ") : "geen"}. ` +
    "Tik op deze melding voor alle adviezen.";
}
function composeBody(lines: string[]): string {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    // ntfy maakt van een bericht boven 4096 bytes een bijlage; ruimte laten voor de stand eronder.
    if (len + lines[i].length > 3000) { out.push(`… en ${lines.length - i} meer in het tabblad Dagadvies.`); break; }
    out.push(lines[i]); len += lines[i].length + 2;
  }
  return out.join("\n\n");
}
async function sendPending(ctx: Ctx): Promise<number> {
  const [{ data: st }, { data: pend }] = await Promise.all([
    ctx.s.from("signal_settings").select("ntfy_topic, ntfy_server, quiet_hours_start, quiet_hours_end, advice_notify").eq("id", 1).maybeSingle(),
    ctx.s.from("xinix_advice_events").select("id, at, kind, message, urgent").eq("book", "live").is("notified_at", null).order("at").limit(200),
  ]);
  const events = (pend ?? []) as Json[];
  if (!events.length) return 0;
  const mark = async (ids: number[]) => { if (ids.length) await ctx.s.from("xinix_advice_events").update({ notified_at: ctx.nowIso }).in("id", ids); };
  const stale = events.filter((e) => ctx.now - Date.parse(String(e.at)) > 2 * DAY);
  await mark(stale.map((e) => Number(e.id)));
  const fresh = events.filter((e) => !stale.includes(e));
  const settings = (st ?? {}) as Json;
  if (!settings.advice_notify || !settings.ntfy_topic) { await mark(fresh.map((e) => Number(e.id))); return 0; }
  if (inQuiet(settings, ctx.now)) return 0;
  const server = String(settings.ntfy_server ?? "https://ntfy.sh"), topic = String(settings.ntfy_topic);
  let sent = 0;
  const urgent = fresh.filter((e) => e.urgent);
  const digest = fresh.filter((e) => !e.urgent && nextDigest(Date.parse(String(e.at))) <= ctx.now);
  const summary = bookSummary(ctx);
  const withSummary = (lines: string[]) => composeBody(lines) + (summary ? `\n\n${summary}` : "");
  if (urgent.length) {
    const err = await sendNtfy(ctx, server, topic, `💼 Dagadvies: nu doen (${urgent.length})`, withSummary(urgent.map((e) => String(e.message))), 5);
    if (err) ctx.errors.push(err); else { await mark(urgent.map((e) => Number(e.id))); sent++; }
  }
  if (digest.length) {
    const orders = digest.filter((e) => e.kind === "order_new").length;
    const title = `💼 Dagadvies ${new Date(ctx.now).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" })}` +
      (orders ? ` — ${orders} kooporder${orders === 1 ? "" : "s"}` : "");
    const err = await sendNtfy(ctx, server, topic, title, withSummary(digest.map((e) => String(e.message))), 4);
    if (err) ctx.errors.push(err); else { await mark(digest.map((e) => Number(e.id))); sent++; }
  }
  bump(ctx, "notified", sent);
  return sent;
}

// ── Kandidaten per bron ─────────────────────────────────────────────────────
interface Cand {
  ticker: string; company: string | null; mkt: Mkt; close: number; buyLimit: number | null; dollarVol: number;
  conv: Record<Source, number>; why: Record<Source, string>; key: Record<Source, number>; quote: Quote | null;
}
async function buildCandidates(ctx: Ctx): Promise<{ ranked: Record<Source, Cand[]>; universe: number; blocked: Set<string> }> {
  const s = ctx.s;
  const since7 = new Date(ctx.now - 7 * DAY).toISOString(), sinceBlock = new Date(ctx.now - BLOCK_DAYS * DAY).toISOString();
  const [tickers, summaries, hippo, hippoCal, sprint, sprintModel, potje, posSig, negSig, news, flags] = await Promise.all([
    fetchAll<Json>(s, "signal_tickers", "ticker, company, sector, exchange, buy_limit, goud_score, price_currency, price_benched", "ticker", (q) => q.eq("active", true)),
    fetchAll<Json>(s, "signal_price_summary", "ticker, last_close, avg_volume_30d, updated_at", "ticker"),
    fetchAll<Json>(s, "xinix_hippo_scores", "ticker, prob, raw_prob, prob_21d, base_rate, tradeable", "ticker"),
    s.from("xinix_hippo_calibration").select("ceiling").eq("horizon", 14).maybeSingle(),
    fetchAll<Json>(s, "xinix_sprint_scores", "ticker, prob, base_rate, measured", "ticker"),
    s.from("xinix_event_models").select("ceiling").eq("event", "h14").maybeSingle(),
    s.rpc("xinix_advice_potje_picks"),
    fetchAll<Json>(s, "signal_events", "id, ticker, signal_type, severity", "id",
      (q) => q.in("signal_type", POS_SIGNALS).gte("detected_at", since7).or(`expires_at.is.null,expires_at.gt.${ctx.nowIso}`)),
    fetchAll<Json>(s, "signal_events", "id, ticker, signal_type, severity, title", "id",
      (q) => q.in("signal_type", NEG_SIGNALS).gte("detected_at", sinceBlock)),
    fetchAll<Json>(s, "xinix_advice_news", "id, ticker, tone, seen_at", "id", (q) => q.gte("seen_at", sinceBlock).neq("tone", "neutraal")),
    fetchAll<Json>(s, "xinix_price_flags", "ticker, resolved", "ticker", (q) => q.eq("resolved", false)),
  ]);
  if (potje.error) ctx.errors.push(`potje: ${potje.error.message}`);
  const act = tickers.filter((t) => !t.price_benched);
  const uni = await chunkedIn<Json>(s, "xinix_universe", "ticker, tv_symbol, market", act.map((t) => String(t.ticker)));
  const uniBy = new Map(uni.map((u) => [String(u.ticker), { tv_symbol: (u.tv_symbol as string) ?? null, market: (u.market as string) ?? null }]));
  const sumBy = new Map(summaries.map((r) => [String(r.ticker), r]));
  const hippoBy = new Map(hippo.map((r) => [String(r.ticker), r]));
  const sprintBy = new Map(sprint.map((r) => [String(r.ticker), r]));
  const potjeBy = new Map(((potje.data ?? []) as Json[]).map((r) => [String(r.ticker), r]));
  const hippoCeil = num(hippoCal.data?.ceiling) ?? HIPPO_CEILING_FALLBACK;
  const sprintCeil = num(sprintModel.data?.ceiling) ?? SPRINT_CEILING_FALLBACK;

  const sigBy = new Map<string, { red: number; orange: number; types: Set<string> }>();
  for (const e of posSig) {
    const t = String(e.ticker);
    const x = sigBy.get(t) ?? { red: 0, orange: 0, types: new Set<string>() };
    if (e.severity === "red") x.red++; else if (e.severity === "orange") x.orange++;
    x.types.add(String(e.signal_type));
    sigBy.set(t, x);
  }
  const blocked = new Set<string>();
  for (const e of negSig) {
    const type = String(e.signal_type);
    if (type !== "8k_material" || (e.severity === "red" && /bankrupt|delist/i.test(String(e.title ?? "")))) blocked.add(String(e.ticker));
  }
  const goodNews = new Set<string>();
  for (const n of news) {
    if (n.tone === "negatief" || n.tone === "let_op") blocked.add(String(n.ticker));
    else if (n.tone === "positief" && Date.parse(String(n.seen_at)) >= ctx.now - 7 * DAY) goodNews.add(String(n.ticker));
  }
  for (const f of flags) blocked.add(String(f.ticker));

  const usdPer = ctx.fx.get("USD") ?? 1.1;
  const all: Cand[] = [];
  for (const t of act) {
    const ticker = String(t.ticker);
    if (blocked.has(ticker)) continue;
    const mkt = marketOf(ticker, (t.exchange as string) ?? null, (t.price_currency as string) ?? null, uniBy.get(ticker));
    if (!mkt) continue;
    const sm = sumBy.get(ticker);
    const close = num(sm?.last_close), avgVol = num(sm?.avg_volume_30d);
    if (!close || close <= 0 || !avgVol || !sm?.updated_at || ctx.now - Date.parse(String(sm.updated_at)) > 4 * DAY) continue;
    const per = perEur(mkt.currency, ctx.fx);
    if (!per) continue;
    const dollarVol = (avgVol * close / per) * usdPer;
    if (dollarVol < MIN_DOLLAR_VOL) continue;
    ctx.companies.set(ticker, (t.company as string) ?? null);
    const buyLimit = num(t.buy_limit);
    const c: Cand = {
      ticker, company: (t.company as string) ?? null, mkt, close, buyLimit: buyLimit && buyLimit > 0 ? buyLimit : null, dollarVol,
      conv: { mix: 0, potje: 0, hippo: 0, sprint: 0, signaal: 0 }, why: { mix: "", potje: "", hippo: "", sprint: "", signaal: "" },
      key: { mix: 0, potje: 0, hippo: 0, sprint: 0, signaal: 0 }, quote: null,
    };
    const h = hippoBy.get(ticker);
    const hp = num(h?.prob), hb = num(h?.base_rate);
    if (h && h.tradeable !== false && hp != null && hb && hp >= 2 * hb) {
      c.conv.hippo = clamp01((hp - hb) / Math.max(0.1, hippoCeil - hb));
      c.key.hippo = hp * 1000 + (num(h.raw_prob) ?? 0) + (num(h.prob_21d) ?? 0) / 100;
      c.why.hippo = `Hippos: ${fmtNl(hp, 1)}% kans op +50% binnen 14 dagen (basis ${fmtNl(hb, 1)}%)`;
    }
    const sp = sprintBy.get(ticker);
    const spp = num(sp?.prob), spb = num(sp?.base_rate);
    if (sp && sp.measured && spp != null && spb && spp >= 2 * spb) {
      c.conv.sprint = clamp01((spp - spb) / Math.max(0.1, sprintCeil - spb));
      c.key.sprint = spp;
      c.why.sprint = `Sprinters: ${fmtNl(spp, 1)}% kans op +50% binnen 10 handelsdagen (basis ${fmtNl(spb, 1)}%)`;
    }
    const pj = potjeBy.get(ticker);
    if (pj) {
      const holders = num(pj.holders) ?? 0;
      c.conv.potje = clamp01(holders / 3);
      c.key.potje = holders * 1000 + (num(pj.avg_r60) ?? 0);
      const slugs = ((pj.slugs as string[]) ?? []).slice(0, 3).join(", ");
      c.why.potje = `Potje: ${holders} van de 10 beste strategieën (60 dagen) kochten hem deze week (${slugs})`;
    }
    const sg = sigBy.get(ticker);
    const score = num(t.goud_score) ?? 0;
    const rank = score + (sg?.red ? 25 : 0) + (sg?.orange ? 10 : 0);
    const nearLimit = !c.buyLimit || close <= c.buyLimit * 1.10;
    if (rank >= 65 && nearLimit) {
      c.conv.signaal = clamp01((rank - 50) / 65);
      c.key.signaal = rank;
      const types = sg ? [...sg.types].slice(0, 3).join(", ") : "";
      const where = c.buyLimit && close < c.buyLimit * 0.97 ? "onder de aankooplimiet" : "rond de aankooplimiet";
      c.why.signaal = `Score ${Math.round(score)}${sg?.red ? " + rood signaal" : ""}${sg?.orange ? " + oranje signaal" : ""}${types ? ` (${types})` : ""}, ${where}`;
    }
    const parts = (["potje", "hippo", "sprint", "signaal"] as Source[]).filter((k) => c.conv[k] > 0);
    // Volle overtuiging pas als drie bronnen het eens zijn; één bron alleen geeft hooguit een derde.
    c.conv.mix = clamp01(parts.reduce((a, k) => a + c.conv[k], 0) / 3);
    c.key.mix = parts.length;
    c.why.mix = parts.map((k) => c.why[k]).join(" · ");
    if (goodNews.has(ticker)) {
      for (const k of SOURCES) if (c.conv[k] > 0) { c.conv[k] = clamp01(c.conv[k] + 0.1); c.why[k] += " · positief nieuws"; }
    }
    if (parts.length) all.push(c);
  }
  const ranked = {} as Record<Source, Cand[]>;
  for (const src of SOURCES) {
    ranked[src] = all.filter((c) => c.conv[src] >= MIN_CONVICTION)
      .sort((a, b) => b.conv[src] - a.conv[src] || b.key[src] - a.key[src] || b.dollarVol - a.dollarVol);
  }
  return { ranked, universe: all.length, blocked };
}

// ── Dagelijkse run ──────────────────────────────────────────────────────────
async function refreshFx(ctx: Ctx) {
  try {
    const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml");
    if (!res.ok) throw new Error(`ECB HTTP ${res.status}`);
    const xml = await res.text();
    const asOf = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
    const rows = [...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)]
      .map((m) => ({ currency: m[1], per_eur: Number(m[2]), as_of: asOf ?? ctx.nowIso.slice(0, 10), updated_at: ctx.nowIso }))
      .filter((r) => r.per_eur > 0);
    if (rows.length < 10) throw new Error(`ECB gaf ${rows.length} koersen`);
    const { error } = await ctx.s.from("xinix_fx_rates").upsert(rows, { onConflict: "currency" });
    if (error) throw new Error(error.message);
    for (const r of rows) ctx.fx.set(r.currency, r.per_eur);
    bump(ctx, "fx", rows.length);
  } catch (e) { ctx.errors.push(`wisselkoersen: ${msg(e)}`); }
}

function positionValue(ctx: Ctx, p: Position): { gross: number; net: number } {
  const per = perEur(p.currency, ctx.fx) ?? p.entry_per_eur;
  const gross = (p.qty * (p.last_price ?? p.entry_price)) / per;
  return { gross, net: gross - tradeCosts(p.market, p.currency, gross, "sell").total };
}
function equityOf(ctx: Ctx, book: string): { equity: number; invested: number; n: number } {
  const b = ctx.books.get(book)!;
  let invested = 0, n = 0;
  for (const p of ctx.positions) if (p.book === book && !p.closed_at) { invested += positionValue(ctx, p).net; n++; }
  return { equity: b.cash_eur + invested, invested, n };
}

async function dailyRun(ctx: Ctx): Promise<string> {
  await refreshFx(ctx);
  if (!ctx.fx.get("USD")) throw new Error("geen wisselkoersen");
  const { ranked, universe, blocked } = await buildCandidates(ctx);

  // Koersen voor alles wat we vasthouden, waarop een order staat of wat kandidaat is.
  const top = new Map<string, Cand>();
  for (const src of SOURCES) for (const c of ranked[src].slice(0, 40)) top.set(c.ticker, c);
  const items = [
    ...ctx.orders.filter((o) => o.status === "open").map((o) => ({ tv: o.tv_symbol, region: o.market })),
    ...ctx.positions.filter((p) => !p.closed_at).map((p) => ({ tv: p.tv_symbol, region: p.market })),
    ...[...top.values()].map((c) => ({ tv: c.mkt.tv, region: c.mkt.region })),
  ];
  const quotes = await fetchQuotes(items, ctx.errors);
  await processQuotes(ctx, quotes, "daily");
  for (const c of top.values()) {
    const q = quoteIn(quotes.get(c.mkt.tv), c.mkt.currency);
    if (q?.close && q.close > 0) { c.quote = q; c.close = q.close; }
  }

  // Tijd-exits.
  for (const p of ctx.positions) {
    if (p.closed_at || p.exit_pending) continue;
    const days = tradingDaysBetween(Date.parse(p.opened_at), ctx.now);
    const gain = (p.last_price ?? p.entry_price) / p.entry_price - 1;
    const reason = days >= MAX_HOLD_DAYS ? `maximale looptijd (${days} handelsdagen)`
      : days >= TIME_EXIT_DAYS && gain < TIME_EXIT_MIN_GAIN ? `${days} handelsdagen zonder doorbraak (${fmtPct(gain * 100)})` : null;
    if (!reason) continue;
    p.exit_pending = reason;
    p.exit_pending_at = new Date(nextOpen(p.market, nextDigest(ctx.now))).toISOString();
    await ctx.s.from("xinix_advice_positions").update({ exit_pending: p.exit_pending, exit_pending_at: p.exit_pending_at }).eq("id", p.id);
    bump(ctx, "sell_advice");
    await addEvent(ctx, p.book, "sell_advice", p.ticker,
      `⏱ VERKOOP ${tickerLabel(ctx, p.ticker, p.exchange)} (${fmtNl(p.qty, 0)} stuks): ${reason}. Annuleer je stop-loss en verkoop bij opening (bestens of limiet ~${fmtPrice(roundTick(p.market, (p.last_price ?? p.entry_price) * 0.99), p.currency)}).`,
      false, { reason });
  }

  // Openstaande orders: verlopen, niet meer kansrijk of geblokkeerd.
  const cooling = new Set<string>();   // book|ticker: niet meteen opnieuw kopen
  for (const o of ctx.orders) {
    if (o.status !== "open") continue;
    const book = ctx.books.get(o.book)!;
    const src = book.source as Source;
    const still = ranked[src]?.some((c) => c.ticker === o.ticker);
    const age = tradingDaysBetween(Date.parse(o.valid_from) - DAY, ctx.now);
    let why: string | null = null;
    if (blocked.has(o.ticker)) why = "slecht nieuws of een koersvlag";
    else if (age >= ORDER_DAYS) why = `${ORDER_DAYS} handelsdagen niet gevuld`;
    else if (!still && o.misses + 1 >= ORDER_MISSES) why = `al ${ORDER_MISSES} dagen geen kandidaat meer`;
    if (!why) {
      const misses = still ? 0 : o.misses + 1;
      if (misses !== o.misses) { o.misses = misses; await ctx.s.from("xinix_advice_orders").update({ misses }).eq("id", o.id); }
      continue;
    }
    o.status = "cancelled";
    cooling.add(`${o.book}|${o.ticker}`);
    await ctx.s.from("xinix_advice_orders").update({ status: "cancelled", closed_at: ctx.nowIso, cancel_reason: why }).eq("id", o.id);
    bump(ctx, "cancelled");
    await addEvent(ctx, o.book, "order_cancel", o.ticker,
      `⛔ ANNULEER je kooporder ${tickerLabel(ctx, o.ticker, o.exchange)} (limiet ${fmtPrice(o.limit_price, o.currency)}): ${why}.`, false, { why });
  }
  // Wat de afgelopen 10 dagen verkocht of geannuleerd is, komt niet meteen terug.
  const recentSince = new Date(ctx.now - BLOCK_DAYS * DAY).toISOString();
  const [{ data: recentClosed }, { data: recentCancelled }] = await Promise.all([
    ctx.s.from("xinix_advice_positions").select("book, ticker").gte("closed_at", recentSince),
    ctx.s.from("xinix_advice_orders").select("book, ticker").eq("status", "cancelled").gte("closed_at", recentSince),
  ]);
  for (const r of [...((recentClosed ?? []) as Json[]), ...((recentCancelled ?? []) as Json[])]) cooling.add(`${r.book}|${r.ticker}`);

  // Nieuwe orders.
  const year = String(new Date(ctx.now).getUTCFullYear());
  const { data: recentHints } = await ctx.s.from("xinix_advice_events").select("ticker").eq("book", "live").eq("kind", "limit_hint")
    .gte("at", new Date(ctx.now - HINT_EVERY_DAYS * DAY).toISOString());
  const hinted = new Set(((recentHints ?? []) as Json[]).map((r) => String(r.ticker)));
  let hintsToday = 0;
  for (const book of ctx.books.values()) {
    const src = (SOURCES as readonly string[]).includes(book.source) ? (book.source as Source) : "mix";
    const open = ctx.orders.filter((o) => o.book === book.book && o.status === "open");
    const have = new Set([...open.map((o) => o.ticker), ...ctx.positions.filter((p) => p.book === book.book && !p.closed_at).map((p) => p.ticker)]);
    const { equity } = equityOf(ctx, book.book);
    let reserved = open.reduce((a, o) => a + o.reserved_eur, 0);
    let added = 0;
    for (const c of ranked[src]) {
      if (added >= MAX_NEW_ORDERS || open.length + added >= MAX_OPEN_ORDERS) break;
      if (have.has(c.ticker) || cooling.has(`${book.book}|${c.ticker}`)) continue;
      const conv = c.conv[src];
      let limit = c.close * (1 - LIMIT_BELOW_CLOSE);
      if (c.buyLimit) limit = Math.min(limit, c.buyLimit);
      limit = roundTick(c.mkt.region, limit);
      if (!(limit > 0)) continue;
      const gap = 1 - limit / c.close;
      if (gap > MAX_LIMIT_GAP) {
        // Alleen in het tabblad (jij beslist of de limiet omhoog gaat), de sterkste vijf per dag.
        if (book.book === "live" && conv >= 0.5 && !hinted.has(c.ticker) && hintsToday < MAX_HINTS_PER_DAY) {
          hinted.add(c.ticker);
          hintsToday++;
          const suggest = roundTick(c.mkt.region, c.close * (1 - LIMIT_BELOW_CLOSE));
          await addEvent(ctx, "live", "limit_hint", c.ticker,
            `💡 ${tickerLabel(ctx, c.ticker, c.mkt.exchange)} is kansrijk (${c.why[src]}), maar je aankooplimiet ${fmtPrice(c.buyLimit ?? 0, c.mkt.currency)} ligt ${fmtNl(gap * 100, 0)}% onder de koers ${fmtPrice(c.close, c.mkt.currency)}. ` +
            `Wil je hem kopen, verhoog dan je limiet naar ${fmtPrice(suggest, c.mkt.currency)} (knop in het tabblad).`,
            false, { close: c.close, buy_limit: c.buyLimit, suggest, conviction: conv, currency: c.mkt.currency }, true);
          bump(ctx, "hints");
        }
        continue;
      }
      const per = perEur(c.mkt.currency, ctx.fx);
      if (!per) continue;
      const weight = conv >= 0.75 ? 0.20 : conv >= 0.5 ? 0.15 : 0.10;
      const available = book.cash_eur - reserved - CASH_FLOOR * equity;
      const budget = Math.min(weight * equity, available);
      const connect = c.mkt.region !== "netherlands" && !(book.exchanges_paid[year] ?? []).includes(c.mkt.exchange) ? CONNECT_EUR : 0;
      const fixed = orderFee(c.mkt.region) + connect;
      const pct = (c.mkt.currency === "EUR" ? 0 : AUTOFX) + taxRate(c.mkt.region, "buy");
      let qty = Math.floor((((budget - fixed) / (1 + pct)) * per) / limit);
      if (c.mkt.lot > 1) qty = Math.floor(qty / c.mkt.lot) * c.mkt.lot;
      if (qty < 1) continue;
      const value = (qty * limit) / per;
      if (value < MIN_ORDER_EUR) continue;
      const reserve = value + tradeCosts(c.mkt.region, c.mkt.currency, value, "buy").total + connect;
      const validFrom = new Date(nextOpen(c.mkt.region, nextDigest(ctx.now))).toISOString();
      const reason = c.why[src];
      const { data: row, error } = await ctx.s.from("xinix_advice_orders").insert({
        book: book.book, ticker: c.ticker, tv_symbol: c.mkt.tv, market: c.mkt.region, exchange: c.mkt.exchange, currency: c.mkt.currency,
        limit_price: limit, qty, reserved_eur: r2(reserve), close_at: c.close, watch_limit: c.buyLimit, conviction: Math.round(conv * 100) / 100,
        source: src, reason, valid_from: validFrom, snap: snapOf(c.quote),
      }).select("*").single();
      if (error || !row) { ctx.errors.push(`order ${c.ticker}: ${error?.message}`); continue; }
      ctx.orders.push(toOrder(row as Json));
      have.add(c.ticker); reserved += reserve; added++;
      bump(ctx, "orders");
      const opens = new Date(validFrom).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", hour: "2-digit", minute: "2-digit" });
      await addEvent(ctx, book.book, "order_new", c.ticker,
        `🟢 KOOP ${tickerLabel(ctx, c.ticker, c.mkt.exchange)}: ${fmtNl(qty, 0)} stuks, GTC-limiet ${fmtPrice(limit, c.mkt.currency)} ` +
        `(slot ${fmtPrice(c.close, c.mkt.currency)}, ${fmtNl(gap * 100, 1)}% lager) ≈ ${fmtEur(reserve)} incl. kosten; plaatsen vóór de opening (${opens}). ` +
        `Overtuiging ${Math.round(conv * 100)}% → ${Math.round(weight * 100)}% van de portefeuille. ${reason}.`,
        false, { qty, limit, close: c.close, conviction: conv, weight, reserved_eur: r2(reserve), valid_from: validFrom });
    }
  }

  // Equity per boek.
  const today = ctx.nowIso.slice(0, 10);
  const eqRows = [...ctx.books.values()].map((b) => {
    const e = equityOf(ctx, b.book);
    return { book: b.book, date: today, equity_eur: r2(e.equity), cash_eur: r2(b.cash_eur), invested_eur: r2(e.invested), positions: e.n };
  });
  const { error: eqErr } = await ctx.s.from("xinix_advice_equity").upsert(eqRows, { onConflict: "book,date" });
  if (eqErr) ctx.errors.push(`equity: ${eqErr.message}`);

  const sel = await monthlySelect(ctx);
  for (const b of ctx.books.values()) { b.last_daily_at = ctx.nowIso; await saveBook(ctx, b); }
  return `universum ${universe}; kandidaten ${SOURCES.map((k) => `${k} ${ranked[k].length}`).join(", ")}${sel ? `; ${sel}` : ""}`;
}

/** Eens per maand: kies de bron voor 'live' op het track record van de schaduwboeken. */
async function monthlySelect(ctx: Ctx): Promise<string | null> {
  const live = ctx.books.get("live");
  if (!live) return null;
  const month = ctx.nowIso.slice(0, 7);
  if (live.last_select_at && live.last_select_at.slice(0, 7) === month) return null;
  live.last_select_at = ctx.nowIso;
  const [{ data: eq }, { data: closed }] = await Promise.all([
    ctx.s.from("xinix_advice_equity").select("book, date, equity_eur").gte("date", new Date(ctx.now - 92 * DAY).toISOString().slice(0, 10)).order("date"),
    ctx.s.from("xinix_advice_positions").select("book, pnl_eur, closed_at").not("closed_at", "is", null).gte("closed_at", new Date(ctx.now - 92 * DAY).toISOString()),
  ]);
  const stats: Array<{ src: Source; ret: number; days: number; trades: number }> = [];
  for (const src of SOURCES) {
    const b = ctx.books.get(src);
    if (!b) continue;
    const rows = ((eq ?? []) as Json[]).filter((r) => r.book === src);
    const days = tradingDaysBetween(Date.parse(b.started_at), ctx.now);
    const first = rows.length ? num(rows[0].equity_eur)! : b.start_eur;
    const startEq = Date.parse(b.started_at) >= ctx.now - 92 * DAY ? b.start_eur : first;
    const nowEq = equityOf(ctx, src).equity;
    const trades = ((closed ?? []) as Json[]).filter((r) => r.book === src).length;
    stats.push({ src, ret: nowEq / startEq - 1, days, trades });
  }
  const current = stats.find((x) => x.src === live.source);
  const eligible = stats.filter((x) => x.days >= SELECT_MIN_DAYS && x.trades >= SELECT_MIN_TRADES).sort((a, b) => b.ret - a.ret);
  const table = stats.map((x) => `${SOURCE_LABEL[x.src]} ${fmtPct(x.ret * 100)} (${x.trades} trades)`).join(", ");
  const best = eligible[0];
  if (!best || best.src === live.source || (current && best.ret - current.ret < SWITCH_MARGIN)) {
    await addEvent(ctx, "live", "source_keep", null,
      `Maandkeuze: bron blijft ${SOURCE_LABEL[live.source as Source] ?? live.source}. ${eligible.length ? "" : "Nog te weinig track record (minstens 20 handelsdagen en 3 afgesloten trades). "}Stand: ${table}.`,
      false, { stats }, true);
    await saveBook(ctx, live);
    return `bron blijft ${live.source}`;
  }
  const old = live.source;
  live.source = best.src;
  live.source_since = ctx.nowIso;
  await saveBook(ctx, live);
  await addEvent(ctx, "live", "source_switch", null,
    `🔀 Je Dagadvies volgt vanaf nu ${SOURCE_LABEL[best.src]} (${fmtPct(best.ret * 100)}) in plaats van ${SOURCE_LABEL[old as Source] ?? old}` +
    `${current ? ` (${fmtPct(current.ret * 100)})` : ""}. Lopende posities en orders lopen gewoon af. Stand: ${table}.`,
    false, { stats, old, new: best.src });
  return `bron ${old} → ${best.src}`;
}

// ── Kwartierronde ───────────────────────────────────────────────────────────
async function watchRun(ctx: Ctx): Promise<string | null> {
  const open = [
    ...ctx.orders.filter((o) => o.status === "open").map((o) => ({ tv: o.tv_symbol, region: o.market })),
    ...ctx.positions.filter((p) => !p.closed_at).map((p) => ({ tv: p.tv_symbol, region: p.market })),
  ].filter((x) => inSession(x.region, ctx.now));
  const tickers = [...new Set([...ctx.orders.map((o) => o.ticker), ...ctx.positions.map((p) => p.ticker)])];
  for (const r of await chunkedIn<Json>(ctx.s, "signal_tickers", "ticker, company", tickers)) ctx.companies.set(String(r.ticker), (r.company as string) ?? null);
  if (open.length) {
    const quotes = await fetchQuotes(open, ctx.errors);
    bump(ctx, "quotes", quotes.size);
    await processQuotes(ctx, quotes, "watch");
  }
  await scanNews(ctx);
  await sendPending(ctx);
  const n = Object.values(ctx.counts).reduce((a, b) => a + b, 0);
  return n || ctx.errors.length ? Object.entries(ctx.counts).map(([k, v]) => `${k} ${v}`).join(", ") : null;
}

async function logRun(s: SB, job: string, started: string, ok: boolean, message: string, metrics: Json) {
  await s.from("signal_runs").insert({ job, started_at: started, finished_at: new Date().toISOString(), ok, message, metrics });
}

async function run(req: Request, mode: string): Promise<Response> {
  const s = client();
  const started = new Date().toISOString();
  const ctx = await loadState(s, Date.now());
  try {
    let message: string | null;
    if (mode === "daily") {
      const tickers = [...new Set([...ctx.orders.map((o) => o.ticker), ...ctx.positions.map((p) => p.ticker)])];
      for (const r of await chunkedIn<Json>(s, "signal_tickers", "ticker, company", tickers)) ctx.companies.set(String(r.ticker), (r.company as string) ?? null);
      message = await dailyRun(ctx);
      await sendPending(ctx);
    } else {
      message = await watchRun(ctx);
    }
    const ok = ctx.errors.length === 0;
    const counts = Object.entries(ctx.counts).map(([k, v]) => `${k} ${v}`).join(", ");
    const full = `${message ?? "niets te doen"}${mode === "daily" && counts ? `; ${counts}` : ""}` +
      (ctx.errors.length ? `; fouten: ${ctx.errors.slice(0, 5).join("; ")}` : "");
    if (mode === "daily" || message || !ok) await logRun(s, `xinix-advice-${mode}`, started, ok, full, ctx.counts);
    return reply(req, { ok, message: full, counts: ctx.counts });
  } catch (e) {
    await logRun(s, `xinix-advice-${mode}`, started, false, msg(e), ctx.counts);
    return reply(req, { ok: false, message: msg(e) }, 500);
  }
}

// ── Lezen ───────────────────────────────────────────────────────────────────
async function overview(req: Request): Promise<Response> {
  const s = client();
  const now = Date.now();
  const evCols = "id, book, at, kind, ticker, message, urgent, payload, notified_at";
  const [books, orders, openPos, closedPos, eventsLive, eventsShadow, equity, settings, fx] = await Promise.all([
    s.from("xinix_advice_books").select("*").order("book"),
    s.from("xinix_advice_orders").select("*").eq("status", "open").order("created_at", { ascending: false }),
    s.from("xinix_advice_positions").select("*").is("closed_at", null).order("opened_at", { ascending: false }),
    s.from("xinix_advice_positions").select("book, ticker, exchange, currency, qty, entry_price, exit_price, cost_eur, proceeds_eur, pnl_eur, pnl_pct, exit_reason, opened_at, closed_at, source, reason")
      .not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(500),
    s.from("xinix_advice_events").select(evCols).eq("book", "live").order("at", { ascending: false }).limit(250),
    s.from("xinix_advice_events").select(evCols).neq("book", "live").order("at", { ascending: false }).limit(250),
    s.from("xinix_advice_equity").select("book, date, equity_eur, cash_eur, invested_eur, positions").order("date"),
    s.from("signal_settings").select("advice_notify, ntfy_topic, quiet_hours_start, quiet_hours_end").eq("id", 1).maybeSingle(),
    s.from("xinix_fx_rates").select("currency, per_eur, as_of"),
  ]);
  for (const r of [books, orders, openPos, closedPos, eventsLive, eventsShadow, equity, fx]) if (r.error) return reply(req, { error: r.error.message }, 500);
  const events = [...(eventsLive.data ?? []), ...(eventsShadow.data ?? [])];
  const fxMap = new Map(((fx.data ?? []) as Json[]).map((r) => [String(r.currency), num(r.per_eur)!]));
  const tickers = [...new Set([...(orders.data ?? []), ...(openPos.data ?? []), ...(closedPos.data ?? [])].map((r) => String((r as Json).ticker)))];
  const names = new Map<string, Json>();
  for (const r of await chunkedIn<Json>(s, "signal_tickers", "ticker, company, sector, buy_limit", tickers)) names.set(String(r.ticker), r);
  const sums = new Map<string, Json>();
  for (const r of await chunkedIn<Json>(s, "signal_price_summary", "ticker, last_close, updated_at", tickers)) sums.set(String(r.ticker), r);

  const positions = ((openPos.data ?? []) as Json[]).map((r): Json => {
    const p = toPosition(r);
    const price = p.last_price ?? num(sums.get(p.ticker)?.last_close) ?? p.entry_price;
    const per = perEur(p.currency, fxMap) ?? p.entry_per_eur;
    const gross = (p.qty * price) / per;
    const net = gross - tradeCosts(p.market, p.currency, gross, "sell").total;
    return {
      ...r, company: names.get(p.ticker)?.company ?? null, price, value_eur: r2(net), pnl_eur: r2(net - p.cost_eur),
      pnl_pct: Math.round(((net - p.cost_eur) / p.cost_eur) * 1000) / 10, days: tradingDaysBetween(Date.parse(p.opened_at), now),
      stop_pct: p.stop_price != null ? Math.round((p.stop_price / p.entry_price - 1) * 1000) / 10 : null,
    };
  });
  const orderRows = ((orders.data ?? []) as Json[]).map((r): Json => ({
    ...r, company: names.get(String(r.ticker))?.company ?? null, buy_limit_now: num(names.get(String(r.ticker))?.buy_limit),
    last_close: num(sums.get(String(r.ticker))?.last_close),
  }));
  const closed = ((closedPos.data ?? []) as Json[]).map((r): Json => ({ ...r, company: names.get(String(r.ticker))?.company ?? null }));
  const bookRows = ((books.data ?? []) as Json[]).map((r) => {
    const b = toBook(r);
    const mine = positions.filter((p) => p.book === b.book);
    const invested = mine.reduce((a, p) => a + (num(p.value_eur) ?? 0), 0);
    const eq = b.cash_eur + invested;
    const done = closed.filter((c) => c.book === b.book);
    const wins = done.filter((c) => (num(c.pnl_eur) ?? 0) > 0).length;
    const reserved = orderRows.filter((o) => o.book === b.book).reduce((a, o) => a + (num(o.reserved_eur) ?? 0), 0);
    const monthStart = ((equity.data ?? []) as Json[]).find((e) => e.book === b.book && String(e.date) >= new Date(now).toISOString().slice(0, 7) + "-01");
    return {
      ...b, equity_eur: r2(eq), invested_eur: r2(invested), reserved_eur: r2(reserved), return_pct: Math.round((eq / b.start_eur - 1) * 1000) / 10,
      month_return_pct: monthStart ? Math.round((eq / num(monthStart.equity_eur)! - 1) * 1000) / 10 : null,
      positions: mine.length, open_orders: orderRows.filter((o) => o.book === b.book).length,
      closed_trades: done.length, wins, realized_eur: r2(done.reduce((a, c) => a + (num(c.pnl_eur) ?? 0), 0)),
      costs_eur: r2(b.fees_eur + b.fx_cost_eur + b.tax_eur + b.connect_eur),
    };
  });
  const eqBy: Record<string, Array<{ date: string; equity_eur: number }>> = {};
  for (const e of (equity.data ?? []) as Json[]) (eqBy[String(e.book)] ??= []).push({ date: String(e.date), equity_eur: num(e.equity_eur)! });
  const st = (settings.data ?? {}) as Json;
  const fxRows = (fx.data ?? []) as Json[];
  return reply(req, {
    books: bookRows,
    orders: orderRows,
    positions,
    closed,
    events,
    equity: eqBy,
    settings: { advice_notify: st.advice_notify !== false, ntfy_configured: !!st.ntfy_topic, quiet_hours_start: st.quiet_hours_start ?? null, quiet_hours_end: st.quiet_hours_end ?? null },
    fx: { as_of: fxRows[0]?.as_of ?? null, rates: Object.fromEntries(fxRows.filter((r) => ["USD", "CAD", "GBP", "AUD", "SEK", "CHF", "JPY"].includes(String(r.currency))).map((r) => [String(r.currency), num(r.per_eur)])) },
    sources: SOURCES.map((k) => ({ key: k, label: SOURCE_LABEL[k] })),
    rules: {
      cash_floor_pct: CASH_FLOOR * 100, max_weight_pct: 20, stop_pct: STOP_PCT * 100, trail_from_pct: TRAIL_FROM * 100,
      time_exit_days: TIME_EXIT_DAYS, time_exit_min_gain_pct: TIME_EXIT_MIN_GAIN * 100, max_hold_days: MAX_HOLD_DAYS,
      limit_below_close_pct: LIMIT_BELOW_CLOSE * 100, max_limit_gap_pct: MAX_LIMIT_GAP * 100, order_days: ORDER_DAYS,
      min_dollar_volume: MIN_DOLLAR_VOL, min_order_eur: MIN_ORDER_EUR, autofx_pct: AUTOFX * 100, connect_eur: CONNECT_EUR,
      digest_hour_utc: DIGEST_HOUR_UTC,
    },
    generated_at: new Date(now).toISOString(),
  });
}

async function action(req: Request): Promise<Response> {
  if (!isAdmin(req)) return reply(req, { error: "niet ingelogd" }, 401);
  const body = (await req.json().catch(() => ({}))) as Json;
  const s = client();
  if (body.action === "raise_limit") {
    const ticker = String(body.ticker ?? "").trim().toUpperCase();
    const limit = num(body.limit);
    if (!ticker || !limit || limit <= 0) return reply(req, { error: "ticker en limiet > 0 nodig" }, 400);
    const { data: t } = await s.from("signal_tickers").select("buy_limit").eq("ticker", ticker).maybeSingle();
    if (!t) return reply(req, { error: `${ticker} staat niet in de watchlist` }, 404);
    const { error } = await s.from("signal_tickers").update({ buy_limit: limit }).eq("ticker", ticker);
    if (error) return reply(req, { error: error.message }, 500);
    await s.from("xinix_advice_events").insert({
      book: "live", kind: "limit_set", ticker, message: `Aankooplimiet ${ticker} aangepast van ${num(t.buy_limit) ?? "—"} naar ${limit} (vanuit Dagadvies).`,
      urgent: false, notified_at: new Date().toISOString(), payload: { old: num(t.buy_limit), new: limit },
    });
    return reply(req, { ok: true });
  }
  if (body.action === "notify") {
    const { error } = await s.from("signal_settings").update({ advice_notify: body.on === true }).eq("id", 1);
    if (error) return reply(req, { error: error.message }, 500);
    return reply(req, { ok: true });
  }
  return reply(req, { error: "onbekende actie" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    if (req.method === "GET") return await overview(req);
    const mode = new URL(req.url).searchParams.get("mode");
    if (mode === "watch" || mode === "daily") {
      if (!isCron(req) && !isAdmin(req)) return reply(req, { error: "niet ingelogd" }, 401);
      return await run(req, mode);
    }
    return await action(req);
  } catch (e) {
    return reply(req, { error: msg(e) }, 500);
  }
});
