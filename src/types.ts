export type Color = "white" | "yellow" | "orange" | "red";
export type Severity = "yellow" | "orange" | "red";

export interface PriceSummary {
  ticker: string;
  last_close: number | null;
  last_volume: number | null;
  low_90d: number | null;
  high_90d: number | null;
  pct_above_90d_low: number | null;
  pct_change_1d: number | null;
  pct_change_5d: number | null;
  avg_volume_30d: number | null;
  volume_ratio: number | null;
  // v1.2 — extremes; gevuld door compute-extremes-background (wekelijks)
  low_1y?: number | null;
  high_1y?: number | null;
  low_5y?: number | null;
  high_5y?: number | null;
  last_extremes_at?: string | null;
  updated_at: string;
}

export interface Signal {
  id: number;
  ticker: string;
  signal_type: string;
  severity: Severity;
  title: string;
  detail: string | null;
  payload: Record<string, unknown> | null;
  detected_at: string;
  expires_at: string | null;
  alerted: boolean;
}

export interface Catalyst {
  id: number;
  ticker: string;
  catalyst_type: string;
  description: string | null;
  expected_date: string | null;
  source: string;
  source_id: string | null;
  status: string;
}

export type Sector = "biotech" | "mining" | "other";

export const SECTOR_LABEL: Record<Sector, string> = {
  biotech: "BIO",
  mining: "MIN",
  other: "OTH",
};
export const SECTOR_TONE: Record<Sector, "cyan" | "watch" | "neutral"> = {
  biotech: "cyan",
  mining: "watch",
  other: "neutral",
};

export interface Card {
  ticker: string;
  company: string;
  sector: Sector;
  goud_score: number | null;
  goud_type: string | null;
  modality: string | null;
  disease_area: string | null;
  phase: string | null;
  commodity: string | null;
  jurisdiction: string | null;
  deposit_type: string | null;
  factor_count: number;
  trigger_event: string | null;
  buy_limit?: number | null;
  // Trailing-12m dividend yield als fractie (0.025 = 2.5%); NULL = nog
  // niet opgehaald, 0 = betaalt geen dividend. Gevuld door poll-prices.
  dividend_yield?: number | null;
  // Yahoo fullExchangeName (NasdaqGS / NYSE / NYSE MKT / ...); voor directe
  // Google-Finance-links bij US-tickers. Gevuld door poll-prices.
  exchange?: string | null;
  // Round-robin price-poll status
  price_polled_at?: string | null;
  price_fail_count?: number;
  price_benched?: boolean;
  price_last_error?: string | null;
  // Medailleklassement (5y zigzag runs)
  medal_gold?: number;
  medal_silver?: number;
  medal_bronze?: number;
  medals_computed_at?: string | null;
  color: Color;
  signal_color: Color;
  baseline_color: Color;
  summary: PriceSummary | null;
  active_signals: number;
  top_signal: Signal | null;
  next_catalyst: Catalyst | null;
  days_to_next_catalyst: number | null;
  // v1.1 (briefing §6.1) — handmatig in te vullen via TickerDetailsModal
  market_cap_usd?: number | null;
  cash_runway_months?: number | null;
  insider_ownership_pct?: number | null;
  pre_event_ytd_return_pct?: number | null;
  share_count_millions?: number | null;
  trial_patient_population_severity?: string | null;
  trial_endpoint_duration_weeks?: number | null;
  mechanism_has_clinical_precedent?: boolean | null;
  primary_endpoint_powered_for_subgroup?: boolean | null;
  prior_crl_count?: number | null;
  label_narrowed_after_crl?: boolean | null;
  has_ex_us_safety_dataset?: boolean | null;
  fda_advisory_committee_outcome?: string | null;
  has_breakthrough_designation?: boolean | null;
  has_fast_track?: boolean | null;
  has_orphan_drug?: boolean | null;
  first_in_class?: boolean | null;
  best_in_class?: boolean | null;
  competitor_failures_in_target?: number | null;
  trial_size_n?: number | null;
  geological_anomaly?: string | null;
  cover_depth_meters?: number | null;
  prior_geophysics_spend_usd?: number | null;
  processing_tech?: string | null;
  operational_status?: string | null;
  promoter_concentration_pct?: number | null;
  has_strategic_backer?: boolean | null;
  strategic_backer_tier?: number | null;
  notes?: string | null;
}

export interface RunLog {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  message: string | null;
}

export interface PollStatus {
  total: number;
  never_polled: number;
  benched: number;
  oldest_polled_at: string | null;
  newest_polled_at: string | null;
  last_run: {
    started_at: string;
    ok: boolean | null;
    message: string | null;
    metrics: Record<string, unknown> | null;
  } | null;
  bench_after_fails: number;
  batch_size: number;
  interval_minutes: number;
}

export interface Dashboard {
  cards: Card[];
  recent_signals: Signal[];
  upcoming_catalysts: Catalyst[];
  run_log: RunLog[];
  poll_status?: PollStatus;
  generated_at: string;
}

export interface Settings {
  email: string | null;
  ntfy_topic: string | null;
  ntfy_server: string;
  alert_email_threshold: Severity;
  alert_ntfy_threshold: Severity;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  alert_only_goud_events: boolean;
}
