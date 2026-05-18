// compute-phoenix-background — scant de bestaande watchlist op het feniks-profiel:
// aandelen die in de afgelopen 10 jaar een EXPLOSIEVE 50× of 100× run hadden.
//
// Criteria (strikt):
//   • 50× run binnen 10-60 dagen, OF
//   • 100× run binnen 10-120 dagen
//   • Minimum run-duur: 10 dagen (anders is het bijna altijd een data-artefact)
//   • Historische piek-cap: $10.000 — aandelen die ooit boven die prijs noteerden
//     zijn meestal extreem verwaterd (reverse-split artefact in Yahoo's adjclose)
//   • Single-bar jump-cap: een dag mag niet >5× de vorige dag zijn
//   • Skip tickers met grote splits (≥5:1) — Yahoo's adjclose voor sommige
//     beurzen past pre-split data niet altijd correct aan
//
// Verwerkt max ~80 tickers per run; draait dagelijks of op verzoek.

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

// Strikte criteria — explosieve runs binnen krap tijdvenster
const RUN_50X_MULT          = 50;
const RUN_100X_MULT         = 100;
const RUN_MIN_DAYS          = 10;   // anders bijna altijd data-artefact
const RUN_50X_MAX_DAYS      = 60;   // 50× moet binnen 60 dagen
const RUN_100X_MAX_DAYS     = 120;  // 100× mag tot 120 dagen
const MAX_HISTORICAL_PEAK   = 10_000; // verwaterde tickers met "$50.000 ooit" overslaan
const MIN_BASELINE_PRICE    = 0.05; // sub-penny noise eruit
const MIN_PEAK_PRICE        = 1.0;  // echte piek moet bovenwaarde hebben
const MAX_SINGLE_BAR_JUMP   = 5;    // daily bar mag niet >5× de vorige (split-artefact)
const MAX_TRUSTED_SPLIT_RATIO = 5;

const BATCH_SIZE = 80;
const RESCAN_DAYS = 90;
const BUDGET_MS = 130_000;
const SLEEP_MS = 350;

interface Bar { date: string; close: number }
interface SplitEvent { date: string; numerator: number; denominator: number; ratio: number }
async function fetchYahoo10y(ticker: string): Promise<{ bars: Bar[]; splits: SplitEvent[] }> {
  // Daily bars — granulariteit nodig voor "10 dagen minimum" en "60 dagen maximum"
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=split`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PhoenixBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> }; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  const bars = ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
  const splits: SplitEvent[] = Object.values(r.events?.splits ?? {}).map((s) => ({
    date: new Date(s.date * 1000).toISOString().slice(0, 10),
    numerator: s.numerator,
    denominator: s.denominator,
    ratio: s.denominator > 0 ? s.numerator / s.denominator : 1,
  }));
  return { bars, splits };
}

function hasUntrustworthySplit(splits: SplitEvent[]): boolean {
  for (const s of splits) {
    const r = s.ratio;
    if (r >= MAX_TRUSTED_SPLIT_RATIO || (r > 0 && r <= 1 / MAX_TRUSTED_SPLIT_RATIO)) return true;
  }
  return false;
}

interface PhoenixIncident {
  baseline_date: string;
  peak_date: string;
  days_to_50x: number;        // werkelijk aantal dagen voor deze run
  peak_mult: number;           // hoeveel × de run uiteindelijk haalde
  growth_180d_pct: number;     // max groei vanaf baseline binnen 180 dagen
}

// Bar-to-bar jump cap: één dag mag niet >MAX× de vorige zijn (organisch
// stijgt zelfs een biotech zelden >3× per dag). Grotere jumps zijn vrijwel
// altijd Yahoo-adjclose-artefacten van splits of dividenden. Filter ze eruit.
function cleanBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let prev = NaN;
  for (const b of bars) {
    if (Number.isFinite(prev) && prev > 0 && b.close >= prev * MAX_SINGLE_BAR_JUMP) {
      // skip artefact-bar, reset baseline naar deze bar zodat we erna verder kunnen
      prev = b.close;
      continue;
    }
    out.push(b);
    prev = b.close;
  }
  return out;
}

// Vind alle explosieve 50× / 100× incidenten in de gegeven bars.
// Strategie: walk through bars; voor elke baseline-bar zoek de beste piek
// binnen [10, 120] dagen die voldoet aan de criteria. Bij een hit: registreer
// het incident en spring voorbij de piek om dezelfde run niet dubbel te tellen.
function findPhoenixIncidents(bars: Bar[]): PhoenixIncident[] {
  // Pre-filter: extreem verwaterde tickers volledig uitsluiten
  for (const b of bars) {
    if (b.close > MAX_HISTORICAL_PEAK) return [];
  }
  const clean = cleanBars(bars);
  if (clean.length < 20) return [];

  const incidents: PhoenixIncident[] = [];
  let i = 0;
  while (i < clean.length) {
    const baseline = clean[i].close;
    if (baseline < MIN_BASELINE_PRICE) { i++; continue; }
    const baselineMs = new Date(clean[i].date).getTime();

    // Zoek de hoogste valide piek binnen het toegestane venster
    let best: { idx: number; days: number; mult: number } | null = null;
    for (let j = i + 1; j < clean.length; j++) {
      const ms = new Date(clean[j].date).getTime();
      const days = Math.round((ms - baselineMs) / 86400000);
      if (days > RUN_100X_MAX_DAYS) break;       // venster verlaten
      if (days < RUN_MIN_DAYS) continue;          // te kort
      if (clean[j].close < MIN_PEAK_PRICE) continue;
      const mult = clean[j].close / baseline;
      const valid50  = mult >= RUN_50X_MULT  && days <= RUN_50X_MAX_DAYS;
      const valid100 = mult >= RUN_100X_MULT && days <= RUN_100X_MAX_DAYS;
      if (!valid50 && !valid100) continue;
      if (!best || mult > best.mult) best = { idx: j, days, mult };
    }

    if (best) {
      // Max prijs binnen 180 dagen na baseline (voor growth_180d_pct)
      const cutoffMs = baselineMs + 180 * 86400000;
      let maxClose = clean[best.idx].close;
      for (let k = i + 1; k < clean.length; k++) {
        const kms = new Date(clean[k].date).getTime();
        if (kms > cutoffMs) break;
        if (clean[k].close > maxClose) maxClose = clean[k].close;
      }
      const growthPct = ((maxClose - baseline) / baseline) * 100;
      incidents.push({
        baseline_date: clean[i].date,
        peak_date: clean[best.idx].date,
        days_to_50x: best.days,
        peak_mult: Math.round(best.mult * 10) / 10,
        growth_180d_pct: Math.round(growthPct * 10) / 10,
      });
      i = best.idx + 1;  // ga verder na de piek — voorkomt dubbele detectie
    } else {
      i++;
    }
  }
  return incidents;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function medianDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid];
}

Deno.serve(runBackground("compute-phoenix", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

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

  let checked = 0, phoenixFound = 0, errors = 0, dilutedSkipped = 0, splitSkipped = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    let isPhoenix = false;
    let last50xDate: string | null = null;
    let incidents: PhoenixIncident[] = [];
    let incidentCount = 0;
    let medianPeakDate: string | null = null;
    let maxGrowth180d: number | null = null;
    let medianDaysTo50x: number | null = null;

    try {
      const { bars, splits } = await fetchYahoo10y(row.ticker);
      if (bars.length >= 20) {
        if (hasUntrustworthySplit(splits)) {
          splitSkipped++;
        } else {
          // Check historical peak cap
          const histPeak = Math.max(...bars.map((b) => b.close));
          if (histPeak > MAX_HISTORICAL_PEAK) {
            dilutedSkipped++;
          } else {
            incidents = findPhoenixIncidents(bars);
            if (incidents.length > 0) {
              isPhoenix = true;
              phoenixFound++;
              last50xDate = incidents[incidents.length - 1].peak_date;
              incidentCount = incidents.length;
              medianPeakDate = medianDate(incidents.map((i) => i.peak_date));
              maxGrowth180d = Math.max(...incidents.map((i) => i.growth_180d_pct));
              const md = median(incidents.map((i) => i.days_to_50x));
              medianDaysTo50x = md != null ? Math.round(md) : null;
            }
          }
        }
      }
    } catch (e) {
      errors++;
      if (errMsgs.length < 5) errMsgs.push(`${row.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }

    await sb.from("signal_tickers")
      .update({
        is_phoenix: isPhoenix,
        is_phoenix_at: new Date().toISOString(),
        phoenix_50x_date: last50xDate,
        phoenix_incident_count: isPhoenix ? incidentCount : null,
        phoenix_median_date: medianPeakDate,
        phoenix_max_growth_180d_pct: maxGrowth180d != null ? Math.round(maxGrowth180d * 10) / 10 : null,
        phoenix_days_to_50x: medianDaysTo50x,
        phoenix_incidents: isPhoenix ? incidents : null,
      })
      .eq("ticker", row.ticker);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, feniks ${phoenixFound}, verwaterd-skip ${dilutedSkipped}, split-skip ${splitSkipped}, fouten ${errors}` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") + (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, phoenix_found: phoenixFound, diluted_skipped: dilutedSkipped, split_skipped: splitSkipped, errors },
  };
}));
