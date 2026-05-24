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
// LET OP: CRH.L verwijderd — CRH plc verhuisde primaire notering naar NYSE in 2023.
// CRH zit nu in DJIA. CRH.L heeft stale Yahoo data (return of capital als dividend → 128%).
const FTSE_100: string[] = [
  "AAL.L","ABF.L","ADM.L","AHT.L","ANTO.L","AUTO.L","AV.L","AZN.L","BA.L","BARC.L",
  "BATS.L","BDEV.L","BEZ.L","BKG.L","BME.L","BNZL.L","BP.L","BRBY.L","BT-A.L","CCH.L",
  "CNA.L","CPG.L","CRDA.L","CTEC.L","DCC.L","DGE.L","DPLM.L","EDV.L","ENT.L",
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

// ── MIDCAP / SECUNDAIRE INDICES ──────────────────────────────────────────────
// Per land één index-niveau onder de bluechip-index. Veel dividend-rijke namen
// zitten juist in deze midcap-sets. Total ~360 extra unieke tickers.

// S&P MidCap 400 — gekozen subset van dividend-georiënteerde midcaps (US, no suffix).
const SP_MIDCAP_400: string[] = [
  "AAP","ACA","ACIW","ADC","AFG","AGCO","AGI","ALE","ALV","AM","AMED","AMG","AN","AOS","APAM","APG","APH",
  "ARMK","ARW","ASB","ASGN","ASH","ATKR","ATR","AVA","AVNT","AVT","AWI","AYI","BANF","BC","BCO","BCPC","BDC",
  "BERY","BFAM","BHE","BHF","BIO","BJ","BKH","BLD","BLKB","BMI","BOH","BRBR","BRC","BRX","BWXT","BYD",
  "CABO","CAR","CASY","CBSH","CBT","CC","CCK","CCS","CFR","CHE","CHX","CLF","CLH","CMA","CMC","CNX","COKE",
  "COLB","COLM","CR","CRI","CRL","CROX","CRUS","CSL","CUBE","CUZ","CW","CWAN","DAR","DCI","DCO","DKL",
  "DKS","DLB","DLX","DNB","DOOO","DOX","DTM","DV","DVA","EAT","EBC","ECPG","EE","EHC","ELS","EME","EMN",
  "ENR","ENS","ENSG","EPAM","EPC","EPR","ERIE","ESI","ETD","EVR","EVTC","EXLS","EXP","EXPO","FAF","FBP",
  "FCFS","FDS","FELE","FFIN","FHB","FHN","FIVE","FIX","FL","FLO","FLR","FN","FNB","FR","G","GATX","GBCI",
  "GEF","GGG","GHC","GMS","GNTX","GPI","GTLS","GVA","H","HAS","HE","HELE","HFWA","HGV","HIW","HMN","HOG",
  "HOMB","HQY","HRB","HSII","HSIC","HUBB","HUBG","HVT","HXL","IDA","IDCC","IDXX","IEX","IFF","IIIV","INSM",
  "IOSP","IP","IPGP","ITRI","J","JACK","JBL","JBLU","JEF","JOE","JWN","KBH","KBR","KEX","KFY","KMPR","KMX",
  "KNF","KSS","LAD","LAMR","LANC","LEG","LEN","LFUS","LH","LHX","LITE","LIVN","LM","LNTH","LOPE","LPLA",
  "LPX","M","MAC","MAN","MANH","MAS","MASI","MAT","MATX","MBC","MCRI","MCS","MD","MDC","MDU","MEDP","MGEE",
  "MGM","MHK","MIDD","MKC","MKL","MKSI","MKTX","MLI","MMS","MOG-A","MORN","MOS","MPW","MPWR","MRCY","MSA",
  "MSCI","MSGS","MSI","MSM","MTDR","MTH","MTN","MTRN","MTSI","MTZ","MUR","MUSA","NAVI","NBR","NCLH","NDSN",
  "NEU","NFG","NJR","NLY","NNN","NOG","NOV","NPK","NRG","NSP","NTAP","NTR","NUS","NVST","NWE","NXST","NXT",
  "NYT","ODP","OEC","OFC","OGE","OGS","OHI","OI","OII","OLED","OLLI","OLN","OMC","OMCL","OMI","ONB","ONTO",
  "ORI","OSIS","OSK","OUT","OZK","PAG","PARR","PB","PBF","PBH","PCH","PCTY","PDCO","PDM","PEB","PFGC","PFSI",
  "PI","PII","PINC","PNFP","PNM","PNW","POOL","POR","POST","POWI","POWL","PPC","PRGS","PRI","PRIM","PSN",
  "PSTG","PTC","PVH","PWR","R","RBA","RCM","RDN","REG","REVG","REXR","REYN","RGA","RGEN","RGLD","RH","RHI",
  "RHP","RJF","RLI","RNR","ROCK","ROL","ROST","RPM","RRC","RRX","RSG","RUSHA","RYAAY","RYN","SAH","SAIA",
  "SAIC","SAM","SANM","SBAC","SBRA","SCCO","SCI","SDGR","SEAS","SEE","SEIC","SEM","SF","SFM","SGRY","SIG",
  "SIGI","SITE","SJM","SJW","SKT","SKYW","SLG","SLM","SM","SMG","SMP","SNDR","SNX","SON","SPB","SPSC","SPXC",
  "SR","SRC","SRPT","SSB","SSD","SSNC","STAG","STC","STE","STN","STRA","STRL","SWX","SXI","SXT","SYNA","TAP",
  "TCBI","TDS","TDY","TECH","TEX","TFII","TFSL","TFX","TGNA","THC","THG","THO","THS","TKR","TMHC","TMP",
  "TNDM","TNET","TNL","TOL","TOWN","TPB","TPH","TPL","TPR","TR","TRC","TREE","TREX","TRMB","TRMK","TRN",
  "TRNO","TROW","TRS","TRUP","TSE","TTC","TTEK","TTMI","TXRH","U","UCB","UCBI","UDR","UE","UFCS","UFI",
  "UFPI","UFPT","UGI","UHAL","UHS","UHT","UMBF","UNF","UNFI","UNIT","UNM","USFD","USLM","USPH","UVE","UVSP",
  "UVV","VAC","VAL","VC","VCEL","VECO","VEEV","VFC","VG","VIRT","VITL","VLY","VNDA","VOC","VPG","VRRM",
  "VRSK","VRT","VRTV","VSAT","VSCO","VSEC","VSH","VVI","VVV","W","WAFD","WAL","WBS","WBT","WCC","WD","WDFC",
  "WEN","WERN","WEX","WGO","WH","WHD","WHR","WIRE","WLK","WLY","WMS","WNS","WOR","WSC","WSFS","WSM","WSO",
  "WST","WTFC","WTRG","WTS","WTW","WU","WWD","WWW","WYNN","X","XENE","XHR","XPER","XPO","XRX","YELP","YETI",
  "ZD","ZION",
];

// AMX (Amsterdam Midkap Index, 25 fondsen) — Yahoo suffix .AS
const AMX: string[] = [
  "AALB.AS","ALFEN.AS","ALLFG.AS","AMG.AS","APAM.AS","ARCAD.AS","AZRN.AS","BFIT.AS","BRNL.AS","CMCOM.AS",
  "CTPNV.AS","ECMPA.AS","FAGR.AS","FUR.AS","INPST.AS","JDEP.AS","LIGHT.AS","OCI.AS","PHARM.AS","PNL.AS",
  "SBMO.AS","TKWY.AS","VPK.AS","WHA.AS",
];

// FTSE 250 — gekozen subset van dividend-georiënteerde UK midcaps (Yahoo suffix .L)
const FTSE_250: string[] = [
  "AAF.L","AGR.L","AJB.L","ANE.L","AO.L","APAX.L","AT.L","ATG.L","AUB.L","BAB.L","BAG.L","BAKK.L","BBOX.L",
  "BBY.L","BCG.L","BGS.L","BME.L","BNKR.L","BOY.L","BWY.L","BYG.L","CARD.L","CCR.L","CINE.L","CLDN.L",
  "COA.L","CTY.L","CWK.L","DRX.L","ECM.L","ELM.L","EMG.L","ESP.L","ETO.L","FCF.L","FEET.L","FGT.L","FOXT.L",
  "FXPO.L","GAW.L","GENL.L","GLO.L","GNK.L","GRG.L","GROW.L","HARL.L","HFEL.L","HMSO.L","HOC.L","HSV.L",
  "HVPE.L","IGG.L","IGR.L","INCH.L","IPO.L","IPX.L","IWG.L","JLEN.L","KIE.L","LRE.L","MGGT.L","MGNS.L",
  "MNKS.L","MONY.L","MRC.L","NCC.L","OCDO.L","OSB.L","PAGE.L","PCT.L","PCTN.L","PFC.L","PHP.L","PNN.L",
  "POLR.L","PSDL.L","PZC.L","QQ.L","RAT.L","RDW.L","RSW.L","SAFE.L","SDR.L","SDY.L","SMP.L","SMRT.L","SNN.L",
  "SPI.L","SRP.L","SXS.L","SYNC.L","TATE.L","TBCG.L","TCAP.L","TEM.L","THRG.L","TPK.L","TPX.L","TRY.L",
  "TUI.L","TUNE.L","VANQ.L","VICO.L","VTY.L","WG.L","WIZZ.L","WKP.L","WMH.L","WTAN.L",
];

// CAC Mid 60 (Paris midcap, ≈60 fondsen) — Yahoo suffix .PA
const CAC_MID_60: string[] = [
  "ALD.PA","AKE.PA","AM.PA","ATO.PA","BB.PA","BIM.PA","BOL.PA","BVI.PA","CGG.PA","CO.PA","COFA.PA","COV.PA",
  "DBG.PA","ELIOR.PA","ELIS.PA","EO.PA","EOSI.PA","ETL.PA","EXN.PA","FDJ.PA","FGR.PA","FNAC.PA","FORE.PA",
  "FR.PA","GET.PA","GFC.PA","GTT.PA","ICAD.PA","ILD.PA","IPN.PA","IPS.PA","JCQ.PA","LI.PA","LOIM.PA",
  "MAU.PA","MERY.PA","MF.PA","NK.PA","ORP.PA","PIG.PA","PLX.PA","RCO.PA","RUI.PA","RXL.PA","SCR.PA","SK.PA",
  "SOI.PA","SOP.PA","SOPRA.PA","SPIE.PA","SW.PA","TFI.PA","TKO.PA","TKTT.PA","TRI.PA","TTE.PA","UBI.PA",
  "VIL.PA","VK.PA","VLA.PA","WLN.PA",
];

// SMIM 30 (Swiss Market Index Mid, 30 fondsen) — Yahoo suffix .SW
const SMIM_30: string[] = [
  "ADEN.SW","AMS.SW","AVOL.SW","BAER.SW","BALN.SW","BARN.SW","BCGE.SW","BCVN.SW","BEAN.SW","BKW.SW",
  "CFR.SW","CMBN.SW","DKSH.SW","DOKA.SW","EMSN.SW","FHZN.SW","GALE.SW","HELN.SW","KOMN.SW","LISN.SW",
  "PSPN.SW","SCHN.SW","SCHP.SW","SFSN.SW","SFZN.SW","SGSN.SW","STMN.SW","SUN.SW","SYBN.SW","TEMN.SW",
  "TKBP.SW","VACN.SW","VATN.SW","VONN.SW","ZEHN.SW",
];

const INDEX_UNIVERSE: string[] = [...new Set([
  ...DJIA, ...NASDAQ_100, ...AEX, ...FTSE_100, ...CAC_40, ...SMI,
  ...SP_MIDCAP_400, ...AMX, ...FTSE_250, ...CAC_MID_60, ...SMIM_30,
])];

interface Bar { date: string; close: number; }
interface DivEvent { date: string; amount: number; }

async function fetchYahooHistory(ticker: string): Promise<{ bars: Bar[]; divs: DivEvent[] }> {
  // Gebruik period1/period2 i.p.v. range=5y: range=5y start op vandaag-5j waardoor
  // dividenden met een ex-datum vroeg in het vijfde jaar (bijv. jan-apr 2021 als vandaag
  // mei 2026 is) buiten de range vallen en als nul worden meegeteld. Door terug te gaan
  // naar 1 jan van (currentYear-6) zijn alle kalenderjaren y1-y5 altijd volledig.
  const now = Math.floor(Date.now() / 1000);
  const currentYear = new Date().getFullYear();
  const periodStart = Math.floor(new Date(`${currentYear - 6}-01-01T00:00:00Z`).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${periodStart}&period2=${now}&interval=1wk&events=div`;
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
  // Gebruik onbijgewerkte slotkoers (quote.close) zodat dividend-aanpassingen de
  // historische 5j-hoog niet kunstmatig verlagen. Val terug op adjclose als quote.close
  // niet beschikbaar is (sommige tickers/periodes hebben dit niet).
  const closes = r.indicators.quote[0]?.close ?? r.indicators.adjclose?.[0]?.adjclose ?? [];
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

  // Prijsberekeningen (hoog, rendement) alleen op de laatste 5 jaar. De fetch levert
  // nu ~6 jaar data zodat dividenden volledig zijn, maar "5j-hoog" blijft 5 jaar.
  const fiveYearsAgo = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const priceBars = bars.filter((b) => b.date >= fiveYearsAgo);
  if (priceBars.length < 10) return null;

  const lastClose = priceBars[priceBars.length - 1].close;
  const high5y = Math.max(...priceBars.map((b) => b.close));
  const pctUnder5yHigh = high5y > 0 ? ((high5y - lastClose) / high5y) * 100 : 0;

  // Jaarlijkse rendementen: vergelijk eindekoers van elk jaar met het vorige
  const byYear: Record<number, number[]> = {};
  for (const b of priceBars) {
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

// Sanity-cap: yield > MAX_TRUSTED_YIELD_PCT is bijna altijd een special distribution,
// return-of-capital, of currency-mismatch in Yahoo's dividend feed (zoals CRH.L 128%).
// Reguliere dividenden van large-caps zitten zelden boven 15%, ~20% is al uitzonderlijk.
const MAX_TRUSTED_YIELD_PCT = 30;
// Historie-eis: dividend-zekerheid kan alleen als er ECHTE historie is.
// CURI met 16.7% TTM maar 0 dividenden in 2021-2025 = eenmalige flits, geen Zwitserleven.
const MIN_RECENT_YEARS_WITH_DIV = 1;

function checkMeetsCriteria(m: Metrics): boolean {
  if (m.dividendYieldPct < MIN_YIELD_PCT) return false;
  if (m.dividendYieldPct > MAX_TRUSTED_YIELD_PCT) return false;
  if (m.pctUnder5yHigh < MIN_UNDER_5Y_HIGH_PCT) return false;
  if (m.maxAnnualGain5y == null || m.maxAnnualGain5y < MIN_MAX_ANNUAL_GAIN) return false;
  if (m.years5pctGrowth < MIN_YEARS_5PCT) return false;
  // Minstens N van de laatste 3 kalenderjaren moet een echte dividenduitkering bevatten.
  const recentYearsWithDiv = m.divYieldByYear.slice(0, 3).filter((v) => v != null && v > 0).length;
  if (recentYearsWithDiv < MIN_RECENT_YEARS_WITH_DIV) return false;
  return true;
}

Deno.serve(runBackground("compute-zwitserleven", async (req) => {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Force-scan modes:
  //   ?ticker=XYZ          → scan alleen deze ene ticker (bypass 90d cutoff)
  //   ?ticker=XYZ&manual=1 → idem, en markeer als handmatig toegevoegd
  //                          (gaat NIET via signal_tickers — direct in zwitserleven_stocks)
  //   ?ticker=XYZ&delete=1 → verwijder deze ticker uit zwitserleven_stocks
  const url = new URL(req.url);
  const forceTicker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const isManualAdd = url.searchParams.get("manual") === "1";
  const isDelete = url.searchParams.get("delete") === "1";

  if (isDelete) {
    if (!forceTicker) return { ok: false, message: "ticker vereist bij delete=1" };
    const { error, count } = await sb
      .from("zwitserleven_stocks")
      .delete({ count: "exact" })
      .eq("ticker", forceTicker);
    if (error) return { ok: false, message: `delete ${forceTicker}: ${error.message}` };
    return { ok: true, message: `${forceTicker} verwijderd (${count ?? 0} rij(en))`, metrics: { deleted: count ?? 0, ticker: forceTicker } };
  }

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
        fetchYahooHistory(row.ticker),
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
