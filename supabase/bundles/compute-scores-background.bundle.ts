// Auto-bundled function: compute-scores-background

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";


// ─── _shared/supabase.ts ───
// Service-role client + run logger. Identiek qua API aan de Netlify
// versie zodat de business logic in de functions één-op-één port.


export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Json = Record<string, unknown>;

export interface RunResult {
  ok: boolean;
  message?: string;
  metrics?: Json;
}

export async function logRun(
  job: string,
  fn: () => Promise<RunResult>
): Promise<RunResult> {
  const supabase = getServiceClient();
  const { data: row } = await supabase
    .from("signal_runs")
    .insert({ job })
    .select("id")
    .single();
  const id = row?.id as number | undefined;
  try {
    const result = await fn();
    if (id) {
      await supabase
        .from("signal_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: result.ok,
          message: result.message ?? null,
          metrics: result.metrics ?? null,
        })
        .eq("id", id);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (id) {
      await supabase
        .from("signal_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          message: msg,
        })
        .eq("id", id);
    }
    throw err;
  }
}

// ─── _shared/auth.ts ───
// Admin auth check. Fail closed wanneer ADMIN_TOKEN niet is gezet —
// dan kan niemand schrijven. Match exact gedrag van de Netlify versie.

export function checkAuth(req: Request): boolean {
  const required = Deno.env.get("ADMIN_TOKEN");
  if (!required) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

// Voor cron-aanroepen vanuit pg_cron: we sturen een speciale header
// `x-cron-secret` mee in de http_post. Geeft toegang tot job-trigger
// functies zonder de admin token in de DB te plaatsen.
export function checkCron(req: Request): boolean {
  const required = Deno.env.get("CRON_SECRET");
  if (!required) return false;
  const got = req.headers.get("x-cron-secret") ?? "";
  return got === required;
}

export function checkAdminOrCron(req: Request): boolean {
  return checkAuth(req) || checkCron(req);
}

// ─── _shared/cors.ts ───
// Shared CORS helper. Frontend draait op constantdynamics.github.io,
// dus Edge Functions moeten CORS expliciet uitvuren — er is geen
// edge layer zoals bij Netlify.

const ALLOWED = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED.has(origin) ? origin : "null";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers":
      "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function jsonResponse(
  req: Request,
  body: unknown,
  init: ResponseInit = {}
): Response {
  const headers = {
    ...corsHeaders(req),
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function textResponse(
  req: Request,
  body: string,
  init: ResponseInit = {}
): Response {
  const headers = {
    ...corsHeaders(req),
    "content-type": "text/plain",
    ...(init.headers as Record<string, string> | undefined),
  };
  return new Response(body, { ...init, headers });
}

// ─── _shared/runner.ts ───
// Boilerplate-collapser voor background functies. Elke achtergrond
// functie ziet er zo uit:
//
//   import { runBackground } from "../_shared/runner.ts";
//   import { logic } from "./logic.ts";  // de echte werkfunctie
//   Deno.serve(runBackground("poll-prices", logic));




export function runBackground(
  job: string,
  fn: () => Promise<RunResult>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const pf = handlePreflight(req);
    if (pf) return pf;

    if (!checkAdminOrCron(req))
      return textResponse(req, "Unauthorized", { status: 401 });

    try {
      const result = await logRun(job, fn);
      return jsonResponse(req, { ok: result.ok, ...result }, {
        status: result.ok ? 200 : 500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(req, { ok: false, message: msg }, { status: 500 });
    }
  };
}

// ─── _shared/scoring/theoretical_max.ts ───
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

// ─── _shared/scoring/weights.ts ───
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

// ─── _shared/scoring/aggregator.ts ───
// Briefing §4.1: drie sub-scores Structural × Catalyst × Timing aggregeren
// via geometric mean (niet arithmetic — we willen dat één zwakke dimensie
// de hele score laag houdt). Daarna risk_penalty asymmetrisch aftrekken
// (kan score verlagen, niet verhogen). Mining krijgt cycle_multiplier
// (briefing §6.1.4): bull=1.0, neutral=0.85, bear=0.50 (strenger in trader).
//
// Action labels uit thresholds (briefing §B.5).



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

// ─── _shared/scoring/classify.ts ───
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

// ─── _shared/scoring/trade_setup.ts ───
// Briefing §4.4 + §10.1: in trader mode produceert elke BUY/STRONG_BUY een
// TradeSetup met entry, target, stop, R:R, position size, max_hold, exits.
// Maakt het signaal actionable — owner heeft een plan voor entry, niet
// alleen een "koop dit" label.
//
// Per briefing §C.3: een STRONG_BUY label is een TRIGGER VOOR ONDERZOEK,
// geen trade order. TradeSetup biedt het kader; de owner doet de
// fine-grained check (clinicaltrials.gov, persberichten) voor entry.

export interface TradeSetup {
  entry: number;          // current price (laatste close)
  target: number;         // peak target
  stop: number;           // hard stop
  rr: number;             // (target - entry) / (entry - stop)
  positionSizeUsd: number; // 1% account risk default
  maxHoldDays: number;    // tot catalyst + 7d cushion
  exits: ExitRule[];
  notes: string[];
}

export interface ExitRule {
  trigger: string;
  detail: string;
}

const DEFAULT_ACCOUNT_USD = 10_000;
const DEFAULT_RISK_PER_TRADE_PCT = 0.01; // 1%
const MIN_RR = 3.0;

// Peak return verwachting per catalyst type — uit briefing §6.1.6
// PEER_PEAK_RETURNS. Dit zijn medians over historische winners; gebruikt
// als realistisch peak target. Conservatiever dan in v1.1 omdat we nog
// geen forward returns hebben (briefing §9.7 survivorship bias).
const PEAK_TARGET_BY_CATALYST: Record<string, number> = {
  // biotech
  phase_3_readout: 1.5,         // 150%
  fda_pdufa_pending: 1.0,       // 100%
  phase_2b_readout: 0.8,
  phase_2_readout: 0.5,
  ema_chmp_pending: 0.6,
  // mining
  drilling_tier1_in_progress: 2.5,  // 250% — PMET/WA1 ballpark
  drilling_results_pending: 1.5,
  resource_estimate_maiden_pending: 1.0,
  permit_decision_tier1_pending: 0.6,
  china_export_shock: 2.0,
  // generic fallback
  generic: 0.6,
};

// Stop loss als % onder entry per catalyst type. Mining is volatieler dus
// wider stop. Briefing §C.3 + §9.10: stop te krap = vroeg uitgestopt op noise.
const STOP_PCT_BY_CATALYST: Record<string, number> = {
  phase_3_readout: 0.18,
  fda_pdufa_pending: 0.15,
  phase_2b_readout: 0.20,
  phase_2_readout: 0.20,
  ema_chmp_pending: 0.15,
  drilling_tier1_in_progress: 0.25,
  drilling_results_pending: 0.22,
  resource_estimate_maiden_pending: 0.20,
  permit_decision_tier1_pending: 0.18,
  china_export_shock: 0.30,
  generic: 0.20,
};

export interface TradeSetupInput {
  currentPrice: number;
  catalystType: string | null;
  daysUntilCatalyst: number | null;
  finalScore: number;
  sector: "biotech" | "mining";
  accountUsd?: number;
}

export function buildTradeSetup(
  input: TradeSetupInput
): TradeSetup | null {
  if (!input.currentPrice || input.currentPrice <= 0) return null;

  const catType = input.catalystType ?? "generic";
  const peakRet =
    PEAK_TARGET_BY_CATALYST[catType] ?? PEAK_TARGET_BY_CATALYST.generic;
  const stopPct =
    STOP_PCT_BY_CATALYST[catType] ?? STOP_PCT_BY_CATALYST.generic;

  const entry = input.currentPrice;
  const target = +(entry * (1 + peakRet)).toFixed(4);
  const stop = +(entry * (1 - stopPct)).toFixed(4);

  const reward = target - entry;
  const risk = entry - stop;
  const rr = risk > 0 ? +(reward / risk).toFixed(2) : 0;

  // Position size: 1% account risk / risk-per-share
  const account = input.accountUsd ?? DEFAULT_ACCOUNT_USD;
  const dollarRisk = account * DEFAULT_RISK_PER_TRADE_PCT;
  const shares = risk > 0 ? Math.floor(dollarRisk / risk) : 0;
  const positionSizeUsd = +(shares * entry).toFixed(2);

  // Max hold: tot catalyst + 7 dagen cushion. Als geen datum, 60 dagen.
  const maxHoldDays =
    input.daysUntilCatalyst != null
      ? Math.max(7, input.daysUntilCatalyst + 7)
      : 60;

  const exits: ExitRule[] = [
    { trigger: "target_hit", detail: `Verkoop bij $${target} (+${(peakRet * 100).toFixed(0)}%)` },
    { trigger: "stop_hit", detail: `Hard stop bij $${stop} (-${(stopPct * 100).toFixed(0)}%)` },
    {
      trigger: "catalyst_passed_no_pump",
      detail: `Als catalyst voorbij is en prijs binnen ±5% van entry: exit.`,
    },
    {
      trigger: "volume_collapse",
      detail: "Als 5-dag volume <50% van 50d-avg: trim of exit.",
    },
  ];
  if (input.sector === "biotech") {
    exits.push({
      trigger: "sell_the_news",
      detail:
        "Bij positieve readout en spike >100%: trail stop op 50% van piek, niet vasthouden voor T+90.",
    });
  }

  const notes: string[] = [];
  if (rr < MIN_RR) {
    notes.push(
      `R:R = ${rr} < ${MIN_RR} minimum — overweeg target hoger of entry afwachten.`
    );
  }
  if (input.daysUntilCatalyst != null && input.daysUntilCatalyst < 5) {
    notes.push(
      "Catalyst < 5 dagen weg — overweeg helft positie voor en helft na."
    );
  }
  if (input.finalScore < 0.55) {
    notes.push(
      `Final score ${input.finalScore.toFixed(2)} onder BUY drempel (0.55) — alleen voor experimenteel.`
    );
  }

  return { entry, target, stop, rr, positionSizeUsd, maxHoldDays, exits, notes };
}

// ─── _shared/scoring/expected_outcome.ts ───
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

// ─── compute-scores-background/index.ts ───
async function scoreOneTicker(
  supabase: ReturnType<typeof getServiceClient>,
  ticker: TickerRow,
  catalysts: CatalystRow[],
  price: PriceSummary | null,
  macro: MacroRow[],
  recentSignalTypes: Set<string>,
  mode: Mode,
  scanDate: string
): Promise<boolean> {
  const weights = getWeights(ticker.sector, mode);
  const ctx: ClassifyContext = {
    ticker,
    catalysts,
    price,
    macro,
    recentSignalTypes,
  };
  const c = classify(ctx);

  const structural = buildSubScore(weights.structural, c.triggeredStructural);
  const catalyst = buildSubScore(weights.catalyst, c.triggeredCatalyst);
  const timing = buildSubScore(weights.timing, c.triggeredTiming);

  const result = aggregate(
    structural,
    catalyst,
    timing,
    weights,
    c.triggeredRiskAdjusters,
    c.cyclePhase,
    mode
  );

  let tradeSetup = null;
  if (
    mode === "trader" &&
    (result.action === "BUY" || result.action === "STRONG_BUY") &&
    price?.last_close
  ) {
    tradeSetup = buildTradeSetup({
      currentPrice: price.last_close,
      catalystType: c.nearestCatalyst?.type ?? null,
      daysUntilCatalyst: c.nearestCatalyst?.daysUntil ?? null,
      finalScore: result.finalScore,
      sector: ticker.sector,
    });
  }

  let expOut = null;
  if (
    (result.action === "BUY" ||
      result.action === "STRONG_BUY" ||
      result.action === "WATCH") &&
    c.nearestCatalyst?.type
  ) {
    expOut = expectedOutcome({
      sector: ticker.sector,
      catalystType: c.nearestCatalyst.type,
      daysUntilCatalyst: c.nearestCatalyst.daysUntil ?? null,
      currentPrice: price?.last_close ?? null,
    });
  }

  const { error } = await supabase.from("signal_scores").upsert(
    {
      ticker: ticker.ticker,
      sector: ticker.sector,
      scan_date: scanDate,
      mode,
      structural: structural.normalized,
      catalyst: catalyst.normalized,
      timing: timing.normalized,
      confluence: result.confluence,
      risk_penalty: result.riskPenalty,
      cycle_multiplier: result.cycleMultiplier,
      final_score: result.finalScore,
      action: result.action,
      flagged_warnings: result.warnings,
      components: {
        structural: structural.components,
        catalyst: catalyst.components,
        timing: timing.components,
        nearest_catalyst: c.nearestCatalyst,
      },
      trade_setup: tradeSetup,
      expected_outcome: expOut,
      data_completeness: c.dataCompleteness,
    },
    { onConflict: "ticker,scan_date,mode" }
  );
  if (error) {
    console.error(`score upsert ${ticker.ticker}:`, error.message);
    return false;
  }
  return true;
}

// Round-robin scoring met slimme prioriteit. Per run worden tot
// SCORE_BATCH tickers gescoord, gekozen op tier:
//   A (curated of buy_limit gezet)              -> herscore als score_at > 1u oud
//   B (factor_count >= 2 of recent signaal 7d)  -> > 12u oud
//   C (de rest, screening-junk)                 -> > 30 dagen oud
// Binnen een tier: meest-stale eerst (NULL = nooit gescoord = bovenaan).
// Zo krijgen tickers die kans maken op een hot/strong-buy positie veel
// vaker een herscore; de 3600 no-data tickers rouleren traag door.
const SCORE_BATCH = 250;
const SCORE_BUDGET_MS = 110_000;
const STALE_A_MS = 1 * 60 * 60 * 1000;
const STALE_B_MS = 12 * 60 * 60 * 1000;
const STALE_C_MS = 30 * 24 * 60 * 60 * 1000;

Deno.serve(
  runBackground("compute-scores", async () => {
    const supabase = getServiceClient();
    const startMs = Date.now();
    const scanDate = new Date().toISOString().slice(0, 10);
    const since30 = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const since7Ms = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const [
      { data: tickers },
      { data: catalysts },
      { data: prices },
      { data: macroRaw },
      { data: events },
    ] = await Promise.all([
      supabase.from("signal_tickers").select("*").eq("active", true),
      supabase.from("signal_catalysts").select("*").eq("status", "pending"),
      supabase.from("signal_price_summary").select("*"),
      supabase
        .from("signal_macro")
        .select(
          "symbol, date, pct_change_30d, pct_change_90d, pct_change_365d"
        )
        .order("date", { ascending: false }),
      supabase
        .from("signal_events")
        .select("ticker, signal_type, detected_at")
        .gt("detected_at", since30),
    ]);

    const latestMacro = new Map<string, MacroRow>();
    for (const m of (macroRaw ?? []) as (MacroRow & { date: string })[]) {
      if (!latestMacro.has(m.symbol)) latestMacro.set(m.symbol, m);
    }
    const macro = [...latestMacro.values()];

    if (!tickers || tickers.length === 0) {
      return { ok: true, message: "no active tickers", metrics: { scored: 0 } };
    }

    const catByTicker = new Map<string, CatalystRow[]>();
    for (const c of (catalysts ?? []) as CatalystRow[]) {
      const arr = catByTicker.get(c.ticker);
      if (arr) arr.push(c);
      else catByTicker.set(c.ticker, [c]);
    }
    const priceByTicker = new Map<string, PriceSummary>();
    for (const p of (prices ?? []) as PriceSummary[])
      priceByTicker.set(p.ticker, p);
    const sigByTicker = new Map<string, Set<string>>();
    const recentSigSet = new Set<string>();
    for (const e of events ?? []) {
      const s = sigByTicker.get(e.ticker) ?? new Set<string>();
      s.add(e.signal_type);
      sigByTicker.set(e.ticker, s);
      const dt = (e as { detected_at?: string }).detected_at;
      if (dt && new Date(dt).getTime() >= since7Ms) recentSigSet.add(e.ticker);
    }

    type TR = TickerRow & {
      goud_score?: number | null;
      buy_limit?: number | null;
      factor_count?: number | null;
      score_at?: string | null;
    };
    const now = Date.now();
    const staleMs = (t: TR): number =>
      t.score_at ? now - new Date(t.score_at).getTime() : Number.MAX_SAFE_INTEGER;
    const tierOf = (t: TR): "A" | "B" | "C" => {
      if (t.goud_score != null || t.buy_limit != null) return "A";
      if ((t.factor_count ?? 0) >= 2 || recentSigSet.has(t.ticker)) return "B";
      return "C";
    };
    const TIER_THRESH: Record<"A" | "B" | "C", number> = {
      A: STALE_A_MS,
      B: STALE_B_MS,
      C: STALE_C_MS,
    };
    const TIER_RANK: Record<"A" | "B" | "C", number> = { A: 0, B: 1, C: 2 };

    const queue = (tickers as TR[])
      .map((t) => ({ t, tier: tierOf(t), stale: staleMs(t) }))
      .filter((x) => x.stale >= TIER_THRESH[x.tier])
      .sort((a, b) => {
        if (TIER_RANK[a.tier] !== TIER_RANK[b.tier])
          return TIER_RANK[a.tier] - TIER_RANK[b.tier];
        return b.stale - a.stale;
      })
      .slice(0, SCORE_BATCH);

    if (queue.length === 0) {
      return { ok: true, message: "alle scores zijn vers", metrics: { scored: 0, queued: 0 } };
    }

    let scored = 0;
    let failed = 0;
    let processed = 0;
    const tierCounts = { A: 0, B: 0, C: 0 };
    for (const { t, tier } of queue) {
      if (Date.now() - startMs > SCORE_BUDGET_MS) break;
      processed++;
      tierCounts[tier]++;
      const ok = await scoreOneTicker(
        supabase,
        t as TickerRow,
        catByTicker.get(t.ticker) ?? [],
        priceByTicker.get(t.ticker) ?? null,
        (macro ?? []) as MacroRow[],
        sigByTicker.get(t.ticker) ?? new Set(),
        "trader",
        scanDate
      );
      // Markeer als gescoord (ook bij upsert-fout, anders blokkeert de
      // ticker de queue). Fouten staan in de edge function logs.
      await supabase
        .from("signal_tickers")
        .update({ score_at: new Date().toISOString() })
        .eq("ticker", t.ticker);
      if (ok) scored++;
      else failed++;
    }

    const stillStale =
      (tickers as TR[]).filter((t) => staleMs(t) >= TIER_THRESH[tierOf(t)]).length -
      processed;
    return {
      ok: processed === 0 || failed < processed / 2,
      message: `${scored} gescoord (A:${tierCounts.A} B:${tierCounts.B} C:${tierCounts.C}), ${failed} fout, ~${Math.max(0, stillStale)} nog te doen`,
      metrics: {
        scored,
        failed,
        processed,
        tier_a: tierCounts.A,
        tier_b: tierCounts.B,
        tier_c: tierCounts.C,
        queue_remaining: Math.max(0, stillStale),
      },
    };
  })
);
