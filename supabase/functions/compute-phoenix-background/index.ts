// compute-phoenix-background v12 — strict detection + loose-data exploration.
//
// Naast de strikte criteria slaat deze versie ook ruwe metrics op in
// phoenix_loose_data (JSONB). Dat maakt SQL-queries mogelijk waarmee per
// versoepeling van één criterium getoond kan worden welke tickers er
// bijkomen — zonder elke keer opnieuw te moeten scannen.

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

// Strikte criteria
const RUN_50X_MULT          = 40;   // was 50 — gebruiker wenst 40× als drempel
const RUN_100X_MULT         = 80;   // was 100 — proportioneel verlaagd
const RUN_MIN_DAYS          = 10;
const RUN_50X_MAX_DAYS      = 730;  // was 365 — verlengd naar 2 jaar voor langere parabolic runs
const RUN_100X_MAX_DAYS     = 730;
const RAW_CLOSE_MIN_MULT    = 20;   // proportioneel verlaagd (40 / 2)
const MAX_CURRENT_VS_BASELINE = 3;
const MAX_DEACTIVATE_PEAK   = 100_000;
const MAX_HISTORICAL_PEAK   = 10_000;
const MIN_BASELINE_PRICE    = 0.01;  // was 0.05 — verlaagd voor nano-cap runs
const MIN_PEAK_PRICE        = 1.0;
const MAX_SINGLE_BAR_JUMP   = 5;
const MAX_TRUSTED_SPLIT_RATIO = 3;
const MAX_INCIDENTS         = 3;

// Loose-data: brede zoekvenster voor exploratie
const LOOSE_MIN_DAYS  = 5;
const LOOSE_MAX_DAYS  = 730;    // was 365 — verlengd naar 2 jaar
const LOOSE_MIN_MULT  = 40;     // verlaagd van 50 → 40 op gebruikersverzoek
const LOOSE_MAX_CANDIDATES = 20;

const BATCH_SIZE = 20;          // verlaagd want 730d venster (2 jaar) verdubbelt inner loop tov 365d
const RESCAN_DAYS = 90;
const BUDGET_MS = 100_000;
const SLEEP_MS = 400;

interface Bar { date: string; adjClose: number; rawClose: number; ms: number }
interface SplitEvent { date: string; numerator: number; denominator: number; ratio: number }

async function fetchYahoo10y(ticker: string): Promise<{ bars: Bar[]; splits: SplitEvent[]; firstTradeDate: string | null }> {
  // Daily bars — granulariteit nodig voor "10 dagen minimum" en "60 dagen maximum"
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=split`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout per ticker
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PhoenixBot/1.0; +https://github.com)" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ meta?: { firstTradeDate?: number | null }; timestamp: number[]; events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> }; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? [];
  const raw = r.indicators.quote[0]?.close ?? [];
  const firstTradeDate = r.meta?.firstTradeDate ? new Date(r.meta.firstTradeDate * 1000).toISOString().slice(0, 10) : null;

  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const a = adj[i];
    const c = raw[i];
    if (!Number.isFinite(a as number) || !Number.isFinite(c as number)) continue;
    if (!(a! > 0) || !(c! > 0)) continue;
    const ms = ts[i] * 1000;
    const date = new Date(ms).toISOString().slice(0, 10);
    if (firstTradeDate && date < firstTradeDate) continue;
    bars.push({ date, adjClose: a as number, rawClose: c as number, ms });
  }

  const splits: SplitEvent[] = Object.values(r.events?.splits ?? {}).map((s) => ({
    date: new Date(s.date * 1000).toISOString().slice(0, 10),
    numerator: s.numerator,
    denominator: s.denominator,
    ratio: s.denominator > 0 ? s.numerator / s.denominator : 1,
  }));
  return { bars, splits, firstTradeDate };
}

function hasUntrustworthySplit(splits: SplitEvent[]): boolean {
  for (const s of splits) {
    const r = s.ratio;
    if (r >= MAX_TRUSTED_SPLIT_RATIO || (r > 0 && r <= 1 / MAX_TRUSTED_SPLIT_RATIO)) return true;
  }
  return false;
}

// Datum van de meest recente grote split (≥3:1 of ≤1:3). Alleen bars
// NA deze datum mogen meedoen in feniks-detectie — adjclose data van
// vóór een grote split is op veel exchanges onbetrouwbaar. Geeft 0
// terug als er geen grote split is.
function latestUntrustworthySplitMs(splits: SplitEvent[]): number {
  let latestMs = 0;
  for (const s of splits) {
    const r = s.ratio;
    if (r >= MAX_TRUSTED_SPLIT_RATIO || (r > 0 && r <= 1 / MAX_TRUSTED_SPLIT_RATIO)) {
      const ms = new Date(s.date).getTime();
      if (ms > latestMs) latestMs = ms;
    }
  }
  return latestMs;
}

function maxSplitRatio(splits: SplitEvent[]): number {
  let max = 1;
  for (const s of splits) {
    const r = s.ratio;
    const effective = r >= 1 ? r : (r > 0 ? 1 / r : 1);
    if (effective > max) max = effective;
  }
  return max;
}

interface PhoenixIncident {
  baseline_date: string;
  baseline_close: number;
  peak_date: string;
  peak_close: number;
  days_to_50x: number;
  peak_mult: number;
  growth_180d_pct: number;
}

interface LooseCandidate {
  baseline_date: string;
  baseline_adj: number;
  peak_date: string;
  peak_adj: number;
  days: number;
  peak_mult: number;
  raw_mult: number;
}

function cleanBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let prev = NaN;
  for (const b of bars) {
    if (Number.isFinite(prev) && prev > 0 && b.adjClose >= prev * MAX_SINGLE_BAR_JUMP) {
      prev = b.adjClose;
      continue;
    }
    out.push(b);
    prev = b.adjClose;
  }
  return out;
}

function findPhoenixIncidents(bars: Bar[]): PhoenixIncident[] {
  for (const b of bars) {
    if (b.adjClose > MAX_HISTORICAL_PEAK || b.rawClose > MAX_HISTORICAL_PEAK) return [];
  }
  const clean = cleanBars(bars);
  if (clean.length < 20) return [];
  const currentClose = clean[clean.length - 1].adjClose;

  const incidents: PhoenixIncident[] = [];
  let i = 0;
  while (i < clean.length) {
    const baseAdj = clean[i].adjClose;
    const baseRaw = clean[i].rawClose;
    if (baseAdj < MIN_BASELINE_PRICE) { i++; continue; }
    const baselineMs = clean[i].ms;

    let best: { idx: number; days: number; mult: number; rawMult: number } | null = null;
    for (let j = i + 1; j < clean.length; j++) {
      const ms = clean[j].ms;
      const days = Math.round((ms - baselineMs) / 86400000);
      if (days > RUN_100X_MAX_DAYS) break;
      if (days < RUN_MIN_DAYS) continue;
      if (clean[j].adjClose < MIN_PEAK_PRICE) continue;
      const mult = clean[j].adjClose / baseAdj;
      const rawMult = baseRaw > 0 ? clean[j].rawClose / baseRaw : 0;
      if (rawMult < RAW_CLOSE_MIN_MULT) continue;
      const valid50  = mult >= RUN_50X_MULT  && days <= RUN_50X_MAX_DAYS;
      const valid100 = mult >= RUN_100X_MULT && days <= RUN_100X_MAX_DAYS;
      if (!valid50 && !valid100) continue;
      if (!best || mult > best.mult) best = { idx: j, days, mult, rawMult };
    }

    if (best) {
      if (currentClose > baseAdj * MAX_CURRENT_VS_BASELINE) {
        i = best.idx + 1;
        continue;
      }
      const cutoffMs = baselineMs + 180 * 86400000;
      let maxClose = clean[best.idx].adjClose;
      for (let k = i + 1; k < clean.length; k++) {
        const kms = clean[k].ms;
        if (kms > cutoffMs) break;
        if (clean[k].adjClose > maxClose) maxClose = clean[k].adjClose;
      }
      const growthPct = ((maxClose - baseAdj) / baseAdj) * 100;
      incidents.push({
        baseline_date: clean[i].date,
        baseline_close: Math.round(baseAdj * 10000) / 10000,
        peak_date: clean[best.idx].date,
        peak_close: Math.round(clean[best.idx].adjClose * 100) / 100,
        days_to_50x: best.days,
        peak_mult: Math.round(best.mult * 10) / 10,
        growth_180d_pct: Math.round(growthPct * 10) / 10,
      });
      if (incidents.length > MAX_INCIDENTS) return [];
      i = best.idx + 1;
    } else {
      i++;
    }
  }
  return incidents;
}

// Loose detectie: alle 50× kandidaten in een breder venster zonder strikte
// raw-mult/current/incident-cap. Output gebruikt voor variant-analyse.
function findLooseCandidates(bars: Bar[]): LooseCandidate[] {
  const clean = cleanBars(bars);
  if (clean.length < 20) return [];

  const candidates: LooseCandidate[] = [];
  let i = 0;
  while (i < clean.length && candidates.length < LOOSE_MAX_CANDIDATES) {
    const baseAdj = clean[i].adjClose;
    const baseRaw = clean[i].rawClose;
    if (baseAdj < MIN_BASELINE_PRICE) { i++; continue; }
    const baselineMs = clean[i].ms;

    let best: { idx: number; days: number; mult: number; rawMult: number } | null = null;
    for (let j = i + 1; j < clean.length; j++) {
      const ms = clean[j].ms;
      const days = Math.round((ms - baselineMs) / 86400000);
      if (days > LOOSE_MAX_DAYS) break;
      if (days < LOOSE_MIN_DAYS) continue;
      if (clean[j].adjClose < MIN_PEAK_PRICE) continue;
      const mult = clean[j].adjClose / baseAdj;
      if (mult < LOOSE_MIN_MULT) continue;
      const rawMult = baseRaw > 0 ? clean[j].rawClose / baseRaw : 0;
      if (!best || mult > best.mult) best = { idx: j, days, mult, rawMult };
    }

    if (best) {
      candidates.push({
        baseline_date: clean[i].date,
        baseline_adj: Math.round(baseAdj * 10000) / 10000,
        peak_date: clean[best.idx].date,
        peak_adj: Math.round(clean[best.idx].adjClose * 100) / 100,
        days: best.days,
        peak_mult: Math.round(best.mult * 10) / 10,
        raw_mult: Math.round(best.rawMult * 10) / 10,
      });
      i = best.idx + 1;
    } else {
      i++;
    }
  }
  return candidates;
}

// Diagnostiek: vindt de ABSOLUUT beste run binnen het 365d-venster,
// ongeacht of die de drempel haalt. Hiermee kunnen we exact zien
// waarom een ticker geen kandidaat is (bv MPU: beste run = 12× over
// 300 dagen — kwalificeert niet).
interface BestRun {
  baseline_date: string;
  baseline_adj: number;
  peak_date: string;
  peak_adj: number;
  days: number;
  mult: number;
}
function findBestRun(bars: Bar[]): BestRun | null {
  const clean = cleanBars(bars);
  if (clean.length < 20) return null;
  let bestMult = 0;
  let best: BestRun | null = null;
  for (let i = 0; i < clean.length; i++) {
    const baseAdj = clean[i].adjClose;
    if (baseAdj < MIN_BASELINE_PRICE) continue;
    const baselineMs = clean[i].ms;
    for (let j = i + 1; j < clean.length; j++) {
      const days = Math.round((clean[j].ms - baselineMs) / 86400000);
      if (days > LOOSE_MAX_DAYS) break;
      if (days < LOOSE_MIN_DAYS) continue;
      if (clean[j].adjClose < MIN_PEAK_PRICE) continue;
      const mult = clean[j].adjClose / baseAdj;
      if (mult > bestMult) {
        bestMult = mult;
        best = {
          baseline_date: clean[i].date,
          baseline_adj: Math.round(baseAdj * 10000) / 10000,
          peak_date: clean[j].date,
          peak_adj: Math.round(clean[j].adjClose * 100) / 100,
          days,
          mult: Math.round(mult * 10) / 10,
        };
      }
    }
  }
  return best;
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

  let checked = 0, phoenixFound = 0, errors = 0, dilutedSkipped = 0, splitSkipped = 0, deactivated = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    let isPhoenix = false;
    let deactivate = false;
    let last50xDate: string | null = null;
    let incidents: PhoenixIncident[] = [];
    let incidentCount = 0;
    let medianPeakDate: string | null = null;
    let maxGrowth180d: number | null = null;
    let medianDaysTo50x: number | null = null;
    let looseData: Json | null = null;

    try {
      const { bars, splits } = await fetchYahoo10y(row.ticker);
      if (bars.length >= 20) {
        let histPeakAdj = 0;
        let histPeakRaw = 0;
        for (const b of bars) {
          if (b.adjClose > histPeakAdj) histPeakAdj = b.adjClose;
          if (b.rawClose > histPeakRaw) histPeakRaw = b.rawClose;
        }
        const histPeak = Math.max(histPeakAdj, histPeakRaw);
        const splitRatio = maxSplitRatio(splits);
        const splitCutoffMs = latestUntrustworthySplitMs(splits);
        // Post-split-only: bij grote splits alleen bars NA de meest recente
        // grote split gebruiken. Yahoo's adjclose vóór zo'n split is op veel
        // exchanges onbetrouwbaar; door post-split data te isoleren krijgen
        // tickers zoals BNKK alsnog een eerlijke check op recente runs.
        const usedBars = splitCutoffMs > 0 ? bars.filter((b) => b.ms > splitCutoffMs) : bars;
        const currentClose = bars[bars.length - 1].adjClose;
        const looseCandidates = usedBars.length >= 20 ? findLooseCandidates(usedBars) : [];
        const bestRun = usedBars.length >= 20 ? findBestRun(usedBars) : null;

        looseData = {
          current_close: Math.round(currentClose * 10000) / 10000,
          hist_peak_adj: Math.round(histPeakAdj * 100) / 100,
          hist_peak_raw: Math.round(histPeakRaw * 100) / 100,
          max_split_ratio: Math.round(splitRatio * 100) / 100,
          post_split_bars: usedBars.length,
          post_split_only: splitCutoffMs > 0,
          best_run: bestRun,
          candidates: looseCandidates,
        };

        if (histPeak > MAX_DEACTIVATE_PEAK) {
          deactivate = true;
          deactivated++;
        } else if (usedBars.length < 20) {
          // Te weinig post-split data om iets zinnigs te zeggen
          splitSkipped++;
        } else {
          // Bereken hist peak van usedBars voor de dilution-check
          let usedHistPeak = 0;
          for (const b of usedBars) {
            if (b.adjClose > usedHistPeak) usedHistPeak = b.adjClose;
            if (b.rawClose > usedHistPeak) usedHistPeak = b.rawClose;
          }
          if (usedHistPeak > MAX_HISTORICAL_PEAK) {
            dilutedSkipped++;
          } else {
            incidents = findPhoenixIncidents(usedBars);
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

    const updateFields: Record<string, unknown> = {
      is_phoenix: isPhoenix,
      is_phoenix_at: new Date().toISOString(),
      phoenix_50x_date: last50xDate,
      phoenix_incident_count: isPhoenix ? incidentCount : null,
      phoenix_median_date: medianPeakDate,
      phoenix_max_growth_180d_pct: maxGrowth180d != null ? Math.round(maxGrowth180d * 10) / 10 : null,
      phoenix_days_to_50x: medianDaysTo50x,
      phoenix_incidents: isPhoenix ? incidents : null,
      phoenix_loose_data: looseData,
    };
    if (deactivate) {
      updateFields.active = false;
      updateFields.notes = `gedeactiveerd: historische adjclose > $${MAX_DEACTIVATE_PEAK.toLocaleString("en")} (te ver verwaterd)`;
    }
    await sb.from("signal_tickers").update(updateFields).eq("ticker", row.ticker);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, feniks ${phoenixFound}, gedeactiveerd ${deactivated}, verwaterd-skip ${dilutedSkipped}, split-skip ${splitSkipped}, fouten ${errors}` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") + (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, phoenix_found: phoenixFound, deactivated, diluted_skipped: dilutedSkipped, split_skipped: splitSkipped, errors },
  };
}));
