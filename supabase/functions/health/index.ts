// health — leesbare status van alle doorlopende achtergrond-jobs.
// Per job: de laatste run (tijd, ok, message, metrics) + de laatste ~15 runs
// als history-strip. Geen auth nodig (read-only, net als dashboard).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

interface RunRow { job: string; started_at: string; finished_at: string | null; ok: boolean | null; message: string | null; metrics: unknown }
interface HistEntry { started_at: string; finished_at: string | null; ok: boolean | null; message: string | null }
interface JobHealth {
  job: string;
  last_started_at: string;
  last_finished_at: string | null;
  last_ok: boolean | null;
  last_message: string | null;
  last_metrics: unknown;
  runs_24h: number;
  ok_24h: number;
  recent: HistEntry[]; // nieuw -> oud, max 15
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const sb = getServiceClient();
  // Ruim genoeg om elke job zijn laatste run + history te geven, ook de
  // dagelijkse/wekelijkse die zelden draaien (poll-metals slaat het weekend
  // over -> kan ~3 dagen geleden zijn). ~3000 runs ≈ de laatste ~7 dagen.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("signal_runs")
    .select("job, started_at, finished_at, ok, message, metrics")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(3000);
  const rows = (data ?? []) as RunRow[];
  const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;

  const byJob = new Map<string, RunRow[]>();
  for (const r of rows) {
    const arr = byJob.get(r.job);
    if (arr) arr.push(r);
    else byJob.set(r.job, [r]);
  }
  const jobs: JobHealth[] = [];
  for (const [job, arr] of byJob) {
    // arr is al desc gesorteerd (door de query)
    const last = arr[0];
    let runs24 = 0, ok24 = 0;
    for (const r of arr) {
      if (new Date(r.started_at).getTime() >= dayAgoMs) {
        runs24++;
        if (r.ok === true) ok24++;
      }
    }
    jobs.push({
      job,
      last_started_at: last.started_at,
      last_finished_at: last.finished_at,
      last_ok: last.ok,
      last_message: last.message,
      last_metrics: last.metrics,
      runs_24h: runs24,
      ok_24h: ok24,
      recent: arr.slice(0, 15).map((r) => ({ started_at: r.started_at, finished_at: r.finished_at, ok: r.ok, message: r.message })),
    });
  }
  jobs.sort((a, b) => a.job.localeCompare(b.job));

  return new Response(
    JSON.stringify({ jobs, generated_at: new Date().toISOString() }),
    { headers: { ...cors(req), "content-type": "application/json", "cache-control": "public, max-age=20" } },
  );
});
