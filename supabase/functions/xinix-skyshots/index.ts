// xinix-skyshots — Favorieten → 🌠 Skyshots: welke aandelen schieten het vaakst binnen één handelsdag
// minstens +80% omhoog (keuzes van de gebruiker op 2026-10-22, zie migratie 2026-10-22_xinix_skyshots.sql).
//
// GET                                         → { rows, last_run, progress }  (het tabblad)
// GET ?counts=1                               → { counts: { TICKER: n } }: getelde skyshots ≥ +80% in 12 maanden
// POST { ticker, day, action }                → "reject" (telt niet) of "restore" (beheertoken)
// POST ?mode=scan[&limit=N][&ticker=X][&dry=1] → een portie van de wekelijkse scan (cron of beheertoken)
//
// Skyshot = een handelsdag waarop de hoogste koers minstens +80% boven het slot van de handelsdag ervoor
// lag (drie jaar dagkoersen van Yahoo). Alles vanaf +50% wordt bewaard, zodat het tabblad de drempel kan
// kiezen. Zo'n dag telt niet als hij een eenheidsfout is (≥ 40×), er niet gehandeld werd, de stijging uit
// minder dan 10 koersstapjes bestond (Martello: $0,005 → $0,01), het volume onder 2× de mediaan van de
// 20 handelsdagen ervoor bleef, of TradingView die stijging niet laat zien. De gebruiker kan een dag ook
// zelf afkeuren.

import { getServiceClient, logRun, type Json, type RunResult } from "../_shared/supabase.ts";
import { checkAuth, checkAdminOrCron } from "../_shared/auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "../_shared/cors.ts";
import { normaliseerEenheid, pasSplitsToe, type KoersBar, type Split } from "../_shared/units.ts";
import { TvClient, type TvHistory } from "./tv.ts";

type SB = ReturnType<typeof getServiceClient>;
type Reason = "eenheid" | "geen_handel" | "tick" | "volume" | "tradingview";
type TvStatus = "ok" | "afwijkend" | "onbekend";

const MIN_PCT = 50;              // wat bewaard wordt; het tabblad kiest 50, 80, 100 of 200
const COUNT_PCT = 80;            // de standaarddrempel (kolom in de favorietenlijst)
const UNIT_JUMP = 40;            // ≥ 40× op één dag is een eenheidsfout (pence/pond), geen koers
const MIN_TICKS = 10;            // keuze 2a
const TICK_WINDOW = 60;          // handelsdagen waaruit het koersstapje wordt afgeleid
const VOL_WINDOW = 20;           // keuze 3b: mediaan van de 20 handelsdagen ervoor
const VOL_MULT = 2;
const TV_BARS = 800;             // ruim drie jaar
const MAX_TRIES = 3;             // daarna telt een aandeel als gemeten, met de foutmelding erbij
const DEFAULT_LIMIT = 100;       // aandelen per run (cron elke 10 minuten op zaterdag)
const WORKERS = 3;
const BUDGET_MS = 100_000;       // ruim binnen de wandklok van een edge function
const DAY = 86_400_000;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r1 = (x: number) => Math.round(x * 10) / 10;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function localDay(tz: string | null | undefined): (ms: number) => string {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return (ms) => f.format(new Date(ms));
}

/** Zaterdag 00:00 UTC van deze week: wat daarvoor gemeten is, komt opnieuw aan de beurt. */
function weekStart(now = Date.now()): string {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(midnight - ((d.getUTCDay() + 1) % 7) * DAY).toISOString();
}

// deno-lint-ignore no-explicit-any
async function fetchAll<T>(sb: SB, table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    // deno-lint-ignore no-explicit-any
    let q: any = sb.from(table).select(cols).order("ticker").range(from, from + 999);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) return out;
  }
}
async function chunkedIn<T>(sb: SB, table: string, cols: string, tickers: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tickers.length; i += 200) {
    const { data, error } = await sb.from(table).select(cols).in("ticker", tickers.slice(i, i + 200));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

// ── Yahoo: drie jaar dagkoersen ──────────────────────────────────────────────
interface Bar { day: string; o: number; h: number; l: number; c: number; v: number }
class YahooMissing extends Error {}

async function yahooBars(ticker: string, ref: number | null): Promise<{ bars: Bar[]; currency: string | null; tz: string }> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3y&interval=1d&events=splits`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (res.status === 404) throw new YahooMissing("Yahoo kent dit aandeel niet");
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const r = ((await res.json()) as any)?.chart?.result?.[0];
  if (!r) throw new YahooMissing("Yahoo gaf geen koersen");
  const tz = typeof r.meta?.exchangeTimezoneName === "string" ? r.meta.exchangeTimezoneName : "UTC";
  const toDay = localDay(tz);
  const q = r.indicators?.quote?.[0] ?? {};
  const ts: number[] = r.timestamp ?? [];
  const byDay = new Map<string, Bar>();
  for (let i = 0; i < ts.length; i++) {
    const o = num(q.open?.[i]), h = num(q.high?.[i]), l = num(q.low?.[i]), c = num(q.close?.[i]);
    if (o == null || h == null || l == null || c == null || !(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    const day = toDay(ts[i] * 1000);
    byDay.set(day, { day, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: num(q.volume?.[i]) ?? 0 });
  }
  const bars = [...byDay.values()];
  if (bars.length < 2) throw new YahooMissing("Yahoo gaf te weinig koersen");

  // Splits die Yahoo meldt maar nog niet verwerkt heeft, en pence/pond-wissels in Londen: de factor
  // volgt uit het slot en geldt voor de hele dag.
  const kb: KoersBar[] = bars.map((b) => ({ date: b.day, close: b.c }));
  // deno-lint-ignore no-explicit-any
  const splits: Split[] = Object.values((r.events?.splits ?? {}) as Record<string, any>).map((s) => ({
    date: toDay(Number(s.date) * 1000), numerator: Number(s.numerator), denominator: Number(s.denominator),
  }));
  pasSplitsToe(kb, splits);
  const currency = normaliseerEenheid(ticker, kb, typeof r.meta?.currency === "string" ? r.meta.currency : null, ref);
  for (let i = 0; i < bars.length; i++) {
    const f = (kb[i].close ?? bars[i].c) / bars[i].c;
    if (Math.abs(f - 1) > 1e-9) {
      const b = bars[i];
      b.o *= f;
      b.h *= f;
      b.l *= f;
      b.c *= f;
    }
  }
  return { bars, currency, tz };
}

// ── Kandidaten: dagen met een top ≥ +50% boven het vorige slot ─────────────────
interface Cand {
  day: string; prev_close: number; open: number; high: number; low: number; close: number; volume: number;
  pct: number; close_pct: number; ticks: number | null; vol_ratio: number | null; reason: Reason | null;
  after_1d: number | null; after_5d: number | null; after_20d: number | null;
  tv_pct: number | null; tv_status: TvStatus | null;
}

const sig = (x: number) => Number(x.toPrecision(6));
/** Het kleinste koersstapje rond die dag, afgeleid uit de koersen zelf. Werkt ook voor oude koersen
 *  die Yahoo voor een samenvoeging heeft omgerekend (dan is het stapje mee vergroot). */
function localTick(b: Bar[], i: number): number | null {
  const ps: number[] = [];
  for (let k = Math.max(0, i - TICK_WINDOW); k <= i; k++) ps.push(sig(b[k].o), sig(b[k].h), sig(b[k].l), sig(b[k].c));
  ps.sort((a, z) => a - z);
  let tick = Infinity;
  for (let k = 1; k < ps.length; k++) {
    const d = ps[k] - ps[k - 1];
    if (d > 0 && d < tick) tick = d;
  }
  return Number.isFinite(tick) ? tick : null;
}
function medianVolume(b: Bar[], i: number): number | null {
  const vs: number[] = [];
  for (let k = Math.max(0, i - VOL_WINDOW); k < i; k++) vs.push(b[k].v);
  if (vs.length < 5) return null;
  vs.sort((a, z) => a - z);
  const m = vs.length >> 1;
  return vs.length % 2 ? vs[m] : (vs[m - 1] + vs[m]) / 2;
}

function findCandidates(b: Bar[]): Cand[] {
  const out: Cand[] = [];
  for (let i = 1; i < b.length; i++) {
    const pc = b[i - 1].c, x = b[i];
    const ratio = x.h / pc;
    if (!(ratio >= 1 + MIN_PCT / 100)) continue;
    const tick = localTick(b, i);
    const ticks = tick ? (x.h - pc) / tick : null;
    const med = medianVolume(b, i);
    let reason: Reason | null = null;
    if (ratio >= UNIT_JUMP) reason = "eenheid";
    else if (!(x.v > 0)) reason = "geen_handel";
    else if (ticks != null && ticks < MIN_TICKS) reason = "tick";
    else if (med != null && x.v < VOL_MULT * med) reason = "volume";
    const after = (k: number) => (i + k < b.length ? r1((b[i + k].c / x.c - 1) * 100) : null);
    out.push({
      day: x.day, prev_close: pc, open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v,
      pct: r1((ratio - 1) * 100), close_pct: r1((x.c / pc - 1) * 100),
      ticks: ticks == null ? null : Math.round(ticks), vol_ratio: med != null && med > 0 ? r1(x.v / med) : null,
      reason, after_1d: after(1), after_5d: after(5), after_20d: after(20), tv_pct: null, tv_status: null,
    });
  }
  return out;
}

/** Keuze 3c: laat TradingView op dezelfde handelsdag ook minstens +50% zien? De hoogste van de twee
 *  bronnen telt niet: in het tabblad geldt de laagste, zodat beide de gekozen drempel moeten halen. */
function checkTradingView(cands: Cand[], hist: TvHistory | null, tz: string) {
  const todo = cands.filter((c) => c.reason == null);
  if (!hist || hist.bars.length < 2) {
    for (const c of todo) c.tv_status = "onbekend";
    return;
  }
  const toDay = localDay(hist.timezone ?? tz);
  const days = hist.bars.map((b) => toDay(b.t * 1000));
  const at = new Map(days.map((d, i) => [d, i]));
  const pctAt = (i: number) => (i >= 1 && i < hist.bars.length ? (hist.bars[i].h / hist.bars[i - 1].c - 1) * 100 : null);
  for (const c of todo) {
    if (c.day <= days[0] || c.day > days[days.length - 1]) {
      c.tv_status = "onbekend";
      continue;
    }
    let p: number | null;
    const i = at.get(c.day);
    if (i != null) p = pctAt(i);
    else {
      // Geen koers op precies die dag (een gat of een andere feestdag): de handelsdag ervoor en erna.
      const j = days.findIndex((d) => d > c.day);
      const around = [pctAt(j - 1), pctAt(j)].filter((x): x is number => x != null);
      p = around.length ? Math.max(...around) : null;
    }
    c.tv_pct = p == null ? null : r1(p);
    c.tv_status = p != null && p >= MIN_PCT ? "ok" : "afwijkend";
    if (c.tv_status === "afwijkend") c.reason = "tradingview";
  }
}

// ── TradingView-symbool bij een Yahoo-ticker ─────────────────────────────────
const TV_EXCHANGE: Record<string, string> = {
  TO: "TSX", V: "TSXV", CN: "CSE", NE: "NEO", L: "LSE", IL: "LSE", DE: "XETR", F: "FWB", PA: "EURONEXT",
  AS: "EURONEXT", BR: "EURONEXT", LS: "EURONEXT", IR: "EURONEXT", MI: "MIL", MC: "BME", WA: "GPW", SW: "SIX",
  ST: "OMXSTO", OL: "OSL", CO: "OMXCOP", HE: "OMXHEX", AX: "ASX", HK: "HKEX", T: "TSE", SI: "SGX", JO: "JSE",
  KS: "KRX", KQ: "KRX", SS: "SSE", SZ: "SZSE", KL: "MYX", TA: "TASE", NZ: "NZX",
};
function tvSymbols(ticker: string, exchange: string | null, known: Array<string | null | undefined>): string[] {
  const out = new Set<string>(known.filter((s): s is string => !!s));
  const dot = ticker.lastIndexOf(".");
  if (dot > 0) {
    const sfx = ticker.slice(dot + 1).toUpperCase();
    const ex = TV_EXCHANGE[sfx];
    if (!ex) return [...out];
    let base = ticker.slice(0, dot);
    if (sfx === "HK" && /^\d+$/.test(base)) base = String(Number(base));
    out.add(`${ex}:${base.replace(/-/g, ".")}`);
    out.add(`${ex}:${base.replace(/-/g, "_")}`);
    return [...out];
  }
  const e = (exchange ?? "").toLowerCase();
  const first = e.includes("otc") || e.includes("pink") ? "OTC" : e.includes("nasdaq") ? "NASDAQ"
    : e.includes("american") || e.includes("amex") || e.includes("arca") ? "AMEX" : e.includes("nyse") ? "NYSE"
    : e.includes("cboe") ? "CBOE" : null;
  const sym = ticker.replace(/-/g, ".");
  for (const ex of [first, "NASDAQ", "NYSE", "AMEX", "OTC"]) if (ex) out.add(`${ex}:${sym}`);
  return [...out];
}

// ── De wekelijkse scan ───────────────────────────────────────────────────────
interface ScanOpts { limit: number; ticker: string | null; dry: boolean }
interface Ctx {
  exchange: Map<string, string | null>;
  uniTv: Map<string, string | null>;
  ref: Map<string, number | null>;
  state: Map<string, { tv_symbol: string | null; tries: number }>;
}
interface Outcome { candidates: number; counted: number; tvChecked: boolean; tvUnknown: boolean; retry?: string; missing?: string; dry?: Json }

async function scanOne(sb: SB, tv: TvClient, ticker: string, ctx: Ctx, dry: boolean): Promise<Outcome> {
  const st = ctx.state.get(ticker) ?? { tv_symbol: null, tries: 0 };
  const nowIso = new Date().toISOString();
  const giveUp = st.tries + 1 >= MAX_TRIES;
  const fail = async (error: string): Promise<Outcome> => {
    if (!dry) {
      await sb.from("xinix_skyshot_tickers").update(
        giveUp ? { scanned_at: nowIso, claimed_at: null, tries: 0, error } : { tries: st.tries + 1, error },
      ).eq("ticker", ticker);
    }
    return { candidates: 0, counted: 0, tvChecked: false, tvUnknown: false, retry: giveUp ? undefined : error };
  };

  let y: Awaited<ReturnType<typeof yahooBars>>;
  try {
    y = await yahooBars(ticker, ctx.ref.get(ticker) ?? null);
  } catch (e) {
    if (e instanceof YahooMissing) {
      if (!dry) {
        await sb.from("xinix_skyshot_tickers").update({ scanned_at: nowIso, claimed_at: null, tries: 0, error: e.message }).eq("ticker", ticker);
      }
      return { candidates: 0, counted: 0, tvChecked: false, tvUnknown: false, missing: e.message };
    }
    return fail(msg(e));
  }

  const cands = findCandidates(y.bars);
  let tvSymbol: string | null = null;
  let tvNote: string | null = null;
  if (cands.some((c) => c.reason == null)) {
    let hist: TvHistory | null = null;
    try {
      for (const s of tvSymbols(ticker, ctx.exchange.get(ticker) ?? null, [st.tv_symbol, ctx.uniTv.get(ticker)])) {
        const h = await tv.daily(s, TV_BARS);
        if (h && h.bars.length) {
          hist = h;
          tvSymbol = s;
          break;
        }
      }
    } catch (e) {
      if (!giveUp) return fail(`TradingView: ${msg(e)}`);
      tvNote = `TradingView: ${msg(e)}`;
      hist = null;
    }
    if (!hist && !tvNote) tvNote = "TradingView kent dit aandeel niet";
    checkTradingView(cands, hist, y.tz);
  }

  const counted = cands.filter((c) => c.reason == null && Math.min(c.pct, c.tv_status === "ok" ? c.tv_pct ?? c.pct : c.pct) >= COUNT_PCT).length;
  const outcome: Outcome = {
    candidates: cands.length, counted, tvChecked: tvSymbol != null, tvUnknown: cands.some((c) => c.tv_status === "onbekend"),
  };
  if (dry) {
    outcome.dry = { ticker, tv_symbol: tvSymbol, tv_note: tvNote, currency: y.currency, tz: y.tz, bars: y.bars.length, first: y.bars[0]?.day, cands } as unknown as Json;
    return outcome;
  }

  if (cands.length) {
    const { error } = await sb.from("xinix_skyshots").upsert(
      cands.map((c) => ({ ticker, ...c, updated_at: nowIso })),
      { onConflict: "ticker,day" },
    );
    if (error) throw new Error(`opslaan ${ticker}: ${error.message}`);
  }
  // Dagen die bij deze meting niet meer opduiken (Yahoo heeft de koers gecorrigeerd) verdwijnen.
  const keep = cands.map((c) => c.day);
  let del = sb.from("xinix_skyshots").delete().eq("ticker", ticker);
  if (keep.length) del = del.not("day", "in", `(${keep.join(",")})`);
  const { error: delError } = await del;
  if (delError) throw new Error(`opruimen ${ticker}: ${delError.message}`);

  const { error: stError } = await sb.from("xinix_skyshot_tickers").update({
    tv_symbol: tvSymbol ?? st.tv_symbol, currency: y.currency, bars: y.bars.length, first_day: y.bars[0].day,
    candidates: cands.length, scanned_at: nowIso, claimed_at: null, tries: 0, error: tvNote,
  }).eq("ticker", ticker);
  if (stError) throw new Error(`status ${ticker}: ${stError.message}`);
  return outcome;
}

async function scan(opts: ScanOpts): Promise<RunResult & { results?: Json[] }> {
  const sb = getServiceClient();
  const t0 = Date.now();
  const since = weekStart();
  let tickers: string[];
  if (opts.ticker) {
    tickers = [opts.ticker];
    if (!opts.dry) await sb.from("xinix_skyshot_tickers").upsert({ ticker: opts.ticker, claimed_at: new Date().toISOString() }, { onConflict: "ticker" });
  } else {
    const { data, error } = await sb.rpc("xinix_skyshot_claim", { p_n: opts.limit, p_since: since });
    if (error) throw new Error(`claim: ${error.message}`);
    tickers = ((data ?? []) as Array<{ claimed_ticker: string }>).map((r) => r.claimed_ticker);
  }
  if (!tickers.length) return { ok: true, message: "Alles is deze week al gemeten", metrics: { scanned: 0 } };

  const [meta, uni, ps, state] = await Promise.all([
    chunkedIn<Json>(sb, "signal_tickers", "ticker, exchange", tickers),
    chunkedIn<Json>(sb, "xinix_universe", "ticker, tv_symbol", tickers),
    chunkedIn<Json>(sb, "signal_price_summary", "ticker, last_close", tickers),
    chunkedIn<Json>(sb, "xinix_skyshot_tickers", "ticker, tv_symbol, tries", tickers),
  ]);
  const ctx: Ctx = {
    exchange: new Map(meta.map((r) => [String(r.ticker), (r.exchange as string) ?? null])),
    uniTv: new Map(uni.map((r) => [String(r.ticker), (r.tv_symbol as string) ?? null])),
    ref: new Map(ps.map((r) => [String(r.ticker), num(r.last_close)])),
    state: new Map(state.map((r) => [String(r.ticker), { tv_symbol: (r.tv_symbol as string) ?? null, tries: Number(r.tries ?? 0) }])),
  };

  const queue = [...tickers];
  const m = { scanned: 0, candidates: 0, counted: 0, tv_checked: 0, tv_unknown: 0, missing: 0, retry: 0, errors: 0 };
  const errors: string[] = [];
  const results: Json[] = [];
  const worker = async () => {
    const tv = new TvClient();
    try {
      while (queue.length && Date.now() - t0 < BUDGET_MS) {
        const ticker = queue.shift()!;
        try {
          const o = await scanOne(sb, tv, ticker, ctx, opts.dry);
          if (o.dry) results.push(o.dry);
          if (o.retry) {
            m.retry++;
            errors.push(`${ticker}: ${o.retry}`);
            continue;
          }
          m.scanned++;
          m.candidates += o.candidates;
          m.counted += o.counted;
          if (o.tvChecked) m.tv_checked++;
          if (o.tvUnknown) m.tv_unknown++;
          if (o.missing) m.missing++;
        } catch (e) {
          m.errors++;
          errors.push(`${ticker}: ${msg(e)}`);
        }
      }
    } finally {
      tv.close();
    }
  };
  await Promise.all(Array.from({ length: Math.min(WORKERS, tickers.length) }, worker));

  const [{ count: done }, { count: pool }] = await Promise.all([
    sb.from("xinix_skyshot_tickers").select("ticker", { count: "exact", head: true }).gte("scanned_at", since),
    sb.from("signal_tickers").select("ticker", { count: "exact", head: true }).eq("active", true),
  ]);
  const left = Math.max(0, (pool ?? 0) - (done ?? 0));
  return {
    ok: m.errors === 0 || m.scanned > 0,
    message: `${m.scanned} aandelen gemeten (nog ${left} te gaan deze week), ${m.counted} skyshots ≥ +${COUNT_PCT}% die meetellen, ` +
      `${m.tv_checked} bij TradingView gecontroleerd` +
      (m.retry ? `, ${m.retry} later opnieuw` : "") + (m.missing ? `, ${m.missing} onbekend bij Yahoo` : "") +
      (errors.length ? `; o.a. ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { ...m, left, unclaimed: queue.length, seconds: Math.round((Date.now() - t0) / 1000) },
    ...(opts.dry ? { results } : {}),
  };
}

// ── Lezen en afkeuren ────────────────────────────────────────────────────────
interface Row {
  ticker: string; day: string; pct: number; close_pct: number | null; tv_pct: number | null; tv_status: TvStatus | null;
  reason: Reason | null; rejected_at: string | null; ticks: number | null; vol_ratio: number | null;
  after_1d: number | null; after_5d: number | null; after_20d: number | null;
}
const effective = (r: Pick<Row, "pct" | "tv_pct" | "tv_status">) =>
  r.tv_status === "ok" && r.tv_pct != null ? Math.min(Number(r.pct), Number(r.tv_pct)) : Number(r.pct);

async function read(req: Request, sb: SB, url: URL): Promise<Response> {
  if (url.searchParams.get("counts")) {
    const rows = await fetchAll<Row>(sb, "xinix_skyshots", "ticker, day, pct, tv_pct, tv_status",
      (q) => q.gte("day", isoDay(Date.now() - 365 * DAY)).gte("pct", COUNT_PCT).is("reason", null).is("rejected_at", null));
    const counts: Record<string, number> = {};
    for (const r of rows) if (effective(r) >= COUNT_PCT) counts[r.ticker] = (counts[r.ticker] ?? 0) + 1;
    return jsonResponse(req, { counts, threshold: COUNT_PCT }, { headers: { "cache-control": "public, max-age=300" } });
  }

  const since = weekStart();
  const [rows, runRes, doneRes, poolRes] = await Promise.all([
    fetchAll<Row>(sb, "xinix_skyshots",
      "ticker, day, pct, close_pct, tv_pct, tv_status, reason, rejected_at, ticks, vol_ratio, after_1d, after_5d, after_20d"),
    sb.from("signal_runs").select("started_at, finished_at, ok, message").eq("job", "xinix-skyshots").order("id", { ascending: false }).limit(1).maybeSingle(),
    sb.from("xinix_skyshot_tickers").select("ticker", { count: "exact", head: true }).gte("scanned_at", since),
    sb.from("signal_tickers").select("ticker", { count: "exact", head: true }).eq("active", true),
  ]);
  const tickers = [...new Set(rows.map((r) => r.ticker))];
  const [meta, ps, favs, st] = await Promise.all([
    chunkedIn<Json>(sb, "signal_tickers", "ticker, company, exchange, sector, active, buy_limit, price_currency", tickers),
    chunkedIn<Json>(sb, "signal_price_summary", "ticker, last_close, updated_at", tickers),
    chunkedIn<Json>(sb, "xinix_favorites", "ticker", tickers),
    chunkedIn<Json>(sb, "xinix_skyshot_tickers", "ticker, currency, error", tickers),
  ]);
  const metaBy = new Map(meta.map((r) => [String(r.ticker), r]));
  const psBy = new Map(ps.map((r) => [String(r.ticker), r]));
  const stBy = new Map(st.map((r) => [String(r.ticker), r]));
  const fav = new Set(favs.map((r) => String(r.ticker)));
  const byTicker = new Map<string, Row[]>();
  for (const r of rows) (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);

  const out: Json[] = [];
  for (const [ticker, days] of byTicker) {
    const t = metaBy.get(ticker);
    // Alleen wat nog op de watchlist staat of een hartje heeft.
    if (!t || (!t.active && !fav.has(ticker))) continue;
    const p = psBy.get(ticker), s = stBy.get(ticker);
    out.push({
      ticker, company: t.company ?? ticker, exchange: t.exchange ?? null, sector: t.sector ?? null,
      currency: (s?.currency as string) ?? (t.price_currency as string) ?? null,
      last_close: num(p?.last_close), price_at: p?.updated_at ?? null, buy_limit: num(t.buy_limit), note: s?.error ?? null,
      days: days.sort((a, b) => b.day.localeCompare(a.day)).map(compactDay),
    });
  }
  return jsonResponse(req, {
    rows: out,
    last_run: runRes.data ?? null,
    progress: { week_start: since, scanned: doneRes.count ?? 0, pool: poolRes.count ?? 0 },
  }, { headers: { "cache-control": "public, max-age=300" } });
}

/** Eén dag met korte sleutels en zonder lege velden: het hele tabblad is anders ruim 1 MB. */
function compactDay(d: Row): Json {
  const out: Json = { d: d.day, p: num(d.pct) };
  const add = (k: string, v: unknown) => {
    if (v != null && v !== false) out[k] = v;
  };
  add("t", num(d.tv_pct));
  add("s", d.tv_status);
  add("c", num(d.close_pct));
  add("r", d.reason);
  add("x", d.rejected_at != null);
  add("k", num(d.ticks));
  add("v", num(d.vol_ratio));
  add("a1", num(d.after_1d));
  add("a5", num(d.after_5d));
  add("a20", num(d.after_20d));
  return out;
}

/** Keuze 3e: de gebruiker keurt een skyshot af ("telt niet") of zet hem terug. */
async function mark(req: Request, sb: SB): Promise<Response> {
  let body: Json = {};
  try {
    body = (await req.json()) as Json;
  } catch {
    return textResponse(req, "Invalid JSON body", { status: 400 });
  }
  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
  const day = typeof body.day === "string" ? body.day : "";
  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return textResponse(req, "ticker en day (JJJJ-MM-DD) zijn nodig", { status: 400 });
  if (body.action !== "reject" && body.action !== "restore") return textResponse(req, "action moet reject of restore zijn", { status: 400 });
  const { data, error } = await sb.from("xinix_skyshots")
    .update({ rejected_at: body.action === "reject" ? new Date().toISOString() : null })
    .eq("ticker", ticker).eq("day", day).select("ticker");
  if (error) return textResponse(req, error.message, { status: 500 });
  if (!data?.length) return textResponse(req, "Onbekende skyshot", { status: 404 });
  return jsonResponse(req, { ok: true, ticker, day, rejected: body.action === "reject" });
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  const url = new URL(req.url);

  if (url.searchParams.get("mode") === "scan") {
    if (!checkAdminOrCron(req)) return textResponse(req, "Unauthorized", { status: 401 });
    const opts: ScanOpts = {
      limit: Math.max(1, Math.min(400, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)),
      ticker: url.searchParams.get("ticker")?.trim().toUpperCase() || null,
      dry: url.searchParams.get("dry") === "1",
    };
    try {
      const r = opts.dry ? await scan(opts) : await logRun("xinix-skyshots", () => scan(opts));
      return jsonResponse(req, r, { status: r.ok ? 200 : 500 });
    } catch (e) {
      return jsonResponse(req, { ok: false, message: msg(e) }, { status: 500 });
    }
  }

  const sb = getServiceClient();
  if (req.method === "GET") {
    try {
      return await read(req, sb, url);
    } catch (e) {
      return textResponse(req, msg(e), { status: 500 });
    }
  }
  if (req.method !== "POST") return textResponse(req, "Method not allowed", { status: 405 });
  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  return mark(req, sb);
});
