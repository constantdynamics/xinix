// Service-role client + run logger. Identiek qua API aan de Netlify
// versie zodat de business logic in de functions één-op-één port.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Json = Record<string, unknown>;

export interface RunResult {
  ok: boolean;
  message?: string;
  metrics?: Json;
}

export async function logRun(
  job: string,
  fn: () => Promise<RunResult>
): Promise<RunResult> {
  const supabase = getServiceClient();
  const { data: row } = await supabase
    .from("signal_runs")
    .insert({ job })
    .select("id")
    .single();
  const id = row?.id as number | undefined;
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
