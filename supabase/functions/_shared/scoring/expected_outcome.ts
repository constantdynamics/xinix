// Briefing §6.1.5 + §6.1.6: per catalyst type een baseline hit-rate
// (historische sector data) + verwachte peak return + sector T+90
// ratio. Owner ziet hierdoor wat de verwachte uitkomst is, niet
// alleen "STRONG_BUY" maar "verwacht peak ~+80%, T+90 ~+30%".
//
// Belangrijk (briefing §9.6): deze cijfers zijn historische medianen,
// owner moet niet linear extrapoleren. Sample size per cat-type is
// N=20-50 over 2018-2024 — wide confidence intervals.

export interface CatalystBaseline {
  hitRate: number;
  peakReturn: number;
  label: string;
}

// Hit rate = % trials/events met ≥+50% piek na catalyst
export const CATALYST_BASELINES: Record<string, CatalystBaseline> = {
  // Biotech (briefing §6.1.5 + §C.5)
  phase_3_readout: { hitRate: 0.30, peakReturn: 1.5, label: "P3 readout" },
  phase_2b_readout: { hitRate: 0.32, peakReturn: 0.8, label: "P2b readout" },
  phase_2_readout: { hitRate: 0.25, peakReturn: 0.5, label: "P2 readout" },
  phase_1_readout: { hitRate: 0.20, peakReturn: 0.4, label: "P1 readout" },
  fda_pdufa_pending: { hitRate: 0.40, peakReturn: 1.0, label: "FDA PDUFA" },
  ema_chmp_pending: { hitRate: 0.45, peakReturn: 0.6, label: "EMA CHMP" },
  fda_adcom_pending: { hitRate: 0.50, peakReturn: 0.7, label: "FDA AdCom" },
  // Mining (briefing §6.1.5 + §C.7)
  drilling_tier1_in_progress: {
    hitRate: 0.55,
    peakReturn: 2.5,
    label: "Tier-1 drilling",
  },
  drilling_results_pending: {
    hitRate: 0.40,
    peakReturn: 1.5,
    label: "Drilling results",
  },
  resource_estimate_maiden_pending: {
    hitRate: 0.20,
    peakReturn: 1.0,
    label: "Maiden resource estimate",
  },
  resource_upgrade_pending: {
    hitRate: 0.30,
    peakReturn: 0.5,
    label: "Resource upgrade",
  },
  permit_decision_tier1_pending: {
    hitRate: 0.55,
    peakReturn: 0.6,
    label: "Permit (tier-1 jurisdiction)",
  },
  feasibility_study_pending: {
    hitRate: 0.35,
    peakReturn: 0.7,
    label: "Feasibility study",
  },
  china_export_shock: {
    hitRate: 0.40,
    peakReturn: 2.0,
    label: "China export shock",
  },
  off_take_signing_pending: {
    hitRate: 0.45,
    peakReturn: 0.6,
    label: "Off-take agreement",
  },
};

// T+90 ratio: peak/T+90 mediaan per sector (briefing §6.1.6)
// Biotech mean reversion is heftiger door sell-the-news;
// mining houdt waarde langer vast bij commodity uplift.
const SECTOR_T90_RATIO: Record<"biotech" | "mining", number> = {
  biotech: 0.35,
  mining: 0.55,
};

export interface ExpectedOutcome {
  catalystType: string;
  catalystLabel: string;
  hitRateBaseline: number;
  peakReturnEst: number;
  t90ReturnEst: number;
  expectedPeakPrice: number | null;
  expectedT90Price: number | null;
  exitWindowDays: number;
  warning: string;
  caveat: string;
}

export function expectedOutcome(input: {
  sector: "biotech" | "mining";
  catalystType: string | null;
  daysUntilCatalyst: number | null;
  currentPrice: number | null;
}): ExpectedOutcome | null {
  if (!input.catalystType) return null;
  const cat = input.catalystType;
  const baseline = CATALYST_BASELINES[cat];
  if (!baseline) {
    // Unknown catalyst → conservatieve defaults
    const peak = 0.4;
    const ratio = SECTOR_T90_RATIO[input.sector];
    return buildOutcome(cat, cat, 0.20, peak, ratio, input);
  }
  const ratio = SECTOR_T90_RATIO[input.sector];
  return buildOutcome(
    cat,
    baseline.label,
    baseline.hitRate,
    baseline.peakReturn,
    ratio,
    input
  );
}

function buildOutcome(
  cat: string,
  label: string,
  hitRate: number,
  peak: number,
  ratio: number,
  input: { sector: string; daysUntilCatalyst: number | null; currentPrice: number | null }
): ExpectedOutcome {
  const t90 = +(peak * ratio).toFixed(3);
  const exit = (input.daysUntilCatalyst ?? 60) + 30;
  return {
    catalystType: cat,
    catalystLabel: label,
    hitRateBaseline: hitRate,
    peakReturnEst: peak,
    t90ReturnEst: t90,
    expectedPeakPrice: input.currentPrice
      ? +(input.currentPrice * (1 + peak)).toFixed(3)
      : null,
    expectedT90Price: input.currentPrice
      ? +(input.currentPrice * (1 + t90)).toFixed(3)
      : null,
    exitWindowDays: exit,
    warning:
      input.sector === "biotech"
        ? `Bij hit verwacht piek ~+${pct(peak)} rond catalyst, maar T+90 mediaan ~+${pct(t90)} (mean reversion). Exit-discipline op piek essentieel — anders geef je 65% van de winst terug.`
        : `Bij hit verwacht piek ~+${pct(peak)}, T+90 mediaan ~+${pct(t90)}. Mining houdt waarde beter vast dan biotech — verkoop discipline minder kritiek maar nog steeds belangrijk.`,
    caveat: `Baseline hit-rate ${pct(hitRate)} is historisch (N≈20-50, 2018-2024). Wide confidence interval — gebruik als prior, niet als belofte (briefing §9.6).`,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
