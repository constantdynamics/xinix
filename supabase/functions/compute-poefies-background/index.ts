// compute-poefies-background — detecteert "poefies": aandelen die in
// maximaal 7 dagen minimaal 125% (= 2.25×) zijn gegroeid in de afgelopen 10 jaar.
//
// Een poefie is een kortstondige, extreme uitbarsting (vandaar de vuurwerk-naam).
// We tellen alle incidenten over het volledige 10-jaars venster, plus aparte
// tellers voor 6m / 1j / 2j / 5j zodat de UI kan filteren op "hoe vaak gebeurde
// het recent". False positives worden weggefilterd: bars met krankzinnige
// single-bar jumps (data-fouten), tickers met absurde historische pieken
// (verwatering), incidenten met onvertrouwbare splits in het venster.

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

// Poefie-criteria
const POEFIE_MULT           = 2.25;   // 125% groei = 2.25× baseline
const POEFIE_MIN_DAYS       = 1;      // minimaal volgende dag
const POEFIE_MAX_DAYS       = 7;      // maximaal 7 kalenderdagen
const MIN_BASELINE_PRICE    = 0.10;   // penny stocks uitsluiten (te veel ruis)
const MIN_PEAK_PRICE        = 0.20;
const MAX_SINGLE_BAR_JUMP   = 5;      // bars die >5× springen → data-fout
const MAX_TRUSTED_SPLIT_RATIO = 5;    // splits met ratio ≥ 5 zijn verdacht
const MAX_HISTORICAL_PEAK   = 50_000; // tickers met absurde historische pieken (verwatering) overslaan
const MAX_DEACTIVATE_PEAK   = 500_000;
const MAX_INCIDENTS         = 500;    // hoge cap (poefies zijn frequenter dan feniks)
const MIN_GAP_DAYS          = 7;      // minimaal 7 dagen tussen het einde van een incident en de volgende baseline

const BATCH_SIZE = 50;
const RESCAN_DAYS = 90;
const BUDGET_MS = 100_000;
const SLEEP_MS = 400;

interface Bar { date: string; adjClose: number; rawClose: number; ms: number }
interface SplitEvent { date: string; numerator: number; denominator: number; ratio: number; ms: number }

async function fetchYahoo10y(ticker: string): Promise<{ bars: Bar[]; splits: SplitEvent[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d&events=split`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PoefieBot/1.0; +https://github.com)" },
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
    ms: s.date * 1000,
  }));
  return { bars, splits };
}

function effectiveSplitRatio(s: SplitEvent): number {
  const r = s.ratio;
  if (r >= 1) return r;
  return r > 0 ? 1 / r : 1;
}

// Heeft er tussen baseline_ms en peak_ms (inclusief) een split met
// effectieve ratio ≥ MAX_TRUSTED_SPLIT_RATIO plaatsgevonden? Zo ja, dan is
// de "groei" in adjClose mogelijk een split-artefact en gooien we het incident weg.
function suspiciousSplitInWindow(splits: SplitEvent[], baselineMs: number, peakMs: number): boolean {
  for (const s of splits) {
    if (s.ms < baselineMs || s.ms > peakMs) continue;
    if (effectiveSplitRatio(s) >= MAX_TRUSTED_SPLIT_RATIO) return true;
  }
  return false;
}

interface PoefieIncident {
  baseline_date: string;
  baseline_close: number;
  peak_date: string;
  peak_close: number;
  days_to_peak: number;
  peak_mult: number;
  growth_pct: number;
  raw_mult: number;
}

function cleanBars(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let prev = NaN;
  for (const b of bars) {
    // Verwerp bars die >5× boven de vorige bar zitten EN weer terugzakken
    // (klassiek symptoom van een data-fout). Echte poefies blijven minimaal
    // 1 dag op het hoge niveau; cleanBars verwijdert single-bar pieken alleen
    // als ze direct teruggaan, niet als ze de start zijn van een echte poefie.
    if (Number.isFinite(prev) && prev > 0 && b.adjClose >= prev * MAX_SINGLE_BAR_JUMP) {
      // Bewaar de bar maar markeer hem niet als 'prev' — zodat de volgende
      // bar weer tegen de oorspronkelijke prev wordt getoetst.
      out.push(b);
      continue;
    }
    out.push(b);
    prev = b.adjClose;
  }
  return out;
}

function findPoefieIncidents(bars: Bar[], splits: SplitEvent[]): PoefieIncident[] {
  if (bars.length < 5) return [];
  // Skip tickers met onbetrouwbare historische pieken (verwatering / herwaardering)
  let histPeak = 0;
  for (const b of bars) {
    if (b.adjClose > histPeak) histPeak = b.adjClose;
    if (b.rawClose > histPeak) histPeak = b.rawClose;
  }
  if (histPeak > MAX_HISTORICAL_PEAK) return [];

  const incidents: PoefieIncident[] = [];
  let i = 0;
  while (i < bars.length && incidents.length < MAX_INCIDENTS) {
    const baseAdj = bars[i].adjClose;
    const baseRaw = bars[i].rawClose;
    if (baseAdj < MIN_BASELINE_PRICE) { i++; continue; }
    const baselineMs = bars[i].ms;

    let best: { idx: number; days: number; mult: number; rawMult: number } | null = null;
    for (let j = i + 1; j < bars.length; j++) {
      const ms = bars[j].ms;
      const days = Math.round((ms - baselineMs) / 86400000);
      if (days > POEFIE_MAX_DAYS) break;
      if (days < POEFIE_MIN_DAYS) continue;
      if (bars[j].adjClose < MIN_PEAK_PRICE) continue;
      const mult = bars[j].adjClose / baseAdj;
      if (mult < POEFIE_MULT) continue;
      const rawMult = baseRaw > 0 ? bars[j].rawClose / baseRaw : 0;
      if (!best || mult > best.mult) best = { idx: j, days, mult, rawMult };
    }

    if (best) {
      const peakMs = bars[best.idx].ms;
      // Filter incidenten met een verdachte split in het venster — die zijn
      // vaak een artefact, geen echte koersbeweging.
      if (suspiciousSplitInWindow(splits, baselineMs, peakMs)) {
        i = best.idx + 1;
        continue;
      }
      // Extra sanity check: enkel-bar piek die meteen helemaal terugzakt naar
      // baseline binnen 1 dag (data-fout met 1 ruisbar).
      if (best.days === 1 && best.idx + 1 < bars.length) {
        const next = bars[best.idx + 1];
        if (next.adjClose < baseAdj * 1.5) {
          i = best.idx + 1;
          continue;
        }
      }
      const growthPct = (best.mult - 1) * 100;
      incidents.push({
        baseline_date: bars[i].date,
        baseline_close: Math.round(baseAdj * 10000) / 10000,
        peak_date: bars[best.idx].date,
        peak_close: Math.round(bars[best.idx].adjClose * 10000) / 10000,
        days_to_peak: best.days,
        peak_mult: Math.round(best.mult * 100) / 100,
        growth_pct: Math.round(growthPct * 10) / 10,
        raw_mult: Math.round(best.rawMult * 100) / 100,
      });
      // Spring voorbij de piek + minimum gap (anders krijgen we overlappende
      // incidenten waar elke bar na de piek alweer als nieuwe baseline telt).
      const gapMs = peakMs + MIN_GAP_DAYS * 86400000;
      let next = best.idx + 1;
      while (next < bars.length && bars[next].ms < gapMs) next++;
      i = Math.max(next, best.idx + 1);
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

function countWithinDays(incidents: PoefieIncident[], days: number, nowMs: number): number {
  const cutoff = nowMs - days * 86400000;
  let n = 0;
  for (const inc of incidents) {
    const t = new Date(inc.peak_date).getTime();
    if (Number.isFinite(t) && t >= cutoff) n++;
  }
  return n;
}

Deno.serve(runBackground("compute-poefies", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();
  const nowMs = Date.now();

  const cutoff = new Date(Date.now() - RESCAN_DAYS * 24 * 3600 * 1000).toISOString();
  const { data: tickers, error: fetchError } = await sb
    .from("signal_tickers")
    .select("ticker")
    .eq("active", true)
    .or(`is_poefie_at.is.null,is_poefie_at.lt.${cutoff}`)
    .order("is_poefie_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (fetchError) throw new Error(fetchError.message);
  const batch = (tickers ?? []) as { ticker: string }[];

  let checked = 0, poefieFound = 0, errors = 0, deactivated = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;

    let isPoefie = false;
    let deactivate = false;
    let lastPoefieDate: string | null = null;
    let incidents: PoefieIncident[] = [];
    let incidentCount = 0;
    let medianPeakDate: string | null = null;
    let maxGrowthPct: number | null = null;
    let medianDaysToPeak: number | null = null;
    let count6m = 0, count1y = 0, count2y = 0, count5y = 0;
    let looseData: Json | null = null;

    try {
      const { bars: rawBars, splits } = await fetchYahoo10y(row.ticker);
      const bars = cleanBars(rawBars);
      if (bars.length >= 5) {
        let histPeakAdj = 0;
        let histPeakRaw = 0;
        for (const b of bars) {
          if (b.adjClose > histPeakAdj) histPeakAdj = b.adjClose;
          if (b.rawClose > histPeakRaw) histPeakRaw = b.rawClose;
        }
        const histPeak = Math.max(histPeakAdj, histPeakRaw);

        looseData = {
          current_close: bars.length > 0 ? Math.round(bars[bars.length - 1].adjClose * 10000) / 10000 : null,
          hist_peak_adj: Math.round(histPeakAdj * 100) / 100,
          hist_peak_raw: Math.round(histPeakRaw * 100) / 100,
          splits: splits.map((s) => ({ date: s.date, ratio: Math.round(s.ratio * 1000) / 1000 })),
        };

        if (histPeak > MAX_DEACTIVATE_PEAK) {
          deactivate = true;
          deactivated++;
        } else {
          incidents = findPoefieIncidents(bars, splits);
          if (incidents.length > 0) {
            isPoefie = true;
            poefieFound++;
            lastPoefieDate = incidents[incidents.length - 1].peak_date;
            incidentCount = incidents.length;
            medianPeakDate = medianDate(incidents.map((i) => i.peak_date));
            maxGrowthPct = Math.max(...incidents.map((i) => i.growth_pct));
            const md = median(incidents.map((i) => i.days_to_peak));
            medianDaysToPeak = md != null ? Math.round(md) : null;
            count6m = countWithinDays(incidents, 182, nowMs);
            count1y = countWithinDays(incidents, 365, nowMs);
            count2y = countWithinDays(incidents, 730, nowMs);
            count5y = countWithinDays(incidents, 1825, nowMs);
          }
        }
      }
    } catch (e) {
      errors++;
      if (errMsgs.length < 5) errMsgs.push(`${row.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const updateFields: Record<string, unknown> = {
      is_poefie: isPoefie,
      is_poefie_at: new Date().toISOString(),
      poefie_last_date: lastPoefieDate,
      poefie_incident_count: isPoefie ? incidentCount : null,
      poefie_median_date: medianPeakDate,
      poefie_max_growth_pct: maxGrowthPct != null ? Math.round(maxGrowthPct * 10) / 10 : null,
      poefie_days_to_peak: medianDaysToPeak,
      poefie_count_6m: isPoefie ? count6m : null,
      poefie_count_1y: isPoefie ? count1y : null,
      poefie_count_2y: isPoefie ? count2y : null,
      poefie_count_5y: isPoefie ? count5y : null,
      poefie_incidents: isPoefie ? incidents : null,
      poefie_loose_data: looseData,
    };
    if (deactivate) {
      updateFields.active = false;
      updateFields.notes = `gedeactiveerd: historische close > $${MAX_DEACTIVATE_PEAK.toLocaleString("en")} (te ver verwaterd)`;
    }
    await sb.from("signal_tickers").update(updateFields).eq("ticker", row.ticker);
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, poefies ${poefieFound}, gedeactiveerd ${deactivated}, fouten ${errors}` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") + (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, poefies_found: poefieFound, deactivated, errors },
  };
}));
