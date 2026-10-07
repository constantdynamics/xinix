// xinix-crypto — Favorieten → 🪙 Crypto: crypto-aandelen met groeipotentie, met
// een eigen formule die los staat van de 5-sterren-scanner en de andere lijsten
// (keuzes van de gebruiker op 2026-10-07, zie migratie 2026-10-07_xinix_crypto.sql).
//
// GET                              → { rows, excluded, last_run }  (de lijst)
// GET ?labels=1                    → { labels: { TICKER: categorie } } voor het rode CRYPTO-label
// POST { ticker, action: "adopt" } → op de watchlist met crypto-label en no_sim: niet in het
//                                    Potje, de papieren portefeuille en het Dagadvies (beheertoken)
// POST ?mode=scan[&notify=0]       → de wekelijkse scan (cron of beheertoken)
//
// De scan zoekt via TradingView op alle DEGIRO-beurzen naar crypto-aandelen (crypto-woorden
// in de naam plus een vaste lijst bekende namen), weert te kleine, te dunne en SPAC-noteringen,
// eist uit tien jaar dagkoersen van Yahoo dat het aandeel minstens één keer +400% binnen een
// maand (21 handelsdagen) steeg, en scoort dan (max 100):
//   nieuws over een cryptostrategie (50) + fase (25) + explosies (15) + omzet (10).

import { getServiceClient, logRun, type Json, type RunResult } from "../_shared/supabase.ts";
import { checkAuth, checkAdminOrCron } from "../_shared/auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "../_shared/cors.ts";
import { publishNtfy } from "../_shared/ntfy.ts";

type Cat = "miner" | "treasury" | "exchange" | "tech";
type SB = ReturnType<typeof getServiceClient>;

const MIN_MCAP_USD = 20e6;
const MIN_DOLLAR_VOL_USD = 1e6;
const MIN_MONTH_RATIO = 5;            // +400% binnen een maand
const MONTH_DAYS = 21;                // handelsdagen
const EPISODE_GAP = 40;               // handelsdagen tussen twee losse explosies
const VOLUME_SPIKE = 1.5;             // zo'n stijging gaat met volume gepaard, een gemiste reverse split niet
const HISTORY_MAX_AGE_DAYS = 28;
const NEWS_MAX_AGE_DAYS = 3;
const ALERT_MIN_SCORE = 80;
const BUDGET_MS = 110_000;            // ruim binnen de wandklok van een edge function
const CONCURRENCY = 6;
const DAY = 86_400_000;
const TAB_URL = "https://constantdynamics.github.io/xinix/?tab=favorieten&sub=crypto";
const ZWSP = String.fromCharCode(0x200b); // onzichtbare spatie voor de punt: anders maakt ntfy van "HIVE.V" een link

const num = (v: unknown): number | null => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const r1 = (x: number) => Math.round(x * 10) / 10;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── Markten: dezelfde lijst als _shared/universe.ts (DEGIRO/Saxo, geen OTC) ──
const MARKETS: Array<{ region: string; ex: Record<string, string> }> = [
  { region: "america", ex: { NASDAQ: "", NYSE: "", AMEX: "" } },
  { region: "canada", ex: { TSX: ".TO", TSXV: ".V", CSE: ".CN", NEO: ".NE" } },
  { region: "uk", ex: { LSE: ".L" } },
  { region: "germany", ex: { XETR: ".DE", FWB: ".F" } },
  { region: "france", ex: { EURONEXT: ".PA" } },
  { region: "netherlands", ex: { EURONEXT: ".AS" } },
  { region: "belgium", ex: { EURONEXT: ".BR" } },
  { region: "italy", ex: { MIL: ".MI" } },
  { region: "spain", ex: { BME: ".MC" } },
  { region: "portugal", ex: { EURONEXT: ".LS" } },
  { region: "poland", ex: { GPW: ".WA" } },
  { region: "switzerland", ex: { SIX: ".SW" } },
  { region: "sweden", ex: { OMXSTO: ".ST" } },
  { region: "norway", ex: { OSL: ".OL" } },
  { region: "denmark", ex: { OMXCOP: ".CO" } },
  { region: "finland", ex: { OMXHEX: ".HE" } },
  { region: "australia", ex: { ASX: ".AX" } },
  { region: "hongkong", ex: { HKEX: ".HK" } },
  { region: "japan", ex: { TSE: ".T" } },
  { region: "singapore", ex: { SGX: ".SI" } },
];
// Beursnamen zoals signal_tickers ze van Yahoo kent (de koerspuller leidt er de handelsuren uit af).
const YAHOO_EXCHANGE: Record<string, string> = {
  "america:NASDAQ": "NASDAQ", "america:NYSE": "NYSE", "america:AMEX": "NYSE American",
  "canada:TSX": "Toronto", "canada:TSXV": "TSXV", "canada:CSE": "Canadian Sec", "canada:NEO": "Cboe CA",
  "uk:LSE": "LSE", "germany:XETR": "XETRA", "germany:FWB": "Frankfurt", "france:EURONEXT": "Paris",
  "netherlands:EURONEXT": "Amsterdam", "belgium:EURONEXT": "Brussels", "portugal:EURONEXT": "Lisbon",
  "italy:MIL": "Milan", "spain:BME": "Madrid", "poland:GPW": "Warsaw", "switzerland:SIX": "Swiss",
  "sweden:OMXSTO": "Stockholm", "norway:OSL": "Oslo", "denmark:OMXCOP": "Copenhagen", "finland:OMXHEX": "Helsinki",
  "australia:ASX": "ASX", "hongkong:HKEX": "HKSE", "japan:TSE": "Tokyo", "singapore:SGX": "SES",
};
function yahooSymbol(region: string, exchange: string, name: string): string | null {
  const sfx = MARKETS.find((x) => x.region === region)?.ex[exchange];
  if (sfx == null) return null;
  let sym = name.toUpperCase().replace(/[._]/g, "-");
  if (region === "hongkong") sym = sym.padStart(4, "0");
  if (region === "uk" && /^[0-9][0-9A-Z]{3}$/.test(sym)) return null;
  return `${sym}${sfx}`;
}

// ── Welke aandelen zijn crypto ──────────────────────────────────────────────
// Bekende namen zonder crypto-woord in de bedrijfsnaam (TradingView-symbool per markt).
const CURATED: Record<string, Record<string, Cat>> = {
  america: {
    MARA: "miner", RIOT: "miner", CLSK: "miner", CIFR: "miner", CORZ: "miner", IREN: "miner", HUT: "miner",
    WULF: "miner", BTDR: "miner", HIVE: "miner", BITF: "miner", BTBT: "miner", GREE: "miner", ARBK: "miner",
    BTCM: "miner", SLNH: "miner", DGXX: "miner", MIGI: "miner", SOS: "miner", FUFU: "miner", ABTC: "miner",
    LMFA: "miner", ANY: "miner", APLD: "miner", NCTY: "miner", BGIN: "miner",
    MSTR: "treasury", SBET: "treasury", BMNR: "treasury", UPXI: "treasury", DFDV: "treasury", NAKA: "treasury",
    XXI: "treasury", SMLR: "treasury", BTCS: "treasury", HSDT: "treasury", ETHZ: "treasury", BTOG: "treasury",
    ALTS: "treasury", VVPR: "treasury", SQNS: "treasury", GNS: "treasury", BNC: "treasury", FORD: "treasury",
    HYPD: "treasury", TRON: "treasury", ASST: "treasury", USDE: "treasury", KIDZ: "treasury",
    STKE: "treasury", ETHM: "treasury", BRR: "treasury", NA: "treasury", AVX: "treasury", PURR: "treasury",
    TONX: "treasury", SUIG: "treasury", ZONE: "treasury", OCTO: "treasury", FWDI: "treasury",
    COIN: "exchange", HOOD: "exchange", BLSH: "exchange", GLXY: "exchange", EXOD: "exchange", GEMI: "exchange",
    BKKT: "exchange", FLD: "exchange", CSHR: "exchange", BTM: "exchange",
    CRCL: "tech", CAN: "tech", SDEV: "tech", FIGR: "tech", ICG: "tech",
  },
  canada: {
    HUT: "miner", HIVE: "miner", BITF: "miner", DMGI: "miner", SATO: "miner", CBIT: "miner", NDA: "miner",
    LQWD: "treasury", BTCT: "treasury", MATA: "treasury", HODL: "treasury",
    BIGG: "exchange", WNDR: "exchange", GLXY: "exchange", DEFI: "exchange",
    MATE: "tech",
  },
  japan: { "3350": "treasury" },
  germany: { ADE: "exchange", NB2: "miner" },
  hongkong: { "863": "exchange", "1611": "exchange", "434": "treasury" },
  australia: { DCC: "exchange" },
  uk: { ARB: "miner", SATS: "treasury" },
};
// Zoekwoorden voor TradingView (deeltekst in de naam) en dezelfde set, met woordgrenzen, hier.
const TV_KEYWORDS = "bitcoin|crypto|blockchain|stablecoin|ethereum|solana|hyperliquid|digital asset|web3|tokeni|bitmine|bitdeer|bitfarms|hashrate|dogecoin|coinshares|coinbase|satoshi";
const NAME_RE = /\b(bitcoin|crypto\w*|blockchain|stablecoins?|ethereum|solana|hyperliquid|digital assets?|web3|tokeni[sz]\w*|bitmine|bitdeer|bitfarms|hashrate|dogecoin|coinshares|coinbase|satoshi)\b/i;
function categoryFromName(name: string): Cat {
  if (/\b(mining|miners?|hash\w*|bitdeer|bitfarms|data ?cent(er|re)s?|hpc)\b/i.test(name)) return "miner";
  if (/\b(treasury|reserve)\b/i.test(name)) return "treasury";
  if (/\b(exchange|brokerage|broker|wallet|coinbase|coinshares|trading platform|bitcoin group)\b/i.test(name)) return "exchange";
  return "tech";
}
const SPAC_RE = /\b(acquisition|spac)\b[^,]{0,40}\b(corp|corporation|company|co|ltd|limited|inc)\b|\bblank[- ]check\b/i;

// ── Wisselkoersen: ECB via xinix-advice, anders vaste waarden (USD per eenheid) ──
const FX_FALLBACK: Record<string, number> = {
  USD: 1, CAD: 0.73, AUD: 0.66, NZD: 0.6, GBP: 1.33, EUR: 1.12, CHF: 1.2, SEK: 0.105, NOK: 0.098, DKK: 0.15,
  PLN: 0.27, HKD: 0.128, JPY: 0.0068, SGD: 0.77, ZAR: 0.055, ILS: 0.27,
};
async function loadFx(sb: SB): Promise<(c: string | null | undefined) => number> {
  const fx: Record<string, number> = { ...FX_FALLBACK };
  const { data } = await sb.from("xinix_fx_rates").select("currency, per_eur");
  const perEur = new Map(((data ?? []) as Array<{ currency: string; per_eur: number }>).map((r) => [r.currency, Number(r.per_eur)]));
  const usd = perEur.get("USD");
  if (usd) {
    fx.EUR = usd;
    for (const [c, v] of perEur) if (v > 0) fx[c] = usd / v;
  }
  // Subeenheden: pence, Zuid-Afrikaanse en Israëlische centen.
  fx.GBX = fx.GBp = fx.GBP / 100;
  fx.ZAc = fx.ZAR / 100;
  fx.ILA = fx.ILS / 100;
  return (c) => (c ? fx[c] ?? fx[c.toUpperCase()] ?? 1 : 1);
}

// ── TradingView ─────────────────────────────────────────────────────────────
const COLS = ["name", "description", "close", "currency", "fundamental_currency_code", "Perf.W", "Perf.1M", "Perf.3M",
  "Perf.6M", "average_volume_30d_calc", "market_cap_basic", "price_52_week_high", "price_52_week_low", "exchange", "type", "subtype"];
interface TvHit {
  ticker: string; tv_symbol: string; market: string; exchange: string; name: string; currency: string | null; fcur: string | null;
  close: number | null; perf_w: number | null; perf_1m: number | null; perf_3m: number | null; perf_6m: number | null;
  avg_vol: number | null; mcap: number | null; hi52: number | null; lo52: number | null; curated: Cat | null;
}
async function tvScan(region: string, extra: Json): Promise<Array<{ s: string; d: unknown[] }>> {
  const m = MARKETS.find((x) => x.region === region)!;
  const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
    body: JSON.stringify({
      filter: [
        { left: "type", operation: "in_range", right: ["stock", "dr"] },
        { left: "is_primary", operation: "equal", right: true },
        { left: "exchange", operation: "in_range", right: Object.keys(m.ex) },
        extra,
      ],
      options: { lang: "en" },
      columns: COLS,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [0, 400],
    }),
  });
  if (!res.ok) throw new Error(`TradingView ${region} HTTP ${res.status}`);
  const j = (await res.json()) as { data?: Array<{ s: string; d: unknown[] }> };
  return j.data ?? [];
}
async function findCandidates(errors: string[]): Promise<{ hits: TvHit[]; failed: Set<string> }> {
  const out = new Map<string, TvHit>();
  const failed = new Set<string>();
  const jobs: Array<() => Promise<void>> = [];
  for (const m of MARKETS) {
    const cur = CURATED[m.region] ?? {};
    const add = (rows: Array<{ s: string; d: unknown[] }>) => {
      for (const { s, d } of rows) {
        const name = String(d[0] ?? ""), exchange = String(d[13] ?? "");
        const ticker = yahooSymbol(m.region, exchange, name);
        if (!ticker || out.has(ticker)) continue;
        if (/preferred|warrant|right|unit/i.test(String(d[15] ?? ""))) continue;
        const desc = String(d[1] ?? name);
        const curated = cur[name.toUpperCase()] ?? null;
        if (!curated && !NAME_RE.test(desc)) continue;
        out.set(ticker, {
          ticker, tv_symbol: s, market: m.region, exchange, name: desc, currency: (d[3] as string) || null, fcur: (d[4] as string) || null,
          close: num(d[2]), perf_w: num(d[5]), perf_1m: num(d[6]), perf_3m: num(d[7]), perf_6m: num(d[8]),
          avg_vol: num(d[9]), mcap: num(d[10]), hi52: num(d[11]), lo52: num(d[12]), curated,
        });
      }
    };
    const run = (extra: Json) => async () => {
      try { add(await tvScan(m.region, extra)); } catch (e) { failed.add(m.region); errors.push(msg(e)); }
    };
    jobs.push(run({ left: "description", operation: "match", right: TV_KEYWORDS }));
    if (Object.keys(cur).length) jobs.push(run({ left: "name", operation: "in_range", right: Object.keys(cur) }));
  }
  await pool(jobs, CONCURRENCY);
  return { hits: [...out.values()], failed };
}

// ── Yahoo: dagkoersen van tien jaar ──────────────────────────────────────────
interface Daily { ts: number[]; close: number[]; vol: number[] }
interface History {
  best_month_pct: number | null; best_month_end: string | null; months_400: number; last_400_end: string | null;
  hi5y: number | null; lo5y: number | null; last_close: number | null;
}
async function yahooDaily(ticker: string): Promise<Daily> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`,
    { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const r = ((await res.json()) as any)?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const close: Array<number | null> = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close ?? [];
  const vol: Array<number | null> = r?.indicators?.quote?.[0]?.volume ?? [];
  const w: Daily = { ts: [], close: [], vol: [] };
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (c == null || !(c > 0) || !Number.isFinite(c)) continue;
    w.ts.push(ts[i] * 1000); w.close.push(c); w.vol.push(Number(vol[i]) || 0);
  }
  if (!w.close.length) throw new Error(`Yahoo ${ticker}: geen koersen`);
  return w;
}
/** Een echte stijging van die omvang gaat met volume gepaard. Een reverse split die Yahoo niet
 *  verwerkt heeft lijkt op een sprong, maar dan worden er juist minder stukken verhandeld.
 *  Zonder volumedata krijgt het aandeel het voordeel van de twijfel. */
function volumeSpike(v: number[], lo: number, i: number): boolean {
  let base = 0, nb = 0, up = 0, nu = 0;
  for (let k = Math.max(0, lo - 20); k <= lo; k++) if (v[k] > 0) { base += v[k]; nb++; }
  for (let k = lo + 1; k <= i; k++) if (v[k] > 0) { up += v[k]; nu++; }
  if (nb < 5 || !nu) return true;
  return up / nu >= VOLUME_SPIKE * (base / nb);
}
/** Grootste stijging binnen een maand: slotkoers t.o.v. het laagste slot van de 21 handelsdagen ervoor.
 *  Een sprong van ≥ 40× op één dag is een eenheidsfout (pence/pond), geen koers: daar knipt de reeks.
 *  Een treffer van ≥ +400% telt niet als de dag erna alweer onder 2,5× dat dal staat (printfout);
 *  treffers die minder dan 40 handelsdagen uit elkaar liggen zijn één explosie. */
function analyzeHistory(w: Daily): History {
  const { ts, close: c, vol: v } = w;
  const n = c.length;
  const seg = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const q = c[i] / c[i - 1];
    seg[i] = seg[i - 1] + (q >= 40 || q <= 1 / 40 ? 1 : 0);
  }
  let best = 0, bestEnd: number | null = null, count = 0, lastHit = -Infinity, lastEnd: number | null = null;
  for (let i = 1; i < n; i++) {
    let lo = -1;
    for (let j = Math.max(0, i - MONTH_DAYS); j < i; j++) if (seg[j] === seg[i] && (lo < 0 || c[j] < c[lo])) lo = j;
    if (lo < 0) continue;
    const ratio = c[i] / c[lo];
    const hit = ratio >= MIN_MONTH_RATIO;
    if (!hit && ratio <= best) continue;
    if (ratio >= 2 && !volumeSpike(v, lo, i)) continue;
    if (hit) {
      if (i < n - 1 && seg[i + 1] === seg[i] && c[i + 1] < 2.5 * c[lo]) continue;
      if (i - lastHit > EPISODE_GAP) count++;
      lastHit = i;
      lastEnd = ts[i];
    }
    if (ratio > best) { best = ratio; bestEnd = ts[i]; }
  }
  const since5y = Date.now() - 5 * 365.25 * DAY;
  let hi5y: number | null = null, lo5y: number | null = null;
  for (let i = 0; i < n; i++) {
    if (ts[i] < since5y || seg[i] !== seg[n - 1]) continue;
    if (hi5y == null || c[i] > hi5y) hi5y = c[i];
    if (lo5y == null || c[i] < lo5y) lo5y = c[i];
  }
  const day = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
  return {
    best_month_pct: best > 0 ? r1((best - 1) * 100) : null, best_month_end: day(bestEnd), months_400: count,
    last_400_end: day(lastEnd), hi5y, lo5y, last_close: c[n - 1],
  };
}
const historyFromRow = (p: Json): History => ({
  best_month_pct: num(p.best_month_pct), best_month_end: (p.best_month_end as string) ?? null, months_400: Number(p.months_400 ?? 0),
  last_400_end: (p.last_400_end as string) ?? null, hi5y: num(p.hi5y), lo5y: num(p.lo5y), last_close: null,
});

// ── Yahoo: nieuws over een cryptostrategie ───────────────────────────────────
const SPAM = /\b(class action|investor alert|shareholder alert|law firm|securities fraud|investigation on behalf|reminds investors|lawsuit filed)\b/i;
const COINS = "bitcoins?|btc|ether(?:eum)?|eth|solana|sol|xrp|bnb|hyperliquid|dogecoin|doge|avax|sui|tron|trx|litecoin|ltc|ena|tao|tokens?";
const CRYPTO = `${COINS}|crypto(?:currenc(?:y|ies))?|digital[- ]assets?`;
// Eerste treffer telt; het gewicht zegt hoe direct het over een cryptostrategie gaat (keuze 4c).
const NEWS_KINDS: Array<[string, number, RegExp]> = [
  // "acquires 487 BTC", "buys additional 1,111 bitcoin", "adds $200 million worth of ETH", "completes bitcoin purchase"
  ["aankoop", 1, new RegExp(`\\b(?:acquir|purchas|buy|bought|add|accumulat)\\w*\\s+(?:(?:an? )?(?:additional|another|more|first|its first)\\s+)?(?:(?:us)?[$€£¥]?\\s?\\d[\\d,.]*\\s*(?:k|m|mn|million|billion|thousand)?\\s+(?:(?:worth )?(?:of|in)\\s+)?)?(?:${COINS})\\b|\\b(?:${COINS})\\s+(?:purchases?|buys?|acquisitions?)\\b`, "i")],
  ["schatkist", 1, new RegExp(`\\b(?:${CRYPTO})[- ](?:treasury|reserve)\\b|\\btreasury (?:strategy|company|vehicle|reserve asset)\\b`, "i")],
  ["financiering", 0.8, new RegExp(`\\b(?:private placement|pipe|registered direct|(?:public|equity|share|stock|atm|at-the-market) (?:offering|program|facility)|convertible (?:senior )?notes?|financing|(?:raises?|raised|secures?|secured)\\s+(?:us)?[$€£¥])[^.]{0,80}\\b(?:${CRYPTO}|treasury)\\b`, "i")],
  ["stablecoin", 0.8, /\bstablecoins?\b/i],
  ["token", 0.6, /\b(?:tokeni[sz]\w*|token (?:launch|sale|generation)|airdrop|staking|validators?|on-?chain|mainnet)\b/i],
  ["mining", 0.5, /\b(?:hash ?rate|exahash|eh\/s|mining (?:capacity|fleet|expansion|site|facility)|(?:purchases?|orders?|acquires?)\b[^.]{0,30}\bminers)\b/i],
];
const NEWS_WEIGHT: Record<string, number> = Object.fromEntries(NEWS_KINDS.map(([k, w]) => [k, w]));
// Rechtsvormen en woorden die in veel cryptokoppen staan: die maken een naam niet herkenbaar.
const LEGAL = new Set(["the", "inc", "corp", "corporation", "ltd", "limited", "plc", "holdings", "holding", "group", "co", "company", "sa", "nv", "ag", "se", "ab", "asa", "oyj", "llc", "lp"]);
const COMMON = new Set(["bitcoin", "crypto", "blockchain", "digital", "stablecoin", "stablecoins", "solana", "ethereum", "ether", "tron", "avax", "hyperliquid", "dogecoin", "defi", "web3", "token", "tokens", "strategy", "strategies", "treasury", "twenty", "first", "new", "global", "international", "technologies", "technology", "tech", "capital", "partners", "asset", "assets", "development", "platforms", "systems", "standard", "machine"]);
/** Het herkenbare deel van de bedrijfsnaam: het eerste woord, of de eerste twee als het eerste te kort of te algemeen is
 *  ("DeFi Development", "Hut 8", "Twenty One"); "Solana Company" en "Strategy" herken je alleen aan de ticker. */
function nameKey(company: string): RegExp | null {
  const w = company.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((x) => x && !LEGAL.has(x));
  let key: string | null = null;
  if (w[0] && !COMMON.has(w[0]) && (w[0].length >= 4 || (w.length === 1 && w[0].length === 3))) key = w[0];
  else if (w.length >= 2) key = `${w[0]} ${w[1]}`;
  return key ? new RegExp(`\\b${key}\\b`, "i") : null;
}
interface NewsItem { title: string; url: string | null; publisher: string | null; at: string; kind: string }
interface YahooNews { title: string; link?: string; publisher?: string; providerPublishTime?: number }
async function yahooNews(q: string): Promise<YahooNews[]> {
  const res = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=20&lang=en-US`,
    { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo nieuws ${q} HTTP ${res.status}`);
  const j = (await res.json()) as { news?: Array<Partial<YahooNews>> };
  return (j.news ?? []).filter((n): n is YahooNews => typeof n.title === "string" && n.title.length > 0);
}
/** De kop moet het bedrijf zelf noemen: cryptoberichten worden bij Yahoo aan veel aandelen tegelijk gekoppeld. */
function relevant(item: YahooNews, ticker: string, key: RegExp | null): boolean {
  const base = ticker.split(".")[0].toUpperCase();
  if (base.length >= 3 && /^[A-Z]+$/.test(base) && new RegExp(`\\b${base}\\b`).test(item.title)) return true;
  return !!key && key.test(item.title);
}
async function cryptoNews(ticker: string, company: string): Promise<NewsItem[]> {
  const since = Date.now() - 30 * DAY;
  const key = nameKey(company);
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const q of [ticker, company]) {
    for (const n of await yahooNews(q)) {
      const at = (n.providerPublishTime ?? 0) * 1000;
      if (at < since || seen.has(n.title) || SPAM.test(n.title) || !relevant(n, ticker, key)) continue;
      seen.add(n.title);
      const kind = NEWS_KINDS.find(([, , re]) => re.test(n.title));
      if (kind) out.push({ title: n.title.slice(0, 300), url: n.link ?? null, publisher: n.publisher ?? null, at: new Date(at).toISOString(), kind: kind[0] });
    }
    if (out.length >= 3) break;
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

// ── De formule ──────────────────────────────────────────────────────────────
const PHASE_PTS: Record<string, number> = { groot: 25, uitbraak: 22, vroeg: 18, comeback: 16, na_piek: 6, rustig: 3 };
function phaseOf(h: TvHit, hist: History): string {
  const p1 = h.perf_1m ?? 0, p3 = h.perf_3m ?? 0;
  const last = hist.last_close ?? h.close;
  if (p1 >= 100) return "groot";
  if (h.hi52 && h.close && h.close >= 0.97 * h.hi52 && p1 >= 15) return "uitbraak";
  if (hist.hi5y && last && h.lo52 && h.close && last <= 0.5 * hist.hi5y && h.close >= 1.5 * h.lo52 && p3 >= 30) return "comeback";
  if (p1 >= 30) return "vroeg";
  if (hist.last_400_end && Date.now() - Date.parse(hist.last_400_end) <= 120 * DAY && p1 < 0) return "na_piek";
  return "rustig";
}
/** Het zwaarste bericht telt voor 30, het tweede voor 12, het derde voor 8; ouder nieuws telt minder. */
function newsPoints(news: NewsItem[]): number {
  const w = news.map((n) => {
    const age = (Date.now() - Date.parse(n.at)) / DAY;
    return (NEWS_WEIGHT[n.kind] ?? 0) * (age <= 7 ? 1 : age <= 14 ? 0.75 : age <= 30 ? 0.5 : 0);
  }).sort((a, b) => b - a);
  return Math.min(50, Math.round(30 * (w[0] ?? 0) + 12 * (w[1] ?? 0) + 8 * (w[2] ?? 0)));
}
function explosionPoints(hist: History): number {
  if (!hist.last_400_end) return 0;
  const days = (Date.now() - Date.parse(hist.last_400_end)) / DAY;
  const p = days <= 90 ? 12 : days <= 365 ? 9 : days <= 1095 ? 6 : 4;
  return Math.min(15, p + (hist.months_400 >= 3 ? 3 : hist.months_400 === 2 ? 2 : 0));
}
const turnoverPoints = (dv: number) => (dv >= 50e6 ? 10 : dv >= 10e6 ? 8 : dv >= 3e6 ? 6 : 4);

async function pool(jobs: Array<() => Promise<void>>, size: number) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (i < jobs.length) await jobs[i++]();
  }));
}
async function fetchAllRows<T>(sb: SB, table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order("ticker").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}

// ── De wekelijkse scan ───────────────────────────────────────────────────────
interface WatchRow { ticker: string; company: string | null; crypto_cat: string | null; active: boolean }
async function scan(notify: boolean): Promise<RunResult> {
  const sb = getServiceClient();
  const t0 = Date.now();
  const overBudget = () => Date.now() - t0 > BUDGET_MS;
  const errors: string[] = [];
  const nowIso = new Date().toISOString();
  const fx = await loadFx(sb);
  const { hits, failed } = await findCandidates(errors);
  if (!hits.length) return { ok: false, message: `TradingView gaf niets terug; ${errors.slice(0, 3).join("; ")}` };

  const prev = new Map((await fetchAllRows<Json>(sb, "xinix_crypto_scan", "*")).map((r) => [String(r.ticker), r]));
  const watch = new Map((await fetchAllRows<WatchRow>(sb, "signal_tickers", "ticker, company, crypto_cat, active")).map((r) => [r.ticker.toUpperCase(), r]));

  const rows: Json[] = [];
  const jobs: Array<() => Promise<void>> = [];
  let histFetched = 0, newsFetched = 0;
  for (const h of hits) {
    const p = prev.get(h.ticker);
    const closeUsd = (h.close ?? 0) * fx(h.currency);
    const mcapUsd = h.mcap != null ? h.mcap * fx(h.fcur ?? h.currency) : null;
    const dollarVol = (h.avg_vol ?? 0) * closeUsd;
    // Elke rij krijgt alle kolommen: een upsert van meerdere rijen zet ontbrekende kolommen op null.
    const row: Json = {
      ticker: h.ticker, tv_symbol: h.tv_symbol, market: h.market, exchange: h.exchange, name: h.name, currency: h.currency,
      category: h.curated ?? categoryFromName(h.name), qualifies: false, reason: null, score: null,
      best_score: p?.best_score ?? null, phase: null, components: null, close: h.close,
      mcap_usd: mcapUsd != null ? Math.round(mcapUsd) : null, dollar_vol_usd: Math.round(dollarVol),
      perf_w: h.perf_w, perf_1m: h.perf_1m, perf_3m: h.perf_3m, perf_6m: h.perf_6m, hi52: h.hi52, lo52: h.lo52,
      hi5y: p?.hi5y ?? null, lo5y: p?.lo5y ?? null, best_month_pct: p?.best_month_pct ?? null, best_month_end: p?.best_month_end ?? null,
      months_400: p?.months_400 ?? null, last_400_end: p?.last_400_end ?? null, history_at: p?.history_at ?? null,
      news: p?.news ?? null, news_at: p?.news_at ?? null, in_watchlist: watch.get(h.ticker)?.active ?? false,
      first_seen_at: p?.first_seen_at ?? nowIso, last_seen_at: nowIso, notified_at: p?.notified_at ?? null,
    };
    rows.push(row);
    const spacLike = SPAC_RE.test(h.name) ||
      (closeUsd >= 9.5 && closeUsd <= 10.9 && !!h.hi52 && !!h.lo52 && h.hi52 / h.lo52 < 1.12 && Math.abs(h.perf_1m ?? 0) < 2);
    if (spacLike) row.reason = "SPAC zonder eigen bedrijf";
    else if (mcapUsd == null) row.reason = "beurswaarde onbekend";
    else if (mcapUsd < MIN_MCAP_USD) row.reason = `beurswaarde $${(mcapUsd / 1e6).toFixed(1)} mln (minder dan $20 mln)`;
    else if (dollarVol < MIN_DOLLAR_VOL_USD) row.reason = `omzet $${(dollarVol / 1e6).toFixed(2)} mln per dag (minder dan $1 mln)`;
    if (row.reason) continue;

    jobs.push(async () => {
      let hist: History | null = p?.history_at ? historyFromRow(p) : null;
      const stale = !hist || Date.now() - Date.parse(String(p!.history_at)) > HISTORY_MAX_AGE_DAYS * DAY;
      if (stale && !overBudget()) {
        try {
          hist = analyzeHistory(await yahooDaily(h.ticker));
          row.history_at = nowIso;
          histFetched++;
        } catch (e) {
          errors.push(msg(e));
        }
      }
      if (!hist) {
        row.reason = overBudget() ? "nog niet gemeten, volgt bij de volgende scan" : "geen koershistorie bij Yahoo";
        return;
      }
      Object.assign(row, {
        best_month_pct: hist.best_month_pct, best_month_end: hist.best_month_end, months_400: hist.months_400,
        last_400_end: hist.last_400_end, hi5y: hist.hi5y, lo5y: hist.lo5y,
      });
      if (!hist.months_400) {
        row.reason = `nooit +400% binnen een maand (beste: ${hist.best_month_pct != null ? `+${Math.round(hist.best_month_pct)}%` : "onbekend"})`;
        return;
      }
      let news = (p?.news as NewsItem[] | null) ?? [];
      const newsStale = !p?.news_at || Date.now() - Date.parse(String(p.news_at)) > NEWS_MAX_AGE_DAYS * DAY;
      if (newsStale && !overBudget()) {
        try {
          news = await cryptoNews(h.ticker, h.name);
          row.news = news;
          row.news_at = nowIso;
          newsFetched++;
        } catch (e) {
          errors.push(msg(e));
        }
      }
      const phase = phaseOf(h, hist);
      const components = { nieuws: newsPoints(news), fase: PHASE_PTS[phase], explosie: explosionPoints(hist), omzet: turnoverPoints(dollarVol) };
      const score = components.nieuws + components.fase + components.explosie + components.omzet;
      Object.assign(row, { qualifies: true, reason: null, score, phase, components, best_score: Math.max(score, num(p?.best_score) ?? 0) });
    });
  }
  await pool(jobs, CONCURRENCY);

  let writeErrors = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("xinix_crypto_scan").upsert(rows.slice(i, i + 200), { onConflict: "ticker" });
    if (error) { writeErrors++; errors.push(`opslaan: ${error.message}`); }
  }
  // Wat eerder gevonden werd en nu niet meer (en niet door een mislukte zoekopdracht), doet niet meer mee.
  const seenNow = new Set(rows.map((r) => String(r.ticker)));
  const gone = [...prev.values()].filter((r) => !seenNow.has(String(r.ticker)) && !failed.has(String(r.market))).map((r) => String(r.ticker));
  if (gone.length) {
    await sb.from("xinix_crypto_scan").update({ qualifies: false, reason: "niet meer gevonden bij TradingView" }).in("ticker", gone);
  }

  // Het rode CRYPTO-label op de watchlist: wat de scan vond (ook als het afviel) en crypto-woorden in de naam.
  const catByTicker = new Map(rows.map((r) => [String(r.ticker), r.category as Cat]));
  const toLabel = new Map<Cat, string[]>();
  for (const [t, w] of watch) {
    if (w.crypto_cat) continue;
    const cat = catByTicker.get(t) ?? (NAME_RE.test(w.company ?? "") ? categoryFromName(w.company ?? "") : null);
    if (cat) toLabel.set(cat, [...(toLabel.get(cat) ?? []), w.ticker]);
  }
  let labeled = 0;
  for (const [cat, list] of toLabel) {
    const { error } = await sb.from("signal_tickers").update({ crypto_cat: cat }).in("ticker", list).is("crypto_cat", null);
    if (error) errors.push(`label: ${error.message}`);
    else labeled += list.length;
  }

  // Melding bij nieuwe kandidaten met score ≥ 80 (keuze 8b); favorieten, gezien en gedempt slaan we over.
  let notified = 0;
  const fresh = notify && !writeErrors
    ? rows.filter((r) => r.qualifies && Number(r.score) >= ALERT_MIN_SCORE && !r.notified_at)
    : [];
  if (fresh.length) {
    const tickers = fresh.map((r) => String(r.ticker));
    const [{ data: favs }, { data: seen }, { data: settings }, { data: gate }] = await Promise.all([
      sb.from("xinix_favorites").select("ticker").in("ticker", tickers),
      sb.from("xinix_seen").select("ticker").in("ticker", tickers),
      sb.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).maybeSingle(),
      sb.rpc("xinix_notify_gate", { p_items: tickers.map((ticker) => ({ ticker, priority: 4 })) }),
    ]);
    const skip = new Set([...((favs ?? []) as Json[]), ...((seen ?? []) as Json[])].map((r) => String(r.ticker)));
    for (const g of (gate ?? []) as Array<{ ticker: string; allowed: boolean }>) if (!g.allowed) skip.add(g.ticker);
    const send = fresh.filter((r) => !skip.has(String(r.ticker))).sort((a, b) => Number(b.score) - Number(a.score));
    let sendError: string | null = null;
    if (send.length && settings?.ntfy_topic) {
      const PHASE_NL: Record<string, string> = { groot: "grote stijger", uitbraak: "uitbraak", comeback: "comeback", vroeg: "vroeg in de stijging", na_piek: "na de piek", rustig: "rustig" };
      const CAT_NL: Record<string, string> = { miner: "MINER", treasury: "SCHATKIST", exchange: "BEURS", tech: "TECH" };
      const lines = send.slice(0, 8).map((r) => {
        const n = (r.news as NewsItem[] | null)?.[0];
        const p1 = num(r.perf_1m);
        return [
          `🪙 ${String(r.ticker).replace(/\./g, `${ZWSP}.`)} · ${r.name} · ${CAT_NL[String(r.category)]} · score ${r.score}`,
          `   ${PHASE_NL[String(r.phase)]}${p1 != null ? ` · ${p1 >= 0 ? "+" : ""}${Math.round(p1)}% in een maand` : ""}`,
          n ? `   📰 ${n.title}` : "",
        ].filter(Boolean).join("\n");
      });
      if (send.length > 8) lines.push(`… en nog ${send.length - 8} in het crypto-tabblad.`);
      sendError = await publishNtfy(sb, String(settings.ntfy_server ?? "https://ntfy.sh"), {
        topic: settings.ntfy_topic,
        title: `${send.length} nieuwe crypto-kandida${send.length > 1 ? "ten" : "at"} (score ≥ ${ALERT_MIN_SCORE})`,
        message: lines.join("\n\n").slice(0, 3000), priority: 4, tags: ["coin"], click: TAB_URL,
        actions: [{ action: "view", label: "Crypto-tabblad", url: TAB_URL }],
      });
      if (sendError) errors.push(`melding: ${sendError}`);
      else {
        notified = send.length;
        await sb.rpc("xinix_notify_record", { p_items: send.map((r) => ({ ticker: r.ticker, source: "crypto-scan", alert_key: "crypto_newcomer", priority: 4 })) });
      }
    }
    // Ook wie overgeslagen is telt als gemeld, anders komt hij elke week terug.
    if (!sendError) await sb.from("xinix_crypto_scan").update({ notified_at: nowIso }).in("ticker", tickers);
  }

  const qualifying = rows.filter((r) => r.qualifies).length;
  return {
    ok: errors.length === 0 || (writeErrors === 0 && qualifying > 0 && errors.length < hits.length / 10),
    message: `${hits.length} crypto-aandelen gevonden, ${qualifying} doen mee, ${rows.length - qualifying} vallen af; ` +
      `${histFetched} koershistories en ${newsFetched} nieuwszoekopdrachten opgehaald, ${labeled} nieuwe CRYPTO-labels, ${notified} gemeld` +
      (errors.length ? `; ${errors.length} fouten, o.a. ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { found: hits.length, qualifying, excluded: rows.length - qualifying, history_fetched: histFetched, news_fetched: newsFetched, labeled, notified, errors: errors.length, seconds: Math.round((Date.now() - t0) / 1000) },
  };
}

// ── Lezen en overnemen ───────────────────────────────────────────────────────
async function read(req: Request, sb: SB, url: URL): Promise<Response> {
  if (url.searchParams.get("labels")) {
    const [tk, sc] = await Promise.all([
      sb.from("signal_tickers").select("ticker, crypto_cat").not("crypto_cat", "is", null).limit(5000),
      sb.from("xinix_crypto_scan").select("ticker, category").limit(5000),
    ]);
    if (tk.error) return textResponse(req, tk.error.message, { status: 500 });
    const labels: Record<string, string> = {};
    for (const r of (sc.data ?? []) as Array<{ ticker: string; category: string | null }>) if (r.category) labels[r.ticker] = r.category;
    for (const r of (tk.data ?? []) as Array<{ ticker: string; crypto_cat: string }>) labels[r.ticker] = r.crypto_cat;
    return jsonResponse(req, { labels });
  }
  const [{ data: rows, error }, { data: run }] = await Promise.all([
    sb.from("xinix_crypto_scan").select("*").order("score", { ascending: false, nullsFirst: false }).limit(2000),
    sb.from("signal_runs").select("started_at, finished_at, ok, message").eq("job", "xinix-crypto").order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return textResponse(req, error.message, { status: 500 });
  const all = (rows ?? []) as Json[];
  const qualifying = all.filter((r) => r.qualifies);
  const tickers = qualifying.map((r) => String(r.ticker));
  const { data: wl } = tickers.length
    ? await sb.from("signal_tickers").select("ticker, active, no_sim").in("ticker", tickers)
    : { data: [] };
  const wlBy = new Map(((wl ?? []) as Array<{ ticker: string; active: boolean; no_sim: boolean }>).map((r) => [r.ticker, r]));
  return jsonResponse(req, {
    rows: qualifying.map((r) => ({ ...r, in_watchlist: wlBy.get(String(r.ticker))?.active ?? false, no_sim: wlBy.get(String(r.ticker))?.no_sim ?? false })),
    excluded: all.filter((r) => !r.qualifies).map((r) => ({
      ticker: r.ticker, name: r.name, market: r.market, category: r.category, reason: r.reason,
      best_month_pct: r.best_month_pct, mcap_usd: r.mcap_usd, dollar_vol_usd: r.dollar_vol_usd,
    })),
    last_run: run ?? null,
  });
}

/** Hartje in het crypto-tabblad (keuze 7a+c): op de watchlist, met label, maar buiten het Potje en het Dagadvies. */
async function adopt(req: Request, sb: SB): Promise<Response> {
  let body: Json = {};
  try { body = (await req.json()) as Json; } catch { return textResponse(req, "Invalid JSON body", { status: 400 }); }
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  if (!ticker) return textResponse(req, "Missing ticker", { status: 400 });
  if (body.action !== "adopt") return textResponse(req, "action moet adopt zijn", { status: 400 });

  const [{ data: row }, { data: existing }] = await Promise.all([
    sb.from("xinix_crypto_scan").select("name, market, exchange, category").eq("ticker", ticker).maybeSingle(),
    sb.from("signal_tickers").select("ticker, crypto_cat").eq("ticker", ticker).maybeSingle(),
  ]);
  const cat = (row?.category as Cat | undefined) ?? null;
  if (existing) {
    const { error } = await sb.from("signal_tickers")
      .update({ active: true, no_sim: true, ...(existing.crypto_cat || !cat ? {} : { crypto_cat: cat }) }).eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
  } else {
    if (!row) return textResponse(req, "Onbekend in het crypto-tabblad", { status: 404 });
    const { error } = await sb.from("signal_tickers").insert({
      ticker, company: String(row.name ?? ticker), exchange: YAHOO_EXCHANGE[`${row.market}:${row.exchange}`] ?? row.exchange,
      sector: "other", active: true, crypto_cat: cat, no_sim: true,
      notes: `Toegevoegd via het crypto-tabblad (${new Date().toISOString().slice(0, 10)}); doet niet mee in het Potje en het Dagadvies.`,
    });
    if (error) return textResponse(req, error.message, { status: 500 });
  }
  await sb.from("xinix_crypto_scan").update({ in_watchlist: true }).eq("ticker", ticker);
  return jsonResponse(req, { ok: true, ticker, added: !existing });
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  const url = new URL(req.url);

  if (url.searchParams.get("mode") === "scan") {
    if (!checkAdminOrCron(req)) return textResponse(req, "Unauthorized", { status: 401 });
    try {
      const r = await logRun("xinix-crypto", () => scan(url.searchParams.get("notify") !== "0"));
      return jsonResponse(req, r, { status: r.ok ? 200 : 500 });
    } catch (e) {
      return jsonResponse(req, { ok: false, message: msg(e) }, { status: 500 });
    }
  }

  const sb = getServiceClient();
  if (req.method === "GET") return read(req, sb, url);
  if (req.method !== "POST") return textResponse(req, "Method not allowed", { status: 405 });
  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  return adopt(req, sb);
});
