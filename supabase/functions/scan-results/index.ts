// scan-results — leesbare uitvoer van scan-losers en scan-bottoms.
// Geeft: auto-toegevoegde tickers + feniks-ranking + hikkertjes-ranking (top 25) + scan-history.

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

    const [tickersResult, runsResult, summariesResult, phoenixResult, phoenixCountResult, unscannedCountResult, hikkertjeResult, hikkertjeCountResult, hikkertjeUnscannedResult] = await Promise.all([
      // Alle auto-toegevoegde tickers, nieuwste eerst
      sb
        .from("signal_tickers")
        .select("ticker, company, sector, medal_gold, medal_silver, medal_bronze, notes, created_at, exchange, active, buy_limit, is_phoenix")
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
      // Laatste-koers lookup
      sb
        .from("signal_price_summary")
        .select("ticker, last_close"),
      // Alle feniks-aandelen (voor ranking)
      sb
        .from("signal_tickers")
        .select("ticker, company, sector, medal_gold, medal_silver, medal_bronze, buy_limit, exchange, is_phoenix, phoenix_50x_date")
        .eq("is_phoenix", true)
        .eq("active", true),
      // Totaal feniks-aandelen
      sb
        .from("signal_tickers")
        .select("*", { count: "exact", head: true })
        .eq("is_phoenix", true)
        .eq("active", true),
      // Nog te scannen (feniks)
      sb
        .from("signal_tickers")
        .select("*", { count: "exact", head: true })
        .is("is_phoenix", null)
        .eq("active", true),
      // Alle hikkertje-aandelen (voor ranking)
      sb
        .from("signal_tickers")
        .select("ticker, company, sector, medal_gold, medal_silver, medal_bronze, buy_limit, exchange, hikkertje_spikes")
        .eq("is_hikkertje", true)
        .eq("active", true),
      // Totaal hikkertjes
      sb
        .from("signal_tickers")
        .select("*", { count: "exact", head: true })
        .eq("is_hikkertje", true)
        .eq("active", true),
      // Nog te scannen (hikkertjes)
      sb
        .from("signal_tickers")
        .select("*", { count: "exact", head: true })
        .is("is_hikkertje", null)
        .eq("active", true),
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
      buy_limit: number | null;
      is_phoenix: boolean | null;
    }>;

    const closeByTicker = new Map<string, number | null>();
    for (const r of (summariesResult.data ?? []) as Array<{ ticker: string; last_close: number | null }>) {
      closeByTicker.set(r.ticker, r.last_close);
    }

    // Bron afleiden uit de notes-tekst + last_close erbij plakken
    const enriched = tickers.map((t) => ({
      ...t,
      last_close: closeByTicker.get(t.ticker) ?? null,
      source: t.notes?.includes("biggest-loser") ? "losers"
            : t.notes?.includes("5y-bodem") || t.notes?.includes("5y-low") ? "bottoms"
            : "unknown",
    }));

    // Phoenix ranking: join met koersen, bereken above_limit_pct, sorteer
    const phoenixTickers = (phoenixResult.data ?? []) as Array<{
      ticker: string;
      company: string | null;
      sector: string | null;
      medal_gold: number | null;
      medal_silver: number | null;
      medal_bronze: number | null;
      buy_limit: number | null;
      exchange: string | null;
      phoenix_50x_date: string | null;
    }>;

    const phoenixWithPrice = phoenixTickers.map((p) => {
      const lastClose = closeByTicker.get(p.ticker) ?? null;
      const aboveLimitPct = p.buy_limit && p.buy_limit > 0 && lastClose != null
        ? ((lastClose - p.buy_limit) / p.buy_limit) * 100
        : null;
      return { ...p, last_close: lastClose, above_limit_pct: aboveLimitPct };
    });

    // Standaard-sortering server-side: dichtstbij of onder de limiet bovenaan.
    // De UI kan client-side hersorteren/filteren (bv. op phoenix_50x_date).
    phoenixWithPrice.sort((a, b) => {
      if (a.above_limit_pct == null && b.above_limit_pct == null) return 0;
      if (a.above_limit_pct == null) return 1;
      if (b.above_limit_pct == null) return -1;
      return a.above_limit_pct - b.above_limit_pct;
    });

    // Stuur alle phoenix-aandelen mee (niet top 25), zodat de UI kan filteren.
    const phoenixRanking = phoenixWithPrice;

    // Hikkertje ranking: meeste spikes bovenaan, daarna dichtstbij buy_limit
    const hikkertjeTickers = (hikkertjeResult.data ?? []) as Array<{
      ticker: string;
      company: string | null;
      sector: string | null;
      medal_gold: number | null;
      medal_silver: number | null;
      medal_bronze: number | null;
      buy_limit: number | null;
      exchange: string | null;
      hikkertje_spikes: number | null;
    }>;

    const hikkertjeWithPrice = hikkertjeTickers.map((h) => {
      const lastClose = closeByTicker.get(h.ticker) ?? null;
      const aboveLimitPct = h.buy_limit && h.buy_limit > 0 && lastClose != null
        ? ((lastClose - h.buy_limit) / h.buy_limit) * 100
        : null;
      return { ...h, last_close: lastClose, above_limit_pct: aboveLimitPct };
    });

    hikkertjeWithPrice.sort((a, b) => {
      // Primair: meeste spikes bovenaan
      const spikeDiff = (b.hikkertje_spikes ?? 0) - (a.hikkertje_spikes ?? 0);
      if (spikeDiff !== 0) return spikeDiff;
      // Secundair: dichtstbij buy_limit
      if (a.above_limit_pct == null && b.above_limit_pct == null) return 0;
      if (a.above_limit_pct == null) return 1;
      if (b.above_limit_pct == null) return -1;
      return a.above_limit_pct - b.above_limit_pct;
    });

    const hikkertjeRanking = hikkertjeWithPrice.slice(0, 25);

    // Runs per job groeperen (max 20 per job)
    const byJob: Record<string, typeof runsResult.data> = { "scan-losers": [], "scan-bottoms": [] };
    for (const r of (runsResult.data ?? [])) {
      const arr = byJob[r.job];
      if (arr && arr.length < 20) arr.push(r);
    }

    return new Response(
      JSON.stringify({
        tickers: enriched,
        runs: byJob,
        phoenix_ranking: phoenixRanking,
        phoenix_count: phoenixCountResult.count ?? 0,
        phoenix_unscanned: unscannedCountResult.count ?? 0,
        hikkertje_ranking: hikkertjeRanking,
        hikkertje_count: hikkertjeCountResult.count ?? 0,
        hikkertje_unscanned: hikkertjeUnscannedResult.count ?? 0,
      }),
      { status: 200, headers: { ...cors(req), "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } }
    );
  }
});
