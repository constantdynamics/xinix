// compute-phoenix-background — scant de bestaande watchlist op het feniks-profiel:
// aandelen die in de afgelopen 10 jaar minimaal 50× zijn gegaan.
// Verwerkt max ~100 tickers per run (is_phoenix IS NULL); draait daily of op verzoek.

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

const PHOENIX_MULT = 50;
const BATCH_SIZE = 100;
const RESCAN_DAYS = 90;
const BUDGET_MS = 128_000;
const SLEEP_MS = 280;

interface Bar { date: string; close: number }
async function fetchYahoo10y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PhoenixBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

// Vind de datum van de laatste 50× run. Het algoritme houdt de loop-minimum bij
// en markeert iedere bar waar close ≥ minSoFar × mult. Een latere crash naar
// een nieuwe low staat een nieuwe 50× run toe vanaf die low. We bewaren de
// meest recente match — null als er geen 50× run gevonden is.
function findLastPhoenixDate(bars: Bar[], mult: number): string | null {
  let minSoFar = Infinity;
  let lastDate: string | null = null;
  for (const b of bars) {
    if (b.close < minSoFar) { minSoFar = b.close; }
    else if (minSoFar > 0 && b.close >= minSoFar * mult) { lastDate = b.date; }
  }
  return lastDate;
}

Deno.serve(runBackground("compute-phoenix", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Selectie: nooit-gescand of >RESCAN_DAYS oud (nieuwe tickers eerst)
  const cutoff = new Date(Date.now() - RESCAN_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: tickers, error: fetchError } = await sb
    .from("signal_tickers")
    .select("ticker")
    .eq("active", true)
    .or(`is_phoenix_at.is.null,is_phoenix_at.lt.${cutoff}`)
    .order("is_phoenix_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (fetchError) throw new Error(fetchError.message);
  const batch = (tickers ?? []) as { ticker: string }[];

  let checked = 0, phoenixFound = 0, errors = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    let isPhoenix = false;
    let last50xDate: string | null = null;
    try {
      const bars = await fetchYahoo10y(row.ticker);
      if (bars.length >= 10) {
        last50xDate = findLastPhoenixDate(bars, PHOENIX_MULT);
        isPhoenix = last50xDate != null;
        if (isPhoenix) phoenixFound++;
      }
    } catch (e) {
      errors++;
      if (errMsgs.length < 5) errMsgs.push(`${row.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Altijd opslaan (ook false bij fout). is_phoenix_at = nu → pas over RESCAN_DAYS weer aan de beurt
    await sb.from("signal_tickers")
      .update({
        is_phoenix: isPhoenix,
        is_phoenix_at: new Date().toISOString(),
        phoenix_50x_date: last50xDate,
      })
      .eq("ticker", row.ticker);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, feniks ${phoenixFound}, fouten ${errors}` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") + (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, phoenix_found: phoenixFound, errors },
  };
}));
