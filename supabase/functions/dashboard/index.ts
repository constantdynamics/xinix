import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }

// === Heat-bijdrage per signal type ===
// De tegel-kleur (Hot/Warm/Pre/Rust) is de "sterk aanbevolen om te kopen"
// indicator. Alleen positieve buy-triggers dragen bij; bearish events
// (faillissement, trial failed, big drop) en richtingsloze events
// (8k material agreement, price spike die al gebeurd is, volume spike,
// near 90d low) dragen NIETS bij en laten een tegel dus Rust (white).
type Sev = "white" | "yellow" | "orange" | "red";
const SEV_RANK: Record<Sev, number> = { white: 0, yellow: 1, orange: 2, red: 3 };
const HEAT_CONTRIBUTION: Record<string, Sev> = {
  // Onmiskenbaar positief / major catalyst -> Hot
  fda_approval: "red",
  topline_positive: "red",
  phase_success: "red",
  breakthrough_designation: "red",
  buyout_definitive: "red",
  bonanza_au: "red",
  discovery_announcement: "red",
  permit: "red",
  first_pour: "red",
  buy_limit_hit: "red",
  // Matig positief -> Warm
  buy_limit_close: "orange",
  bonanza_ag: "orange",
  bonanza_cu: "orange",
  licensing_deal: "orange",
  resource_update: "orange",
  pea: "orange",
  pfs: "orange",
  dfs: "orange",
  step_out_drill: "orange",
  trial_status_change: "orange",
  // Watch -> Pre
  buy_limit_warmup: "yellow",
  jv_strategic: "yellow",
  macro_tide: "yellow",
  pre_catalyst_7d: "yellow",
  pre_catalyst_14d: "yellow",
  pre_catalyst_30d: "yellow",
  pre_catalyst_60d: "yellow",
  // (price_spike_up, volume_spike, near_90d_low, big_drop, trial_failed,
  //  topline_failure, 8k_material -> geen heat-bijdrage)
};

Deno.serve(async (req) => {
  const p = pf(req); if (p) return p;
  const supabase = getServiceClient();
  const [tickersRes, summaryRes, signalsRes, catalystsRes, runLogRes] = await Promise.all([
    supabase.from("signal_tickers").select("*").eq("active", true),
    supabase.from("signal_price_summary").select("*"),
    supabase.from("signal_events").select("*").or("expires_at.is.null,expires_at.gt." + new Date().toISOString()).order("detected_at", { ascending: false }).limit(500),
    supabase.from("signal_catalysts").select("*").eq("status", "pending").order("expected_date", { ascending: true }),
    supabase.from("signal_runs").select("job, started_at, finished_at, ok, message, metrics").order("started_at", { ascending: false }).limit(20),
  ]);
  const tickers = tickersRes.data ?? [];
  const summaries = summaryRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const catalysts = catalystsRes.data ?? [];
  const runLog = runLogRes.data ?? [];
  const summaryByTicker = new Map(summaries.map((s: any) => [s.ticker, s]));
  const signalsByTicker = new Map<string, any[]>();
  for (const sig of signals) { const arr = signalsByTicker.get(sig.ticker) ?? []; arr.push(sig); signalsByTicker.set(sig.ticker, arr); }
  const catalystsByTicker = new Map<string, any[]>();
  for (const cat of catalysts) { const arr = catalystsByTicker.get(cat.ticker) ?? []; arr.push(cat); catalystsByTicker.set(cat.ticker, arr); }

  const cards = tickers.map((t: any) => {
    const tSignals = signalsByTicker.get(t.ticker) ?? [];
    const tCatalysts = catalystsByTicker.get(t.ticker) ?? [];
    const summary = summaryByTicker.get(t.ticker);
    // Heat-bijdrage van signalen: alleen positieve triggers tellen.
    let signalSev: Sev = "white";
    for (const sig of tSignals) {
      const contrib = HEAT_CONTRIBUTION[sig.signal_type as string];
      if (contrib && SEV_RANK[contrib] > SEV_RANK[signalSev]) signalSev = contrib;
    }
    // Baseline uit handmatige goud_score (curatie).
    let baselineSev: Sev = "white";
    if (t.goud_score != null) {
      if (t.goud_score >= 80) baselineSev = "red";
      else if (t.goud_score >= 65) baselineSev = "orange";
      else if (t.goud_score >= 35) baselineSev = "yellow";
    }
    const finalSev: Sev = SEV_RANK[signalSev] > SEV_RANK[baselineSev] ? signalSev : baselineSev;
    const nextCatalyst = tCatalysts[0];
    const daysToNext = nextCatalyst?.expected_date
      ? Math.ceil((new Date(nextCatalyst.expected_date).getTime() - Date.now()) / 86400000)
      : null;
    return {
      ticker: t.ticker, company: t.company, sector: t.sector ?? "other",
      goud_score: t.goud_score, goud_type: t.goud_type, modality: t.modality,
      disease_area: t.disease_area, phase: t.phase, commodity: t.commodity,
      jurisdiction: t.jurisdiction, deposit_type: t.deposit_type,
      factor_count: t.factor_count ?? 0, trigger_event: t.trigger_event,
      buy_limit: t.buy_limit ?? null,
      dividend_yield: t.dividend_yield ?? null,
      exchange: t.exchange ?? null,
      price_polled_at: t.price_polled_at ?? null,
      price_fail_count: t.price_fail_count ?? 0,
      price_benched: t.price_benched ?? false,
      price_last_error: t.price_last_error ?? null,
      medal_gold: t.medal_gold ?? 0,
      medal_silver: t.medal_silver ?? 0,
      medal_bronze: t.medal_bronze ?? 0,
      medals_computed_at: t.medals_computed_at ?? null,
      color: finalSev, signal_color: signalSev, baseline_color: baselineSev,
      summary: summary ?? null, active_signals: tSignals.length,
      top_signal: tSignals[0] ?? null,
      signals: tSignals.slice(0, 5),
      next_catalyst: nextCatalyst ?? null,
      days_to_next_catalyst: daysToNext,
      market_cap_usd: t.market_cap_usd ?? null,
      cash_runway_months: t.cash_runway_months ?? null,
      insider_ownership_pct: t.insider_ownership_pct ?? null,
      pre_event_ytd_return_pct: t.pre_event_ytd_return_pct ?? null,
      share_count_millions: t.share_count_millions ?? null,
      trial_patient_population_severity: t.trial_patient_population_severity ?? null,
      trial_endpoint_duration_weeks: t.trial_endpoint_duration_weeks ?? null,
      mechanism_has_clinical_precedent: t.mechanism_has_clinical_precedent ?? null,
      primary_endpoint_powered_for_subgroup: t.primary_endpoint_powered_for_subgroup ?? null,
      prior_crl_count: t.prior_crl_count ?? null,
      label_narrowed_after_crl: t.label_narrowed_after_crl ?? null,
      has_ex_us_safety_dataset: t.has_ex_us_safety_dataset ?? null,
      fda_advisory_committee_outcome: t.fda_advisory_committee_outcome ?? null,
      has_breakthrough_designation: t.has_breakthrough_designation ?? null,
      has_fast_track: t.has_fast_track ?? null,
      has_orphan_drug: t.has_orphan_drug ?? null,
      first_in_class: t.first_in_class ?? null,
      best_in_class: t.best_in_class ?? null,
      competitor_failures_in_target: t.competitor_failures_in_target ?? null,
      trial_size_n: t.trial_size_n ?? null,
      geological_anomaly: t.geological_anomaly ?? null,
      cover_depth_meters: t.cover_depth_meters ?? null,
      prior_geophysics_spend_usd: t.prior_geophysics_spend_usd ?? null,
      processing_tech: t.processing_tech ?? null,
      operational_status: t.operational_status ?? null,
      promoter_concentration_pct: t.promoter_concentration_pct ?? null,
      has_strategic_backer: t.has_strategic_backer ?? null,
      strategic_backer_tier: t.strategic_backer_tier ?? null,
      notes: t.notes ?? null,
    };
  });
  cards.sort((a: any, b: any) => {
    if (SEV_RANK[b.color as Sev] !== SEV_RANK[a.color as Sev]) return SEV_RANK[b.color as Sev] - SEV_RANK[a.color as Sev];
    return (b.goud_score ?? 0) - (a.goud_score ?? 0);
  });

  let pollOldest: string | null = null, pollNewest: string | null = null, neverPolled = 0, benchedCount = 0, withMedals = 0;
  for (const t of tickers) {
    if (t.price_benched) benchedCount++;
    if (t.medals_computed_at) withMedals++;
    if (!t.price_polled_at) { neverPolled++; continue; }
    if (!pollOldest || t.price_polled_at < pollOldest) pollOldest = t.price_polled_at;
    if (!pollNewest || t.price_polled_at > pollNewest) pollNewest = t.price_polled_at;
  }
  const lastPriceRun = runLog.find((r: any) => r.job === "poll-prices") ?? null;
  const pollStatus = {
    total: tickers.length, never_polled: neverPolled, benched: benchedCount, medals_computed: withMedals,
    oldest_polled_at: pollOldest, newest_polled_at: pollNewest,
    last_run: lastPriceRun ? { started_at: lastPriceRun.started_at, ok: lastPriceRun.ok, message: lastPriceRun.message, metrics: lastPriceRun.metrics } : null,
    bench_after_fails: 3, batch_size: 80, interval_minutes: 10,
  };
  return j(req, { cards, recent_signals: signals.slice(0, 50), upcoming_catalysts: catalysts.slice(0, 50), run_log: runLog, poll_status: pollStatus, generated_at: new Date().toISOString() }, { headers: { "cache-control": "public, max-age=30" } });
});
