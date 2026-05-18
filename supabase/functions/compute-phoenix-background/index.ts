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
// Anti-noise / anti-split-artefact criteria. Vier lagen verdediging:
//  1. adjclose (i.p.v. raw close): kent reverse-/forward-splits af
//  2. MIN_BASELINE: minimum baseline om sub-penny noise uit te sluiten
//  3. MIN_PEAK: minimum top — een echte feniks raakt absolute hoogtes
//  4. MIN_RUN_BARS: 50× run moet zich over meerdere bars ontwikkelen
//     (1-bar jumps = altijd split-data-fout, geen organische run)
//  5. MAX_SINGLE_BAR_JUMP: één bar mag niet >MAX×-jumpen t.o.v. de vorige
//     (vangst van overgebleven split-artefacten in adjclose-data)
const MIN_BASELINE_PRICE   = 0.05;
const MIN_PEAK_PRICE       = 1.0;
const MIN_RUN_BARS         = 4;   // ≥4 weekly bars tussen min en piek
const MAX_SINGLE_BAR_JUMP  = 10;  // bar-to-bar mag niet >10× zijn (5000% in 1 week = data-fout)
// Na een gerecord 50×-incident vereist een nieuw incident dat de koers eerst
// minimaal terugzakt naar peak/POST_PEAK_CRASH_DIV. Dit voorkomt dat 1 lange
// rally als meerdere incidenten wordt geteld.
const POST_PEAK_CRASH_DIV  = 10;

interface Bar { date: string; close: number }
interface SplitEvent { date: string; numerator: number; denominator: number; ratio: number }
async function fetchYahoo10y(ticker: string): Promise<{ bars: Bar[]; splits: SplitEvent[] }> {
  // events=split → split-events erbij. Tickers met grote splits (reverse of forward
  // ≥5:1) overslaan we — Yahoo's adjclose voor sommige beurzen (XETRA, OTC, BSE)
  // past pre-split data niet altijd correct aan, wat valse 50× runs oplevert
  // (zoals H2O.DE Enapter na hun 10:1 reverse split feb 2024).
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1wk&events=split`;
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

const MAX_TRUSTED_SPLIT_RATIO = 5;
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
  days_to_50x: number;
  growth_180d_pct: number;
}

// Vind alle 50× incidenten. Een incident telt als: vanaf een lokaal minimum
// stijgt de koers ≥ mult×, met de gebruikelijke anti-noise filters. Na een
// geregistreerd incident eist het algoritme een echte crash (koers ≤ peak/10)
// voordat een nieuw incident geteld kan worden — anders zou één lange rally
// meerdere keren tellen.
function findPhoenixIncidents(bars: Bar[], mult: number): PhoenixIncident[] {
  const incidents: PhoenixIncident[] = [];
  let minSoFar = Infinity;
  let minBarIdx = -1;
  let lastPeak: number | null = null;
  let prevClose = NaN;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (Number.isFinite(prevClose) && prevClose > 0 && b.close >= prevClose * MAX_SINGLE_BAR_JUMP) {
      prevClose = b.close;
      continue;
    }
    prevClose = b.close;

    if (lastPeak !== null) {
      // Wachten tot een echte crash voordat we een nieuw incident accepteren
      if (b.close <= lastPeak / POST_PEAK_CRASH_DIV) {
        lastPeak = null;
        minSoFar = b.close;
        minBarIdx = i;
      } else {
        if (b.close > lastPeak) lastPeak = b.close;
      }
      continue;
    }

    if (b.close < minSoFar) {
      minSoFar = b.close;
      minBarIdx = i;
    } else if (
      minSoFar >= MIN_BASELINE_PRICE &&
      b.close >= MIN_PEAK_PRICE &&
      b.close >= minSoFar * mult &&
      (i - minBarIdx) >= MIN_RUN_BARS
    ) {
      const baselineDate = bars[minBarIdx].date;
      const baselineMs = new Date(baselineDate).getTime();
      const cutoffMs = baselineMs + 180 * 86400 * 1000;
      // Maximale prijs binnen 180 dagen na baseline (incl. de peak-bar zelf)
      let maxClose = b.close;
      for (let j = minBarIdx + 1; j < bars.length; j++) {
        const jms = new Date(bars[j].date).getTime();
        if (jms > cutoffMs) break;
        if (bars[j].close > maxClose) maxClose = bars[j].close;
      }
      const growthPct = ((maxClose - minSoFar) / minSoFar) * 100;
      const daysTo50x = Math.round((new Date(b.date).getTime() - baselineMs) / 86400000);

      incidents.push({
        baseline_date: baselineDate,
        peak_date: b.date,
        days_to_50x: daysTo50x,
        growth_180d_pct: Math.round(growthPct * 10) / 10,
      });
      lastPeak = b.close;
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

  let checked = 0, phoenixFound = 0, errors = 0;
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
      if (bars.length >= 10) {
        if (!hasUntrustworthySplit(splits)) {
          incidents = findPhoenixIncidents(bars, PHOENIX_MULT);
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
    message: `batch ${batch.length}, gecheckt ${checked}, feniks ${phoenixFound}, fouten ${errors}` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") + (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, phoenix_found: phoenixFound, errors },
  };
}));
