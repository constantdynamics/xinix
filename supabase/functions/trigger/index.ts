import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

const JOBS = [
  "poll-prices-background",
  "poll-trials-background",
  "poll-edgar-background",
  "poll-fda-background",
  "poll-biotech-news-background",
  "poll-metals-background",
  "poll-mining-news-background",
  "compute-signals-background",
  "compute-scores-background",
  "dispatch-alerts-background",
  "forward-returns-background",
  "backtest-background",
  "compute-phoenix-background",
];

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const job = url.searchParams.get("job");
  if (!job || !JOBS.includes(job)) {
    return jsonResponse(req, { error: "unknown job", available: JOBS }, {
      status: 400,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!supabaseUrl || !cronSecret) {
    return textResponse(req, "Server config missing", { status: 500 });
  }

  const target = `${supabaseUrl}/functions/v1/${job}`;
  // Trigger niet-blockerend — we wachten alleen op accepted, niet op de
  // hele job. Achtergrondfuncties loggen zelf naar signal_runs.
  fetch(target, {
    method: "POST",
    headers: {
      "x-cron-secret": cronSecret,
      "content-type": "application/json",
    },
  }).catch((e) => console.error("trigger fanout error", e));

  return jsonResponse(req, { triggered: job, status: 202 }, { status: 202 });
});
