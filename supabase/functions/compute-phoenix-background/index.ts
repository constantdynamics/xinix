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

// Skip-criterium: een ticker met een grote split (≥5:1 forward of reverse) in
// de afgelopen 10 jaar krijgt geen phoenix-flag, ook al detecteert het algoritme
// een 50× run. Yahoo's adjclose past niet altijd correct retroactief aan voor
// Europese / Aziatische / OTC-tickers, dus de 50× is bijna altijd fake.
const MAX_TRUSTED_SPLIT_RATIO = 5;
function hasUntrustworthySplit(splits: SplitEvent[]): boolean {
  for (const s of splits) {
    const r = s.ratio;
    if (r >= MAX_TRUSTED_SPLIT_RATIO || (r > 0 && r <= 1 / MAX_TRUSTED_SPLIT_RATIO)) return true;
  }
  return false;
}

// Vind de datum van de laatste echte 50× run. Het algoritme houdt het loop-minimum
// bij + de bar-index van dat minimum. Een bar telt alleen als feniks-piek als:
//   - baseline ≥ MIN_BASELINE_PRICE (geen sub-penny noise)
//   - piek ≥ MIN_PEAK_PRICE (echte hoogte, geen penny→cent flits)
//   - piek ≥ baseline × mult (de 50× zelf)
//   - er zitten ≥ MIN_RUN_BARS bars tussen baseline en piek (geen 1-bar jump =
//     altijd data-fout / split-artefact)
// Bij een latere crash naar een nieuwe low staat een nieuwe 50× run toe vanaf die
// low. We bewaren de meest recente match — null als er geen valide run gevonden is.
// Bonus: bars die meer dan MAX_SINGLE_BAR_JUMP× t.o.v. de vorige spiken worden
// overgeslagen (Yahoo serveert soms restanten van splits in adjclose).
function findLastPhoenixDate(bars: Bar[], mult: number): string | null {
  let minSoFar = Infinity;
  let minBarIdx = -1;
  let lastDate: string | null = null;
  let prevClose = NaN;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // Bar-to-bar jump check: een >10× rise in 1 weekly bar is geen organische
    // koersbeweging maar een split-data-artefact. Skip deze bar voor analyse
    // (reset prevClose zodat we erna verder kunnen).
    if (Number.isFinite(prevClose) && prevClose > 0 && b.close >= prevClose * MAX_SINGLE_BAR_JUMP) {
      prevClose = b.close;
      continue;
    }
    prevClose = b.close;

    if (b.close < minSoFar) {
      minSoFar = b.close;
      minBarIdx = i;
    } else if (
      minSoFar >= MIN_BASELINE_PRICE &&
      b.close >= MIN_PEAK_PRICE &&
      b.close >= minSoFar * mult &&
      (i - minBarIdx) >= MIN_RUN_BARS
    ) {
      lastDate = b.date;
    }
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
      const { bars, splits } = await fetchYahoo10y(row.ticker);
      if (bars.length >= 10) {
        if (hasUntrustworthySplit(splits)) {
          // Skip — adjclose-data is onbetrouwbaar door grote split, kans op vals positief.
          isPhoenix = false;
          last50xDate = null;
        } else {
          last50xDate = findLastPhoenixDate(bars, PHOENIX_MULT);
          isPhoenix = last50xDate != null;
          if (isPhoenix) phoenixFound++;
        }
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
