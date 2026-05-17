// zwitserleven-results — geeft Zwitserleven-scan resultaten terug aan de frontend.
// Retourneert: alle gescande stocks + statistieken (client-side filteren/sorteren).
//
// Universum-grootte wordt hier hardcoded zodat we niet bij elke read de full
// lijst over de wire hoeven. LET OP: zelfde lijst staat in
// compute-zwitserleven-background/index.ts. Bij wijziging beide aanpassen.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Index-universum (zelfde lijst als in compute-zwitserleven-background)
const INDEX_UNIVERSE: string[] = [...new Set([
  // DJIA (30)
  "AAPL","AMGN","AMZN","AXP","BA","CAT","CRM","CSCO","CVX","DIS",
  "GS","HD","HON","IBM","JNJ","JPM","KO","MCD","MMM","MRK",
  "MSFT","NKE","NVDA","PG","SHW","TRV","UNH","V","VZ","WMT",
  // NASDAQ-100 (100)
  "ABNB","ADBE","ADI","ADP","ADSK","AEP","AMAT","AMD","ANSS","APP",
  "ARM","ASML","AVGO","AXON","AZN","BIIB","BKNG","BKR","CCEP","CDNS",
  "CDW","CEG","CHTR","CMCSA","COST","CPRT","CRWD","CSGP","CSX","CTAS",
  "CTSH","DASH","DDOG","DXCM","EA","EXC","FANG","FAST","FTNT","GEHC",
  "GFS","GILD","GOOG","GOOGL","IDXX","INTC","INTU","ISRG","KDP","KHC",
  "KLAC","LIN","LRCX","LULU","MAR","MCHP","MDB","MDLZ","MELI","META",
  "MNST","MRVL","MU","NFLX","NXPI","ODFL","ON","ORLY","PANW","PAYX",
  "PCAR","PDD","PEP","PLTR","PYPL","QCOM","REGN","ROP","ROST","SBUX",
  "SNPS","TEAM","TMUS","TSLA","TTD","TTWO","TXN","VRSK","VRTX","WBD",
  "WDAY","XEL","ZS",
  // AEX (25)
  "ADYEN.AS","AGN.AS","AD.AS","AKZA.AS","MT.AS","ASML.AS","ASM.AS","ASRNL.AS","BESI.AS","DSFIR.AS",
  "EXO.AS","GLPG.AS","HEIA.AS","IMCD.AS","INGA.AS","KPN.AS","NN.AS","PHIA.AS","PRX.AS","RAND.AS",
  "REL.AS","SHELL.AS","UMG.AS","UNA.AS","WKL.AS",
  // FTSE 100 (≈100) — CRH.L verwijderd (delisted 2023, stale Yahoo data)
  "AAL.L","ABF.L","ADM.L","AHT.L","ANTO.L","AUTO.L","AV.L","BARC.L",
  "BATS.L","BDEV.L","BEZ.L","BKG.L","BME.L","BNZL.L","BP.L","BRBY.L","BT-A.L","CCH.L",
  "CNA.L","CPG.L","CRDA.L","CTEC.L","DCC.L","DGE.L","DPLM.L","EDV.L","ENT.L",
  "EXPN.L","EZJ.L","FCIT.L","FRAS.L","FRES.L","GLEN.L","GSK.L","HIK.L","HL.L","HLN.L",
  "HSBA.L","HSX.L","HWDN.L","IAG.L","ICG.L","IHG.L","III.L","IMB.L","IMI.L","INF.L",
  "ITRK.L","JD.L","KGF.L","LAND.L","LGEN.L","LLOY.L","LMP.L","LSEG.L","MNDI.L","MNG.L",
  "MRO.L","NG.L","NWG.L","NXT.L","PHNX.L","PRU.L","PSH.L","PSN.L","PSON.L","REL.L",
  "RIO.L","RKT.L","RR.L","RS1.L","RTO.L","SBRY.L","SDR.L","SGE.L","SGRO.L","SHEL.L",
  "SMDS.L","SMIN.L","SMT.L","SN.L","SPX.L","SSE.L","STAN.L","STJ.L","SVT.L","TSCO.L",
  "TW.L","ULVR.L","UTG.L","UU.L","VOD.L","WEIR.L","WPP.L","WTB.L",
  // CAC 40 (≈40)
  "AC.PA","AI.PA","AIR.PA","ALO.PA","CS.PA","BNP.PA","EN.PA","CAP.PA","CA.PA","ACA.PA",
  "BN.PA","DSY.PA","EDEN.PA","ENGI.PA","EL.PA","ERF.PA","RMS.PA","KER.PA","LR.PA","OR.PA",
  "MC.PA","ML.PA","ORA.PA","RI.PA","PUB.PA","SGO.PA","SAN.PA","SU.PA","GLE.PA","STLAP.PA",
  "STMPA.PA","TEP.PA","HO.PA","TTE.PA","URW.PA","VIE.PA","DG.PA","VIV.PA",
  // SMI (20)
  "ABBN.SW","ALC.SW","GEBN.SW","GIVN.SW","HOLN.SW","KNIN.SW","LOGN.SW","LONN.SW","NESN.SW","NOVN.SW",
  "PGHN.SW","ROG.SW","SCMN.SW","SGSN.SW","SIKA.SW","SLHN.SW","SOON.SW","SREN.SW","UBSG.SW","ZURN.SW",
  // S&P MidCap 400 (US midcap subset)
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
  // AMX (Amsterdam Midkap)
  "AALB.AS","ALFEN.AS","ALLFG.AS","AMG.AS","APAM.AS","ARCAD.AS","AZRN.AS","BFIT.AS","BRNL.AS","CMCOM.AS",
  "CTPNV.AS","ECMPA.AS","FAGR.AS","FUR.AS","INPST.AS","JDEP.AS","LIGHT.AS","OCI.AS","PHARM.AS","PNL.AS",
  "SBMO.AS","TKWY.AS","VPK.AS","WHA.AS",
  // FTSE 250 (UK midcap subset)
  "AAF.L","AGR.L","AJB.L","ANE.L","AO.L","APAX.L","AT.L","ATG.L","AUB.L","BAB.L","BAG.L","BAKK.L","BBOX.L",
  "BBY.L","BCG.L","BGS.L","BNKR.L","BOY.L","BWY.L","BYG.L","CARD.L","CCR.L","CINE.L","CLDN.L",
  "COA.L","CTY.L","CWK.L","DRX.L","ECM.L","ELM.L","EMG.L","ESP.L","ETO.L","FCF.L","FEET.L","FGT.L","FOXT.L",
  "FXPO.L","GAW.L","GENL.L","GLO.L","GNK.L","GRG.L","GROW.L","HARL.L","HFEL.L","HMSO.L","HOC.L","HSV.L",
  "HVPE.L","IGG.L","IGR.L","INCH.L","IPO.L","IPX.L","IWG.L","JLEN.L","KIE.L","LRE.L","MGGT.L","MGNS.L",
  "MNKS.L","MONY.L","MRC.L","NCC.L","OCDO.L","OSB.L","PAGE.L","PCT.L","PCTN.L","PFC.L","PHP.L","PNN.L",
  "POLR.L","PSDL.L","PZC.L","QQ.L","RAT.L","RDW.L","RSW.L","SAFE.L","SDY.L","SMRT.L","SNN.L",
  "SPI.L","SRP.L","SXS.L","SYNC.L","TATE.L","TBCG.L","TCAP.L","TEM.L","THRG.L","TPK.L","TPX.L","TRY.L",
  "TUI.L","TUNE.L","VANQ.L","VICO.L","VTY.L","WG.L","WIZZ.L","WKP.L","WMH.L","WTAN.L",
  // CAC Mid 60 (Paris midcap)
  "ALD.PA","AKE.PA","AM.PA","ATO.PA","BB.PA","BIM.PA","BOL.PA","BVI.PA","CGG.PA","CO.PA","COFA.PA","COV.PA",
  "DBG.PA","ELIOR.PA","ELIS.PA","EO.PA","EOSI.PA","ETL.PA","EXN.PA","FDJ.PA","FGR.PA","FNAC.PA","FORE.PA",
  "FR.PA","GET.PA","GFC.PA","GTT.PA","ICAD.PA","ILD.PA","IPN.PA","IPS.PA","JCQ.PA","LI.PA","LOIM.PA",
  "MAU.PA","MERY.PA","MF.PA","NK.PA","ORP.PA","PIG.PA","PLX.PA","RCO.PA","RUI.PA","RXL.PA","SCR.PA","SK.PA",
  "SOI.PA","SOP.PA","SOPRA.PA","SPIE.PA","SW.PA","TFI.PA","TKO.PA","TKTT.PA","TRI.PA","UBI.PA",
  "VIL.PA","VK.PA","VLA.PA","WLN.PA",
  // SMIM 30 (Swiss midcap)
  "ADEN.SW","AMS.SW","AVOL.SW","BAER.SW","BALN.SW","BARN.SW","BCGE.SW","BCVN.SW","BEAN.SW","BKW.SW",
  "CFR.SW","CMBN.SW","DKSH.SW","DOKA.SW","EMSN.SW","FHZN.SW","GALE.SW","HELN.SW","KOMN.SW","LISN.SW",
  "PSPN.SW","SCHN.SW","SCHP.SW","SFSN.SW","SFZN.SW","STMN.SW","SUN.SW","SYBN.SW","TEMN.SW",
  "TKBP.SW","VACN.SW","VATN.SW","VONN.SW","ZEHN.SW",
])];

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  try {
    const sb = getServiceClient();

    const [stocksResult, totalResult, universeScannedResult] = await Promise.all([
      // Alle gescande stocks (max 500), gesorteerd op yield
      sb
        .from("zwitserleven_stocks")
        .select("ticker,company,exchange,country,sector,last_close,currency,dividend_yield_pct,annual_dividend,high_5y,pct_under_5y_high,max_annual_gain_5y,years_5pct_growth_5y,payout_ratio,dividend_cuts_5y,risk_label,meets_criteria,scanned_at,div_yield_y1,div_yield_y2,div_yield_y3,div_yield_y4,div_yield_y5,is_manual")
        .order("dividend_yield_pct", { ascending: false, nullsLast: true })
        .limit(500),
      // Totaal gescand (alle tickers ooit gescand, inclusief handmatige)
      sb
        .from("zwitserleven_stocks")
        .select("*", { count: "exact", head: true }),
      // Hoeveel uit het INDEX_UNIVERSE zijn al gescand
      sb
        .from("zwitserleven_stocks")
        .select("ticker", { count: "exact", head: true })
        .in("ticker", INDEX_UNIVERSE),
    ]);

    const stocks = (stocksResult.data ?? []) as Array<{
      ticker: string;
      company: string | null;
      exchange: string | null;
      country: string | null;
      sector: string | null;
      last_close: number | null;
      currency: string | null;
      dividend_yield_pct: number | null;
      annual_dividend: number | null;
      high_5y: number | null;
      pct_under_5y_high: number | null;
      max_annual_gain_5y: number | null;
      years_5pct_growth_5y: number | null;
      payout_ratio: number | null;
      dividend_cuts_5y: number | null;
      risk_label: string | null;
      meets_criteria: boolean | null;
      scanned_at: string | null;
      div_yield_y1: number | null;
      div_yield_y2: number | null;
      div_yield_y3: number | null;
      div_yield_y4: number | null;
      div_yield_y5: number | null;
      is_manual: boolean | null;
    }>;

    const meetsCriteriaCount = stocks.filter((s) => s.meets_criteria).length;
    const manualCount = stocks.filter((s) => s.is_manual === true).length;
    const universeSize = INDEX_UNIVERSE.length;
    const universeScanned = universeScannedResult.count ?? 0;
    const unscannedCount = Math.max(0, universeSize - universeScanned);

    return new Response(
      JSON.stringify({
        stocks,
        total_scanned: totalResult.count ?? 0,
        meets_criteria_count: meetsCriteriaCount,
        manual_count: manualCount,
        unscanned_count: unscannedCount,
        universe_size: universeSize,
        universe_scanned: universeScanned,
      }),
      { status: 200, headers: { ...cors(req), "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } }
    );
  }
});
