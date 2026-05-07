import type { Config } from "@netlify/functions";
import { runLookalikePairs } from "./_lib/scoring/lookalike_pairs.mts";

export default async () => {
  const out = runLookalikePairs();
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/test-pairs",
};
