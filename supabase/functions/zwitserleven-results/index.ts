// zwitserleven-results — geeft Zwitserleven-scan resultaten terug aan de frontend.
// Retourneert: alle gescande stocks + statistieken (client-side filteren/sorteren).

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

    const [stocksResult, totalResult, unscannedResult] = await Promise.all([
      // Alle gescande stocks (max 500), gesorteerd op yield
      sb
        .from("zwitserleven_stocks")
        .select("ticker,company,exchange,country,sector,last_close,currency,dividend_yield_pct,annual_dividend,high_5y,pct_under_5y_high,max_annual_gain_5y,years_5pct_growth_5y,payout_ratio,dividend_cuts_5y,risk_label,meets_criteria,scanned_at")
        .order("dividend_yield_pct", { ascending: false, nullsLast: true })
        .limit(500),
      // Totaal gescand
      sb
        .from("zwitserleven_stocks")
        .select("*", { count: "exact", head: true }),
      // Nog te scannen (nooit gescand)
      sb
        .from("signal_tickers")
        .select("*", { count: "exact", head: true })
        .eq("active", true)
        .is("zwitserleven_at", null),
    ]);

    const stocks = (stocksResult.data ?? []) as Array<{
      ticker: string;
      company: string | null;
      exchange: string | null;
      country: string | null;
      sector: string | null;
      last_close: number | null;
      currency: string | null;
      dividend_yield_pct: number | null;
      annual_dividend: number | null;
      high_5y: number | null;
      pct_under_5y_high: number | null;
      max_annual_gain_5y: number | null;
      years_5pct_growth_5y: number | null;
      payout_ratio: number | null;
      dividend_cuts_5y: number | null;
      risk_label: string | null;
      meets_criteria: boolean | null;
      scanned_at: string | null;
    }>;

    const meetsCriteriaCount = stocks.filter((s) => s.meets_criteria).length;

    return new Response(
      JSON.stringify({
        stocks,
        total_scanned: totalResult.count ?? 0,
        meets_criteria_count: meetsCriteriaCount,
        unscanned_count: unscannedResult.count ?? 0,
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
