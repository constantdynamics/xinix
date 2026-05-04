import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

// OpenFDA — free, no key required (rate limit 240 req/min, 1000/day).
// We poll the drugsfda endpoint for recent approvals matching company names.
// Docs: https://open.fda.gov/apis/drug/drugsfda/

interface OpenFDAResult {
  application_number?: string;
  sponsor_name?: string;
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  submissions?: Array<{
    submission_status?: string;
    submission_status_date?: string;
    submission_type?: string;
    submission_class_code?: string;
  }>;
}

async function searchSponsorRecent(sponsor: string): Promise<OpenFDAResult[]> {
  // Quote the sponsor to handle multi-word names.
  const search = `sponsor_name:"${sponsor.replace(/"/g, "")}"`;
  const url = `https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(
    search
  )}&limit=20`;
  const res = await fetch(url);
  if (res.status === 404) return []; // no results
  if (!res.ok) throw new Error(`OpenFDA ${sponsor} HTTP ${res.status}`);
  const json = (await res.json()) as { results?: OpenFDAResult[] };
  return json.results ?? [];
}

export default async () => {
  await logRun("poll-fda", async () => {
    const supabase = getServiceClient();
    const { data: tickers } = await supabase
      .from("biotech_tickers")
      .select("ticker, company")
      .eq("active", true);
    if (!tickers) return { ok: true, message: "no tickers" };

    let signalsInserted = 0;
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const errors: string[] = [];

    for (const { ticker, company } of tickers) {
      try {
        const results = await searchSponsorRecent(company);
        for (const r of results) {
          const sub = r.submissions?.find(
            (s) =>
              s.submission_status === "AP" &&
              s.submission_status_date &&
              new Date(
                `${s.submission_status_date.slice(0, 4)}-${s.submission_status_date.slice(
                  4,
                  6
                )}-${s.submission_status_date.slice(6, 8)}`
              ) > cutoff
          );
          if (!sub) continue;
          const drug =
            r.openfda?.brand_name?.[0] ??
            r.openfda?.generic_name?.[0] ??
            r.application_number ??
            "drug";
          const dateStr = sub.submission_status_date!;
          const dateIso = `${dateStr.slice(0, 4)}-${dateStr.slice(
            4,
            6
          )}-${dateStr.slice(6, 8)}`;
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "fda_approval",
            severity: "red",
            title: `${ticker}: FDA approval — ${drug}`,
            detail: `Application ${r.application_number}, ${sub.submission_type ?? ""} ${sub.submission_class_code ?? ""} approved ${dateIso}.`,
            payload: {
              application: r.application_number,
              drug,
              date: dateIso,
            },
            expires_at: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000
            ).toISOString(),
            dedup_key: `fda_approval:${r.application_number}:${dateIso}`,
          });
          if (id) signalsInserted++;
        }
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ticker}: ${msg}`);
      }
    }

    return {
      ok: errors.length === 0,
      message: `${signalsInserted} approval signals` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: { signals: signalsInserted, errors: errors.length },
    };
  });
};

export const config: Config = {
  schedule: "0 */6 * * *", // every 6 hours
};
