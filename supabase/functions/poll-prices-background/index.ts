import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
type Severity = "yellow" | "orange" | "red";
interface SignalInput { ticker: string; signal_type: string; severity: Severity; title: string; detail?: string; payload?: Record<string, unknown>; expires_at?: string | null; dedup_key?: string; }
async function insertSignal(sb: SupabaseClient, s: SignalInput): Promise<number | null> { const dedup = s.dedup_key ?? `${s.signal_type}:${s.ticker}`; const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); const { data: existing } = await sb.from("signal_events").select("id").eq("ticker", s.ticker).eq("signal_type", s.signal_type).gte("detected_at", since).contains("payload", { dedup_key: dedup }).limit(1); if (existing && existing.length > 0) return null; const payload = { ...(s.payload ?? {}), dedup_key: dedup }; const { data, error } = await sb.from("signal_events").insert({ ticker: s.ticker, signal_type: s.signal_type, severity: s.severity, title: s.title, detail: s.detail ?? null, payload, expires_at: s.expires_at ?? null }).select("id").single(); if (error) { console.error("insertSignal", error); return null; } return data.id; }
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }
function tt(req: Request, body: string, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string,string>|undefined) } }); }
function runBackground(job: string, fn: () => Promise<RunResult>) { return async (req: Request) => { const p = pf(req); if (p) return p; if (!checkAdminOrCron(req)) return tt(req, "Unauthorized", { status: 401 }); try { const r = await logRun(job, fn); return j(req, { ok: r.ok, ...r }, { status: r.ok ? 200 : 500 }); } catch (e) { return j(req, { ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }; }

// Round-robin price polling met bench. Per run de oudst-gescande
// active+niet-benched tickers, tijdsbudget ~110s, bench na 3 fails.
// Signalen die voor ELKE ticker mogen vuren (price_spike_up grote variant,
// volume_spike, near_90d_low) blijven; signalen die alleen relevant zijn
// voor tickers die je EXPLICIET wil kopen (big_drop, buy_limit_*) vuren
// alleen als er een buy_limit is gezet — anders flood bij 3600 tickers.
const BATCH_SIZE = 80;
const BUDGET_MS = 110_000;
const FAIL_BENCH_AT = 3;
// Tiered poll-cadans (IO-budget): favorieten 2× per handelsdag (guard voorkomt
// dubbele polls binnen één venster), overige tickers hooguit 1× per week.
const FAV_REPOLL_MS = 3 * 60 * 60 * 1000;        // favoriet: niet vaker dan elke 3u
const REST_STALE_MS = 7 * 24 * 60 * 60 * 1000;   // niet-favoriet: hooguit 1×/week

interface YahooBar { date: string; close: number | null; volume: number | null; }
interface YahooFetch { bars: YahooBar[]; dividendTtm: number; exchange: string | null; }
// range=1y zodat we (a) genoeg historie hebben voor de 90d/30d vensters en
// (b) de volledige trailing-12m dividenduitkeringen kunnen optellen
// (events=div geeft een map ts -> {amount,date}). meta.fullExchangeName
// gebruiken we om voor US-tickers de juiste Google-Finance exchange te kiezen.
async function fetchYahoo(ticker: string): Promise<YahooFetch> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&events=div`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BiotechSignalBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: { quote: Array<{ close: (number | null)[]; volume: (number | null)[] }> };
        events?: { dividends?: Record<string, { amount?: number; date?: number }> };
        meta?: { fullExchangeName?: string; exchangeName?: string };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = json.chart.result?.[0];
  if (!result) throw new Error(json.chart.error?.description ?? "no result");
  const ts = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  const volumes = result.indicators.quote[0]?.volume ?? [];
  const bars = ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? null, volume: volumes[i] ?? null }));
  const cutoff = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
  let dividendTtm = 0;
  for (const d of Object.values(result.events?.dividends ?? {})) {
    if (typeof d?.amount === "number" && typeof d?.date === "number" && d.date >= cutoff) dividendTtm += d.amount;
  }
  const exchange = result.meta?.fullExchangeName ?? result.meta?.exchangeName ?? null;
  return { bars, dividendTtm, exchange };
}
function pct(a: number, b: number): number { if (!b) return 0; return ((a - b) / b) * 100; }

// ── Exchange-aware polling: alleen polls als de beurs van een ticker NU open is.
// Gebruikt ruime vensters (incl. pre/post-market buffer + DST-tolerantie) zodat
// we ook ~1u voor en na regulier handelen polls doen (relevante bewegingen).
// Mon-Fri in UTC, behalve ASX die over middernacht loopt.
function openExchangesNow(now: Date): string[] {
  const day = now.getUTCDay();   // 0=Sun ... 6=Sat
  const hour = now.getUTCHours();
  const open: string[] = [];
  const isWeekday = day >= 1 && day <= 5;

  // Noord-Amerika: regulier 13:30-21:00 UTC. Met pre/post-market buffer 12-23 UTC. Ma-vr.
  if (isWeekday && hour >= 12 && hour < 23) {
    open.push(
      "NasdaqCM","NasdaqGS","NasdaqGM","NYSE","NYSE American","NYSEArca","Cboe US",
      "Toronto","TSXV","Canadian Sec",
      "OTC Markets OTCQB","OTC Markets OTCPK","OTC Markets OTCID","OTC Markets OTCQX",
    );
  }
  // Europa: regulier 07:00-16:30 UTC. Met buffer 06-17 UTC. Ma-vr.
  if (isWeekday && hour >= 6 && hour < 17) {
    open.push("LSE","Amsterdam","Paris","Frankfurt","XETRA","Milan");
  }
  // Azië (excl. ASX): 00-11 UTC dekt Tokyo (00-06), HK (01:30-08), Shanghai/Shenzhen,
  // Singapore, Jakarta, KL, India. Ma-vr.
  if (isWeekday && hour < 11) {
    open.push("HKSE","Tokyo","SES","Shanghai","Shenzhen","Jakarta","Kuala Lumpur","NSE","BSE");
  }
  // ASX (Sydney): Mon-Fri lokaal = Zon 22:00 UTC tot Vrij 07:00 UTC (UTC+10/11).
  // Sluit Sat helemaal, Zon vóór 22 UTC, Vrij na 07 UTC.
  const asxOpen =
    !(day === 6) &&
    !(day === 0 && hour < 22) &&
    !(day === 5 && hour >= 7);
  if (asxOpen) open.push("ASX");

  return open;
}

// ── Favoriet-vensters: welke beurzen zitten NU in een favoriet-poll-venster
// (~1u ná opening óf ~1u vóór sluiting)? Vensters zijn ruim (±) genomen zodat
// zomer-/wintertijd en cron-granulariteit worden opgevangen; de 3u-guard in de
// queue zorgt dat elk favoriet-venster tot exact één poll leidt. Mon-Fri.
function favPollWindowExchangesNow(now: Date): Set<string> {
  const day = now.getUTCDay();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const wk = day >= 1 && day <= 5;
  const out = new Set<string>();
  const NA = ["NasdaqCM", "NasdaqGS", "NasdaqGM", "NASDAQ", "NYSE", "NYSE American", "NYSEArca", "Cboe US", "Toronto", "TSXV", "Canadian Sec", "OTC Markets OTCQB", "OTC Markets OTCPK", "OTC Markets OTCID", "OTC Markets OTCQX"];
  const EU = ["LSE", "Amsterdam", "Paris", "Frankfurt", "XETRA", "Milan", "Warsaw", "Oslo"];
  const ASIA = ["HKSE", "Tokyo", "SES", "Shanghai", "Shenzhen", "Jakarta", "Kuala Lumpur", "NSE", "BSE"];
  // Noord-Amerika (regulier 13:30-21:00 UTC): open+1u 14:00-16:00, sluit-1u 19:30-21:30.
  if (wk && ((h >= 14 && h < 16) || (h >= 19.5 && h < 21.5))) NA.forEach((e) => out.add(e));
  // Europa (07:00-16:30 UTC): open+1u 08:00-09:30, sluit-1u 14:30-16:00.
  if (wk && ((h >= 8 && h < 9.5) || (h >= 14.5 && h < 16))) EU.forEach((e) => out.add(e));
  // Azië (00:00-11:00 UTC): open+1u 01:00-02:30, sluit-1u 09:00-10:30.
  if (wk && ((h >= 1 && h < 2.5) || (h >= 9 && h < 10.5))) ASIA.forEach((e) => out.add(e));
  // ASX (Sydney, UTC+10/11): open ~22:00 UTC → open+1u 23:00-00:30; sluit ~07:00 → sluit-1u 05:00-06:30.
  const asxMorning = (day >= 0 && day <= 4 && h >= 23) || (day >= 1 && day <= 5 && h < 0.5);
  const asxAfternoon = day >= 1 && day <= 5 && h >= 5 && h < 6.5;
  if (asxMorning || asxAfternoon) out.add("ASX");
  return out;
}

Deno.serve(runBackground("poll-prices", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Bepaal welke beurzen NU open zijn. Tickers van gesloten beurzen pollen we niet —
  // koersen bewegen toch niet en we belasten Yahoo nodeloos.
  const openExchanges = openExchangesNow(new Date());
  if (openExchanges.length === 0) {
    return { ok: true, message: "alle markten gesloten — geen polls", metrics: { skipped: "all-markets-closed" } };
  }

  // Filter: open beurzen OF onbekende beurs (null) — laatste polls als fallback.
  // Bouw OR-clause met eq per beurs (veiliger dan in.() bij PostgREST-parsing met spaties).
  const orClause = [
    ...openExchanges.map((e) => `exchange.eq.${e}`),
    "exchange.is.null",
  ].join(",");

  // Laad favorieten en koers-extremen parallel vóór queue-opbouw zodat we
  // favorieten altijd als eerste in de batch kunnen plaatsen (dagelijks vers).
  const [{ data: favData }, { data: extremes }] = await Promise.all([
    sb.from("xinix_favorites").select("ticker"),
    sb.from("signal_price_summary").select("ticker, high_1y, last_close"),
  ]);
  const high1yByTicker = new Map<string, number | null>();
  const prevCloseByTicker = new Map<string, number | null>();
  for (const r of extremes ?? []) {
    high1yByTicker.set(r.ticker as string, ((r as { high_1y?: number | null }).high_1y) ?? null);
    prevCloseByTicker.set(r.ticker as string, ((r as { last_close?: number | null }).last_close) ?? null);
  }
  const favSet = new Set<string>((favData ?? []).map((f) => f.ticker as string));
  const favTickers = Array.from(favSet);

  // Poll-queue met tiered cadans (IO-budget):
  //  • Favorieten: 2× per handelsdag — ~1u na opening en ~1u voor sluiting van
  //    hun eigen beurs. De 3u-guard voorkomt een tweede poll binnen één venster.
  //    Nieuw toegevoegde favoriet (nog nooit gepollt) wordt meteen opgehaald.
  //  • Overige tickers: hooguit 1× per week, alleen als hun beurs nu open is,
  //    oudst-gepollt eerst — verspreidt ~2100 tickers over de week.
  type QueueRow = { ticker: string; buy_limit: number | null; price_fail_count: number; exchange: string | null; goud_score: number | null; price_polled_at?: string | null };
  const nowQ = Date.now();
  const favWindow = favPollWindowExchangesNow(new Date());
  let queue: QueueRow[] = [];
  if (favTickers.length > 0) {
    const { data: favRows, error: fErr } = await sb
      .from("signal_tickers")
      .select("ticker, buy_limit, price_fail_count, exchange, goud_score, price_polled_at")
      .eq("active", true)
      .eq("price_benched", false)
      .in("ticker", favTickers);
    if (fErr) throw new Error((fErr as { message?: string }).message ?? String(fErr));
    queue = ((favRows ?? []) as QueueRow[]).filter((r) => {
      const pAt = r.price_polled_at ? new Date(r.price_polled_at).getTime() : 0;
      if (pAt === 0) return true;                    // nieuw → meteen ophalen
      if (nowQ - pAt < FAV_REPOLL_MS) return false;  // < 3u geleden gepollt
      return favWindow.has(r.exchange ?? "");        // alleen in een venster
    }).slice(0, BATCH_SIZE);
  }
  const remaining = BATCH_SIZE - queue.length;
  if (remaining > 0) {
    const staleBefore = new Date(nowQ - REST_STALE_MS).toISOString();
    const baseQuery = sb
      .from("signal_tickers")
      .select("ticker, buy_limit, price_fail_count, exchange, goud_score")
      .eq("active", true)
      .eq("price_benched", false)
      .or(orClause)
      .or(`price_polled_at.is.null,price_polled_at.lt.${staleBefore}`)
      .order("price_polled_at", { ascending: true, nullsFirst: true })
      .limit(remaining);
    const { data: regularQueue, error: rErr } = favTickers.length > 0
      ? await baseQuery.not("ticker", "in", `(${favTickers.join(",")})`)
      : await baseQuery;
    if (rErr) throw new Error((rErr as { message?: string }).message ?? String(rErr));
    queue = [...queue, ...((regularQueue ?? []) as QueueRow[])];
  }
  if (queue.length === 0) return { ok: true, message: "queue leeg (open markten: " + openExchanges.length + ")" };

  let scanned = 0, ok = 0, failed = 0, benched = 0, signalsInserted = 0, glitchSkipped = 0;
  const errSamples: string[] = [];
  const now = Date.now();
  for (const tk of queue) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const ticker = tk.ticker as string;
    const buyLimit = (tk as { buy_limit?: number | null }).buy_limit ?? null;
    const hasLimit = typeof buyLimit === "number" && buyLimit > 0;
    const score = (tk as { goud_score?: number | null }).goud_score ?? null;
    const isFav = favSet.has(ticker);
    const failCount = (tk as { price_fail_count?: number }).price_fail_count ?? 0;
    scanned++;
    try {
      const { bars, dividendTtm, exchange } = await fetchYahoo(ticker);
      const valid = bars.filter((b): b is YahooBar & { close: number } => b.close !== null);
      if (valid.length === 0) throw new Error("no valid bars");
      const last = valid[valid.length - 1];
      const prev = valid[valid.length - 2];
      // Glitch-guard: een koers die >=8x of <=1/8 t.o.v. de vorige dag (zelfde
      // reeks) of de laatst opgeslagen koers springt, is vrijwel zeker een
      // foute print of niet-aangepaste split. Niet wegschrijven — anders koopt/
      // waardeert de sim op een onmogelijke koers (bv. VOX.L pence/pond 100x).
      const refClose = prev?.close ?? prevCloseByTicker.get(ticker) ?? null;
      if (refClose && refClose > 0 && last.close > 0) {
        const jump = last.close / refClose;
        if (jump >= 8 || jump <= 0.125) {
          glitchSkipped++;
          await sb.from("signal_tickers").update({
            price_polled_at: new Date().toISOString(),
            price_last_error: `koers-glitch geweerd: ${last.close} vs ref ${refClose} (${jump.toFixed(1)}x)`,
          }).eq("ticker", ticker);
          continue;
        }
      }
      const fiveAgo = valid[valid.length - 6];
      const twentyTwoAgo = valid.length >= 23 ? valid[valid.length - 23] : null;
      const window90 = valid.slice(-90);
      const closes90 = window90.map((b) => b.close);
      const low90 = Math.min(...closes90);
      const high90 = Math.max(...closes90);
      const last30 = valid.slice(-30);
      const validVolumes = last30.map((b) => b.volume ?? 0).filter((v) => v > 0);
      const avgVol = validVolumes.reduce((a, b) => a + b, 0) / (validVolumes.length || 1);
      const lastVol = last.volume ?? 0;
      const volRatio = avgVol > 0 ? lastVol / avgVol : 0;
      const summary = { ticker, last_close: last.close, last_volume: lastVol, low_90d: low90, high_90d: high90, pct_above_90d_low: low90 > 0 ? pct(last.close, low90) : 0, pct_change_1d: prev ? pct(last.close, prev.close) : 0, pct_change_5d: fiveAgo ? pct(last.close, fiveAgo.close) : 0, pct_change_22d: twentyTwoAgo ? pct(last.close, twentyTwoAgo.close) : null, avg_volume_30d: Math.round(avgVol), volume_ratio: Number(volRatio.toFixed(2)), updated_at: new Date().toISOString() };
      await sb.from("signal_price_summary").upsert(summary, { onConflict: "ticker" });
      const divYield = last.close > 0 ? Number((dividendTtm / last.close).toFixed(5)) : 0;
      const tickerUpdate: Record<string, unknown> = { price_polled_at: new Date().toISOString(), price_fail_count: 0, price_last_error: null, dividend_yield: divYield };
      if (exchange) tickerUpdate.exchange = exchange;
      await sb.from("signal_tickers").update(tickerUpdate).eq("ticker", ticker);
      ok++;
      const today = new Date().toISOString().slice(0, 10);
      const expires7 = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
      const expires180 = new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString();

      // === buy-limit thresholds (alleen als limit gezet) ===
      if (hasLimit) {
        const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        const since180 = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString();
        if (last.close <= buyLimit!) {
          const { data: recent } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "buy_limit_hit").gte("detected_at", since7).limit(1);
          if (!recent || recent.length === 0) { const id = await insertSignal(sb, { ticker, signal_type: "buy_limit_hit", severity: "red", title: `${ticker} ≤ aankooplimiet $${buyLimit!.toFixed(2)}`, detail: `Koers $${last.close.toFixed(2)} bereikte of zakte onder jouw limit van $${buyLimit!.toFixed(2)}.`, payload: { last_close: last.close, buy_limit: buyLimit, threshold: "hit" }, expires_at: expires7, dedup_key: `buy_limit_hit:${ticker}:${today}` }); if (id) signalsInserted++; }
        } else if (last.close <= buyLimit! * 1.10) {
          const { data: recent } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "buy_limit_close").gte("detected_at", since180).limit(1);
          if (!recent || recent.length === 0) { const a = ((last.close - buyLimit!) / buyLimit!) * 100; const id = await insertSignal(sb, { ticker, signal_type: "buy_limit_close", severity: "red", title: `${ticker} +${a.toFixed(1)}% boven aankooplimiet`, detail: `Koers $${last.close.toFixed(2)} — ${a.toFixed(1)}% boven jouw limit van $${buyLimit!.toFixed(2)}. Op de radar (1×/6mnd).`, payload: { last_close: last.close, buy_limit: buyLimit, above_pct: a, threshold: "close" }, expires_at: expires180, dedup_key: `buy_limit_close:${ticker}:${today}` }); if (id) signalsInserted++; }
        } else if (last.close <= buyLimit! * 1.25) {
          const { data: recent } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "buy_limit_warmup").gte("detected_at", since180).limit(1);
          if (!recent || recent.length === 0) { const a = ((last.close - buyLimit!) / buyLimit!) * 100; const id = await insertSignal(sb, { ticker, signal_type: "buy_limit_warmup", severity: "red", title: `${ticker} +${a.toFixed(1)}% boven aankooplimiet`, detail: `Koers $${last.close.toFixed(2)} — ${a.toFixed(1)}% boven jouw limit van $${buyLimit!.toFixed(2)}. Eerste warmup-melding (1×/6mnd).`, payload: { last_close: last.close, buy_limit: buyLimit, above_pct: a, threshold: "warmup" }, expires_at: expires180, dedup_key: `buy_limit_warmup:${ticker}:${today}` }); if (id) signalsInserted++; }
        }
      }

      // === big_drop (alleen voor tickers met een buy_limit) ===
      if (hasLimit) {
        const high1y = high1yByTicker.get(ticker);
        if (typeof high1y === "number" && high1y > 0 && last.close <= high1y * 0.60) {
          const since14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
          const { data: recentDrop } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "big_drop").gte("detected_at", since14).limit(1);
          if (!recentDrop || recentDrop.length === 0) { const d = ((high1y - last.close) / high1y) * 100; const id = await insertSignal(sb, { ticker, signal_type: "big_drop", severity: "red", title: `${ticker} — ${d.toFixed(0)}% onder 1y high`, detail: `Koers $${last.close.toFixed(2)} vs 1y high $${high1y.toFixed(2)}. Materiële correctie — check thesis.`, payload: { last_close: last.close, high_1y: high1y, drop_pct: d }, expires_at: new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(), dedup_key: `big_drop:${ticker}:${today}` }); if (id) signalsInserted++; }
        }
      }

      // === generieke price signalen (voor alle tickers) ===
      if (summary.pct_above_90d_low <= 5) { const id = await insertSignal(sb, { ticker, signal_type: "near_90d_low", severity: "yellow", title: `${ticker} binnen 5% van 90-dag low`, detail: `Koers $${last.close.toFixed(2)}, 90d-low $${low90.toFixed(2)} (+${summary.pct_above_90d_low.toFixed(1)}%)`, payload: { last_close: last.close, low_90d: low90 }, expires_at: expires7, dedup_key: `near_90d_low:${ticker}:${today}` }); if (id) signalsInserted++; }
      if (summary.pct_change_1d >= 30 && volRatio >= 3) { const id = await insertSignal(sb, { ticker, signal_type: "price_spike_up", severity: "red", title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% met volume ${volRatio.toFixed(1)}×`, detail: `Koers $${last.close.toFixed(2)} (was $${prev?.close.toFixed(2)}). Vrijwel zeker net-event.`, payload: { pct: summary.pct_change_1d, volume_ratio: volRatio }, expires_at: expires7, dedup_key: `price_spike_up:${ticker}:${today}` }); if (id) signalsInserted++; }
      else if (summary.pct_change_1d >= 15 && volRatio >= 2) { const id = await insertSignal(sb, { ticker, signal_type: "price_spike_up", severity: "orange", title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% (vol ${volRatio.toFixed(1)}×)`, detail: `Koers $${last.close.toFixed(2)}. Materiële beweging.`, payload: { pct: summary.pct_change_1d, volume_ratio: volRatio }, expires_at: expires7, dedup_key: `price_spike_up:${ticker}:${today}` }); if (id) signalsInserted++; }
      else if (summary.pct_change_1d >= 8) { const id = await insertSignal(sb, { ticker, signal_type: "price_spike_up", severity: "yellow", title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% intraday`, detail: `Koers $${last.close.toFixed(2)}. Volume ratio ${volRatio.toFixed(1)}×.`, payload: { pct: summary.pct_change_1d, volume_ratio: volRatio }, expires_at: expires7, dedup_key: `price_spike_up:${ticker}:${today}` }); if (id) signalsInserted++; }
      if (volRatio >= 3 && Math.abs(summary.pct_change_1d) < 5 && summary.pct_change_1d >= -5) { const id = await insertSignal(sb, { ticker, signal_type: "volume_spike", severity: "yellow", title: `${ticker} ongewoon volume (${volRatio.toFixed(1)}×)`, detail: `Volume ${lastVol.toLocaleString()} vs gem. ${Math.round(avgVol).toLocaleString()}.`, payload: { volume_ratio: volRatio }, expires_at: expires7, dedup_key: `volume_spike:${ticker}:${today}` }); if (id) signalsInserted++; }

      // === favoriet-signalen ===
      if (isFav) {
        if (summary.pct_change_1d <= -10) { const id = await insertSignal(sb, { ticker, signal_type: "fav_big_drop_1d", severity: "red", title: `⭐ ${ticker} -${Math.abs(summary.pct_change_1d).toFixed(1)}% vandaag (favoriet)`, detail: `Koers $${last.close.toFixed(2)}. Scherpe daling bij een favoriet.`, payload: { pct: summary.pct_change_1d, last_close: last.close }, expires_at: expires7, dedup_key: `fav_big_drop_1d:${ticker}:${today}` }); if (id) signalsInserted++; }
        if (summary.pct_change_5d <= -20) { const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(); const { data: rDrop5 } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "fav_big_drop_5d").gte("detected_at", since7).limit(1); if (!rDrop5 || rDrop5.length === 0) { const id = await insertSignal(sb, { ticker, signal_type: "fav_big_drop_5d", severity: "red", title: `⭐ ${ticker} -${Math.abs(summary.pct_change_5d).toFixed(1)}% deze week (favoriet)`, detail: `Koers $${last.close.toFixed(2)}. Weekverlies bij een favoriet.`, payload: { pct: summary.pct_change_5d, last_close: last.close }, expires_at: expires7, dedup_key: `fav_big_drop_5d:${ticker}:${today}` }); if (id) signalsInserted++; } }
        if (hasLimit) {
          if (last.close <= buyLimit!) { const id = await insertSignal(sb, { ticker, signal_type: "fav_buy_limit_hit", severity: "red", title: `⭐ ${ticker} onder aankooplimiet $${buyLimit!.toFixed(2)} (favoriet)`, detail: `Koers $${last.close.toFixed(2)} — onder jouw limiet. Koopmoment?`, payload: { last_close: last.close, buy_limit: buyLimit }, expires_at: expires7, dedup_key: `fav_buy_limit_hit:${ticker}:${today}` }); if (id) signalsInserted++; }
          else { const abovePct = ((last.close - buyLimit!) / buyLimit!) * 100; if (abovePct <= 10) { const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(); const { data: rNear } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "fav_near_buy_limit").gte("detected_at", since7).limit(1); if (!rNear || rNear.length === 0) { const id = await insertSignal(sb, { ticker, signal_type: "fav_near_buy_limit", severity: "orange", title: `⭐ ${ticker} +${abovePct.toFixed(1)}% boven aankooplimiet (favoriet)`, detail: `Koers $${last.close.toFixed(2)}, limiet $${buyLimit!.toFixed(2)}. Bijna koopbaar.`, payload: { last_close: last.close, buy_limit: buyLimit, above_pct: abovePct }, expires_at: expires7, dedup_key: `fav_near_buy_limit:${ticker}:${today}` }); if (id) signalsInserted++; } } }
        }
      }

      // === #50: hoog dividendrendement (score ≥65, bruto yield >6%) ===
      if (typeof score === "number" && score >= 65 && divYield > 0.06) { const since180 = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString(); const { data: rDiv } = await sb.from("signal_events").select("id").eq("ticker", ticker).eq("signal_type", "high_div_yield").gte("detected_at", since180).limit(1); if (!rDiv || rDiv.length === 0) { const id = await insertSignal(sb, { ticker, signal_type: "high_div_yield", severity: "yellow", title: `${ticker} dividendrendement ${(divYield * 100).toFixed(1)}% (score ${score})`, detail: `Bruto yield ${(divYield * 100).toFixed(1)}% bij koers $${last.close.toFixed(2)}. Gecombineerd met score ≥65.`, payload: { div_yield: divYield, score, last_close: last.close }, expires_at: expires180, dedup_key: `high_div_yield:${ticker}:${today}` }); if (id) signalsInserted++; } }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const newFail = failCount + 1;
      const goBench = newFail >= FAIL_BENCH_AT;
      await sb.from("signal_tickers").update({ price_polled_at: new Date().toISOString(), price_fail_count: newFail, price_benched: goBench, price_last_error: msg.slice(0, 300) }).eq("ticker", ticker);
      failed++;
      if (goBench) benched++;
      if (errSamples.length < 5) errSamples.push(`${ticker}: ${msg}`);
    }
  }
  const { count: queueLeft } = await sb.from("signal_tickers").select("ticker", { count: "exact", head: true }).eq("active", true).eq("price_benched", false);
  const { count: benchedTotal } = await sb.from("signal_tickers").select("ticker", { count: "exact", head: true }).eq("active", true).eq("price_benched", true);
  return { ok: failed < scanned / 2, message: `${scanned} gescand, ${ok} ok, ${failed} fout, ${benched} nieuw op bank, ${signalsInserted} signals${glitchSkipped ? `, ${glitchSkipped} koers-glitch geweerd` : ""}` + (errSamples.length ? `; bv: ${errSamples.slice(0, 3).join("; ")}` : ""), metrics: { scanned, ok, failed, benched_new: benched, signals: signalsInserted, glitch_skipped: glitchSkipped, queue_size: queueLeft ?? null, benched_total: benchedTotal ?? null } };
}));
