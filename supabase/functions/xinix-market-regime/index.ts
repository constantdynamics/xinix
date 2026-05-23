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
    // Haal SPY (1 jaar history) en VIX (5 dagen) parallel op
    const [spyResp, vixResp] = await Promise.all([
      fetch("https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y", { headers: { "User-Agent": "Mozilla/5.0" } }),
      fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d", { headers: { "User-Agent": "Mozilla/5.0" } }),
    ]);
    if (!spyResp.ok) throw new Error(`Yahoo Finance SPY HTTP ${spyResp.status}`);

    const spyJson = await spyResp.json();
    // VIX is optioneel — een VIX-storing (429, HTML-foutpagina) mag de
    // SPY-gebaseerde regimebepaling niet om zeep helpen. panicMode hieronder
    // verdraagt vixClose == null.
    let vixJson: any = null;
    try {
      if (vixResp.ok) vixJson = await vixResp.json();
    } catch {
      vixJson = null;
    }

    const spyResult = spyJson?.chart?.result?.[0];
    if (!spyResult) throw new Error("Geen SPY data van Yahoo Finance");

    const rawCloses: (number | null)[] = spyResult.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((c): c is number => c != null && isFinite(c));

    if (closes.length < 50) throw new Error(`Te weinig SPY koerspunten: ${closes.length}`);

    const lastClose = closes[closes.length - 1];
    const window200 = closes.slice(-200);
    const ma200     = window200.reduce((a, b) => a + b, 0) / window200.length;
    const window50  = closes.slice(-50);
    const ma50      = window50.reduce((a, b) => a + b, 0) / window50.length;

    // VIX: meest recente slotkoers (paniekmeter — boven 30 = hoge angst)
    const vixRaw: (number | null)[] = vixJson?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const vixClose = vixRaw.filter((c): c is number => c != null && isFinite(c)).at(-1) ?? null;

    // Regime-bepaling (3 staten):
    //   bear:        death cross (50d MA < 200d MA) OF VIX > 30 (paniekmodus)
    //   weak_bull:   golden cross maar koers onder 50d MA → voorzichtig kopen (60% positiegrootte)
    //   strong_bull: golden cross EN koers boven 50d MA EN VIX ≤ 30 → normaal kopen
    const deathCross = ma50 < ma200;
    const panicMode  = vixClose != null && vixClose > 30;
    const regime: "strong_bull" | "weak_bull" | "bear" =
      (deathCross || panicMode) ? "bear"
      : lastClose > ma50        ? "strong_bull"
      :                           "weak_bull";
    const isBull = regime !== "bear";

    await sb.from("market_regime").upsert({
      id:         1,
      updated_at: now,
      spy_close:  +lastClose.toFixed(2),
      ma_200:     +ma200.toFixed(2),
      ma_50:      +ma50.toFixed(2),
      vix_close:  vixClose != null ? +vixClose.toFixed(2) : null,
      regime,
      is_bull:    isBull,
    }, { onConflict: "id" });

    const regimeLabel = regime === "strong_bull" ? "STRONG BULL 🐂🟢" : regime === "weak_bull" ? "WEAK BULL 🐂🟡" : "BEAR 🐻";
    const vixLabel = vixClose != null ? ` | VIX ${vixClose.toFixed(1)}${vixClose > 30 ? " ⚠️" : ""}` : "";
    const msg = `SPY ${lastClose.toFixed(2)} | 50d MA ${ma50.toFixed(2)} | 200d MA ${ma200.toFixed(2)}${vixLabel} → ${regimeLabel}`;
    await sb.from("signal_runs").insert({
      job: "xinix-market-regime", ran_at: now, ok: true, message: msg,
      metrics: { spy_close: +lastClose.toFixed(2), ma_50: +ma50.toFixed(2), ma_200: +ma200.toFixed(2), vix_close: vixClose, regime, is_bull: isBull, data_points: closes.length },
    });

    return new Response(JSON.stringify({ ok: true, spy_close: lastClose, ma_50: ma50, ma_200: ma200, vix_close: vixClose, regime, is_bull: isBull, data_points: closes.length }), {
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
