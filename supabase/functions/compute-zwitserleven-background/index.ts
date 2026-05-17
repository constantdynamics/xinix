// compute-zwitserleven-background — scant de major indices op het Zwitserleven-profiel:
// hoog dividend (≥6.5% TTM), ver onder 5j-hoog (≥50%), met historische groeijaren.
// Filtert op "fallen angels" — aandelen met dividendzekerheid én historisch aangetoond
// herstelvermogen.
//
// Universum: NASDAQ-100 + DJIA + AEX + FTSE 100 + CAC 40 + SMI (~315 large-caps).
// Bewust GEEN signal_tickers (de Xinix-watchlist) — die is voor biotech/mining catalyst
// plays en bevat nauwelijks dividend-aandelen.
//
// Verwerkt max 40 tickers per run; herscan iedere 90 dagen per ticker.

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

const ALLOWED_ORIGINS = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function corsHeaders(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED_ORIGINS.has(o) ? o : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-cron-secret, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function runBackground(job: string, fn: (req: Request) => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401, headers: corsHeaders(req) });
    try {
      const r = await logRun(job, () => fn(req));
      return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { ...corsHeaders(req), "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders(req), "content-type": "application/json" } });
    }
  };
}

const BATCH_SIZE = 40;
const RESCAN_DAYS = 90;
const BUDGET_MS = 128_000;
const SLEEP_MS = 500; // 2 API calls per ticker, iets meer rust

// Criteria voor "meets_criteria"
const MIN_YIELD_PCT = 6.5;
const MIN_UNDER_5Y_HIGH_PCT = 50; // koers ≥50% onder 5j-hoog
const MIN_MAX_ANNUAL_GAIN = 25;   // minstens 1 jaar met ≥25% stijging
const MIN_YEARS_5PCT = 2;         // minstens 2 jaar met ≥5% stijging

// ── INDEX_UNIVERSE ──────────────────────────────────────────────────────────
// Hoogste indices van de 6 markten waar dividend-aandelen vandaan moeten komen.
// LET OP: zelfde lijst staat in zwitserleven-results/index.ts (UNIVERSE_SIZE).
// Bij wijziging hier → ook daar bijwerken.
const DJIA: string[] = [
  "AAPL","AMGN","AMZN","AXP","BA","CAT","CRM","CSCO","CVX","DIS",
  "GS","HD","HON","IBM","JNJ","JPM","KO","MCD","MMM","MRK",
  "MSFT","NKE","NVDA","PG","SHW","TRV","UNH","V","VZ","WMT",
];
const NASDAQ_100: string[] = [
  "AAPL","ABNB","ADBE","ADI","ADP","ADSK","AEP","AMAT","AMD","AMGN",
  "AMZN","ANSS","APP","ARM","ASML","AVGO","AXON","AZN","BIIB","BKNG",
  "BKR","CCEP","CDNS","CDW","CEG","CHTR","CMCSA","COST","CPRT","CRWD",
  "CSCO","CSGP","CSX","CTAS","CTSH","DASH","DDOG","DXCM","EA","EXC",
  "FANG","FAST","FTNT","GEHC","GFS","GILD","GOOG","GOOGL","HON","IDXX",
  "INTC","INTU","ISRG","KDP","KHC","KLAC","LIN","LRCX","LULU","MAR",
  "MCHP","MDB","MDLZ","MELI","META","MNST","MRVL","MSFT","MU","NFLX",
  "NVDA","NXPI","ODFL","ON","ORLY","PANW","PAYX","PCAR","PDD","PEP",
  "PLTR","PYPL","QCOM","REGN","ROP","ROST","SBUX","SNPS","TEAM","TMUS",
  "TSLA","TTD","TTWO","TXN","VRSK","VRTX","WBD","WDAY","XEL","ZS",
];
// AEX (NL, 25 hoofdfondsen) — Yahoo suffix .AS
const AEX: string[] = [
  "ADYEN.AS","AGN.AS","AD.AS","AKZA.AS","MT.AS","ASML.AS","ASM.AS","ASRNL.AS","BESI.AS","DSFIR.AS",
  "EXO.AS","GLPG.AS","HEIA.AS","IMCD.AS","INGA.AS","KPN.AS","NN.AS","PHIA.AS","PRX.AS","RAND.AS",
  "REL.AS","SHELL.AS","UMG.AS","UNA.AS","WKL.AS",
];
// FTSE 100 (UK) — Yahoo suffix .L
const FTSE_100: string[] = [
  "AAL.L","ABF.L","ADM.L","AHT.L","ANTO.L","AUTO.L","AV.L","AZN.L","BA.L","BARC.L",
  "BATS.L","BDEV.L","BEZ.L","BKG.L","BME.L","BNZL.L","BP.L","BRBY.L","BT-A.L","CCH.L",
  "CNA.L","CPG.L","CRDA.L","CRH.L","CTEC.L","DCC.L","DGE.L","DPLM.L","EDV.L","ENT.L",
  "EXPN.L","EZJ.L","FCIT.L","FRAS.L","FRES.L","GLEN.L","GSK.L","HIK.L","HL.L","HLN.L",
  "HSBA.L","HSX.L","HWDN.L","IAG.L","ICG.L","IHG.L","III.L","IMB.L","IMI.L","INF.L",
  "ITRK.L","JD.L","KGF.L","LAND.L","LGEN.L","LLOY.L","LMP.L","LSEG.L","MNDI.L","MNG.L",
  "MRO.L","NG.L","NWG.L","NXT.L","PHNX.L","PRU.L","PSH.L","PSN.L","PSON.L","REL.L",
  "RIO.L","RKT.L","RR.L","RS1.L","RTO.L","SBRY.L","SDR.L","SGE.L","SGRO.L","SHEL.L",
  "SMDS.L","SMIN.L","SMT.L","SN.L","SPX.L","SSE.L","STAN.L","STJ.L","SVT.L","TSCO.L",
  "TW.L","ULVR.L","UTG.L","UU.L","VOD.L","WEIR.L","WPP.L","WTB.L",
];
// CAC 40 (FR) — Yahoo suffix .PA
const CAC_40: string[] = [
  "AC.PA","AI.PA","AIR.PA","ALO.PA","CS.PA","BNP.PA","EN.PA","CAP.PA","CA.PA","ACA.PA",
  "BN.PA","DSY.PA","EDEN.PA","ENGI.PA","EL.PA","ERF.PA","RMS.PA","KER.PA","LR.PA","OR.PA",
  "MC.PA","ML.PA","ORA.PA","RI.PA","PUB.PA","SGO.PA","SAN.PA","SU.PA","GLE.PA","STLAP.PA",
  "STMPA.PA","TEP.PA","HO.PA","TTE.PA","URW.PA","VIE.PA","DG.PA","VIV.PA",
];
// SMI (Zwitserland) — Yahoo suffix .SW
const SMI: string[] = [
  "ABBN.SW","ALC.SW","GEBN.SW","GIVN.SW","HOLN.SW","KNIN.SW","LOGN.SW","LONN.SW","NESN.SW","NOVN.SW",
  "PGHN.SW","ROG.SW","SCMN.SW","SGSN.SW","SIKA.SW","SLHN.SW","SOON.SW","SREN.SW","UBSG.SW","ZURN.SW",
];

const INDEX_UNIVERSE: string[] = [...new Set([
  ...DJIA, ...NASDAQ_100, ...AEX, ...FTSE_100, ...CAC_40, ...SMI,
])];

interface Bar { date: string; close: number; }
interface DivEvent { date: string; amount: number; }

async function fetchYahoo5yWeekly(ticker: string): Promise<{ bars: Bar[]; divs: DivEvent[] }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1wk&events=div`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ZwitserBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = await res.json() as {
    chart: {
      result?: Array<{
        timestamp: number[];
        events?: { dividends?: Record<string, { amount: number; date: number }> };
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
  const bars = ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN }))
    .filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
  const divMap = r.events?.dividends ?? {};
  const divs: DivEvent[] = Object.values(divMap)
    .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { bars, divs };
}

async function fetchQuoteSummary(ticker: string): Promise<{ payoutRatio: number | null; country: string | null; currency: string | null; company: string | null; exchange: string | null; sector: string | null }> {
  try {
    const url = `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,assetProfile,price`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ZwitserBot/1.0; +https://github.com)" } });
    if (!res.ok) return { payoutRatio: null, country: null, currency: null, company: null, exchange: null, sector: null };
    const json = await res.json() as {
      quoteSummary?: {
        result?: Array<{
          summaryDetail?: { payoutRatio?: { raw?: number }; currency?: string };
          assetProfile?: { country?: string; sector?: string };
          price?: { longName?: string; shortName?: string; fullExchangeName?: string; exchangeName?: string };
        }>;
      };
    };
    const r = json.quoteSummary?.result?.[0];
    return {
      payoutRatio: r?.summaryDetail?.payoutRatio?.raw ?? null,
      country: r?.assetProfile?.country ?? null,
      currency: r?.summaryDetail?.currency ?? null,
      company: r?.price?.longName ?? r?.price?.shortName ?? null,
      exchange: r?.price?.fullExchangeName ?? r?.price?.exchangeName ?? null,
      sector: r?.assetProfile?.sector ?? null,
    };
  } catch {
    return { payoutRatio: null, country: null, currency: null, company: null, exchange: null, sector: null };
  }
}

interface Metrics {
  lastClose: number;
  high5y: number;
  pctUnder5yHigh: number;
  annualDividend: number;
  dividendYieldPct: number;
  dividendCuts5y: number;
  maxAnnualGain5y: number | null;
  years5pctGrowth: number;
  divYieldByYear: (number | null)[]; // [y1, y2, y3, y4, y5] = [vorig jaar … 5 jaar geleden]
}

function computeMetrics(bars: Bar[], divs: DivEvent[]): Metrics | null {
  if (bars.length < 10) return null;
  const lastClose = bars[bars.length - 1].close;
  const high5y = Math.max(...bars.map((b) => b.close));
  const pctUnder5yHigh = high5y > 0 ? ((high5y - lastClose) / high5y) * 100 : 0;

  // Jaarlijkse rendementen: vergelijk eindekoers van elk jaar met het vorige
  const byYear: Record<number, number[]> = {};
  for (const b of bars) {
    const y = parseInt(b.date.slice(0, 4));
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(b.close);
  }
  const years = Object.keys(byYear).map(Number).sort();
  const annualReturns: number[] = [];
  for (let i = 1; i < years.length; i++) {
    const prev = byYear[years[i - 1]];
    const curr = byYear[years[i]];
    const prevClose = prev[prev.length - 1];
    const currClose = curr[curr.length - 1];
    if (prevClose > 0) annualReturns.push(((currClose - prevClose) / prevClose) * 100);
  }
  const maxAnnualGain5y = annualReturns.length > 0 ? Math.max(...annualReturns) : null;
  const years5pctGrowth = annualReturns.filter((r) => r >= 5).length;

  // TTM dividend: som van alle dividenden in de afgelopen 12 maanden
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recentDivs = divs.filter((d) => d.date >= oneYearAgo);
  const annualDividend = recentDivs.reduce((s, d) => s + d.amount, 0);
  const dividendYieldPct = lastClose > 0 && annualDividend > 0 ? (annualDividend / lastClose) * 100 : 0;

  // Dividendkortingen: vergelijk jaarlijkse dividend-totalen
  const divByYear: Record<number, number> = {};
  for (const d of divs) {
    const y = parseInt(d.date.slice(0, 4));
    divByYear[y] = (divByYear[y] ?? 0) + d.amount;
  }
  const divYears = Object.keys(divByYear).map(Number).sort();
  let dividendCuts5y = 0;
  for (let i = 1; i < divYears.length; i++) {
    // >10% daling telt als korting (kleine variaties door ex-datum timing negeren)
    if (divByYear[divYears[i]] < divByYear[divYears[i - 1]] * 0.9) dividendCuts5y++;
  }

  // Per-jaar dividendrendement: y1 = vorig jaar, y5 = 5 jaar geleden.
  // Gebruik de eindkoers van dat jaar als noemer (voor lopend jaar: huidige koers).
  const currentYear = new Date().getFullYear();
  const divYieldByYear: (number | null)[] = [];
  for (let offset = 1; offset <= 5; offset++) {
    const year = currentYear - offset;
    const divTotal = divByYear[year] ?? 0;
    if (divTotal === 0) { divYieldByYear.push(null); continue; }
    const yearBars = byYear[year];
    if (!yearBars || yearBars.length === 0) { divYieldByYear.push(null); continue; }
    const priceAtYearEnd = yearBars[yearBars.length - 1];
    if (priceAtYearEnd <= 0) { divYieldByYear.push(null); continue; }
    divYieldByYear.push(Math.round((divTotal / priceAtYearEnd) * 10000) / 100);
  }

  return { lastClose, high5y, pctUnder5yHigh, annualDividend, dividendYieldPct, dividendCuts5y, maxAnnualGain5y, years5pctGrowth, divYieldByYear };
}

function computeRiskLabel(cuts: number, payoutRatio: number | null, years5pct: number): string {
  if (cuts > 2 || (payoutRatio != null && payoutRatio > 1.0)) return "Zeer hoog";
  if (cuts === 2 || (payoutRatio != null && payoutRatio > 0.85)) return "Hoog";
  if (cuts === 1 || (payoutRatio != null && payoutRatio > 0.7) || years5pct < 2) return "Matig";
  return "Laag"; // cuts=0, pr≤0.70 of onbekend, years5pct≥2
}

function checkMeetsCriteria(m: Metrics): boolean {
  if (m.dividendYieldPct < MIN_YIELD_PCT) return false;
  if (m.pctUnder5yHigh < MIN_UNDER_5Y_HIGH_PCT) return false;
  if (m.maxAnnualGain5y == null || m.maxAnnualGain5y < MIN_MAX_ANNUAL_GAIN) return false;
  if (m.years5pctGrowth < MIN_YEARS_5PCT) return false;
  return true;
}

Deno.serve(runBackground("compute-zwitserleven", async (req) => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Force-scan modes:
  //   ?ticker=XYZ          → scan alleen deze ene ticker (bypass 90d cutoff)
  //   ?ticker=XYZ&manual=1 → idem, en markeer als handmatig toegevoegd
  //                          (gaat NIET via signal_tickers — direct in zwitserleven_stocks)
  const url = new URL(req.url);
  const forceTicker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const isManualAdd = url.searchParams.get("manual") === "1";

  let batch: { ticker: string; company: string | null; exchange: string | null; sector: string | null }[];
  if (forceTicker) {
    // Force-scan één ticker (kan elke beurs zijn, hoeft niet in INDEX_UNIVERSE te staan).
    // Bij isManualAdd=1: meteen aanmaken in zwitserleven_stocks met is_manual=true,
    // ook als nog geen scan-data beschikbaar is.
    batch = [{ ticker: forceTicker, company: null, exchange: null, sector: null }];
  } else {
    // Reguliere batch: kies uit INDEX_UNIVERSE de tickers die nooit zijn gescand
    // of waarvan de laatste scan langer dan RESCAN_DAYS geleden is.
    const cutoff = new Date(Date.now() - RESCAN_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: scanned, error: fetchError } = await sb
      .from("zwitserleven_stocks")
      .select("ticker, scanned_at")
      .in("ticker", INDEX_UNIVERSE);
    if (fetchError) throw new Error(fetchError.message);
    const scannedMap = new Map<string, string | null>();
    for (const r of (scanned ?? [])) scannedMap.set(r.ticker as string, (r.scanned_at as string | null) ?? null);

    const candidates = INDEX_UNIVERSE
      .map((t) => ({ ticker: t, scannedAt: scannedMap.get(t) ?? null }))
      .filter((c) => c.scannedAt == null || c.scannedAt < cutoff)
      .sort((a, b) => {
        if (a.scannedAt == null && b.scannedAt == null) return 0;
        if (a.scannedAt == null) return -1;
        if (b.scannedAt == null) return 1;
        return a.scannedAt.localeCompare(b.scannedAt);
      })
      .slice(0, BATCH_SIZE);
    batch = candidates.map((c) => ({ ticker: c.ticker, company: null, exchange: null, sector: null }));
  }

  let checked = 0, foundCount = 0, errors = 0;
  const errMsgs: string[] = [];

  for (const row of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    const now = new Date().toISOString();
    try {
      const [{ bars, divs }, summary] = await Promise.all([
        fetchYahoo5yWeekly(row.ticker),
        fetchQuoteSummary(row.ticker),
      ]);
      const m = computeMetrics(bars, divs);
      // Verkies meta van Yahoo boven (lege) row-meta — voor index-tickers is row.* leeg.
      const company  = summary.company  ?? row.company;
      const exchange = summary.exchange ?? row.exchange;
      const sector   = summary.sector   ?? row.sector;
      if (!m) {
        await sb.from("zwitserleven_stocks").upsert({
          ticker: row.ticker, company, exchange, sector,
          meets_criteria: false, error_msg: "te weinig data", scanned_at: now,
          ...(isManualAdd ? { is_manual: true } : {}),
        }, { onConflict: "ticker" });
      } else {
        const meets = checkMeetsCriteria(m);
        const riskLabel = computeRiskLabel(m.dividendCuts5y, summary.payoutRatio, m.years5pctGrowth);
        if (meets) foundCount++;

        // Controleer of dit een nieuw "Laag"-risico aandeel is dat nog niet eerder was gevonden
        // zodat we niet bij elke 90-daagse herscan opnieuw een notificatie sturen.
        let isNewLaag = false;
        if (meets && riskLabel === "Laag") {
          const { data: existing } = await sb
            .from("zwitserleven_stocks")
            .select("meets_criteria, risk_label")
            .eq("ticker", row.ticker)
            .single();
          const wasAlreadyLaag = existing?.meets_criteria === true && existing?.risk_label === "Laag";
          isNewLaag = !wasAlreadyLaag;
        }

        await sb.from("zwitserleven_stocks").upsert({
          ticker: row.ticker,
          company,
          exchange,
          country: summary.country,
          sector,
          last_close: m.lastClose,
          currency: summary.currency,
          dividend_yield_pct: Math.round(m.dividendYieldPct * 100) / 100,
          annual_dividend: Math.round(m.annualDividend * 10000) / 10000,
          high_5y: m.high5y,
          pct_under_5y_high: Math.round(m.pctUnder5yHigh * 100) / 100,
          max_annual_gain_5y: m.maxAnnualGain5y != null ? Math.round(m.maxAnnualGain5y * 100) / 100 : null,
          years_5pct_growth_5y: m.years5pctGrowth,
          payout_ratio: summary.payoutRatio,
          dividend_cuts_5y: m.dividendCuts5y,
          risk_label: riskLabel,
          meets_criteria: meets,
          error_msg: null,
          scanned_at: now,
          div_yield_y1: m.divYieldByYear[0] ?? null,
          div_yield_y2: m.divYieldByYear[1] ?? null,
          div_yield_y3: m.divYieldByYear[2] ?? null,
          div_yield_y4: m.divYieldByYear[3] ?? null,
          div_yield_y5: m.divYieldByYear[4] ?? null,
          ...(isManualAdd ? { is_manual: true } : {}),
        }, { onConflict: "ticker" });

        // Notificatie voor nieuw gevonden Laag-risico aandeel — 🌴
        if (isNewLaag) {
          const yieldStr = `${m.dividendYieldPct.toFixed(1)}%`;
          const underStr = `${m.pctUnder5yHigh.toFixed(1)}%`;
          await sb.from("signal_events").insert({
            ticker: row.ticker,
            signal_type: "zwitserleven_laag",
            severity: "yellow",
            title: `🌴 ${row.ticker} · Zwitserleven Laag risico · dividend ${yieldStr}`,
            detail: `${company ?? row.ticker} · Dividend ${yieldStr} TTM · ${underStr} onder 5j-hoog · Laag dividendrisico. Voldoet aan alle Zwitserleven-criteria.`,
          });
        }
      }
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      if (errMsgs.length < 5) errMsgs.push(`${row.ticker}: ${msg}`);
      await sb.from("zwitserleven_stocks").upsert({
        ticker: row.ticker, company: row.company, exchange: row.exchange, sector: row.sector,
        meets_criteria: false, error_msg: msg.slice(0, 200), scanned_at: now,
        ...(isManualAdd ? { is_manual: true } : {}),
      }, { onConflict: "ticker" });
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  const remaining = batch.length - checked;
  return {
    ok: errors < Math.max(1, checked),
    message: `batch ${batch.length}, gecheckt ${checked}, gevonden ${foundCount}, fouten ${errors}` +
      (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : "") +
      (remaining > 0 ? `; ${remaining} overgeslagen (tijdslimiet)` : ""),
    metrics: { batch_size: batch.length, checked, found: foundCount, errors },
  };
}));
