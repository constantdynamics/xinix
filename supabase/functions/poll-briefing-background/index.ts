// poll-briefing-background — vult automatisch de briefing-velden op signal_tickers
// (phase, has_orphan_drug, has_breakthrough_designation, has_fast_track,
// trial_size_n, disease_area) door clinicaltrials.gov en openFDA te bevragen.
//
// Bronnen:
//   • clinicaltrials.gov v2 API — gratis, geen key. Geeft per sponsor (= bedrijfsnaam)
//     de actieve/afgeronde studies met fase, enrollment, condition.
//   • openFDA designations — orphan drug, fast track, breakthrough via drugsfda
//     en orphan-drug datasets.
//
// Scope: alleen sector='biotech' tickers waar briefing_status IN ('pending', 'no_data',
// 'filled' + ouder dan 30 dagen). Mining/other = not_applicable, niet gepolld.
//
// Run-budget: 120s, ~30 tickers per nachtelijke run, ~150 in weekend-batches.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> {
  const sb = getServiceClient();
  const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single();
  const id = row?.id as number | undefined;
  try {
    const r = await fn();
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id);
    throw e;
  }
}
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }

const BUDGET_MS = 120_000;
const SLEEP_MS = 400;
const UA = "Mozilla/5.0 (compatible; XinixBriefingBot/1.0; +https://github.com)";
// RESCAN_DAYS: filled tickers worden pas na X dagen opnieuw gepolld
const RESCAN_DAYS = 30;

// ── Normaliseer bedrijfsnaam voor CT.gov sponsor-match ──────────────────────
function normalizeCompany(name: string | null): string {
  if (!name) return "";
  return name
    .replace(/,?\s+(Inc\.?|Corp\.?|Corporation|Limited|Ltd\.?|PLC|S\.A\.?|N\.V\.?|AG|GmbH|Holdings?|Group|Therapeutics|Pharmaceuticals|Pharma|Biosciences?|Bio)$/i, "")
    .trim();
}

// ── ClinicalTrials.gov v2: studies per sponsor ──────────────────────────────
interface CTStudy {
  protocolSection?: {
    identificationModule?: { briefTitle?: string };
    statusModule?: { overallStatus?: string };
    designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
    conditionsModule?: { conditions?: string[]; keywords?: string[] };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
  };
}
async function fetchTrials(sponsor: string): Promise<CTStudy[]> {
  // GEEN `fields`-parameter: de v2-API kent de oude v1-veldnamen (BriefTitle,
  // EnrollmentCount, …) niet en geeft dan HTTP 400. Zonder `fields` levert de
  // API de volledige protocolSection-structuur — precies wat deriveFromTrials
  // hieronder uitleest.
  const params = new URLSearchParams({
    "query.lead": sponsor,
    "filter.overallStatus": "RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,COMPLETED,SUSPENDED",
    pageSize: "30",
  });
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CT.gov HTTP ${res.status}`);
  const json = (await res.json()) as { studies?: CTStudy[] };
  return json.studies ?? [];
}

// ── Afleiding van briefing-velden uit CT.gov-resultaten ─────────────────────
const PHASE_RANK: Record<string, number> = { "EARLY_PHASE1": 1, "PHASE1": 2, "PHASE1/PHASE2": 3, "PHASE2": 4, "PHASE2/PHASE3": 5, "PHASE3": 6, "PHASE4": 7, "NA": 0 };
const PHASE_LABEL: Record<string, string> = { "EARLY_PHASE1": "Phase 1", "PHASE1": "Phase 1", "PHASE1/PHASE2": "Phase 1/2", "PHASE2": "Phase 2", "PHASE2/PHASE3": "Phase 2/3", "PHASE3": "Phase 3", "PHASE4": "Phase 4" };

function deriveFromTrials(studies: CTStudy[]): {
  phase: string | null;
  maxEnrollment: number | null;
  diseaseArea: string | null;
  isOncology: boolean;
  isRareDisease: boolean;
  hasBreakthroughHint: boolean;
} {
  let bestPhaseRank = 0;
  let bestPhase: string | null = null;
  let maxEnrollment = 0;
  const conditions: string[] = [];
  let breakthroughHint = false;

  for (const s of studies) {
    const phases = s.protocolSection?.designModule?.phases ?? [];
    for (const p of phases) {
      const r = PHASE_RANK[p] ?? 0;
      if (r > bestPhaseRank) { bestPhaseRank = r; bestPhase = PHASE_LABEL[p] ?? p; }
    }
    const enroll = s.protocolSection?.designModule?.enrollmentInfo?.count ?? 0;
    if (enroll > maxEnrollment) maxEnrollment = enroll;
    for (const c of s.protocolSection?.conditionsModule?.conditions ?? []) conditions.push(c.toLowerCase());
    for (const k of s.protocolSection?.conditionsModule?.keywords ?? []) conditions.push(k.toLowerCase());
    const title = (s.protocolSection?.identificationModule?.briefTitle ?? "").toLowerCase();
    if (title.includes("breakthrough therapy") || title.includes("breakthrough designation")) breakthroughHint = true;
  }

  const condBlob = conditions.join(" ");
  const isOncology = /cancer|carcinoma|tumor|tumour|leukemia|lymphoma|myeloma|melanoma|sarcoma|glioma|oncolog/.test(condBlob);
  const isRareDisease = /rare disease|orphan disease|als\b|amyotrophic|hemophilia|cystic fibrosis|huntington|duchenne|sma\b|sickle cell|gaucher|fabry|pompe|wilson disease|niemann/.test(condBlob);

  // disease_area best-effort: oncology → "Oncology", anders eerste herkende area
  let diseaseArea: string | null = null;
  if (isOncology) diseaseArea = "Oncology";
  else if (isRareDisease) diseaseArea = "Rare disease";
  else if (/neurolog|alzheimer|parkinson|epilep/.test(condBlob)) diseaseArea = "Neurology";
  else if (/cardio|heart|stroke|atherosclero/.test(condBlob)) diseaseArea = "Cardiovascular";
  else if (/diabetes|metabolic|obesity/.test(condBlob)) diseaseArea = "Metabolic";
  else if (/inflammator|rheumatoid|psoriasis|crohn|ulcerative colitis|lupus|autoimmun/.test(condBlob)) diseaseArea = "Immunology";

  return { phase: bestPhase, maxEnrollment: maxEnrollment > 0 ? maxEnrollment : null, diseaseArea, isOncology, isRareDisease, hasBreakthroughHint: breakthroughHint };
}

// ── Mining: Yahoo quoteSummary voor industry + country ─────────────────────
async function fetchYahooProfile(ticker: string): Promise<{ industry: string | null; country: string | null }> {
  try {
    const url = `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { industry: null, country: null };
    const json = (await res.json()) as { quoteSummary?: { result?: Array<{ assetProfile?: { industry?: string; country?: string } }> } };
    const r = json.quoteSummary?.result?.[0]?.assetProfile;
    return { industry: r?.industry ?? null, country: r?.country ?? null };
  } catch {
    return { industry: null, country: null };
  }
}

// ── Tier-1/2/3 jurisdictie mapping (uit weights.ts mining_quality logic) ───
const TIER1_COUNTRIES = new Set(["Canada", "Australia", "United States", "USA"]);
const TIER2_COUNTRIES = new Set(["Chile", "Peru", "Brazil", "Mexico", "Argentina", "Colombia", "Finland", "Sweden", "Norway", "Portugal", "Spain"]);
// Anders = tier 3 (Afrika, Centraal-Azië, etc.). Niet expliciet gelijst; we slaan
// het land op, scoring leest het.
function inferJurisdiction(country: string | null): string | null {
  if (!country) return null;
  if (TIER1_COUNTRIES.has(country)) return country;
  if (TIER2_COUNTRIES.has(country)) return country;
  return country; // tier-3 — opgeslagen voor transparantie, scoring beoordeelt
}

// Commodity-detectie uit industry-string + company-name fallback
function inferCommodity(industry: string | null, company: string | null): string | null {
  const blob = ((industry ?? "") + " " + (company ?? "")).toLowerCase();
  if (/lithium/.test(blob)) return "lithium";
  if (/copper/.test(blob)) return "copper";
  if (/gold|au\b/.test(blob)) return "gold";
  if (/silver|ag\b/.test(blob)) return "silver";
  if (/uranium|u3o8/.test(blob)) return "uranium";
  if (/nickel/.test(blob)) return "nickel";
  if (/rare earth|ree\b|neodymium|praseodymium|dysprosium/.test(blob)) return "rare-earth";
  if (/antimony/.test(blob)) return "antimony";
  if (/cobalt/.test(blob)) return "cobalt";
  if (/zinc|lead/.test(blob)) return "zinc-lead";
  if (/iron|fe2o3/.test(blob)) return "iron";
  if (/platinum|palladium|pgm/.test(blob)) return "pgm";
  if (/tin\b/.test(blob)) return "tin";
  if (/graphite/.test(blob)) return "graphite";
  if (/coal/.test(blob)) return "coal";
  return null;
}

// Operational status uit signal_catalysts events: PEA/PFS/DFS = pre-development,
// permit/first_pour/production = operational.
async function inferOperationalStatus(sb: ReturnType<typeof getServiceClient>, ticker: string): Promise<string | null> {
  const { data: cats } = await sb
    .from("signal_catalysts")
    .select("catalyst_type, status")
    .eq("ticker", ticker);
  if (!cats || cats.length === 0) return null;
  const types = new Set(cats.map((c) => (c.catalyst_type as string) || ""));
  if (types.has("first_pour") || types.has("operational") || types.has("production_start")) return "operational";
  if (types.has("permit") || types.has("permit_decision")) return "permit-stage";
  if (types.has("dfs") || types.has("definitive_feasibility")) return "pre-development";
  if (types.has("pfs") || types.has("pre_feasibility")) return "pre-development";
  if (types.has("pea") || types.has("preliminary_economic_assessment")) return "pre-development";
  if (types.has("resource_estimate")) return "exploration";
  return null;
}

// ── openFDA: orphan/breakthrough/fast track designations ────────────────────
interface FdaHit { sponsor_name?: string; products?: Array<{ active_ingredients?: Array<{ name?: string }> }>; }
async function fetchFdaDesignations(company: string): Promise<{ hasOrphan: boolean; hasFastTrack: boolean; hasBreakthrough: boolean }> {
  // openFDA's drugsfda endpoint heeft submission_type/_class velden waar designations
  // soms in zitten, maar coverage is wisselend. Voor MVP: zoek op orphan drug dataset.
  try {
    const search = `sponsor_name:"${company.replace(/"/g, "")}"`;
    const url = `https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(search)}&limit=20`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return { hasOrphan: false, hasFastTrack: false, hasBreakthrough: false };
    const json = (await res.json()) as { results?: FdaHit[] };
    if (!json.results || json.results.length === 0) return { hasOrphan: false, hasFastTrack: false, hasBreakthrough: false };
    // openFDA drugsfda heeft geen directe designations veld. We retourneren false en
    // vertrouwen op CT.gov-keywords + de breakthroughHint voor nu.
    // (Toekomstige uitbreiding: parse openfda.designation_type uit andere endpoints.)
    return { hasOrphan: false, hasFastTrack: false, hasBreakthrough: false };
  } catch {
    return { hasOrphan: false, hasFastTrack: false, hasBreakthrough: false };
  }
}

// ── Hoofd-flow ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!checkAuth(req) && !checkCron(req)) return new Response("Unauthorized", { status: 401 });
  try {
    const r = await logRun("poll-briefing", run);
    return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
  }
});

async function run(): Promise<RunResult> {
  const sb = getServiceClient();
  const startMs = Date.now();

  // Optionele batch-size override via query param (handig voor weekend-runs)
  const url = new URL("http://x"); // placeholder, query niet bereikbaar in async function
  // Default batch: 30. Voor weekend-cron zou een grotere batch zinvol zijn.
  const BATCH_SIZE = 30;
  const RESCAN_CUTOFF = new Date(Date.now() - RESCAN_DAYS * 24 * 3600 * 1000).toISOString();

  // Pak biotech + mining tickers met:
  //   - briefing_status='pending' OF 'no_data'
  //   - OF 'filled' + briefing_polled_at < cutoff
  // 'not_applicable' wordt nooit gepolld (sector='other').
  const { data: batch, error } = await sb
    .from("signal_tickers")
    .select("ticker, company, sector, phase, disease_area, trial_size_n, has_orphan_drug, has_breakthrough_designation, has_fast_track, commodity, jurisdiction, operational_status, briefing_status, briefing_polled_at")
    .eq("active", true)
    .in("sector", ["biotech", "mining"])
    .or(`briefing_status.eq.pending,briefing_status.eq.no_data,and(briefing_status.eq.filled,briefing_polled_at.lt.${RESCAN_CUTOFF})`)
    .order("briefing_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(error.message);
  if (!batch || batch.length === 0) {
    return { ok: true, message: "queue leeg — alle biotech-tickers up-to-date", metrics: { checked: 0 } };
  }

  let checked = 0, filled = 0, noData = 0, errors = 0;
  const errMsgs: string[] = [];

  for (const t of batch) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    const now = new Date().toISOString();
    try {
      const company = normalizeCompany(t.company as string);
      if (!company) {
        await sb.from("signal_tickers").update({ briefing_polled_at: now, briefing_status: "no_data" }).eq("ticker", t.ticker);
        noData++;
        continue;
      }

      const update: Record<string, unknown> = { briefing_polled_at: now };
      let anyFilled = false;

      if (t.sector === "biotech") {
        // ── Biotech: CT.gov sponsor-search → phase, disease_area, trial_size, designations
        const studies = await fetchTrials(company);
        const derived = deriveFromTrials(studies);
        const fda = await fetchFdaDesignations(company);
        if (!t.phase && derived.phase) { update.phase = derived.phase; anyFilled = true; }
        if (!t.disease_area && derived.diseaseArea) { update.disease_area = derived.diseaseArea; anyFilled = true; }
        if (t.trial_size_n == null && derived.maxEnrollment != null) { update.trial_size_n = derived.maxEnrollment; anyFilled = true; }
        if (t.has_orphan_drug == null && (fda.hasOrphan || derived.isRareDisease)) { update.has_orphan_drug = derived.isRareDisease; anyFilled = true; }
        if (t.has_breakthrough_designation == null && (fda.hasBreakthrough || derived.hasBreakthroughHint)) {
          update.has_breakthrough_designation = fda.hasBreakthrough || derived.hasBreakthroughHint;
          anyFilled = true;
        }
        if (t.has_fast_track == null && fda.hasFastTrack) { update.has_fast_track = true; anyFilled = true; }
      } else if (t.sector === "mining") {
        // ── Mining: Yahoo industry/country + signal_catalysts events → commodity,
        //          jurisdiction, operational_status. Andere velden (deposit_type,
        //          geological_anomaly, processing_tech, has_strategic_backer) vereisen
        //          NI 43-101 PDF-parsing en blijven handmatig.
        const profile = await fetchYahooProfile(t.ticker as string);
        const commodity = inferCommodity(profile.industry, t.company as string);
        const jurisdiction = inferJurisdiction(profile.country);
        const opStatus = await inferOperationalStatus(sb, t.ticker as string);
        if (!t.commodity && commodity) { update.commodity = commodity; anyFilled = true; }
        if (!t.jurisdiction && jurisdiction) { update.jurisdiction = jurisdiction; anyFilled = true; }
        if (!t.operational_status && opStatus) { update.operational_status = opStatus; anyFilled = true; }
      }

      update.briefing_status = anyFilled ? "filled" : "no_data";
      if (anyFilled) filled++; else noData++;

      await sb.from("signal_tickers").update(update).eq("ticker", t.ticker);
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      if (errMsgs.length < 5) errMsgs.push(`${t.ticker}: ${msg}`);
      // Bij fout: alleen polled_at bijwerken zodat we niet eindeloos retryen op dezelfde
      await sb.from("signal_tickers").update({ briefing_polled_at: now }).eq("ticker", t.ticker);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  return {
    ok: errors < Math.max(1, checked),
    message: `${checked} gescand, ${filled} gevuld, ${noData} no_data, ${errors} fouten` + (errMsgs.length ? `; bv: ${errMsgs.slice(0, 3).join("; ")}` : ""),
    metrics: { checked, filled, no_data: noData, errors, batch_size: batch.length },
  };
}
