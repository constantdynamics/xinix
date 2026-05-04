import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

// ClinicalTrials.gov v2 API — fully free, no auth.
// Search by sponsor/lead name; we use ticker→company mapping from biotech_tickers.
// Docs: https://clinicaltrials.gov/data-api/api

interface CTStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    statusModule?: {
      overallStatus?: string;
      primaryCompletionDateStruct?: { date?: string };
      lastUpdatePostDateStruct?: { date?: string };
    };
    designModule?: { phases?: string[] };
  };
}

async function fetchStudiesBySponsor(sponsor: string): Promise<CTStudy[]> {
  // Filter to interventional trials with phase info; limit to recent activity
  const params = new URLSearchParams({
    "query.lead": sponsor,
    "filter.overallStatus":
      "RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,COMPLETED",
    pageSize: "50",
    fields:
      "NCTId,BriefTitle,OverallStatus,PrimaryCompletionDate,LastUpdatePostDate,Phase",
  });
  const url = `https://clinicaltrials.gov/api/v2/studies?${params}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BiotechSignalBot/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`CT.gov ${sponsor} HTTP ${res.status}`);
  const json = (await res.json()) as { studies?: CTStudy[] };
  return json.studies ?? [];
}

function parseCtDate(s?: string): string | null {
  if (!s) return null;
  // CT.gov returns "2026-09" or "2026-09-15"
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-15`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function isPivotalPhase(phases: string[] | undefined): boolean {
  if (!phases) return false;
  return phases.some((p) => /PHASE2|PHASE3/i.test(p));
}

export default async () => {
  await logRun("poll-trials", async () => {
    const supabase = getServiceClient();
    const { data: tickers } = await supabase
      .from("biotech_tickers")
      .select("ticker, company")
      .eq("active", true);
    if (!tickers) return { ok: true, message: "no tickers" };

    let trialsTracked = 0;
    let signalsInserted = 0;
    let catalystsAdded = 0;
    const errors: string[] = [];

    for (const { ticker, company } of tickers) {
      try {
        const studies = await fetchStudiesBySponsor(company);
        for (const s of studies) {
          const id = s.protocolSection?.identificationModule;
          const status = s.protocolSection?.statusModule;
          const design = s.protocolSection?.designModule;
          if (!id?.nctId) continue;
          if (!isPivotalPhase(design?.phases)) continue;

          const completion = parseCtDate(
            status?.primaryCompletionDateStruct?.date
          );
          const update = parseCtDate(status?.lastUpdatePostDateStruct?.date);
          const overall = status?.overallStatus ?? null;
          const phase = design?.phases?.[0] ?? null;

          // Check if we have this trial already
          const { data: existing } = await supabase
            .from("biotech_trials")
            .select("nct_id, overall_status, primary_completion_date")
            .eq("nct_id", id.nctId)
            .maybeSingle();

          const statusChanged =
            existing && existing.overall_status !== overall;

          await supabase.from("biotech_trials").upsert(
            {
              nct_id: id.nctId,
              ticker,
              brief_title: id.briefTitle ?? null,
              phase,
              overall_status: overall,
              primary_completion_date: completion,
              last_update_posted: update,
              last_polled_at: new Date().toISOString(),
              status_changed_at: statusChanged
                ? new Date().toISOString()
                : undefined,
            },
            { onConflict: "nct_id" }
          );
          trialsTracked++;

          // Trial completion → readout signal (red, occurred event)
          if (
            statusChanged &&
            overall === "COMPLETED" &&
            existing?.overall_status !== "COMPLETED"
          ) {
            const sigId = await insertSignal(supabase, {
              ticker,
              signal_type: "trial_status_change",
              severity: "red",
              title: `${ticker} trial COMPLETED — ${id.briefTitle?.slice(0, 60)}`,
              detail: `${phase ?? ""} ${id.nctId} status → COMPLETED. Topline kan elk moment komen.`,
              payload: { nct_id: id.nctId, new_status: overall },
              expires_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000
              ).toISOString(),
              dedup_key: `trial_completed:${id.nctId}`,
            });
            if (sigId) signalsInserted++;
          }

          // Add as catalyst if completion date is in next 12 months
          if (completion) {
            const completionDate = new Date(completion);
            const now = new Date();
            const oneYear = new Date(
              now.getTime() + 365 * 24 * 60 * 60 * 1000
            );
            if (completionDate > now && completionDate < oneYear) {
              const { data: existingCat } = await supabase
                .from("biotech_catalysts")
                .select("id")
                .eq("source", "clinicaltrials.gov")
                .eq("source_id", id.nctId)
                .maybeSingle();
              if (!existingCat) {
                const catalystType = phase?.includes("PHASE3")
                  ? "Phase3_readout"
                  : "Phase2_readout";
                await supabase.from("biotech_catalysts").insert({
                  ticker,
                  catalyst_type: catalystType,
                  description: id.briefTitle ?? id.nctId,
                  expected_date: completion,
                  source: "clinicaltrials.gov",
                  source_id: id.nctId,
                  status: "pending",
                });
                catalystsAdded++;
              } else {
                // Update expected date if it changed
                await supabase
                  .from("biotech_catalysts")
                  .update({
                    expected_date: completion,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", existingCat.id);
              }
            }
          }
        }
        // Be nice to CT.gov
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ticker}: ${msg}`);
      }
    }

    return {
      ok: errors.length === 0,
      message: `${trialsTracked} trials, ${catalystsAdded} catalysts, ${signalsInserted} signals` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: {
        trials: trialsTracked,
        catalysts: catalystsAdded,
        signals: signalsInserted,
      },
    };
  });
};

export const config: Config = {
  schedule: "0 6 * * *", // daily 06:00 UTC
};
