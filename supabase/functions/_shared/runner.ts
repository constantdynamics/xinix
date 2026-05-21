// Boilerplate-collapser voor background functies. Elke achtergrond
// functie ziet er zo uit:
//
//   import { runBackground } from "../_shared/runner.ts";
//   import { logic } from "./logic.ts";  // de echte werkfunctie
//   Deno.serve(runBackground("poll-prices", logic));

import { logRun, getServiceClient, type RunResult } from "./supabase.ts";
import { checkAdminOrCron } from "./auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "./cors.ts";

async function notifyFailure(job: string, message: string): Promise<void> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from("signal_settings")
      .select("ntfy_topic, ntfy_server")
      .single();
    const topic = (data as Record<string, unknown> | null)?.ntfy_topic as string | undefined;
    if (!topic) return;
    const server = ((data as Record<string, unknown>)?.ntfy_server as string | undefined) || "https://ntfy.sh";
    await fetch(server.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        title: `⚠️ Job mislukt: ${job}`,
        message,
        priority: 4,
        tags: ["warning"],
      }),
    });
  } catch {
    // Notificatiefout nooit de job zelf laten crashen.
  }
}

export function runBackground(
  job: string,
  fn: () => Promise<RunResult>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const pf = handlePreflight(req);
    if (pf) return pf;

    if (!checkAdminOrCron(req))
      return textResponse(req, "Unauthorized", { status: 401 });

    try {
      const result = await logRun(job, fn);
      if (!result.ok) {
        void notifyFailure(job, result.message ?? "Onbekende fout");
      }
      return jsonResponse(req, { ok: result.ok, ...result }, {
        status: result.ok ? 200 : 500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void notifyFailure(job, msg);
      return jsonResponse(req, { ok: false, message: msg }, { status: 500 });
    }
  };
}
