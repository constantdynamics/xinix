// poll-trials-background — haalt ClinicalTrials.gov-studies op per biotech-
// ticker (Phase 2/3), schrijft signal_trials + signal_catalysts (pending)
// + signal_events bij statuswijziging. 50 tickers/run, round-robin op
// trials_polled_at NULLS FIRST. Dit is de primaire bron van biotech-catalysts.

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
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
function runBackground(job: string, fn: () => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401 });
    try {
      const r = await logRun(job, fn);
      return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}

// ───────────── config ─────────────
const BATCH = 50;
const BUDGET_MS = 110_000;
const SLEEP_MS = 250;
const CT_UA = "Mozilla/5.0 (compatible; BiotechSignalBot/1.0; +https://github.com)";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── signal_events dedup insert ─────────────
type SB = ReturnType<typeof getServiceClient>;
async function insertSignal(sb: SB, opts: { ticker: string; signal_type: string; severity: string; title: string; detail?: string; payload?: Json; expires_at?: string; dedup_key: string; }): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: ex } = await sb.from("signal_events").select("id")
    .eq("ticker", opts.ticker).eq("signal_type", opts.signal_type)
    .gte("detected_at", since)
    .contains("payload", { dedup_key: opts.dedup_key })
    .limit(1);
  if (ex && ex.length > 0) return false;
  await sb.from("signal_events").insert({
    ticker: opts.ticker, signal_type: opts.signal_type, severity: opts.severity,
    title: opts.title, detail: opts.detail ?? null,
    payload: { ...(opts.payload ?? {}), dedup_key: opts.dedup_key },
    expires_at: opts.expires_at ?? null,
  });
  return true;
}

// ───────────── ClinicalTrials.gov ─────────────
interface CTStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: { overallStatus?: string; primaryCompletionDateStruct?: { date?: string }; lastUpdatePostDateStruct?: { date?: string }; };
    designModule?: { phases?: string[] };
  };
}

async function fetchStudies(sponsor: string): Promise<CTStudy[]> {
  const params = new URLSearchParams({
    "query.lead": sponsor,
    "filter.overallStatus": "RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,COMPLETED",
    pageSize: "50",
    fields: "NCTId,BriefTitle,OverallStatus,PrimaryCompletionDate,LastUpdatePostDate,Phase",
  });
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies?${params}`, { headers: { "User-Agent": CT_UA } });
  if (!res.ok) throw new Error(`CT.gov HTTP ${res.status}`);
  const json = (await res.json()) as { studies?: CTStudy[] };
  return json.studies ?? [];
}

function parseCtDate(s?: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-15`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// ───────────── main ─────────────
Deno.serve(runBackground("poll-trials", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker, company")
    .eq("active", true)
    .eq("sector", "biotech")
    .order("trials_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen biotech-tickers", metrics: { tickers: 0 } };

  let trialsTracked = 0, catalystsAdded = 0, signalsInserted = 0;
  const errors: string[] = [];
  const now = new Date();
  const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const t of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    try {
      const studies = await fetchStudies(t.company);
      for (const s of studies) {
        const id = s.protocolSection?.identificationModule;
        const status = s.protocolSection?.statusModule;
        const design = s.protocolSection?.designModule;
        if (!id?.nctId) continue;
        const phases = design?.phases ?? [];
        if (!phases.some((p) => /PHASE2|PHASE3/i.test(p))) continue;

        const completion = parseCtDate(status?.primaryCompletionDateStruct?.date);
        const update = parseCtDate(status?.lastUpdatePostDateStruct?.date);
        const overall = status?.overallStatus ?? null;
        const phase = phases[0] ?? null;

        const { data: existing } = await sb.from("signal_trials").select("nct_id, overall_status")
          .eq("nct_id", id.nctId).maybeSingle();
        const statusChanged = existing && existing.overall_status !== overall;

        await sb.from("signal_trials").upsert({
          nct_id: id.nctId, ticker: t.ticker,
          brief_title: id.briefTitle ?? null, phase, overall_status: overall,
          primary_completion_date: completion, last_update_posted: update,
          last_polled_at: nowIso,
          ...(statusChanged ? { status_changed_at: nowIso } : {}),
        }, { onConflict: "nct_id" });
        trialsTracked++;

        if (statusChanged && overall === "COMPLETED" && existing?.overall_status !== "COMPLETED") {
          const ok = await insertSignal(sb, {
            ticker: t.ticker, signal_type: "trial_status_change", severity: "orange",
            title: `${t.ticker} trial COMPLETED — ${id.briefTitle?.slice(0, 60)}`,
            detail: `${phase ?? ""} ${id.nctId} status → COMPLETED. Topline kan binnen weken komen.`,
            payload: { nct_id: id.nctId, new_status: overall },
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            dedup_key: `trial_completed:${id.nctId}`,
          });
          if (ok) signalsInserted++;
        }

        if (completion) {
          const completionDate = new Date(completion);
          if (completionDate > now && completionDate < oneYear) {
            const { data: existingCat } = await sb.from("signal_catalysts").select("id")
              .eq("source", "clinicaltrials.gov").eq("source_id", id.nctId).maybeSingle();
            if (!existingCat) {
              await sb.from("signal_catalysts").insert({
                ticker: t.ticker,
                catalyst_type: phase?.includes("PHASE3") ? "Phase3_readout" : "Phase2_readout",
                description: id.briefTitle ?? id.nctId,
                expected_date: completion,
                source: "clinicaltrials.gov", source_id: id.nctId,
                status: "pending",
              });
              catalystsAdded++;
            } else {
              await sb.from("signal_catalysts").update({ expected_date: completion, updated_at: nowIso }).eq("id", existingCat.id);
            }
          }
        }
      }
      await sb.from("signal_tickers").update({ trials_polled_at: nowIso }).eq("ticker", t.ticker);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (errors.length < 5) errors.push(`${t.ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ trials_polled_at: new Date().toISOString() }).eq("ticker", t.ticker);
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: errors.length < tickers.length / 2,
    message: `${tickers.length} tickers, ${trialsTracked} trials, ${catalystsAdded} catalysts, ${signalsInserted} signals` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { tickers: tickers.length, trials: trialsTracked, catalysts: catalystsAdded, signals: signalsInserted, errors: errors.length },
  };
}));
