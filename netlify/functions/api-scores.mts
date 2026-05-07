import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

export default async (req: Request) => {
  const url = new URL(req.url);
  const sector = url.searchParams.get("sector");
  const mode = url.searchParams.get("mode") ?? "trader";
  const minScore = Number(url.searchParams.get("min_score") ?? "0");
  const limit = Math.min(500, Number(url.searchParams.get("limit") ?? "200"));

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let q = supabase
    .from("signal_scores")
    .select("*")
    .eq("mode", mode)
    .gte("scan_date", since)
    .order("scan_date", { ascending: false })
    .order("final_score", { ascending: false })
    .limit(limit);
  if (sector) q = q.eq("sector", sector);
  if (minScore > 0) q = q.gte("final_score", minScore);

  const { data, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  // Dedup: keep latest scan_date per ticker
  const latestByTicker = new Map<string, (typeof data)[number]>();
  for (const row of data ?? []) {
    if (!latestByTicker.has(row.ticker)) latestByTicker.set(row.ticker, row);
  }
  const rows = [...latestByTicker.values()];

  const counts = {
    STRONG_BUY: rows.filter((r) => r.action === "STRONG_BUY").length,
    BUY: rows.filter((r) => r.action === "BUY").length,
    WATCH: rows.filter((r) => r.action === "WATCH").length,
    HOLD: rows.filter((r) => r.action === "HOLD").length,
    AVOID: rows.filter((r) => r.action === "AVOID").length,
  };

  return new Response(
    JSON.stringify({ rows, counts, mode, scan_date: today }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = {
  path: "/api/scores",
};
