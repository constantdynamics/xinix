// Boilerplate-collapser voor background functies. Elke achtergrond
// functie ziet er zo uit:
//
//   import { runBackground } from "../_shared/runner.ts";
//   import { logic } from "./logic.ts";  // de echte werkfunctie
//   Deno.serve(runBackground("poll-prices", logic));

import { logRun, type RunResult } from "./supabase.ts";
import { checkAdminOrCron } from "./auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "./cors.ts";

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
      return jsonResponse(req, { ok: result.ok, ...result }, {
        status: result.ok ? 200 : 500,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse(req, { ok: false, message: msg }, { status: 500 });
    }
  };
}
