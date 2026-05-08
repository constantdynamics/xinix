// Briefing §5.4 + §C.6: drie lookalike pairs waar identiek pre-event
// profiel tegenovergestelde uitkomsten gaf. Discrimination test:
// winner.final_score moet > loser.final_score zijn met minimum delta 0.10.
// Falt deze test bij codewijziging → regressie in fase 4 trial_design /
// mining_quality risk-adjusters.

import { getWeights } from "./weights.ts";
import { aggregate, buildSubScore } from "./aggregator.ts";
import {
  classify,
  type CatalystRow,
  type ClassifyContext,
  type MacroRow,
  type PriceSummary,
  type TickerRow,
} from "./classify.ts";

interface PairCase {
  name: string;
  winner: { ticker: TickerRow; price: PriceSummary; catalysts: CatalystRow[] };
  loser: { ticker: TickerRow; price: PriceSummary; catalysts: CatalystRow[] };
  discriminator: string;
}

const TODAY_PLUS = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// ── Pair 1: ETNB (winner) vs AKRO (loser) — NASH FGF21 P2b 2023 ───────
// Differentiator: ETNB selecteerde F2-F3 + 24w endpoint; AKRO koos F4
// cirrhose + 36w endpoint = mechanistisch zwaarder + langer = hogere
// uncertainty. ETNB +50-80% day-0, AKRO -62.6%.
const PAIR_ETNB_AKRO: PairCase = {
  name: "ETNB vs AKRO (NASH FGF21 P2b 2023)",
  discriminator:
    "Patient population (F2-F3 vs F4) + endpoint duration (24w vs 36w)",
  winner: {
    ticker: {
      id: 901,
      ticker: "ETNB",
      sector: "biotech",
      market_cap_usd: 250_000_000,
      cash_runway_months: 24,
      share_count_millions: 35,
      insider_ownership_pct: 0.18,
      disease_area: "NASH metabolic",
      modality: "FGF21 analog",
      first_in_class: true,
      has_breakthrough_designation: false,
      has_fast_track: true,
      has_orphan_drug: false,
      trial_patient_population_severity: "early",
      trial_endpoint_duration_weeks: 24,
      mechanism_has_clinical_precedent: true,
      primary_endpoint_powered_for_subgroup: false,
      prior_crl_count: 0,
      pre_event_ytd_return_pct: 0.4,
      trial_size_n: 280,
    },
    price: {
      ticker: "ETNB",
      last_close: 12.5,
      avg_volume_30d: 1_500_000,
      last_volume: 1_700_000,
      volume_ratio: 1.13,
      pct_above_90d_low: 35,
    },
    catalysts: [
      {
        id: 9001,
        ticker: "ETNB",
        catalyst_type: "phase_2b_readout",
        expected_date: TODAY_PLUS(45),
        status: "pending",
      },
    ],
  },
  loser: {
    ticker: {
      id: 902,
      ticker: "AKRO",
      sector: "biotech",
      market_cap_usd: 280_000_000,
      cash_runway_months: 26,
      share_count_millions: 38,
      insider_ownership_pct: 0.16,
      disease_area: "NASH metabolic",
      modality: "FGF21 analog",
      first_in_class: true,
      has_breakthrough_designation: false,
      has_fast_track: true,
      has_orphan_drug: false,
      trial_patient_population_severity: "late", // F4 cirrhose
      trial_endpoint_duration_weeks: 36, // SYMMETRY-endpoint
      mechanism_has_clinical_precedent: true,
      primary_endpoint_powered_for_subgroup: true, // SYMMETRY ambitie
      prior_crl_count: 0,
      pre_event_ytd_return_pct: 0.45,
      trial_size_n: 260,
    },
    price: {
      ticker: "AKRO",
      last_close: 22.0,
      avg_volume_30d: 1_300_000,
      last_volume: 1_400_000,
      volume_ratio: 1.08,
      pct_above_90d_low: 38,
    },
    catalysts: [
      {
        id: 9002,
        ticker: "AKRO",
        catalyst_type: "phase_2b_readout",
        expected_date: TODAY_PLUS(50),
        status: "pending",
      },
    ],
  },
};

// ── Pair 2: AKBA (winner) vs APLT (loser) — rare disease PDUFA 2024 ─
// Differentiator: AKBA narrowed label naar dialysis-only na 2022 CRL +
// 30k pt Japan post-marketing; APLT geen label change + +155% YTD run
// = sell-the-news fragiel. AKBA approved, APLT CRL.
const PAIR_AKBA_APLT: PairCase = {
  name: "AKBA vs APLT (rare disease PDUFA 2024)",
  discriminator:
    "Label narrowing na CRL + ex-US safety dataset + sell-the-news positionering",
  winner: {
    ticker: {
      id: 903,
      ticker: "AKBA",
      sector: "biotech",
      market_cap_usd: 80_000_000, // penny stock
      cash_runway_months: 14,
      share_count_millions: 165,
      insider_ownership_pct: 0.06,
      disease_area: "rare disease anemia (CKD on dialysis)",
      first_in_class: false,
      best_in_class: true,
      has_breakthrough_designation: false,
      has_fast_track: false,
      has_orphan_drug: false,
      prior_crl_count: 1,
      label_narrowed_after_crl: true,
      has_ex_us_safety_dataset: true,
      mechanism_has_clinical_precedent: true,
      pre_event_ytd_return_pct: 0.3,
    },
    price: {
      ticker: "AKBA",
      last_close: 1.2,
      volume_ratio: 1.4,
      pct_above_90d_low: 25,
      avg_volume_30d: 5_000_000,
      last_volume: 7_000_000,
    },
    catalysts: [
      {
        id: 9003,
        ticker: "AKBA",
        catalyst_type: "fda_pdufa_pending",
        expected_date: TODAY_PLUS(40),
        status: "pending",
      },
    ],
  },
  loser: {
    ticker: {
      id: 904,
      ticker: "APLT",
      sector: "biotech",
      market_cap_usd: 350_000_000,
      cash_runway_months: 18,
      share_count_millions: 92,
      insider_ownership_pct: 0.08,
      disease_area: "rare disease galactosemia",
      first_in_class: true,
      has_breakthrough_designation: true,
      has_orphan_drug: true,
      prior_crl_count: 0,
      label_narrowed_after_crl: false,
      has_ex_us_safety_dataset: false, // geen ex-US data
      mechanism_has_clinical_precedent: false, // FIC zonder precedent
      pre_event_ytd_return_pct: 1.55, // +155% YTD = extreme runup
    },
    price: {
      ticker: "APLT",
      last_close: 9.8,
      volume_ratio: 1.2,
      pct_above_90d_low: 130, // +130% boven 90d low — runup proxy
      avg_volume_30d: 2_000_000,
      last_volume: 2_400_000,
    },
    catalysts: [
      {
        id: 9004,
        ticker: "APLT",
        catalyst_type: "fda_pdufa_pending",
        expected_date: TODAY_PLUS(35),
        status: "pending",
      },
    ],
  },
};

// ── Pair 3: UAMY (winner) vs PPTA (loser) — antimony China shock 2024 ─
// Differentiator: UAMY operational smelter + 75M tight float; PPTA
// pre-development Stibnite + $400M+ cap. UAMY +3800%, PPTA +19% op
// dezelfde macro-catalyst.
const PAIR_UAMY_PPTA: PairCase = {
  name: "UAMY vs PPTA (antimony China shock 2024)",
  discriminator:
    "Operational status + share count tightness + market cap",
  winner: {
    ticker: {
      id: 905,
      ticker: "UAMY",
      sector: "mining",
      market_cap_usd: 30_000_000,
      cash_runway_months: 8,
      share_count_millions: 75,
      jurisdiction: "USA",
      commodity: "Sb",
      operational_status: "operational",
      processing_tech: "proven_conventional",
      geological_anomaly: "none",
      has_strategic_backer: false,
      reverse_split_history: false,
      pre_event_ytd_return_pct: 0.3,
    },
    price: {
      ticker: "UAMY",
      last_close: 0.8,
      volume_ratio: 2.0,
      pct_above_90d_low: 40,
      avg_volume_30d: 3_000_000,
      last_volume: 6_000_000,
    },
    catalysts: [
      {
        id: 9005,
        ticker: "UAMY",
        catalyst_type: "china_export_shock",
        expected_date: TODAY_PLUS(7),
        status: "pending",
      },
    ],
  },
  loser: {
    ticker: {
      id: 906,
      ticker: "PPTA",
      sector: "mining",
      market_cap_usd: 420_000_000,
      cash_runway_months: 14,
      share_count_millions: 220,
      jurisdiction: "USA",
      commodity: "Sb",
      operational_status: "pre_development",
      processing_tech: "proven_conventional",
      geological_anomaly: "single_signal",
      has_strategic_backer: true,
      strategic_backer_tier: 2,
      pre_event_ytd_return_pct: 0.6,
    },
    price: {
      ticker: "PPTA",
      last_close: 1.85,
      volume_ratio: 1.3,
      pct_above_90d_low: 55,
      avg_volume_30d: 1_500_000,
      last_volume: 2_000_000,
    },
    catalysts: [
      {
        id: 9006,
        ticker: "PPTA",
        catalyst_type: "china_export_shock",
        expected_date: TODAY_PLUS(7),
        status: "pending",
      },
    ],
  },
};

export const LOOKALIKE_PAIRS = [PAIR_ETNB_AKRO, PAIR_AKBA_APLT, PAIR_UAMY_PPTA];

interface ScoreOnly {
  final_score: number;
  action: string;
  structural: number;
  catalyst: number;
  timing: number;
  risk_penalty: number;
  warnings: string[];
}

function scoreFromCase(
  c: { ticker: TickerRow; price: PriceSummary; catalysts: CatalystRow[] },
  macro: MacroRow[]
): ScoreOnly {
  const weights = getWeights(c.ticker.sector, "trader");
  const ctx: ClassifyContext = {
    ticker: c.ticker,
    catalysts: c.catalysts,
    price: c.price,
    macro,
    recentSignalTypes: new Set(),
  };
  const cls = classify(ctx);
  const s = buildSubScore(weights.structural, cls.triggeredStructural);
  const ca = buildSubScore(weights.catalyst, cls.triggeredCatalyst);
  const t = buildSubScore(weights.timing, cls.triggeredTiming);
  const r = aggregate(
    s,
    ca,
    t,
    weights,
    cls.triggeredRiskAdjusters,
    cls.cyclePhase,
    "trader"
  );
  return {
    final_score: r.finalScore,
    action: r.action,
    structural: s.normalized,
    catalyst: ca.normalized,
    timing: t.normalized,
    risk_penalty: r.riskPenalty,
    warnings: r.warnings,
  };
}

export interface PairResult {
  name: string;
  discriminator: string;
  winner: ScoreOnly & { ticker: string };
  loser: ScoreOnly & { ticker: string };
  delta: number;
  pass: boolean;
}

export function runLookalikePairs(macro: MacroRow[] = []): {
  results: PairResult[];
  summary: { passed: number; total: number };
} {
  const results: PairResult[] = LOOKALIKE_PAIRS.map((p) => {
    const w = scoreFromCase(p.winner, macro);
    const l = scoreFromCase(p.loser, macro);
    const delta = +(w.final_score - l.final_score).toFixed(4);
    return {
      name: p.name,
      discriminator: p.discriminator,
      winner: { ...w, ticker: p.winner.ticker.ticker },
      loser: { ...l, ticker: p.loser.ticker.ticker },
      delta,
      pass: delta >= 0.1,
    };
  });
  return {
    results,
    summary: {
      passed: results.filter((r) => r.pass).length,
      total: results.length,
    },
  };
}
