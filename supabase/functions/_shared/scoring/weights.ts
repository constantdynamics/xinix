// Weight tables uit briefing Appendix B. Default mode = trader (owner doel:
// swing trades op piek-detectie, niet buy-and-hold).
//
// Trader vs Investor (briefing §4.4):
//   - Trader: lagere structural (bedrijf hoeft niet lang te bestaan, alleen
//     tot catalyst), hogere timing (entry-moment is alles), strenger met
//     pre-event run-up penalties (sell-the-news risk).
//   - Investor: klassiek buy-and-hold profielfilter.
//
// Per briefing §11.3.3: deze gewichten zijn educated guesses tot fase 5
// forward returns ze data-driven herkalibreert. Niet aanpassen op anekdotes.

import type { WeightEntry } from "./theoretical_max.ts";

export type Mode = "investor" | "trader";

export interface WeightSet {
  structural: WeightEntry[];
  catalyst: WeightEntry[];
  timing: WeightEntry[];
  riskAdjusters: { name: string; penalty: number }[];
}

export const BIOTECH_INVESTOR: WeightSet = {
  structural: [
    { name: "market_cap_under_500m_usd", weight: 25 },
    { name: "market_cap_500m_to_2b", weight: 12 },
    { name: "market_cap_over_2b", weight: 0 },
    { name: "runway_18plus_months", weight: 15 },
    { name: "runway_12_to_18_months", weight: 10 },
    { name: "runway_6_to_12_months", weight: 5 },
    { name: "runway_under_6_months", weight: -10, isRiskAdjuster: true },
    { name: "float_5m_to_50m", weight: 10 },
    { name: "float_50m_to_100m", weight: 6 },
    { name: "float_under_5m_or_over_100m", weight: 2 },
    { name: "no_dilution_last_6_months", weight: 8 },
    { name: "recent_dilution_last_6_months", weight: -8, isRiskAdjuster: true },
    { name: "listed_5plus_years", weight: 8 },
    { name: "listed_2_to_5_years", weight: 4 },
    { name: "listed_under_2_years", weight: 0 },
    { name: "insider_ownership_10_to_30pct", weight: 6 },
    { name: "insider_ownership_under_10pct", weight: 2 },
    { name: "insider_ownership_over_30pct", weight: 2 },
  ],
  catalyst: [
    { name: "phase_3_readout", weight: 30 },
    { name: "phase_2b_readout", weight: 18 },
    { name: "phase_2_readout", weight: 10 },
    { name: "fda_pdufa_pending", weight: 25 },
    { name: "ema_chmp_pending", weight: 15 },
    { name: "rare_disease_indication", weight: 18 },
    { name: "oncology_indication", weight: 12 },
    { name: "common_disease_indication", weight: 5 },
    { name: "first_in_class", weight: 15 },
    { name: "best_in_class", weight: 8 },
    { name: "has_breakthrough_designation", weight: 12 },
    { name: "has_fast_track", weight: 6 },
    { name: "has_orphan_drug", weight: 8 },
    { name: "trial_size_300plus", weight: 6 },
    { name: "competitor_failures_in_target_2plus", weight: 8 },
    { name: "competitor_failures_in_target_1", weight: 4 },
  ],
  timing: [
    { name: "catalyst_30_to_90_days_out", weight: 25 },
    { name: "catalyst_90_to_180_days_out", weight: 15 },
    { name: "catalyst_15_to_30_days_out", weight: 12 },
    { name: "catalyst_under_15_days", weight: 5 },
    { name: "catalyst_over_180_days", weight: 0 },
    { name: "insider_cluster_buy_30d", weight: 18 },
    { name: "insider_net_buying_30d", weight: 10 },
    { name: "insider_net_selling_30d", weight: -10, isRiskAdjuster: true },
    { name: "short_interest_decreasing", weight: 10 },
    { name: "short_interest_under_10pct", weight: 6 },
    { name: "short_interest_squeeze_setup", weight: 12 },
    { name: "price_above_ema_50_and_200", weight: 8 },
    { name: "price_above_ema_200_only", weight: 5 },
    { name: "price_at_52w_low", weight: -8, isRiskAdjuster: true },
    { name: "volume_above_50d_avg_15pct", weight: 10 },
    { name: "volume_spike_50pct_plus", weight: 12 },
  ],
  riskAdjusters: [
    { name: "going_concern_flag", penalty: 0.30 },
    { name: "recent_class_action_lawsuit", penalty: 0.25 },
    { name: "reverse_split_history", penalty: 0.10 },
    { name: "insider_concentration_over_50pct", penalty: 0.08 },
    { name: "rapid_dilution_velocity", penalty: 0.20 },
    { name: "data_integrity_concerns", penalty: 0.40 },
    // sell-the-news (briefing §6.1.2)
    { name: "pre_event_runup_mild", penalty: 0.05 },
    { name: "pre_event_runup_moderate", penalty: 0.15 },
    { name: "pre_event_runup_extreme", penalty: 0.25 },
    // trial design rode vlaggen (briefing §6.1.1 + §5.4)
    { name: "primary_endpoint_powered_for_subgroup", penalty: 0.20 }, // AKRO-style
    { name: "adcom_negative", penalty: 0.40 }, // YMAB 2022 = vrijwel fataal
    { name: "prior_crl_unchanged_strategy", penalty: 0.25 }, // APLT-style
  ],
};

// Trader: structural-weights ge-halveerd, timing-weights iets verhoogd,
// strengere sell-the-news + trial-design penalty.
export const BIOTECH_TRADER: WeightSet = {
  structural: BIOTECH_INVESTOR.structural.map((w) => ({
    ...w,
    weight: w.isRiskAdjuster ? w.weight : Math.round(w.weight * 0.6),
  })),
  catalyst: BIOTECH_INVESTOR.catalyst,
  timing: [
    { name: "catalyst_30_to_90_days_out", weight: 28 },
    { name: "catalyst_15_to_30_days_out", weight: 22 }, // dichterbij = beter voor trader
    { name: "catalyst_90_to_180_days_out", weight: 10 },
    { name: "catalyst_under_15_days", weight: 8 },
    { name: "catalyst_over_180_days", weight: 0 },
    { name: "insider_cluster_buy_30d", weight: 20 },
    { name: "insider_net_buying_30d", weight: 12 },
    { name: "insider_net_selling_30d", weight: -12, isRiskAdjuster: true },
    { name: "short_interest_decreasing", weight: 12 },
    { name: "short_interest_under_10pct", weight: 6 },
    { name: "short_interest_squeeze_setup", weight: 15 },
    { name: "price_above_ema_50_and_200", weight: 10 },
    { name: "price_above_ema_200_only", weight: 6 },
    { name: "price_at_52w_low", weight: -10, isRiskAdjuster: true },
    { name: "volume_above_50d_avg_15pct", weight: 12 },
    { name: "volume_spike_50pct_plus", weight: 15 },
  ],
  riskAdjusters: [
    ...BIOTECH_INVESTOR.riskAdjusters.filter(
      (r) => !r.name.startsWith("pre_event_runup_")
    ),
    // strenger in trader mode — owner kan niet wachten op mean reversion
    { name: "pre_event_runup_mild", penalty: 0.08 },
    { name: "pre_event_runup_moderate", penalty: 0.20 },
    { name: "pre_event_runup_extreme", penalty: 0.35 },
  ],
};

// Update mining trader risk adjusters — geen veranderingen aan biotech-only
// trial-design risk names omdat die niet in MINING_INVESTOR voorkomen.

export const MINING_INVESTOR: WeightSet = {
  structural: [
    { name: "market_cap_under_50m_usd", weight: 25 },
    { name: "market_cap_50m_to_250m_usd", weight: 20 },
    { name: "market_cap_over_250m_usd", weight: 5 },
    { name: "cash_12plus_months_ops", weight: 15 },
    { name: "cash_6_to_12_months_ops", weight: 8 },
    { name: "cash_under_6_months_ops", weight: -10, isRiskAdjuster: true },
    { name: "exchange_tier1_us_listed", weight: 10 },
    { name: "exchange_asx_or_tsx", weight: 8 },
    { name: "exchange_tsxv_or_aim", weight: 6 },
    { name: "jurisdiction_tier_1", weight: 15 }, // Canada/Australia/USA
    { name: "jurisdiction_tier_2", weight: 8 }, // Chile/Peru/Brazil
    { name: "jurisdiction_tier_3", weight: -15, isRiskAdjuster: true }, // DRC/Mali — AVZ-style
    { name: "share_count_under_100m", weight: 10 }, // tight float
    { name: "share_count_100m_to_300m", weight: 5 },
    { name: "share_count_over_300m", weight: 0 },
    { name: "operational_status_operational", weight: 12 }, // UAMY-style smelter
    { name: "operational_status_pre_development", weight: 0 }, // PPTA — moet bewijzen
    { name: "geological_anomaly_dual_grav_mag", weight: 12 }, // WA1
    { name: "geological_anomaly_single_signal", weight: 4 }, // LYN
    { name: "processing_tech_proven_conventional", weight: 6 }, // PMET spodumene
    { name: "processing_tech_unproven_dle", weight: -10, isRiskAdjuster: true }, // LKE Lilac
  ],
  catalyst: [
    { name: "drilling_tier1_in_progress", weight: 30 }, // PMET / WA1 setup
    { name: "drilling_results_pending", weight: 22 },
    { name: "drilling_step_out_planned", weight: 12 },
    { name: "resource_estimate_maiden_pending", weight: 25 },
    { name: "resource_estimate_update_pending", weight: 12 },
    { name: "permit_decision_tier1_pending", weight: 22 }, // tier-1 jurisdictie permit
    { name: "permit_decision_tier2_pending", weight: 10 },
    { name: "commodity_phase_breakout", weight: 18 }, // antimony 2024, lithium 2022
    { name: "commodity_phase_neutral", weight: 5 },
    { name: "commodity_phase_bear", weight: -8, isRiskAdjuster: true },
    { name: "china_export_shock", weight: 20 }, // UAMY-style macro
    { name: "strategic_backer_tier1", weight: 12 }, // Albemarle/CATL
    { name: "strategic_backer_other", weight: 6 },
  ],
  timing: [
    { name: "catalyst_under_15_days", weight: 25 }, // mining: pump nabij
    { name: "catalyst_15_to_30_days_out", weight: 22 },
    { name: "catalyst_30_to_90_days_out", weight: 15 },
    { name: "catalyst_90_to_180_days_out", weight: 8 },
    { name: "catalyst_over_180_days", weight: 0 },
    { name: "insider_cluster_buy_30d", weight: 18 },
    { name: "insider_net_buying_30d", weight: 10 },
    { name: "insider_net_selling_30d", weight: -10, isRiskAdjuster: true },
    { name: "volume_above_50d_avg_15pct", weight: 12 },
    { name: "volume_spike_50pct_plus", weight: 15 },
    { name: "price_above_ema_50_and_200", weight: 8 },
    { name: "price_above_ema_200_only", weight: 5 },
    { name: "price_at_52w_low", weight: -6, isRiskAdjuster: true },
  ],
  riskAdjusters: [
    { name: "reverse_split_history", penalty: 0.10 },
    { name: "going_concern_flag", penalty: 0.30 },
    { name: "rapid_dilution_velocity", penalty: 0.20 },
    { name: "promoter_concentration", penalty: 0.10 },
    { name: "meme_stock_dynamics", penalty: 0.30 }, // KAILI — briefing §6.2
    { name: "pre_event_runup_mild", penalty: 0.05 },
    { name: "pre_event_runup_moderate", penalty: 0.15 },
    { name: "pre_event_runup_extreme", penalty: 0.25 },
  ],
};

export const MINING_TRADER: WeightSet = {
  structural: MINING_INVESTOR.structural.map((w) => ({
    ...w,
    weight: w.isRiskAdjuster ? w.weight : Math.round(w.weight * 0.7),
  })),
  catalyst: MINING_INVESTOR.catalyst,
  timing: MINING_INVESTOR.timing.map((w) => ({
    ...w,
    weight: w.isRiskAdjuster ? w.weight : Math.round(w.weight * 1.15),
  })),
  riskAdjusters: [
    ...MINING_INVESTOR.riskAdjusters.filter(
      (r) => !r.name.startsWith("pre_event_runup_")
    ),
    { name: "pre_event_runup_mild", penalty: 0.08 },
    { name: "pre_event_runup_moderate", penalty: 0.20 },
    { name: "pre_event_runup_extreme", penalty: 0.35 },
  ],
};

export function getWeights(
  sector: "biotech" | "mining",
  mode: Mode
): WeightSet {
  if (sector === "biotech")
    return mode === "trader" ? BIOTECH_TRADER : BIOTECH_INVESTOR;
  return mode === "trader" ? MINING_TRADER : MINING_INVESTOR;
}
