// Briefing §4.3: theoretical_max wordt vooraf berekend uit weights, waarbij
// mutually exclusive groepen (bv. market_cap brackets) alleen hun max
// bijdragen aan de denominator. Zonder deze fix krijgen alle tickers 1.00
// omdat een ticker die alleen "common_disease (5pt)" hit dezelfde 5/5=1.00
// scoort als één die "rare_disease (18pt)" hit (18/18=1.00).
//
// IMPORTANT: bij elke nieuwe weight in een mutually-exclusive groep MOET
// het regex-patroon hieronder bestaan, anders telt het signaal additief en
// blaast de denominator op (alle scores verlagen).

export interface WeightEntry {
  name: string;
  weight: number;
  isRiskAdjuster?: boolean;
}

export interface GroupPattern {
  pattern: RegExp;
  group: string;
}

export const GROUP_PATTERNS: GroupPattern[] = [
  // ── Structural — biotech + mining
  { pattern: /^market_cap_/, group: "market_cap" },
  { pattern: /^runway_/, group: "runway" },
  { pattern: /^cash_/, group: "cash" },
  { pattern: /^float_/, group: "float" },
  { pattern: /^(?:no_dilution|recent_dilution)_/, group: "dilution" },
  { pattern: /^listed_/, group: "listed_duration" },
  { pattern: /^insider_ownership_/, group: "insider_ownership" },
  { pattern: /^jurisdiction_tier_/, group: "jurisdiction_tier" },
  { pattern: /^exchange_/, group: "exchange" },
  { pattern: /^operational_status_/, group: "operational_status" },
  { pattern: /^share_count_/, group: "share_count" },
  { pattern: /^geological_anomaly_/, group: "geological_anomaly" },
  { pattern: /^processing_tech_/, group: "processing_tech" },

  // ── Catalyst — biotech
  { pattern: /^phase_\d/, group: "trial_phase" },
  { pattern: /^(?:fda_pdufa|ema_chmp|fda_decision)_/, group: "regulatory_decision" },
  { pattern: /_indication$/, group: "indication_type" },
  { pattern: /^(?:first|best)_in_class$/, group: "novelty" },
  { pattern: /^trial_patient_population_/, group: "trial_population" },
  { pattern: /^trial_endpoint_duration_/, group: "trial_endpoint_duration" },
  { pattern: /^prior_crl_count_/, group: "prior_crl" },
  { pattern: /^competitor_failures_/, group: "competitor_failures" },
  { pattern: /^trial_size_/, group: "trial_size" },

  // ── Catalyst — mining
  { pattern: /^drilling_/, group: "drilling_stage" },
  { pattern: /^resource_estimate_/, group: "resource_estimate" },
  { pattern: /^permit_/, group: "permit" },
  { pattern: /^commodity_phase_/, group: "commodity_phase" },
  { pattern: /^geological_setting_/, group: "geological_setting" },

  // ── Timing — beide sectoren
  { pattern: /^catalyst_(?:\d|under_|over_)/, group: "catalyst_proximity" },
  { pattern: /^insider_(?:cluster|net)_/, group: "insider_activity" },
  { pattern: /^short_interest_/, group: "short_interest" },
  { pattern: /^(?:price_above_ema_|price_at_)/, group: "price_momentum" },
  { pattern: /^volume_/, group: "volume" },
  { pattern: /^pre_event_runup_/, group: "pre_event_runup" },
  { pattern: /^cycle_/, group: "commodity_cycle" },
];

export function classifySignal(name: string): string {
  for (const p of GROUP_PATTERNS) {
    if (p.pattern.test(name)) return p.group;
  }
  return name;
}

export function calculateTheoreticalMax(weights: WeightEntry[]): number {
  const groups = new Map<string, number>();
  let additive = 0;
  for (const w of weights) {
    if (w.isRiskAdjuster || w.weight <= 0) continue;
    const g = classifySignal(w.name);
    if (g === w.name) additive += w.weight;
    else groups.set(g, Math.max(groups.get(g) ?? 0, w.weight));
  }
  let total = additive;
  for (const v of groups.values()) total += v;
  return total;
}

export function explainGrouping(
  weights: WeightEntry[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of weights) {
    const g = classifySignal(w.name);
    (out[g] ??= []).push(`${w.name}=${w.weight}`);
  }
  return out;
}
