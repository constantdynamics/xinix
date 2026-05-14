// xinix-market-regime — haalt dagelijks de S&P 500 (SPY ETF) koers op en bepaalt
// de marktfase op basis van het 200-daags voortschrijdend gemiddelde.
//
// Bull-markt: SPY slotkoers > 200d MA → kopen toegestaan in sim en trade.
// Bear-markt: SPY slotkoers ≤ 200d MA → geen nieuwe posities kopen.
//
// Draait dagelijks om 21:30 UTC (30 min vóór trade/sim om 22:05 UTC).
// Data-bron: Yahoo Finance publieke API (SPY, 1 jaar history).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
function checkAuth(req: Request) { const t = Deno.env.get("ADMIN_TOKEN"); if (!t) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${t}`; }
function checkCron(req: Request) { const t = Deno.env.get("CRON_SECRET"); if (!t) return false; return (req.headers.get("x-cron-secret") ?? "") === t; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!checkAuth(req) && !checkCron(req)) return new Response("Unauthorized", { status: 401 });

  const sb = getServiceClient();
  const now = new Date().toISOString();

  try {
    // Yahoo Finance: SPY dagelijkse koersen, 1 jaar history (~252 handelsdagen)
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y";
    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) throw new Error(`Yahoo Finance HTTP ${resp.status}`);

    const json = await resp.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("Geen data van Yahoo Finance");

    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((c): c is number => c != null && isFinite(c));

    if (closes.length < 50) throw new Error(`Te weinig koerspunten: ${closes.length}`);

    const lastClose = closes[closes.length - 1];
    // Gebruik de laatste 200 beschikbare datapunten voor het MA
    const window   = closes.slice(-200);
    const ma200    = window.reduce((a, b) => a + b, 0) / window.length;
    const isBull   = lastClose > ma200;

    await sb.from("market_regime").upsert({
      id:         1,
      updated_at: now,
      spy_close:  +lastClose.toFixed(2),
      ma_200:     +ma200.toFixed(2),
      is_bull:    isBull,
    }, { onConflict: "id" });

    const msg = `SPY ${lastClose.toFixed(2)} ${isBull ? ">" : "≤"} 200d MA ${ma200.toFixed(2)} → ${isBull ? "BULL 🐂" : "BEAR 🐻"} (${closes.length} datapunten)`;
    await sb.from("signal_runs").insert({
      job: "xinix-market-regime", ran_at: now, ok: true, message: msg,
      metrics: { spy_close: +lastClose.toFixed(2), ma_200: +ma200.toFixed(2), is_bull: isBull, data_points: closes.length },
    });

    return new Response(JSON.stringify({ ok: true, spy_close: lastClose, ma_200: ma200, is_bull: isBull, data_points: closes.length }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("signal_runs").insert({ job: "xinix-market-regime", ran_at: now, ok: false, message: msg }).catch(() => {});
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
