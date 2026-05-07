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

export type Sector = "biotech" | "mining";

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

export interface Dashboard {
  cards: Card[];
  recent_signals: Signal[];
  upcoming_catalysts: Catalyst[];
  run_log: RunLog[];
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
