import { createClient } from "@supabase/supabase-js";

export function getServiceClient() {
  const url = Netlify.env.get("SUPABASE_URL");
  const key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Json = Record<string, unknown>;

export async function logRun(
  job: string,
  fn: () => Promise<{ ok: boolean; message?: string; metrics?: Json }>
) {
  const supabase = getServiceClient();
  const { data: row } = await supabase
    .from("signal_runs")
    .insert({ job })
    .select("id")
    .single();
  const id = row?.id;
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
