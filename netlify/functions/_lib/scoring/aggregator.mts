// Briefing §4.1: drie sub-scores Structural × Catalyst × Timing aggregeren
// via geometric mean (niet arithmetic — we willen dat één zwakke dimensie
// de hele score laag houdt). Daarna risk_penalty asymmetrisch aftrekken
// (kan score verlagen, niet verhogen). Mining krijgt cycle_multiplier
// (briefing §6.1.4): bull=1.0, neutral=0.85, bear=0.50 (strenger in trader).
//
// Action labels uit thresholds (briefing §B.5).

import {
  calculateTheoreticalMax,
  type WeightEntry,
} from "./theoretical_max.mts";
import type { Mode, WeightSet } from "./weights.mts";

export type Action = "STRONG_BUY" | "BUY" | "WATCH" | "HOLD" | "AVOID";

export interface Component {
  name: string;
  weight: number;
  triggered: boolean;
}

export interface SubScore {
  raw: number; // sum of triggered weights
  max: number; // theoretical max
  normalized: number; // raw/max clipped [0,1]
  components: Component[];
  triggeredCount: number;
}

export interface ScoreResult {
  structural: SubScore;
  catalyst: SubScore;
  timing: SubScore;
  confluence: number;
  riskPenalty: number;
  cycleMultiplier: number;
  finalScore: number;
  action: Action;
  warnings: string[];
}

export const ACTION_THRESHOLDS: Record<
  Mode,
  { STRONG_BUY: number; BUY: number; WATCH: number; HOLD: number }
> = {
  trader: { STRONG_BUY: 0.75, BUY: 0.55, WATCH: 0.4, HOLD: 0.25 },
  investor: { STRONG_BUY: 0.7, BUY: 0.5, WATCH: 0.35, HOLD: 0.2 },
};

export const CYCLE_MULTIPLIERS: Record<
  Mode,
  Record<"bull" | "neutral" | "bear", number>
> = {
  trader: { bull: 1.0, neutral: 0.8, bear: 0.4 },
  investor: { bull: 1.0, neutral: 0.85, bear: 0.5 },
};

export function buildSubScore(
  weights: WeightEntry[],
  triggeredNames: Set<string>
): SubScore {
  const max = calculateTheoreticalMax(weights);
  let raw = 0;
  const components: Component[] = [];
  for (const w of weights) {
    const trig = triggeredNames.has(w.name);
    if (trig && !w.isRiskAdjuster) raw += w.weight;
    components.push({ name: w.name, weight: w.weight, triggered: trig });
  }
  const normalized = max > 0 ? Math.max(0, Math.min(1, raw / max)) : 0;
  return {
    raw,
    max,
    normalized,
    components,
    triggeredCount: components.filter((c) => c.triggered).length,
  };
}

export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.some((v) => v <= 0)) return 0;
  const logSum = values.reduce((s, v) => s + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

export function actionFor(score: number, mode: Mode): Action {
  const t = ACTION_THRESHOLDS[mode];
  if (score >= t.STRONG_BUY) return "STRONG_BUY";
  if (score >= t.BUY) return "BUY";
  if (score >= t.WATCH) return "WATCH";
  if (score >= t.HOLD) return "HOLD";
  return "AVOID";
}

export function aggregate(
  structural: SubScore,
  catalyst: SubScore,
  timing: SubScore,
  weights: WeightSet,
  triggeredRiskAdjusters: Set<string>,
  cyclePhase: "bull" | "neutral" | "bear" | null,
  mode: Mode
): ScoreResult {
  const confluence = geometricMean([
    structural.normalized,
    catalyst.normalized,
    timing.normalized,
  ]);

  let riskPenalty = 0;
  const warnings: string[] = [];
  for (const ra of weights.riskAdjusters) {
    if (triggeredRiskAdjusters.has(ra.name)) {
      riskPenalty += ra.penalty;
      warnings.push(`risk:${ra.name}`);
    }
  }
  riskPenalty = Math.min(1, riskPenalty);

  const cycleMultiplier = cyclePhase
    ? CYCLE_MULTIPLIERS[mode][cyclePhase]
    : 1.0;
  if (cycleMultiplier < 1.0) {
    warnings.push(`cycle:${cyclePhase}_multiplier_${cycleMultiplier}`);
  }

  const afterRisk = Math.max(0, confluence - riskPenalty);
  const finalScore = Math.max(0, Math.min(1, afterRisk * cycleMultiplier));
  const action = actionFor(finalScore, mode);

  return {
    structural,
    catalyst,
    timing,
    confluence,
    riskPenalty,
    cycleMultiplier,
    finalScore,
    action,
    warnings,
  };
}
