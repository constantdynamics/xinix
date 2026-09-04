// tickers — CRUD op de watchlist (signal_tickers).
// POST   { ...ticker }        → één ticker upserten
// POST   { rows: [...] }      → batch upserten (gededupliceerd op ticker)
// POST   ?action=unbench-all  → alle gebenchte tickers weer in de prijs-queue
// PATCH  ?ticker=XYZ          → losse velden bijwerken
// DELETE ?ticker=XYZ          → op inactief zetten (soft delete)

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

type Sector = "biotech" | "mining" | "other" | "ai";

// Onbekende waarden worden 'other' — nooit stilzwijgend 'biotech', want dan
// zou een AI- of overig aandeel de biotech-briefing en -scoring in rollen.
function normalizeSector(v: unknown): Sector {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "mining" || s === "biotech" || s === "ai") return s;
  return "other";
}

function num(v: unknown): number | null {
  return v == null || v === "" ? null : Number(v);
}
function bool(v: unknown): boolean | null {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return null;
}
function str(v: unknown): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

const V1_1_BIOTECH_FIELDS = [
  "trial_patient_population_severity",
  "trial_endpoint_duration_weeks",
  "mechanism_has_clinical_precedent",
  "primary_endpoint_powered_for_subgroup",
  "prior_crl_count",
  "label_narrowed_after_crl",
  "has_ex_us_safety_dataset",
  "fda_advisory_committee_outcome",
  "has_breakthrough_designation",
  "has_fast_track",
  "has_orphan_drug",
  "first_in_class",
  "best_in_class",
  "competitor_failures_in_target",
  "trial_size_n",
] as const;

const V1_1_MINING_FIELDS = [
  "geological_anomaly",
  "cover_depth_meters",
  "prior_geophysics_spend_usd",
  "processing_tech",
  "operational_status",
  "promoter_concentration_pct",
  "has_strategic_backer",
  "strategic_backer_tier",
] as const;

const V1_1_SHARED_FIELDS = [
  "market_cap_usd",
  "cash_runway_months",
  "insider_ownership_pct",
  "pre_event_ytd_return_pct",
  "buy_limit",
  "notes",
] as const;

const NUMERIC_V1_1 = new Set<string>([
  "trial_endpoint_duration_weeks",
  "prior_crl_count",
  "competitor_failures_in_target",
  "trial_size_n",
  "cover_depth_meters",
  "prior_geophysics_spend_usd",
  "promoter_concentration_pct",
  "strategic_backer_tier",
  "market_cap_usd",
  "cash_runway_months",
  "insider_ownership_pct",
  "pre_event_ytd_return_pct",
  "buy_limit",
]);

const BOOLEAN_V1_1 = new Set<string>([
  "mechanism_has_clinical_precedent",
  "primary_endpoint_powered_for_subgroup",
  "label_narrowed_after_crl",
  "has_ex_us_safety_dataset",
  "has_breakthrough_designation",
  "has_fast_track",
  "has_orphan_drug",
  "first_in_class",
  "best_in_class",
  "has_strategic_backer",
]);

function applyV1_1(
  out: Record<string, unknown>,
  input: Record<string, unknown>
): void {
  for (const f of [
    ...V1_1_BIOTECH_FIELDS,
    ...V1_1_MINING_FIELDS,
    ...V1_1_SHARED_FIELDS,
  ]) {
    if (!(f in input)) continue;
    const v = input[f];
    if (NUMERIC_V1_1.has(f)) out[f] = num(v);
    else if (BOOLEAN_V1_1.has(f)) out[f] = bool(v);
    else out[f] = str(v);
  }
}

function buildRow(input: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    ticker: String(input.ticker ?? "").toUpperCase().trim(),
    company: String(input.company ?? "").trim(),
    sector: normalizeSector(input.sector),
    goud_score: num(input.goud_score),
    goud_type: str(input.goud_type),
    trigger_event: str(input.trigger_event),
    trigger_date: str(input.trigger_date),
    modality: str(input.modality),
    disease_area: str(input.disease_area),
    phase: str(input.phase),
    commodity: str(input.commodity),
    jurisdiction: str(input.jurisdiction),
    deposit_type: str(input.deposit_type),
    share_count_millions: num(input.share_count_millions),
    active: true,
    updated_at: new Date().toISOString(),
  };
  if ("exchange" in input) row.exchange = str(input.exchange);
  applyV1_1(row, input);
  return row;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  const supabase = getServiceClient();
  const url = new URL(req.url);

  if (req.method === "POST") {
    if (url.searchParams.get("action") === "unbench-all") {
      const { data, error } = await supabase
        .from("signal_tickers")
        .update({
          price_benched: false,
          price_fail_count: 0,
          price_last_error: null,
          price_polled_at: null,
        })
        .eq("price_benched", true)
        .select("ticker");
      if (error) return textResponse(req, error.message, { status: 500 });
      return jsonResponse(req, { ok: true, unbenched: (data ?? []).length });
    }

    const body = (await req.json()) as Record<string, unknown>;

    if (Array.isArray(body.rows)) {
      const built = (body.rows as Record<string, unknown>[])
        .map(buildRow)
        .filter((r) => r.ticker && r.company);
      // Dedupe: een upsert met twee rijen voor dezelfde conflict-key faalt.
      const byTicker = new Map<string, Record<string, unknown>>();
      for (const r of built) byTicker.set(r.ticker as string, r);
      const rows = [...byTicker.values()];
      if (rows.length === 0)
        return textResponse(req, "no valid rows", { status: 400 });
      const { error, data } = await supabase
        .from("signal_tickers")
        .upsert(rows, { onConflict: "ticker" })
        .select("ticker");
      if (error) return textResponse(req, error.message, { status: 500 });
      return jsonResponse(req, {
        ok: true,
        inserted: (data ?? []).length,
        deduped: built.length - rows.length,
      });
    }

    if (!body.ticker || !body.company)
      return textResponse(req, "ticker and company required", { status: 400 });
    const { error } = await supabase
      .from("signal_tickers")
      .upsert(buildRow(body), { onConflict: "ticker" });
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true });
  }

  if (req.method === "PATCH") {
    const ticker = url.searchParams.get("ticker");
    if (!ticker) return textResponse(req, "ticker required", { status: 400 });
    const body = (await req.json()) as Record<string, unknown>;
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    applyV1_1(update, body);
    if ("company" in body) update.company = str(body.company);
    if ("sector" in body) update.sector = normalizeSector(body.sector);
    if ("exchange" in body) update.exchange = str(body.exchange);
    if ("disease_area" in body) update.disease_area = str(body.disease_area);
    if ("modality" in body) update.modality = str(body.modality);
    if ("phase" in body) update.phase = str(body.phase);
    if ("commodity" in body) update.commodity = str(body.commodity);
    if ("jurisdiction" in body) update.jurisdiction = str(body.jurisdiction);
    if ("deposit_type" in body) update.deposit_type = str(body.deposit_type);
    if ("share_count_millions" in body)
      update.share_count_millions = num(body.share_count_millions);
    // Bench-beheer: vrijgeven zet de ticker vooraan in de prijs-queue
    // (price_polled_at NULL sorteert bovenaan).
    if (body.unbench === true || body.price_benched === false) {
      update.price_benched = false;
      update.price_fail_count = 0;
      update.price_last_error = null;
      update.price_polled_at = null;
    } else if (body.price_benched === true) {
      update.price_benched = true;
    }
    const { error } = await supabase
      .from("signal_tickers")
      .update(update)
      .eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true });
  }

  if (req.method === "DELETE") {
    const ticker = url.searchParams.get("ticker");
    if (!ticker) return textResponse(req, "ticker required", { status: 400 });
    const { error } = await supabase
      .from("signal_tickers")
      .update({ active: false })
      .eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
