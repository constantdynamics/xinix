// compute-hikkertjes-background — scant de watchlist op het hikkertje-profiel:
// aandelen die in het afgelopen jaar minimaal 2× op één dag ≥50% gestegen zijn
// én die stijging minimaal 3 handelsdagen vastgehouden hebben.
// Verwerkt max 80 tickers per run (is_hikkertje IS NULL); draait daily of op verzoek.

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

const MIN_GAIN_PCT = 0.50;   // ≥50% single-day stijging
const MIN_HOLD_DAYS = 3;     // stijging minimaal 3 handelsdagen vasthouden
const MIN_SPIKES = 2;        // minimaal 2 keer in het afgelopen jaar
const BATCH_SIZE = 80;       // dagelijkse data is zwaarder, iets kleiner batch
const RESCAN_DAYS = 90;      // herscan iedere 90 dagen
const BUDGET_MS = 120_000;
const SLEEP_MS = 300;

interface Bar { date: string; close: number }

async function fetchYahoo1y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HikkertjeBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          adjclose?: Array<{ adjclose?: (number | null)[] }>;
          quote: Array<{ close: (number | null)[] }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN }))
    .filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

// Telt spikes van ≥minGainPct op één dag die daarna minHoldDays handelsdagen
// boven de spike-drempel blijven. Na een geldige spike slaat de teller de
// holdperiode over om dubbeltellingen te voorkomen.
function countHikkerSpikes(bars: Bar[], minGainPct: number, minHoldDays: number): number {
  let count = 0;
  let i = 1;
  while (i + minHoldDays <= bars.length) {
    const prev = bars[i - 1].close;
    if (prev <= 0) { i++; continue; }
    const ratio = bars[i].close / prev;
    if (ratio >= 1 + minGainPct) {
      const threshold = prev * (1 + minGainPct);
      let held = true;
      for (let j = i; j < i + minHoldDays; j++) {
        if (bars[j].close < threshold) { held = false; break; }
      }
      if (held) {
        count++;
        i += minHoldDays; // sla holdperiode over
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return count;
}

Deno.serve(runBackground("compute-hikkertjes", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Selectie: nooit-gescand (is_hikkertje_at IS NULL) of >RESCAN_DAYS oud.
  // Volgorde: oudste eerst (NULLs eerst), zodat nieuwe tickers prioriteit hebben.
  const cutoff = new Date(Date.now() - RESCAN_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: tickers, error: fetchError } = await sb
    .from("signal_tickers")
    .select("ticker")
    .eq("active", true)
    .or(`is_hikkertje_at.is.null,is_hikkertje_at.lt.${cutoff}`)
    .order("is_hikkertje_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (fetchError) throw new Error(fetchError.message);
  const batch = (tickers ?? []) as { ticker: string }[];

  let checked = 0, hikkertjeFound = 0, errors = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    let spikes = 0;
    let isHikkertje = false;
    try {
      const bars = await fetchYahoo1y(row.ticker);
      if (bars.length >= MIN_HOLD_DAYS + 1) {
        spikes = countHikkerSpikes(bars, MIN_GAIN_PCT, MIN_HOLD_DAYS);
        isHikkertje = spikes >= MIN_SPIKES;
        if (isHikkertje) hikkertjeFound++;
      }
    } catch (e) {
      errors++;
      if (errMsgs.length < 5) errMsgs.push(`${row.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Altijd opslaan zodat falende tickers niet steeds opnieuw worden geprobeerd
    // is_hikkertje_at = nu → pas over RESCAN_DAYS weer aan de beurt
    await sb.from("signal_tickers")
      .update({
        is_hikkertje: isHikkertje,
        hikkertje_spikes: spikes > 0 ? spikes : null,
        is_hikkertje_at: new Date().toISOString(),
      })
      .eq("ticker", row.ticker);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, hikkertjes ${hikkertjeFound}, fouten ${errors}` +
      (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") +
      (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, hikkertje_found: hikkertjeFound, errors },
  };
}));
