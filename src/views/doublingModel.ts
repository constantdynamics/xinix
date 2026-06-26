// ─────────────────────────────────────────────────────────────────────────────
// Verdubbel-model — schat per favoriet de kans dat de koers binnen 12 maanden
// verdubbelt (+100%), uitgedrukt als score 1–100 (= de geschatte kans in %).
//
// Filosofie (betrouwbaarheid staat voorop):
//   Een verdubbeling binnen een jaar voorspellen is fundamenteel onzeker. Dit
//   model belooft geen waarheid — het maakt de *kans* zo onderbouwd mogelijk
//   door alleen op meetbare, historische data te steunen en élke aanname
//   transparant te tonen. De score = de geschatte kans (%), niet opgerekt naar
//   een mooi ogende 1–100-spreiding. Dat een aandeel "maar" 12 scoort is dan de
//   eerlijke uitkomst: verdubbelen is zeldzaam.
//
// De score combineert twee ONAFHANKELIJKE schatters plus structurele tilts:
//
//   1. Volatiliteit-baseline (theorie). Onder een lognormaal koersmodel (GBM)
//      met gerealiseerde jaarvolatiliteit σ en een neutrale drift μ geldt
//          P(S₁ ≥ 2·S₀) = 1 − Φ( (ln2 − (μ − σ²/2)) / σ ).
//      Puur volatiliteit: hoe beweeglijker, hoe dikker de rechterstaart, hoe
//      groter de kans op +100%. De −σ²/2-drift-drag houdt dit eerlijk (een
//      extreem volatiel aandeel zonder drift halveert net zo makkelijk).
//
//   2. Empirische verdubbelfrequentie (gedrag van dít aandeel). Uit 5 jaar
//      koershistorie: vanaf hoeveel willekeurige startpunten verdubbelde de
//      koers binnen de volgende 12 maanden? Dat is een directe, modelvrije
//      schatting van precies wat we willen weten. Aangevuld met de poefie-
//      tellers (poefies = explosieve spikes uit de scan-engine).
//
//   3. Structurele tilts (×-factoren rond 1.0): koerspositie t.o.v. 5y-range,
//      kwaliteitsscore, medailles, sector, marktkapitalisatie, dividend,
//      katalysator, signaalkleur. Bewust bescheiden — de twee schatters
//      hierboven dragen het zwaarste gewicht, de tilts duwen alleen bij.
//
// Alles draait client-side op data die de app al heeft (dashboard + scans) plus
// één koershistorie-fetch per aandeel. Geen black box: `components[]` legt elke
// bijdrage uit en `confidence` zegt hoe hard de onderbouwing is.
// ─────────────────────────────────────────────────────────────────────────────

export type DoublingSector = "biotech" | "mining" | "other" | null;

/** Per-aandeel invoer, samengesteld uit dashboard-card + scan-rankings. */
export interface DoublingCardInput {
  ticker: string;
  company: string;
  sector: DoublingSector;
  goudScore: number | null; // 0..100 (card.goud_score)
  finalScore: number | null; // 0..1 (signal-engine final_score)
  signalAction: string | null; // STRONG_BUY / BUY / WATCH / AVOID
  color: string | null; // white / yellow / orange / red (signaalsterkte)
  medalGold: number;
  medalSilver: number;
  medalBronze: number;
  dividendYield: number | null; // fractie (0.025 = 2.5%)
  marketCapUsd: number | null;
  shareCountMillions: number | null;
  lastClose: number | null;
  low1y: number | null;
  high1y: number | null;
  low5y: number | null;
  high5y: number | null;
  pctChange5d: number | null; // %
  volumeRatio: number | null; // last_volume / avg_volume_30d
  buyLimit: number | null;
  aboveLimitPct: number | null; // % boven (of onder, negatief) de aankooplimiet
  daysToNextCatalyst: number | null;
  // poefie / phoenix / hikkertje (scan-engine, historische explosies)
  poefieMaxGrowthPct: number | null;
  poefieCount1y: number | null;
  poefieCount2y: number | null;
  poefieCount5y: number | null;
  phoenixMaxGrowth180dPct: number | null;
  phoenixIncidentCount: number | null;
  hikkertjeSpikes: number | null;
}

/** Afgeleide statistieken uit de gefetchte koershistorie. */
export interface PriceStats {
  annualVol: number; // σ, geannualiseerd uit log-rendementen
  empDoubleProb: number; // 0..1: P(verdubbeling binnen 1j) vanaf willekeurig startpunt
  empMeasured: boolean; // is er ≥1 startpunt met een vol jaar historie vooruit?
  episodes: number; // # niet-overlappende verdubbelingen in de steekproef
  yearsCovered: number;
  posInRange: number; // 0..1: 0 = op het dieptepunt, 1 = op de top (van de steekproef)
  pctBelowHigh: number; // % onder de hoogste koers in de steekproef
  mom6m: number | null; // 6-maands rendement (fractie), null bij te weinig data
  maxWindowGain: number; // beste ~1j rolling stijging in de steekproef (fractie)
  points: number; // aantal koerspunten gebruikt
}

export type Confidence = "zeer-hoog" | "hoog" | "middel" | "laag";

export interface DoublingFactor {
  label: string;
  detail: string;
  impact: "up" | "down" | "neutral";
  /** Relatieve sterkte 0..1 voor visuele weging (alleen voor de balk-breedte). */
  weight: number;
}

/**
 * Research-overlay uit de backend (xinix-doubling-research-background): per
 * favoriet samengevatte fundamentele/nieuws-research die elke ~15 dagen ververst.
 * Wordt over de prijs-gedreven kern heen gelegd.
 */
export interface ResearchOverlay {
  research_multiplier: number; // ×-factor op de kans
  conf_bonus: number; // opgeteld bij de confidence-score
  factors: DoublingFactor[];
  bull: string[];
  bear: string[];
  summary: string | null;
  computed_at: string;
}

export interface DoublingResult {
  ticker: string;
  company: string;
  sector: DoublingSector;
  /** 1..99 — geschatte kans (%) op +100% binnen 12 maanden. */
  score: number;
  /** Dezelfde kans als fractie 0..1 (score/100). */
  probability: number;
  /** Onderdeel-kansen voor transparantie. */
  pVol: number;
  pEmp: number | null;
  structuralMultiplier: number;
  confidence: Confidence;
  /** Welke sterke databronnen ontbraken (voor de betrouwbaarheids-uitleg). */
  missing: string[];
  factors: DoublingFactor[];
  narrative: string;
  stats: PriceStats | null;
  /** Kerngetallen voor de tabel. */
  annualVolPct: number | null;
  historicalDoublings: number | null;
  lastClose: number | null;
  /** Geadviseerde maximale instapkoers (aankooplimiet of model-afleiding). */
  adviesPrice: number | null;
  adviesSource: "limiet" | "model" | null;
  /** Huidige koers t.o.v. advies-koers in % (positief = boven advies). */
  adviesDistancePct: number | null;
  /** Research-overlay (backend, ~15-daags). hasResearch=false → alleen prijs-kern. */
  hasResearch: boolean;
  bull: string[];
  bear: string[];
  researchSummary: string | null;
  researchAt: string | null;
}

// ── Wiskundige helpers ───────────────────────────────────────────────────────

/** Standaardnormale CDF (Abramowitz & Stegun 26.2.17, |fout| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * P(eindkoers ≥ 2× na 1 jaar) onder GBM — terminale kans. Bewaard ter referentie.
 *   ln(S₁/S₀) ~ N(μ − σ²/2, σ²)  ⇒  P(ln(S₁/S₀) ≥ ln2) = 1 − Φ(z).
 */
export function lognormalDoubleProb(sigma: number, mu: number): number {
  if (!(sigma > 0) || !Number.isFinite(sigma)) return 0;
  const z = (Math.LN2 - (mu - (sigma * sigma) / 2)) / sigma;
  return 1 - normCdf(z);
}

/**
 * P(koers raakt 2× AAN op enig moment binnen 1 jaar) onder GBM — first-passage
 * (barrier-hit), niet de eindwaarde. Dit is de juiste maatstaf voor "verdubbelt
 * in het komende jaar" (één keer 2x aantikken telt) én sluit aan op de
 * empirische maatstaf, die óók "verdubbelde op enig moment in het venster" meet.
 * Reflectieprincipe voor gedrifte Brownse beweging X_t = ln(S_t/S₀) = m·t + σ·W_t:
 *   P(sup_{0≤t≤1} X_t ≥ a) = Φ((m−a)/σ) + e^{2ma/σ²}·Φ((−m−a)/σ),
 * met m = μ − σ²/2 (log-drift), a = ln2, T = 1.
 */
export function lognormalTouchDoubleProb(sigma: number, mu: number): number {
  if (!(sigma > 0) || !Number.isFinite(sigma)) return 0;
  const a = Math.LN2;
  const m = mu - (sigma * sigma) / 2;
  const term1 = normCdf((m - a) / sigma);
  const ex = (2 * m * a) / (sigma * sigma);
  // Bij extreem lage σ overflowt e^ex terwijl de Φ-factor onderflowt → product ≈ 0.
  const term2 = ex > 700 ? 0 : Math.exp(ex) * normCdf((-m - a) / sigma);
  const p = term1 + term2;
  return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
}

function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1);
  return Math.sqrt(v);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const DAY = 86400;
const YEAR_SEC = 365.25 * DAY;

// ── Koershistorie-analyse ────────────────────────────────────────────────────

/**
 * Bereken volatiliteit + empirische verdubbelkans uit ruwe koerspunten.
 * `points` = {t (unix-seconden), c (slotkoers)} in chronologische volgorde
 * (weekkoersen bij het 5y-venster). Retourneert null bij te weinig data.
 */
export function analyzePriceHistory(points: { t: number; c: number }[]): PriceStats | null {
  const pts = [...points]
    .filter((p) => Number.isFinite(p.c) && p.c > 0 && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 12) return null;

  const closes = pts.map((p) => p.c);
  const ts = pts.map((p) => p.t);
  const n = closes.length;

  // Sampling-frequentie uit de mediane tussentijd → periodes per jaar.
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(ts[i] - ts[i - 1]);
  const medGap = median(gaps) || 7 * DAY;
  const periodsPerYear = Math.max(1, YEAR_SEC / medGap);

  // σ uit log-rendementen, geannualiseerd.
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const annualVol = stdev(rets) * Math.sqrt(periodsPerYear);

  // Empirische verdubbelkans: voor elk startpunt met een vol jaar vooruit,
  // raakte de koers binnen die 12 maanden 2x aan? Fractie = directe P-schatting
  // (first-passage, dezelfde gebeurtenis als lognormalTouchDoubleProb).
  // maxWindowGain wordt over álle startpunten bepaald (ook deelvensters aan het
  // eind / bij korte historie) zodat "beste run" nooit onterecht +0% toont.
  let eligible = 0;
  let doubled = 0;
  let maxWindowGain = 0;
  for (let i = 0; i < n; i++) {
    const horizon = ts[i] + YEAR_SEC;
    const hasFullYear = ts[n - 1] >= horizon;
    let maxC = closes[i];
    for (let j = i + 1; j < n && ts[j] <= horizon; j++) {
      if (closes[j] > maxC) maxC = closes[j];
    }
    const gain = maxC / closes[i] - 1;
    if (gain > maxWindowGain) maxWindowGain = gain;
    if (hasFullYear) {
      eligible++;
      if (maxC >= 2 * closes[i]) doubled++;
    }
  }
  const empMeasured = eligible > 0;
  const empDoubleProb = empMeasured ? doubled / eligible : 0;

  // Niet-overlappende verdubbelingen (intuïtief: "verdubbelde X keer in 5j").
  // Vanaf een lopend dieptepunt; bij een 2x binnen ≤1j: tel mee, herstart
  // referentie op de piek.
  let episodes = 0;
  let refIdx = 0;
  for (let i = 1; i < n; i++) {
    if (closes[i] < closes[refIdx]) {
      refIdx = i;
      continue;
    }
    if (closes[i] >= 2 * closes[refIdx] && ts[i] - ts[refIdx] <= YEAR_SEC * 1.05) {
      episodes++;
      refIdx = i;
    }
  }

  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  const last = closes[n - 1];
  const posInRange = hi > lo ? (last - lo) / (hi - lo) : 0.5;
  const pctBelowHigh = hi > 0 ? (1 - last / hi) * 100 : 0;

  // 6-maands momentum: koers nu vs ~26 weken (of ~half jaar) terug.
  let mom6m: number | null = null;
  const sixMonthAgo = ts[n - 1] - YEAR_SEC / 2;
  for (let i = n - 1; i >= 0; i--) {
    if (ts[i] <= sixMonthAgo) {
      if (closes[i] > 0) mom6m = last / closes[i] - 1;
      break;
    }
  }

  const yearsCovered = (ts[n - 1] - ts[0]) / YEAR_SEC;

  return {
    annualVol,
    empDoubleProb,
    empMeasured,
    episodes,
    yearsCovered,
    posInRange,
    pctBelowHigh,
    mom6m,
    maxWindowGain,
    points: n,
  };
}

// ── Hulpschatters zonder koershistorie (fallback) ───────────────────────────

/**
 * Grove jaarvolatiliteit uit de 1-jaars high/low (Parkinson-achtig). Alleen als
 * fallback wanneer de koershistorie-fetch faalt.
 */
function volFromRange(low: number | null, high: number | null): number | null {
  if (low == null || high == null || low <= 0 || high <= low) return null;
  // Parkinson: σ ≈ ln(high/low) / (2·√ln2) over een periode ≈ 1 jaar.
  return Math.log(high / low) / (2 * Math.sqrt(Math.LN2));
}

/** Empirische kans uit poefie-tellers: poefies zijn verdubbelings-klasse spikes. */
function empFromPoefie(c: DoublingCardInput): number | null {
  const c5 = c.poefieCount5y;
  const c2 = c.poefieCount2y;
  const c1 = c.poefieCount1y;
  let ratePerYear: number | null = null;
  if (c5 != null && c5 > 0) ratePerYear = c5 / 5;
  else if (c2 != null && c2 > 0) ratePerYear = c2 / 2;
  else if (c1 != null && c1 > 0) ratePerYear = c1;
  else if (c5 === 0 || c2 === 0 || c1 === 0) ratePerYear = 0;
  if (ratePerYear == null) return null;
  // Poisson: P(≥1 spike komend jaar) = 1 − e^(−λ). Tempering: niet elke poefie
  // is een volle verdubbeling, dus rate × 0.7.
  return 1 - Math.exp(-ratePerYear * 0.7);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Marktkap (USD) — direct of geschat uit aandelenaantal × koers. */
function marketCap(c: DoublingCardInput): number | null {
  if (c.marketCapUsd != null && c.marketCapUsd > 0) return c.marketCapUsd;
  if (c.shareCountMillions != null && c.shareCountMillions > 0 && c.lastClose != null && c.lastClose > 0) {
    return c.shareCountMillions * 1e6 * c.lastClose;
  }
  return null;
}

// ── Hoofdscore ───────────────────────────────────────────────────────────────

const NEUTRAL_DRIFT = 0.08; // neutrale jaardrift voor de vol-baseline (geen aangenomen edge)

/**
 * Bereken de verdubbel-score (1–99) voor één favoriet. `stats` is optioneel:
 * met koershistorie wordt het model sterk onderbouwd; zonder valt het terug op
 * range-volatiliteit + poefie-tellers (lagere confidence).
 */
export function scoreDoubling(
  c: DoublingCardInput,
  stats: PriceStats | null,
  overlay?: ResearchOverlay | null,
): DoublingResult {
  const factors: DoublingFactor[] = [];
  const missing: string[] = [];

  // 1) Volatiliteit-baseline -------------------------------------------------
  let sigma: number | null = stats ? stats.annualVol : null;
  let sigmaSource: "historie" | "range" | null = stats ? "historie" : null;
  if (sigma == null || !(sigma > 0)) {
    const vr = volFromRange(c.low1y, c.high1y);
    if (vr != null) {
      sigma = vr;
      sigmaSource = "range";
    }
  }
  // First-passage ("raakt 2x aan binnen 1j") — zelfde gebeurtenis als de
  // empirische maatstaf, zodat beide schatters op dezelfde meetlat staan.
  const pVol = sigma != null ? lognormalTouchDoubleProb(sigma, NEUTRAL_DRIFT) : 0;

  if (sigma != null) {
    factors.push({
      label: "Volatiliteit",
      detail: `σ ≈ ${(sigma * 100).toFixed(0)}%/jaar${sigmaSource === "range" ? " (geschat uit 1j-range)" : ""} → baseline-kans ${(pVol * 100).toFixed(0)}%`,
      impact: pVol >= 0.12 ? "up" : "neutral",
      weight: clamp(sigma / 1.5, 0.1, 1),
    });
  } else {
    missing.push("volatiliteit (geen koershistorie of range)");
  }

  // 2) Empirische verdubbelfrequentie ---------------------------------------
  // Historie-empirie telt alleen mee als er werkelijk een vol jaar vooruit is
  // gemeten (empMeasured); anders is empDoubleProb=0 geen meting maar ruis.
  const histEmp = stats && stats.empMeasured ? stats.empDoubleProb : null;
  const pEmpPoefie = empFromPoefie(c);
  let pEmp: number | null = histEmp;
  if (pEmp == null) pEmp = pEmpPoefie;
  else if (pEmpPoefie != null) pEmp = Math.max(pEmp, 0.5 * pEmp + 0.5 * pEmpPoefie);

  if (stats && stats.empMeasured) {
    factors.push({
      label: "Eigen historie",
      detail:
        stats.episodes > 0
          ? `verdubbelde ${stats.episodes}× in ${stats.yearsCovered.toFixed(1)}j · empirische kans ${(stats.empDoubleProb * 100).toFixed(0)}% · beste run +${(stats.maxWindowGain * 100).toFixed(0)}%`
          : `geen verdubbeling in ${stats.yearsCovered.toFixed(1)}j · beste run +${(stats.maxWindowGain * 100).toFixed(0)}%`,
      impact: stats.empDoubleProb >= 0.1 ? "up" : stats.empDoubleProb > 0 ? "neutral" : "down",
      weight: clamp(stats.empDoubleProb * 2 + (stats.episodes > 0 ? 0.3 : 0), 0.1, 1),
    });
  } else if (stats) {
    // Historie aanwezig maar te kort voor een vol-jaars verdubbel-meting.
    factors.push({
      label: "Eigen historie",
      detail: `te korte historie (${stats.yearsCovered.toFixed(1)}j) voor empirische verdubbel-meting · beste run +${(stats.maxWindowGain * 100).toFixed(0)}%`,
      impact: "neutral",
      weight: 0.2,
    });
    missing.push("voldoende historie voor empirische verdubbel-meting (venster < 1j)");
  } else if (pEmpPoefie != null) {
    factors.push({
      label: "Poefie-historie",
      detail: `${c.poefieCount5y ?? 0} explosieve spikes in 5j → kans ${(pEmpPoefie * 100).toFixed(0)}%`,
      impact: pEmpPoefie >= 0.1 ? "up" : "neutral",
      weight: clamp(pEmpPoefie * 2, 0.1, 1),
    });
    missing.push("koershistorie (volledige verdubbel-analyse)");
  } else {
    missing.push("koershistorie + poefie-data (verdubbel-historie)");
  }

  // 3) Basiskans: blend van de twee schatters --------------------------------
  // Met goede historie weegt de empirische schatter zwaarder (directer bewijs).
  let pBase: number;
  if (histEmp != null && stats) {
    // Gemeten eigen historie weegt zwaarder (directer bewijs) naarmate er meer is.
    const wEmp = stats.yearsCovered >= 4 ? 0.6 : stats.yearsCovered >= 2.5 ? 0.5 : 0.4;
    pBase = (1 - wEmp) * pVol + wEmp * pEmp!;
  } else if (sigma != null && pEmp != null) {
    pBase = 0.6 * pVol + 0.4 * pEmp;
  } else if (sigma != null) {
    pBase = pVol;
  } else if (pEmp != null) {
    pBase = pEmp;
  } else {
    // Niets bekend: zeer voorzichtige sector-basis.
    pBase = c.sector === "biotech" ? 0.06 : c.sector === "mining" ? 0.05 : 0.03;
    missing.push("alle koersgegevens — score is een grove sectorgemiddelde");
  }

  // 4) Structurele tilts (×-factoren rond 1.0) -------------------------------
  let M = 1;

  // Koerspositie t.o.v. 5y-range: laag = ruimte + mean-reversion; hoog = duur.
  const pos = stats ? stats.posInRange : positionFromCard(c);
  if (pos != null) {
    let f = 1;
    if (pos < 0.2) f = 1.22;
    else if (pos < 0.4) f = 1.1;
    else if (pos > 0.85) f = 0.82;
    else if (pos > 0.65) f = 0.92;
    M *= f;
    factors.push({
      label: "Koerspositie",
      detail:
        pos < 0.4
          ? `dicht bij meerjarige bodem (${Math.round(pos * 100)}% van range) — veel ruimte omhoog`
          : pos > 0.85
            ? `dicht bij meerjarige top (${Math.round(pos * 100)}% van range) — minder ruimte`
            : `midden in de range (${Math.round(pos * 100)}%)`,
      impact: f > 1.02 ? "up" : f < 0.98 ? "down" : "neutral",
      weight: Math.abs(f - 1) * 4,
    });
  }

  // Kwaliteit: goud-score + signaal-actie.
  const q = c.goudScore;
  if (q != null) {
    let f = 1;
    if (q >= 80) f = 1.2;
    else if (q >= 65) f = 1.1;
    else if (q >= 50) f = 1.0;
    else if (q < 40) f = 0.9;
    if (c.signalAction === "STRONG_BUY") f *= 1.08;
    else if (c.signalAction === "AVOID") f *= 0.9;
    M *= f;
    factors.push({
      label: "Kwaliteitsscore",
      detail: `goud-score ${q.toFixed(0)}${c.signalAction ? ` · ${c.signalAction}` : ""}`,
      impact: f > 1.02 ? "up" : f < 0.98 ? "down" : "neutral",
      weight: Math.abs(f - 1) * 4,
    });
  } else {
    missing.push("goud-score");
  }

  // Medailles: gouden 5y-koersruns bevestigen explosief vermogen.
  if (c.medalGold > 0) {
    const f = 1 + Math.min(c.medalGold, 3) * 0.05;
    M *= f;
    factors.push({
      label: "Medailles",
      detail: `${c.medalGold}× 🏆 (grote koers-runs in 5j)`,
      impact: "up",
      weight: Math.min(c.medalGold, 3) / 3,
    });
  }

  // Marktkapitalisatie: kleinere caps verdubbelen makkelijker.
  const cap = marketCap(c);
  if (cap != null) {
    let f = 1;
    if (cap < 50e6) f = 1.28;
    else if (cap < 300e6) f = 1.15;
    else if (cap < 2e9) f = 1.0;
    else if (cap < 10e9) f = 0.85;
    else f = 0.7;
    M *= f;
    factors.push({
      label: "Marktkapitalisatie",
      detail: `≈ ${fmtCap(cap)}${f > 1.02 ? " — small cap, beweegt sneller" : f < 0.98 ? " — large cap, beweegt traag" : ""}`,
      impact: f > 1.02 ? "up" : f < 0.98 ? "down" : "neutral",
      weight: Math.abs(f - 1) * 3,
    });
  } else {
    missing.push("marktkapitalisatie");
  }

  // Dividend: betalers zijn doorgaans volwassen, verdubbelen zelden.
  if (c.dividendYield != null && c.dividendYield > 0) {
    const f = c.dividendYield >= 0.02 ? 0.82 : 0.92;
    M *= f;
    factors.push({
      label: "Dividend",
      detail: `${(c.dividendYield * 100).toFixed(1)}% rendement — volwassen bedrijf, zelden een verdubbelaar`,
      impact: "down",
      weight: Math.abs(f - 1) * 4,
    });
  }

  // Katalysator op korte termijn — alleen als terugval wanneer er geen
  // research-overlay is; anders bezit de overlay de (rijkere) katalysator-data.
  if (!overlay && c.daysToNextCatalyst != null && c.daysToNextCatalyst >= 0 && c.daysToNextCatalyst <= 90) {
    const f = c.daysToNextCatalyst <= 30 ? 1.16 : 1.08;
    M *= f;
    factors.push({
      label: "Katalysator",
      detail: `gebeurtenis over ${c.daysToNextCatalyst} dagen`,
      impact: "up",
      weight: Math.abs(f - 1) * 5,
    });
  }

  // Signaalkleur: rood = mega-verwachting.
  if (c.color === "red") {
    M *= 1.1;
    factors.push({ label: "Signaal", detail: "rood — mega-verwachting", impact: "up", weight: 0.5 });
  } else if (c.color === "orange") {
    M *= 1.04;
    factors.push({ label: "Signaal", detail: "oranje — sterke verwachting", impact: "up", weight: 0.25 });
  }

  // Overgekocht t.o.v. eigen aankooplimiet → late instap, kans op +100% lager.
  if (c.aboveLimitPct != null && c.aboveLimitPct > 80) {
    const f = c.aboveLimitPct > 200 ? 0.8 : 0.9;
    M *= f;
    factors.push({
      label: "Overextensie",
      detail: `+${c.aboveLimitPct.toFixed(0)}% boven aankooplimiet — al ver opgelopen`,
      impact: "down",
      weight: Math.abs(f - 1) * 4,
    });
  }

  // Research-overlay (backend): katalysatoren, materieel nieuws, verwatering.
  if (overlay) {
    M *= overlay.research_multiplier;
    for (const f of overlay.factors) factors.push(f);
  }

  M = clamp(M, 0.4, 2.4);

  // 5) Eindkans + score ------------------------------------------------------
  const probability = clamp(pBase * M, 0.005, 0.85);
  const score = clamp(Math.round(probability * 100), 1, 99);

  // 6) Confidence (betrouwbaarheid van de onderbouwing) ----------------------
  // Alleen volwaardig vertrouwen op de historie als de empirische verdubbel-
  // pijler écht een vol jaar vooruit kon meten (empMeasured).
  // De koershistorie is de zwaarst wegende, meest betrouwbare bron; fundamentals
  // (goud-score, marktkap) tellen daarbovenop. Confidence = data-volledigheid,
  // niet signaalsterkte.
  let conf = 0;
  if (stats && stats.empMeasured && stats.yearsCovered >= 3) conf += 3;
  else if (stats && stats.empMeasured && stats.yearsCovered >= 1.3) conf += 1.8;
  else if (stats) conf += 0.6; // historie aanwezig maar te kort voor empirische meting
  if (pEmpPoefie != null) conf += 0.8;
  if (c.goudScore != null) conf += 1;
  if (cap != null) conf += 1;
  if (c.medalGold + c.medalSilver + c.medalBronze > 0) conf += 0.5;
  if (overlay) conf += overlay.conf_bonus; // harde research → hogere betrouwbaarheid
  // Vier niveaus: zeer-hoog = lange gemeten historie + fundamentals + research.
  const confidence: Confidence =
    conf >= 5 ? "zeer-hoog" : conf >= 3 ? "hoog" : conf >= 1.5 ? "middel" : "laag";

  // Advies-instapkoers + afstand huidige koers daartoe.
  const advies = computeAdvies(c, pos);

  const narrative = buildNarrative(c, stats, { pVol, pEmp, pBase, M, probability, score, confidence });

  return {
    ticker: c.ticker,
    company: c.company,
    sector: c.sector,
    score,
    probability,
    pVol,
    pEmp,
    structuralMultiplier: M,
    confidence,
    missing,
    factors,
    narrative,
    stats,
    annualVolPct: sigma != null ? sigma * 100 : null,
    historicalDoublings: stats ? stats.episodes : null,
    lastClose: c.lastClose,
    adviesPrice: advies.price,
    adviesSource: advies.source,
    adviesDistancePct: advies.distancePct,
    hasResearch: !!overlay,
    bull: overlay?.bull ?? [],
    bear: overlay?.bear ?? [],
    researchSummary: overlay?.summary ?? null,
    researchAt: overlay?.computed_at ?? null,
  };
}

/**
 * Geadviseerde maximale instapkoers + afstand van de huidige koers daartoe.
 * - Is er een aankooplimiet (curated/scan), dan is dát het advies (consistent
 *   met de Lijst-tab).
 * - Anders een model-afleiding: koop op een terugval richting de 1j-bodem
 *   (40% van de weg terug), begrensd op 3–30% korting; zonder bodem een
 *   korting o.b.v. de koerspositie. Nooit een advies bóven de huidige koers.
 */
function computeAdvies(
  c: DoublingCardInput,
  pos: number | null,
): { price: number | null; source: "limiet" | "model" | null; distancePct: number | null } {
  const current = c.lastClose;
  if (current == null || !(current > 0)) return { price: null, source: null, distancePct: null };

  if (c.buyLimit != null && c.buyLimit > 0) {
    return { price: c.buyLimit, source: "limiet", distancePct: ((current - c.buyLimit) / c.buyLimit) * 100 };
  }

  let target: number;
  if (c.low1y != null && c.low1y > 0 && c.low1y < current) {
    target = current - 0.4 * (current - c.low1y);
  } else {
    const disc = pos == null ? 0.1 : pos < 0.3 ? 0.05 : pos < 0.6 ? 0.1 : pos < 0.85 ? 0.16 : 0.22;
    target = current * (1 - disc);
  }
  const price = clamp(target, current * 0.7, current * 0.97);
  return { price, source: "model", distancePct: ((current - price) / price) * 100 };
}

/** Koerspositie 0..1 uit de card (fallback wanneer er geen historie is). */
function positionFromCard(c: DoublingCardInput): number | null {
  const lo = c.low5y ?? c.low1y;
  const hi = c.high5y ?? c.high1y;
  if (lo == null || hi == null || c.lastClose == null || hi <= lo) return null;
  return clamp((c.lastClose - lo) / (hi - lo), 0, 1);
}

function fmtCap(cap: number): string {
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
  return `$${cap.toFixed(0)}`;
}

function buildNarrative(
  c: DoublingCardInput,
  stats: PriceStats | null,
  m: { pVol: number; pEmp: number | null; pBase: number; M: number; probability: number; score: number; confidence: Confidence },
): string {
  const parts: string[] = [];
  if (stats) {
    parts.push(
      `Op basis van ${stats.yearsCovered.toFixed(1)} jaar koershistorie (σ ≈ ${(stats.annualVol * 100).toFixed(0)}%/jaar) ` +
        (stats.episodes > 0
          ? `verdubbelde ${c.ticker} ${stats.episodes}× — een empirische kans van ${(stats.empDoubleProb * 100).toFixed(0)}% per jaar.`
          : `verdubbelde ${c.ticker} niet in deze periode; de kans leunt vooral op de volatiliteit (${(m.pVol * 100).toFixed(0)}%).`),
    );
  } else {
    parts.push(
      `Zonder koershistorie steunt de schatting op volatiliteit uit de 1j-range${m.pEmp != null ? " en de poefie-tellers" : ""} — minder betrouwbaar.`,
    );
  }
  const tilt = m.M >= 1.15 ? "omhoog bijgesteld" : m.M <= 0.9 ? "omlaag bijgesteld" : "nauwelijks bijgesteld";
  parts.push(
    `Structurele factoren (kwaliteit, omvang, positie, sector) hebben de kans ${tilt} (×${m.M.toFixed(2)}).`,
  );
  parts.push(`Eindschatting: ~${m.score}% kans op +100% binnen 12 maanden (betrouwbaarheid: ${m.confidence}).`);
  return parts.join(" ");
}
