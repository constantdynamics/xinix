// Gedeelde stukken van de explosie-motor die niet over rekenen gaan:
// run-logging, TradingView-sweep, Yahoo-symbolen, sectoren, modelopslag en
// het toevoegen van treffers aan de watchlist.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as E from "./engine.ts";

export type SB = SupabaseClient;
export type Json = Record<string, unknown>;
export interface RunResult { ok: boolean; message?: string; metrics?: Json }

export function getServiceClient(): SB {
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
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
function authorized(req: Request): boolean {
  const admin = Deno.env.get("ADMIN_TOKEN"), cron = Deno.env.get("CRON_SECRET");
  return (!!admin && (req.headers.get("authorization") ?? "") === `Bearer ${admin}`) ||
    (!!cron && (req.headers.get("x-cron-secret") ?? "") === cron);
}
export function runBackground(job: string, fn: () => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
    try {
      const r = await logRun(job, fn);
      return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}

// deno-lint-ignore no-explicit-any
export async function fetchAll<T>(sb: SB, table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
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
export async function chunkedIn<T>(sb: SB, table: string, cols: string, tickers: string[], size = 200): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tickers.length; i += size) {
    const { data, error } = await sb.from(table).select(cols).in("ticker", tickers.slice(i, i + size));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}
export function num(v: unknown): number | null { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
export const r1 = (x: number) => Math.round(x * 10) / 10;

// ── Markten ─────────────────────────────────────────────────────────────────
// De beurzen die Saxo aanbiedt (zelfde lijst als de andere scanners), met per
// TradingView-beurs het Yahoo-achtervoegsel. Beurzen die hier niet staan
// (OTC, Aquis, regionale Japanse/Duitse pleinen) worden overgeslagen.
export const MARKETS: Array<{ region: string; ex: Record<string, string> }> = [
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
/** TradingView-symbool → Yahoo. null als de beurs niet meedoet. */
export function yahooSymbol(region: string, exchange: string, name: string): string | null {
  const m = MARKETS.find((x) => x.region === region);
  const sfx = m?.ex[exchange];
  if (sfx == null) return null;
  let sym = name.toUpperCase().replace(/[._]/g, "-");
  if (region === "hongkong") sym = sym.padStart(4, "0");     // Yahoo: 0700.HK
  if (region === "uk" && /^[0-9][0-9A-Z]{3}$/.test(sym)) return null;   // IOB-spooknoteringen
  return `${sym}${sfx}`;
}
const US_EXCHANGE: Record<string, string> = { NASDAQ: "NASDAQ", NYSE: "NYSE", AMEX: "NYSE American" };

export const TV_COLUMNS = [
  "name", "description", "close", "currency", "change", "Perf.W", "Perf.1M", "Perf.6M",
  "volume", "average_volume_30d_calc", "market_cap_basic", "price_52_week_high", "price_52_week_low",
  "High.3M", "Low.3M", "High.All", "Low.All", "Volatility.M", "sector", "industry", "exchange",
];
export interface TvRow {
  ticker: string; tv_symbol: string; market: string; exchange: string; name: string | null; currency: string | null;
  tv_sector: string | null; tv_industry: string | null;
  close: number | null; change_1d: number | null; perf_w: number | null; perf_1m: number | null; perf_6m: number | null;
  volume: number | null; avg_vol_30d: number | null; mcap_usd: number | null;
  hi52: number | null; lo52: number | null; hi3m: number | null; lo3m: number | null; hi_all: number | null; lo_all: number | null;
  volat_m: number | null;
}
async function tvPost(region: string, body: unknown): Promise<{ totalCount: number; data: Array<{ s: string; d: unknown[] }> }> {
  const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TV ${region} HTTP ${res.status}`);
  // deno-lint-ignore no-explicit-any
  const j = (await res.json()) as any;
  return { totalCount: Number(j.totalCount ?? 0), data: j.data ?? [] };
}
/** Alle primaire gewone aandelen van één markt. */
export async function tvMarket(region: string): Promise<TvRow[]> {
  const m = MARKETS.find((x) => x.region === region)!;
  const out: TvRow[] = [];
  const PAGE = 3000;
  for (let from = 0; from < 20000; from += PAGE) {
    const r = await tvPost(region, {
      filter: [
        { left: "type", operation: "equal", right: "stock" },
        { left: "is_primary", operation: "equal", right: true },
        { left: "subtype", operation: "in_range", right: ["common", "foreign-issuer", ""] },
        { left: "exchange", operation: "in_range", right: Object.keys(m.ex) },
        { left: "close", operation: "greater", right: 0 },
      ],
      options: { lang: "en" },
      columns: TV_COLUMNS,
      sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
      range: [from, from + PAGE],
    });
    for (const row of r.data) {
      const d = row.d;
      const exchange = String(d[20] ?? "");
      const ticker = yahooSymbol(region, exchange, String(d[0] ?? ""));
      if (!ticker) continue;
      const n = (i: number) => num(d[i]);
      out.push({
        ticker, tv_symbol: row.s, market: region,
        exchange: region === "america" ? (US_EXCHANGE[exchange] ?? exchange) : exchange,
        name: (d[1] as string) || null, currency: (d[3] as string) || null,
        tv_sector: (d[18] as string) || null, tv_industry: (d[19] as string) || null,
        close: n(2), change_1d: n(4), perf_w: n(5), perf_1m: n(6), perf_6m: n(7),
        volume: n(8), avg_vol_30d: n(9), mcap_usd: n(10), hi52: n(11), lo52: n(12),
        hi3m: n(13), lo3m: n(14), hi_all: n(15), lo_all: n(16), volat_m: n(17),
      });
    }
    if (from + PAGE >= r.totalCount || r.data.length === 0) break;
  }
  return out;
}
/** Small caps (IWM) nu: boven het 200-daags gemiddelde en het 22-daags rendement. */
export async function tvRegime(): Promise<{ iwm200: number | null; iwm22: number | null }> {
  const r = await tvPost("america", { symbols: { tickers: ["AMEX:IWM"] }, columns: ["close", "SMA200", "Perf.1M"] });
  const d = r.data[0]?.d ?? [];
  const c = num(d[0]), sma = num(d[1]);
  return { iwm200: c != null && sma != null ? (c > sma ? 1 : 0) : null, iwm22: num(d[2]) };
}

/** Wachtrij-niveau op basis van de goedkope TradingView-data. */
export function tierOf(t: TvRow): { tier: number; priority: number } {
  const fx = E.fxUsd(t.currency);
  const priceUsd = (t.close ?? 0) * fx;
  const dvol = (t.avg_vol_30d ?? 0) * (t.close ?? 0) * fx;
  const ratio = t.hi52 && t.lo52 && t.lo52 > 0 ? t.hi52 / t.lo52 : 1;
  const volat = t.volat_m ?? 0;
  const priority = Math.round((Math.log(ratio) + volat / 10) * 1000) / 1000;
  // Te goedkoop of vrijwel onverhandelbaar: niet meten, er valt niets te halen.
  if (priceUsd < 0.05 || dvol < 5000) return { tier: 3, priority };
  const phoenixLike = t.hi_all && t.lo_all && t.close ? t.hi_all >= t.lo_all * E.PHOENIX_MULT && t.close <= t.hi_all * E.PHOENIX_MAX_FRACTION : false;
  if (ratio >= 2 || volat >= 6) return { tier: 1, priority };
  if (ratio >= 1.4 || phoenixLike || (t.hi_all && t.close && t.hi_all >= t.close * 10)) return { tier: 2, priority };
  return { tier: 3, priority };
}

// ── Sector ──────────────────────────────────────────────────────────────────
const MINING_RE = /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tungsten|rare\s*earth|potash|iron\s*ore)\b/i;
const BIOTECH_RE = /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|oncolog(?:y|ic)|immuno(?:logy|therap)|vaccines?|antibod(?:y|ies))\b/i;
export function inferSector(name: string | null, sector: string | null, industry: string | null): "biotech" | "mining" | "other" {
  const ind = industry ?? "";
  if (/biotechnology|pharmaceuticals/i.test(ind)) return "biotech";
  if (/precious metals|other metals|steel|aluminum|coal/i.test(ind) || sector === "Non-Energy Minerals") return "mining";
  if (name && MINING_RE.test(name)) return "mining";
  if (name && BIOTECH_RE.test(name)) return "biotech";
  return "other";
}

// ── Modelopslag ─────────────────────────────────────────────────────────────
// De vaste criteria van de onderdelen, uitgedrukt in kenmerk-buckets, zodat
// de backtest direct uit de gepoolde tellingen volgt.
export const CRITERIA: Array<{ key: string; label: string; feature: string; slots: number[] }> = [
  { key: "hikkertje", label: "Hikkertje (≥2 spikes in het afgelopen jaar)", feature: "hikk", slots: [2, 3] },
  { key: "poefie2y", label: "Poefie in de afgelopen 2 jaar", feature: "poef", slots: [0, 1, 2] },
  { key: "poefie", label: "Ooit een poefie (10 jaar)", feature: "poef", slots: [0, 1, 2, 3] },
  { key: "ster", label: "5-sterren-DNA fit ≥ 80", feature: "star", slots: [3, 4] },
  { key: "feniks", label: "Gevallen feniks (≥40× gelopen, nu ≥90% onder de top)", feature: "phx", slots: [1] },
  { key: "sprint45", label: "+50%-piek in de afgelopen 45 dagen", feature: "since", slots: [0, 1] },
];
export function backtestOf(m: E.Model, pool: ArrayLike<number>) {
  const g = E.EVENTS[m.e].group;
  return CRITERIA.map((c) => {
    const f = E.FI[c.feature];
    let n = 0, h = 0;
    for (const s of c.slots) { n += Number(pool[E.idxN(g, f, s)]); h += Number(pool[E.idxH(m.e, f, s)]); }
    const rate = n > 0 ? h / n : 0;
    return { key: c.key, label: c.label, n, hits: h, rate_pct: Math.round(rate * 1000) / 10, lift: m.p0 > 0 ? Math.round((rate / m.p0) * 100) / 100 : null };
  });
}
export async function writeModels(sb: SB, models: Array<E.Model | null>, pool: ArrayLike<number>, tickers: number, extra?: (e: number) => Json): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const rows = models.filter((m): m is E.Model => m != null).map((m) => ({
    event: E.EVENTS[m.e].key, computed_at: nowIso, label: E.EVENTS[m.e].label, tickers,
    ...E.modelSummary(m, pool), backtest: backtestOf(m, pool), ...(extra ? extra(m.e) : {}),
  }));
  if (!rows.length) return null;
  const { error } = await sb.from("xinix_event_models").upsert(rows, { onConflict: "event" });
  return error ? error.message : null;
}
export async function loadPool(sb: SB): Promise<{ counts: number[]; tickers: number; computed_at: string } | null> {
  const { data } = await sb.from("xinix_event_pool").select("layout, tickers, counts, computed_at").eq("id", 1).maybeSingle();
  if (!data || data.layout !== E.LAYOUT || !Array.isArray(data.counts) || data.counts.length !== E.LEN) return null;
  return { counts: (data.counts as unknown[]).map(Number), tickers: data.tickers as number, computed_at: data.computed_at as string };
}
/** Modellen pas gebruiken als er genoeg aandelen in de pool zitten. */
export const MIN_POOL_TICKERS = 150;

// ── Toevoegen aan de watchlist ──────────────────────────────────────────────
export interface AddCandidate {
  ticker: string; name: string | null; exchange: string | null; mcap_usd: number | null;
  tv_sector: string | null; tv_industry: string | null;
  reasons: string[]; strength: number;
  fields: Json;                       // module-velden die we al weten (hikkertje, poefie, feniks)
}
export async function addedToday(sb: SB): Promise<number> {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const { count } = await sb.from("xinix_universe").select("ticker", { count: "exact", head: true }).gte("added_at", start.toISOString());
  return count ?? 0;
}
export async function addSettings(sb: SB): Promise<{ on: boolean; max: number }> {
  const { data } = await sb.from("signal_settings").select("universe_auto_add, universe_max_add_per_day").eq("id", 1).maybeSingle();
  return { on: data?.universe_auto_add !== false, max: Math.max(0, Number(data?.universe_max_add_per_day ?? 100)) };
}
/**
 * Voeg de sterkste kandidaten toe (binnen het dagplafond). Aandelen die al
 * ooit in signal_tickers stonden worden nooit opnieuw geactiveerd: die zijn
 * bewust uitgezet.
 */
export async function addToWatchlist(sb: SB, cands: AddCandidate[], room: number): Promise<{ added: string[]; error: string | null }> {
  if (room <= 0 || !cands.length) return { added: [], error: null };
  const existing = new Set((await chunkedIn<{ ticker: string }>(sb, "signal_tickers", "ticker", cands.map((c) => c.ticker))).map((r) => r.ticker));
  const pick = cands.filter((c) => !existing.has(c.ticker)).sort((a, b) => b.strength - a.strength).slice(0, room);
  if (!pick.length) return { added: [], error: null };
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const added: string[] = [];
  let error: string | null = null;
  for (const c of pick) {
    const row: Json = {
      ticker: c.ticker, company: c.name, sector: inferSector(c.name, c.tv_sector, c.tv_industry), active: true,
      exchange: c.ticker.includes(".") ? null : c.exchange,
      market_cap_usd: c.mcap_usd != null ? Math.round(c.mcap_usd) : null,
      notes: `Auto-toegevoegd door de explosie-motor (${today}): ${c.reasons.join("; ")}.`,
      ...c.fields,
    };
    const { error: e } = await sb.from("signal_tickers").insert(row);
    if (e) { error = `${c.ticker}: ${e.message}`; continue; }
    added.push(c.ticker);
    await sb.from("xinix_universe").update({ added_at: nowIso, add_reason: c.reasons.join("; "), in_watchlist: true }).eq("ticker", c.ticker);
  }
  return { added, error };
}
