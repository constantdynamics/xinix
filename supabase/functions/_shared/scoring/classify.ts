// Vertaalt ruwe Supabase rows (signal_tickers + signal_catalysts +
// signal_price_summary + signal_macro + signal_events) naar een Set van
// triggered signaal-namen die de aggregator gebruikt.
//
// Pragmatisch: niet alle weights uit de briefing zijn bekend — voor velden
// die we niet hebben triggeren we het signaal simpelweg niet (sub-score
// blijft proportioneel lager). data_completeness houdt bij hoeveel
// inputs we hadden.

export interface TickerRow {
  id: number;
  ticker: string;
  sector: "biotech" | "mining";
  goud_score?: number | null;
  goud_type?: string | null;
  share_count_millions?: number | null;
  reverse_split_history?: boolean | null;
  jurisdiction?: string | null;
  commodity?: string | null;
  phase?: string | null;
  modality?: string | null;
  disease_area?: string | null;
  // Shared fase 4 velden
  market_cap_usd?: number | null;
  cash_runway_months?: number | null;
  insider_ownership_pct?: number | null;
  pre_event_ytd_return_pct?: number | null;
  // Biotech v1.1 (briefing §6.1.1)
  trial_patient_population_severity?: string | null; // 'early'|'moderate'|'late'
  trial_endpoint_duration_weeks?: number | null;
  mechanism_has_clinical_precedent?: boolean | null;
  primary_endpoint_powered_for_subgroup?: boolean | null;
  prior_crl_count?: number | null;
  label_narrowed_after_crl?: boolean | null;
  has_ex_us_safety_dataset?: boolean | null;
  fda_advisory_committee_outcome?: string | null; // 'positive'|'negative'|'none'|'pending'
  has_breakthrough_designation?: boolean | null;
  has_fast_track?: boolean | null;
  has_orphan_drug?: boolean | null;
  first_in_class?: boolean | null;
  best_in_class?: boolean | null;
  competitor_failures_in_target?: number | null;
  trial_size_n?: number | null;
  // Mining v1.1 (briefing §6.1.3)
  geological_anomaly?: string | null; // 'dual_grav_mag'|'single_signal'|'nearology'|'none'
  cover_depth_meters?: number | null;
  prior_geophysics_spend_usd?: number | null;
  processing_tech?: string | null; // 'proven_conventional'|'unproven_dle'|'unproven_other'
  operational_status?: string | null; // 'operational'|'construction'|'pre_development'
  promoter_concentration_pct?: number | null;
  has_strategic_backer?: boolean | null;
  strategic_backer_tier?: number | null; // 1 or 2
}

export interface CatalystRow {
  id: number;
  ticker: string;
  catalyst_type: string;
  expected_date: string;
  description?: string | null;
  status: string;
}

// Werkelijke kolommen uit poll-prices-background.mts (fase 4 voegt EMA's
// en short interest toe via een upgrade van de price poller)
export interface PriceSummary {
  ticker: string;
  last_close?: number | null;
  last_volume?: number | null;
  low_90d?: number | null;
  high_90d?: number | null;
  pct_above_90d_low?: number | null; // proxy voor pre-event run-up
  pct_change_1d?: number | null;
  pct_change_5d?: number | null;
  avg_volume_30d?: number | null;
  volume_ratio?: number | null; // last_volume / avg_volume_30d
}

export interface MacroRow {
  symbol: string; // GOLD/SILVER/COPPER/LITHIUM/URANIUM/PLATINUM/PALLADIUM
  pct_change_30d?: number | null;
  pct_change_90d?: number | null;
  pct_change_365d?: number | null;
}

// signal_macro.symbol → ticker.commodity mapping (uit poll-metals SYMBOLS)
const MACRO_SYMBOL_TO_COMMODITY: Record<string, string> = {
  GOLD: "Au",
  SILVER: "Ag",
  COPPER: "Cu",
  PLATINUM: "Pt",
  PALLADIUM: "Pd",
  URANIUM: "U",
  LITHIUM: "Li",
};

// Briefing §6.1.4: cycle phase uit 30d+90d momentum.
// Bull: 90d ≥ +20% OF 30d ≥ +10%. Bear: 90d ≤ -15%. Anders neutral.
function derivePhase(m: MacroRow): "bull" | "neutral" | "bear" {
  const m30 = m.pct_change_30d ?? 0;
  const m90 = m.pct_change_90d ?? 0;
  if (m90 >= 20 || m30 >= 10) return "bull";
  if (m90 <= -15) return "bear";
  return "neutral";
}

export interface ClassifyContext {
  ticker: TickerRow;
  catalysts: CatalystRow[];
  price?: PriceSummary | null;
  macro: MacroRow[];
  recentSignalTypes: Set<string>; // signal_events afgelopen 30d
}

export interface ClassifyResult {
  triggeredStructural: Set<string>;
  triggeredCatalyst: Set<string>;
  triggeredTiming: Set<string>;
  triggeredRiskAdjusters: Set<string>;
  cyclePhase: "bull" | "neutral" | "bear" | null;
  nearestCatalyst: { type: string; daysUntil: number } | null;
  dataCompleteness: number;
}

const TIER1_JURISDICTIONS = new Set([
  "Canada",
  "Australia",
  "USA",
  "United States",
  "Australië",
]);
const TIER3_JURISDICTIONS = new Set(["DRC", "Mali", "Bolivia", "Venezuela"]);

const STRATEGIC_BACKERS_TIER1 = new Set(["Albemarle", "CATL", "Pfizer"]);

export function classify(ctx: ClassifyContext): ClassifyResult {
  const t = ctx.ticker;
  const sector = t.sector;
  const struct = new Set<string>();
  const cat = new Set<string>();
  const tim = new Set<string>();
  const risk = new Set<string>();
  let inputs = 0;
  let knownInputs = 0;

  // ── Structural ──────────────────────────────────────────────────────
  inputs++;
  if (t.market_cap_usd != null) {
    knownInputs++;
    if (sector === "biotech") {
      if (t.market_cap_usd < 500_000_000) struct.add("market_cap_under_500m_usd");
      else if (t.market_cap_usd < 2_000_000_000) struct.add("market_cap_500m_to_2b");
      else struct.add("market_cap_over_2b");
    } else {
      if (t.market_cap_usd < 50_000_000) struct.add("market_cap_under_50m_usd");
      else if (t.market_cap_usd < 250_000_000) struct.add("market_cap_50m_to_250m_usd");
      else struct.add("market_cap_over_250m_usd");
    }
  }

  inputs++;
  if (t.cash_runway_months != null) {
    knownInputs++;
    if (sector === "biotech") {
      if (t.cash_runway_months >= 18) struct.add("runway_18plus_months");
      else if (t.cash_runway_months >= 12) struct.add("runway_12_to_18_months");
      else if (t.cash_runway_months >= 6) struct.add("runway_6_to_12_months");
      else risk.add("runway_under_6_months");
    } else {
      if (t.cash_runway_months >= 12) struct.add("cash_12plus_months_ops");
      else if (t.cash_runway_months >= 6) struct.add("cash_6_to_12_months_ops");
      else risk.add("cash_under_6_months_ops");
    }
  }

  inputs++;
  if (t.share_count_millions != null) {
    knownInputs++;
    if (sector === "mining") {
      if (t.share_count_millions <= 100) struct.add("share_count_under_100m");
      else if (t.share_count_millions <= 300) struct.add("share_count_100m_to_300m");
      else struct.add("share_count_over_300m");
    } else {
      // biotech: float buckets — share count benadering
      if (t.share_count_millions >= 5 && t.share_count_millions <= 50)
        struct.add("float_5m_to_50m");
      else if (t.share_count_millions <= 100) struct.add("float_50m_to_100m");
      else struct.add("float_under_5m_or_over_100m");
    }
  }

  if (t.reverse_split_history) risk.add("reverse_split_history");

  inputs++;
  if (t.insider_ownership_pct != null) {
    knownInputs++;
    if (t.insider_ownership_pct >= 0.1 && t.insider_ownership_pct <= 0.3)
      struct.add("insider_ownership_10_to_30pct");
    else if (t.insider_ownership_pct < 0.1)
      struct.add("insider_ownership_under_10pct");
    else struct.add("insider_ownership_over_30pct");
    if (t.insider_ownership_pct > 0.5) risk.add("insider_concentration_over_50pct");
  }

  // Mining-specifieke jurisdictie tier
  if (sector === "mining") {
    inputs++;
    if (t.jurisdiction) {
      knownInputs++;
      if (TIER1_JURISDICTIONS.has(t.jurisdiction)) struct.add("jurisdiction_tier_1");
      else if (TIER3_JURISDICTIONS.has(t.jurisdiction)) risk.add("jurisdiction_tier_3");
      else struct.add("jurisdiction_tier_2");
    }
  }

  // ── Catalyst ────────────────────────────────────────────────────────
  // Nearest pending catalyst bepaalt de catalyst sub-score + timing window.
  const today = new Date();
  const pending = ctx.catalysts
    .filter((c) => c.status === "pending")
    .map((c) => ({
      ...c,
      daysUntil: Math.ceil(
        (new Date(c.expected_date).getTime() - today.getTime()) /
          (24 * 60 * 60 * 1000)
      ),
    }))
    .filter((c) => c.daysUntil >= 0)
    .sort((a, b) => a.daysUntil - b.daysUntil);
  const nearest = pending[0] ?? null;

  if (nearest) {
    knownInputs++;
    inputs++;
    const ct = nearest.catalyst_type.toLowerCase();
    // biotech catalyst types
    if (ct.includes("phase_3") || ct.includes("p3") || ct.includes("topline_p3"))
      cat.add("phase_3_readout");
    else if (ct.includes("phase_2b") || ct.includes("p2b"))
      cat.add("phase_2b_readout");
    else if (ct.includes("phase_2") || ct.includes("p2"))
      cat.add("phase_2_readout");
    if (ct.includes("pdufa") || ct.includes("fda_decision"))
      cat.add("fda_pdufa_pending");
    if (ct.includes("ema_chmp")) cat.add("ema_chmp_pending");

    // mining catalyst types
    if (ct.includes("drilling") || ct.includes("bonanza")) {
      if (ct.includes("step_out")) cat.add("drilling_step_out_planned");
      else cat.add("drilling_results_pending");
    }
    if (ct.includes("maiden_resource") || ct.includes("resource_estimate"))
      cat.add("resource_estimate_maiden_pending");
    if (ct.includes("permit")) {
      if (sector === "mining" && t.jurisdiction && TIER1_JURISDICTIONS.has(t.jurisdiction))
        cat.add("permit_decision_tier1_pending");
      else cat.add("permit_decision_tier2_pending");
    }
    if (ct.includes("china_export") || ct.includes("export_shock"))
      cat.add("china_export_shock");
  }

  // Indication / disease area mapping (biotech) — heuristiek vanuit
  // disease_area string. Owner kan via first_in_class/best_in_class
  // velden expliciet overschrijven.
  if (sector === "biotech" && t.disease_area) {
    inputs++;
    knownInputs++;
    const da = t.disease_area.toLowerCase();
    const rareKeys = ["rare", "orphan", "prader", "fsgs", "lpld", "alpha-1", "wilson"];
    const oncoKeys = ["cancer", "tumor", "oncology", "leukemia", "lymphoma", "myeloma"];
    if (rareKeys.some((k) => da.includes(k))) cat.add("rare_disease_indication");
    else if (oncoKeys.some((k) => da.includes(k))) cat.add("oncology_indication");
    else cat.add("common_disease_indication");
  }

  // ── Biotech v1.1 trial design (briefing §6.1.1) ─────────────────────
  if (sector === "biotech") {
    if (t.first_in_class) cat.add("first_in_class");
    else if (t.best_in_class) cat.add("best_in_class");
    if (t.has_breakthrough_designation) cat.add("has_breakthrough_designation");
    if (t.has_fast_track) cat.add("has_fast_track");
    if (t.has_orphan_drug) cat.add("has_orphan_drug");
    if (t.trial_size_n != null && t.trial_size_n >= 300)
      cat.add("trial_size_300plus");
    if (t.competitor_failures_in_target != null) {
      if (t.competitor_failures_in_target >= 2)
        cat.add("competitor_failures_in_target_2plus");
      else if (t.competitor_failures_in_target === 1)
        cat.add("competitor_failures_in_target_1");
    }
    // Trial design quality risk-adjusters (briefing §6.1.1):
    // these don't add positive weight but penalize via riskAdjusters
    // — we model them as risk adjuster names that the aggregator
    // looks up. Add to risk set only if briefing flags them as
    // negative-only signals (none currently in BIOTECH risk list,
    // but reserved for fase 6 calibration).
    if (t.primary_endpoint_powered_for_subgroup === true) {
      // AKRO-style red flag: powered alleen op subgroup
      // (briefing §5.4 paar 1)
      risk.add("primary_endpoint_powered_for_subgroup");
    }
    if (
      t.mechanism_has_clinical_precedent === false &&
      t.first_in_class === true
    ) {
      // Geen precedent + FIC = hogere onzekerheid — reserveer voor fase 6.
    }
    if (t.fda_advisory_committee_outcome === "negative") {
      risk.add("adcom_negative");
    }
    // prior CRL strategy: label narrowed = positive, no narrowing after CRL = risk
    if (t.prior_crl_count != null && t.prior_crl_count > 0) {
      if (t.label_narrowed_after_crl !== true) {
        risk.add("prior_crl_unchanged_strategy");
      }
    }
  }

  // ── Mining v1.1 quality differentiators (briefing §6.1.3) ───────────
  if (sector === "mining") {
    // Geological setting
    if (t.geological_anomaly === "dual_grav_mag")
      struct.add("geological_anomaly_dual_grav_mag");
    else if (
      t.geological_anomaly === "single_signal" ||
      t.geological_anomaly === "nearology"
    )
      struct.add("geological_anomaly_single_signal");

    // Processing tech
    if (t.processing_tech === "proven_conventional")
      struct.add("processing_tech_proven_conventional");
    else if (
      t.processing_tech === "unproven_dle" ||
      t.processing_tech === "unproven_other"
    )
      risk.add("processing_tech_unproven_dle");

    // Operational status (UAMY vs PPTA differentiator — briefing §5.4 paar 5)
    if (t.operational_status === "operational")
      struct.add("operational_status_operational");
    else if (t.operational_status === "pre_development")
      struct.add("operational_status_pre_development");

    // Strategic backer (Albemarle/CATL — briefing §5.4 paar 4)
    if (t.has_strategic_backer) {
      if (t.strategic_backer_tier === 1) cat.add("strategic_backer_tier1");
      else cat.add("strategic_backer_other");
    }

    // Promoter concentration
    if (
      t.promoter_concentration_pct != null &&
      t.promoter_concentration_pct > 0.4
    )
      risk.add("promoter_concentration");
  }

  // ── Timing ───────────────────────────────────────────────────────────
  if (nearest) {
    const d = nearest.daysUntil;
    if (d <= 14) tim.add("catalyst_under_15_days");
    else if (d <= 30) tim.add("catalyst_15_to_30_days_out");
    else if (d <= 90) tim.add("catalyst_30_to_90_days_out");
    else if (d <= 180) tim.add("catalyst_90_to_180_days_out");
    else tim.add("catalyst_over_180_days");
  }

  // Insider activity uit signal_events
  if (ctx.recentSignalTypes.has("insider_cluster_buy"))
    tim.add("insider_cluster_buy_30d");
  else if (ctx.recentSignalTypes.has("insider_net_buying"))
    tim.add("insider_net_buying_30d");
  else if (ctx.recentSignalTypes.has("insider_net_selling"))
    risk.add("insider_net_selling_30d");

  // Volume + price momentum (uit signal_price_summary)
  if (ctx.price) {
    inputs++;
    knownInputs++;
    const p = ctx.price;

    // Volume spike via volume_ratio (last_volume / avg_volume_30d)
    if (p.volume_ratio != null) {
      if (p.volume_ratio >= 1.5) tim.add("volume_spike_50pct_plus");
      else if (p.volume_ratio >= 1.15) tim.add("volume_above_50d_avg_15pct");
    }

    // 52w-low proxy: prijs minder dan 10% boven 90d low
    if (p.pct_above_90d_low != null && p.pct_above_90d_low < 10)
      risk.add("price_at_52w_low");

    // Sell-the-news pre-event run-up — proxy via pct_above_90d_low
    // (briefing §6.1.2 + §6.1.3). Echt YTD return komt in fase 4 als
    // poll-prices ook 365d returns gaat opslaan.
    const runup =
      t.pre_event_ytd_return_pct ?? (p.pct_above_90d_low ?? 0) / 100;
    if (runup >= 1.5) risk.add("pre_event_runup_extreme");
    else if (runup >= 0.75) risk.add("pre_event_runup_moderate");
    else if (runup >= 0.4) risk.add("pre_event_runup_mild");
  }

  // ── Commodity cycle (mining only) ───────────────────────────────────
  let cyclePhase: "bull" | "neutral" | "bear" | null = null;
  if (sector === "mining" && t.commodity) {
    const macro = ctx.macro.find(
      (m) => MACRO_SYMBOL_TO_COMMODITY[m.symbol] === t.commodity
    );
    if (macro) {
      cyclePhase = derivePhase(macro);
      if (cyclePhase === "bull") cat.add("commodity_phase_breakout");
      else if (cyclePhase === "neutral") cat.add("commodity_phase_neutral");
      else if (cyclePhase === "bear") risk.add("commodity_phase_bear");
    }
  }

  // ── Macro-driven catalyst tagging ───────────────────────────────────
  if (ctx.recentSignalTypes.has("macro_tide")) cat.add("commodity_phase_breakout");

  return {
    triggeredStructural: struct,
    triggeredCatalyst: cat,
    triggeredTiming: tim,
    triggeredRiskAdjusters: risk,
    cyclePhase,
    nearestCatalyst: nearest
      ? { type: nearest.catalyst_type, daysUntil: nearest.daysUntil }
      : null,
    dataCompleteness: inputs > 0 ? knownInputs / inputs : 0,
  };
}
