import { runLookalikePairs } from "../_shared/scoring/lookalike_pairs.ts";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  return jsonResponse(req, runLookalikePairs());
});
