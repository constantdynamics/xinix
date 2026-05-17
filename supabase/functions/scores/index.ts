import { getServiceClient } from "../_shared/supabase.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

// Scores endpoint: leest uit de signal_scores_latest view (1 rij per
// ticker+mode) zodat we niet client-side hoeven te dedupen en niet door
// een limit-bias top-200 missen.

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const url = new URL(req.url);
  const sector = url.searchParams.get("sector");
  const mode = url.searchParams.get("mode") ?? "trader";
  const minScore = Number(url.searchParams.get("min_score") ?? "0");
  // Default 5000 dekt de hele watchlist (~3600 actieven) ruim. Cap 10000
  // als veiligheidsklep zodat een misbruikt request niet 50k JSON-rijen levert.
  const limit = Math.min(10000, Number(url.searchParams.get("limit") ?? "5000"));

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  let q = supabase
    .from("signal_scores_latest")
    .select("*")
    .eq("mode", mode)
    .order("final_score", { ascending: false })
    .limit(limit);
  if (sector) q = q.eq("sector", sector);
  if (minScore > 0) q = q.gte("final_score", minScore);

  const { data, error } = await q;
  if (error) return textResponse(req, error.message, { status: 500 });

  const rows = data ?? [];
  const counts = {
    STRONG_BUY: rows.filter((r) => r.action === "STRONG_BUY").length,
    BUY: rows.filter((r) => r.action === "BUY").length,
    WATCH: rows.filter((r) => r.action === "WATCH").length,
    HOLD: rows.filter((r) => r.action === "HOLD").length,
    AVOID: rows.filter((r) => r.action === "AVOID").length,
  };

  return jsonResponse(req, { rows, counts, mode, scan_date: today, total: rows.length });
});
