import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkAuth, checkCron, checkAdminOrCron } from "../_shared/auth.ts";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }
function tt(req: Request, body: string, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string,string>|undefined) } }); }
function runBackground(job: string, fn: () => Promise<RunResult>) { return async (req: Request) => { const p = pf(req); if (p) return p; if (!checkAdminOrCron(req)) return tt(req, "Unauthorized", { status: 401 }); try { const r = await logRun(job, fn); return j(req, { ok: r.ok, ...r }, { status: r.ok ? 200 : 500 }); } catch (e) { return j(req, { ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }; }

// Per run: 80 stale/never tickers, tijdsbudget 110s. Berekent 1y/5y
// extremes EN het medailleklassement uit dezelfde 5y weekly fetch.
// Tickers die poll-prices al heeft gebenched slaan we over (Yahoo kent
// ze niet) — anders staat deze job permanent op FOUT.
const MAX_PER_RUN = 80;
const BUDGET_MS = 110_000;

interface Bar { date: string; close: number; }
async function fetchYahoo5y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalExtremesBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

function extremesSince(bars: Bar[], cutoff: Date): { low: number | null; high: number | null } {
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let lo = Infinity, hi = -Infinity, count = 0;
  for (const b of bars) { if (b.date < cutoffStr) continue; count++; if (b.close < lo) lo = b.close; if (b.close > hi) hi = b.close; }
  if (count === 0) return { low: null, high: null };
  return { low: lo, high: hi };
}

// === Medailleklassement ===
// Zigzag met 50% terugval-drempel: een rally telt als één leg zolang de
// tussentijdse terugval <50% is. Per leg precies 1 medaille = hoogste
// tier (≥500% goud, 250-500% zilver, 100-250% brons). Plus: de koers
// moet ≥2 weekly bars boven de tier-drempel hebben gestaan binnen die
// leg — anders telt het niet (filtert eendaagse spikes).
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
    if (highIdx > lowIdx && high > 0 && c <= high * (1 - RETRACE)) {
      award();
      low = c; lowIdx = i; high = c; highIdx = i;
      continue;
    }
    if (c < low) { low = c; lowIdx = i; high = c; highIdx = i; continue; }
    if (c > high) { high = c; highIdx = i; }
  }
  award();
  return { gold: g, silver: s, bronze: b };
}

Deno.serve(runBackground("compute-extremes", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();
  const sevenDaysAgoMs = startMs - 7 * 24 * 60 * 60 * 1000;
  // Skip benched tickers: poll-prices weet al dat Yahoo deze niet kent.
  const { data: tickers } = await sb.from("signal_tickers").select("ticker").eq("active", true).eq("price_benched", false);
  const allActive = new Set((tickers ?? []).map((t) => t.ticker as string));
  const { data: summaries } = await sb.from("signal_price_summary").select("ticker, last_extremes_at");
  const lastByTicker = new Map<string, string | null>();
  for (const s of summaries ?? []) lastByTicker.set(s.ticker as string, (s.last_extremes_at as string | null) ?? null);
  const todo: string[] = [];
  for (const t of allActive) {
    const last = lastByTicker.get(t);
    if (last == null) { todo.push(t); continue; }
    if (new Date(last).getTime() < sevenDaysAgoMs) todo.push(t);
  }
  if (todo.length === 0) return { ok: true, message: "alle extremes zijn vers" };

  const batch = todo.slice(0, MAX_PER_RUN);
  let updated = 0, failed = 0, processed = 0;
  const errors: string[] = [];
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 86400000);
  const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 86400000);

  for (const ticker of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    processed++;
    try {
      const bars = await fetchYahoo5y(ticker);
      if (bars.length === 0) { failed++; continue; }
      const oneY = extremesSince(bars, oneYearAgo);
      const fiveY = extremesSince(bars, fiveYearsAgo);
      const medals = countMedals(bars);
      const { error: e1 } = await sb.from("signal_price_summary").upsert({
        ticker, low_1y: oneY.low, high_1y: oneY.high, low_5y: fiveY.low, high_5y: fiveY.high, last_extremes_at: now.toISOString(),
      }, { onConflict: "ticker" });
      // Slimme buy_limit-default: 10% boven 5y-low. Alleen vullen als
      // de gebruiker er nog geen heeft ingesteld (handmatige waarden
      // overschrijven we niet).
      const smartLimit = fiveY.low != null && fiveY.low > 0
        ? Number((fiveY.low * 1.10).toFixed(fiveY.low < 1 ? 4 : fiveY.low < 10 ? 3 : 2))
        : null;
      const tickerUpdate: Record<string, unknown> = {
        medal_gold: medals.gold, medal_silver: medals.silver, medal_bronze: medals.bronze, medals_computed_at: now.toISOString(),
      };
      const { error: e2 } = await sb.from("signal_tickers").update(tickerUpdate).eq("ticker", ticker);
      let e3: { message?: string } | null = null;
      if (smartLimit != null) {
        const { error } = await sb.from("signal_tickers").update({ buy_limit: smartLimit }).eq("ticker", ticker).is("buy_limit", null);
        if (error) e3 = error;
      }
      if (e1 || e2 || e3) { failed++; errors.push(`${ticker}: ${(e1?.message ?? e2?.message ?? e3?.message) ?? "?"}`); }
      else updated++;
    } catch (e) {
      failed++;
      errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const remaining = todo.length - processed;
  return { ok: failed < processed / 2, message: `${updated} bijgewerkt, ${failed} mislukt, ${remaining} nog te doen` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""), metrics: { updated, failed, processed, remaining, todo_total: todo.length } };
}));
