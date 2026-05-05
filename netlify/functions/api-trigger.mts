import type { Config } from "@netlify/functions";

// Manual trigger to invoke a background job for testing.
// Authenticated via ADMIN_TOKEN.

const JOBS = [
  "poll-prices-background",
  "poll-trials-background",
  "poll-edgar-background",
  "poll-fda-background",
  "poll-biotech-news-background",
  "poll-metals-background",
  "poll-mining-news-background",
  "compute-signals-background",
  "dispatch-alerts-background",
];

function checkAuth(req: Request): boolean {
  const required = Netlify.env.get("ADMIN_TOKEN");
  if (!required) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

export default async (req: Request) => {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const job = url.searchParams.get("job");
  if (!job || !JOBS.includes(job)) {
    return new Response(
      JSON.stringify({ error: "unknown job", available: JOBS }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const base = `${url.protocol}//${url.host}`;
  // Background functions are invoked via their default path
  const target = `${base}/.netlify/functions/${job}`;
  const res = await fetch(target, { method: "POST" });
  return new Response(
    JSON.stringify({ triggered: job, status: res.status }),
    { status: 202, headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = {
  path: "/api/trigger",
};
