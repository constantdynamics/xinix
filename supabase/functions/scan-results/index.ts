// scan-results — leesbare uitvoer van scan-losers en scan-bottoms.
// Geeft: auto-toegevoegde tickers (notes startend met "Auto-toegevoegd")
// + laatste 20 runs per job voor de scan-history. Geen auth nodig.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  try {
    const sb = getServiceClient();

    const [tickersResult, runsResult] = await Promise.all([
      // Alle auto-toegevoegde tickers, nieuwste eerst
      sb
        .from("signal_tickers")
        .select("ticker, company, sector, medal_gold, medal_silver, medal_bronze, notes, created_at, exchange, active")
        .ilike("notes", "Auto-toegevoegd%")
        .order("created_at", { ascending: false })
        .limit(500),
      // Laatste 20 runs per scan-job
      sb
        .from("signal_runs")
        .select("job, started_at, finished_at, ok, message, metrics")
        .in("job", ["scan-losers", "scan-bottoms"])
        .order("started_at", { ascending: false })
        .limit(60),
    ]);

    const tickers = (tickersResult.data ?? []) as Array<{
      ticker: string;
      company: string | null;
      sector: string | null;
      medal_gold: number | null;
      medal_silver: number | null;
      medal_bronze: number | null;
      notes: string | null;
      created_at: string;
      exchange: string | null;
      active: boolean | null;
    }>;

    // Bron afleiden uit de notes-tekst
    const enriched = tickers.map((t) => ({
      ...t,
      source: t.notes?.includes("biggest-loser") ? "losers"
            : t.notes?.includes("5y-bodem") || t.notes?.includes("5y-low") ? "bottoms"
            : "unknown",
    }));

    // Runs per job groeperen (max 20 per job)
    const byJob: Record<string, typeof runsResult.data> = { "scan-losers": [], "scan-bottoms": [] };
    for (const r of (runsResult.data ?? [])) {
      const arr = byJob[r.job];
      if (arr && arr.length < 20) arr.push(r);
    }

    return new Response(
      JSON.stringify({ tickers: enriched, runs: byJob }),
      { status: 200, headers: { ...cors(req), "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } }
    );
  }
});
