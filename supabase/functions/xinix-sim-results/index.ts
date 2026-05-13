// xinix-sim-results — rankings + lerende inzichten voor de 100-strategie simulatie.
// Geeft per strategie: rang, rendement, win-rate, medaille.
// Geeft per configuratie-dimensie: welke waarde correleert met betere resultaten.
// Geeft aanbevelingen voor het dashboard op basis van wat werkt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const sb = getServiceClient();
    const [stratRes, statesRes, closedRes, openRes, summaryRes] = await Promise.all([
      sb.from("xinix_strategies").select("id, slug, name, grp, config").eq("active", true),
      sb.from("xinix_strategy_state").select("strategy_id, cash, initial_capital, last_run_at"),
      sb.from("xinix_strategy_positions").select("strategy_id, return_usd, return_pct, entry_signal_types, entry_sector").not("closed_at","is",null),
      sb.from("xinix_strategy_positions").select("strategy_id, ticker, qty, avg_price").is("closed_at", null),
      sb.from("signal_price_summary").select("ticker, last_close"),
    ]);

    const priceMap = new Map<string, number>();
    for (const r of (summaryRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    // Aggregate per-strategy stats from closed positions
    type Agg = { realizedUsd: number; closed: number; wins: number; sumRetPct: number };
    const agg = new Map<number, Agg>();
    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const a = agg.get(sid) ?? { realizedUsd: 0, closed: 0, wins: 0, sumRetPct: 0 };
      a.realizedUsd += Number(p.return_usd ?? 0);
      a.closed++;
      if (Number(p.return_pct ?? 0) > 0) a.wins++;
      a.sumRetPct += Number(p.return_pct ?? 0);
      agg.set(sid, a);
    }

    // Open positions value per strategy
    const openVal = new Map<number, { val: number; cnt: number }>();
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const px = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      const mv = Number(p.qty) * px;
      const cur = openVal.get(sid) ?? { val: 0, cnt: 0 };
      cur.val += mv; cur.cnt++;
      openVal.set(sid, cur);
    }

    // Build per-strategy result
    const stateByStrat = new Map<number, Record<string, unknown>>();
    for (const s of (statesRes.data ?? [])) stateByStrat.set(s.strategy_id as number, s as Record<string, unknown>);

    interface StratResult {
      id: number; slug: string; name: string; grp: string; config: Record<string, unknown>;
      rank: number; medal: string | null;
      total_equity: number; total_return_pct: number; total_return_usd: number;
      realized_usd: number; unrealized_usd: number;
      open_count: number; closed_count: number;
      win_rate: number; avg_return_pct: number;
      last_run_at: string | null;
    }

    const results: StratResult[] = [];
    for (const strat of (stratRes.data ?? [])) {
      const sid = strat.id as number;
      const state = stateByStrat.get(sid);
      if (!state) continue;
      const cash = Number(state.cash);
      const initial = Number(state.initial_capital ?? 10000);
      const ov = openVal.get(sid);
      const posVal = ov?.val ?? 0;
      const openCnt = ov?.cnt ?? 0;
      const totalEquity = cash + posVal;
      const totalReturnUsd = totalEquity - initial;
      const totalReturnPct = initial > 0 ? (totalReturnUsd / initial) * 100 : 0;
      const a = agg.get(sid) ?? { realizedUsd: 0, closed: 0, wins: 0, sumRetPct: 0 };
      const unrealizedUsd = posVal - (openCnt * (initial / Math.max(1, (strat.config as Record<string, unknown>).maxPos as number))); // rough
      results.push({
        id: sid, slug: strat.slug as string, name: strat.name as string,
        grp: strat.grp as string, config: strat.config as Record<string, unknown>,
        rank: 0, medal: null,
        total_equity: totalEquity, total_return_pct: totalReturnPct, total_return_usd: totalReturnUsd,
        realized_usd: a.realizedUsd, unrealized_usd: unrealizedUsd,
        open_count: openCnt, closed_count: a.closed,
        win_rate: a.closed > 0 ? a.wins / a.closed : 0,
        avg_return_pct: a.closed > 0 ? a.sumRetPct / a.closed : 0,
        last_run_at: (state.last_run_at as string | null) ?? null,
      });
    }

    // Rank by total_return_pct (beste eerst)
    results.sort((a, b) => b.total_return_pct - a.total_return_pct);
    const n = results.length;
    results.forEach((r, i) => {
      r.rank = i + 1;
      // Medaille: top 10% → 🏆, volgende 20% → 🥈, volgende 30% → 🥉
      r.medal = i < Math.ceil(n * 0.10) ? "🏆"
              : i < Math.ceil(n * 0.30) ? "🥈"
              : i < Math.ceil(n * 0.60) ? "🥉"
              : null;
    });

    // ── Lerende inzichten per configuratie-dimensie ───────────────────────────
    // Voor elke dimensie: gemiddeld rendement per waarde, beste en slechtste
    type DimVal = { label: string; count: number; sumRet: number; sumWinRate: number };

    function dimensionInsight(dim: string, getValue: (cfg: Record<string, unknown>) => string | null) {
      const vals = new Map<string, DimVal>();
      for (const r of results) {
        const v = getValue(r.config);
        if (v == null) continue;
        const cur = vals.get(v) ?? { label: v, count: 0, sumRet: 0, sumWinRate: 0 };
        cur.count++; cur.sumRet += r.total_return_pct; cur.sumWinRate += r.win_rate;
        vals.set(v, cur);
      }
      const entries = [...vals.entries()]
        .map(([k, v]) => ({ value: k, count: v.count, avgRet: v.count > 0 ? v.sumRet / v.count : 0, avgWinRate: v.count > 0 ? v.sumWinRate / v.count : 0 }))
        .sort((a, b) => b.avgRet - a.avgRet);
      if (entries.length < 2) return null;
      const best = entries[0];
      const worst = entries[entries.length - 1];
      const diff = best.avgRet - worst.avgRet;
      if (Math.abs(diff) < 0.1) return null; // geen zinvol verschil
      return { dimension: dim, best: best.value, worst: worst.value, diff: Number(diff.toFixed(2)), entries };
    }

    const insights = [
      dimensionInsight("Score-drempel", (cfg) => cfg.minScore != null ? `≥${cfg.minScore}` : null),
      dimensionInsight("Tijdvenster (hold)", (cfg) => cfg.holdDays != null ? `${cfg.holdDays}d` : null),
      dimensionInsight("Stop-loss", (cfg) => cfg.stop != null ? `-${(Number(cfg.stop)*100).toFixed(0)}%` : "geen stop"),
      dimensionInsight("Take-profit", (cfg) => cfg.tp != null ? `+${(Number(cfg.tp)*100).toFixed(0)}%` : "geen TP"),
      dimensionInsight("Sector", (cfg) => (cfg.sector as string) || "all"),
      dimensionInsight("Max posities", (cfg) => cfg.maxPos != null ? `${cfg.maxPos} pos` : null),
      dimensionInsight("Positiegrootte", (cfg) => cfg.posSize != null ? `$${cfg.posSize}` : null),
      dimensionInsight("Rood-signaal vereist", (cfg) => cfg.redReq ? "Rood vereist" : "Rood optioneel"),
      dimensionInsight("Limiet-buffer", (cfg) => cfg.limitBuf != null ? `+${(Number(cfg.limitBuf)*100).toFixed(0)}%` : "geen limiet"),
      dimensionInsight("Min goud-medailles", (cfg) => cfg.minGold != null ? `≥${cfg.minGold} goud` : null),
    ].filter(Boolean);

    // ── Aanbevelingen voor het dashboard ─────────────────────────────────────
    const recommendations: string[] = [];
    for (const ins of insights) {
      if (!ins || ins.diff < 1.0) continue; // minder dan 1% verschil → niet relevant
      recommendations.push(`📊 **${ins.dimension}**: "${ins.best}" scoort gem. ${ins.diff > 0 ? "+" : ""}${ins.diff.toFixed(1)}% beter dan "${ins.worst}" — overweeg het dashboard hierop af te stellen.`);
    }
    if (results.length >= 10) {
      const top10 = results.slice(0, Math.ceil(n * 0.10));
      const bottom10 = results.slice(-Math.ceil(n * 0.10));
      // Wat hebben top-10 gemeen?
      const topGrps = new Map<string, number>();
      for (const r of top10) { topGrps.set(r.grp, (topGrps.get(r.grp) ?? 0) + 1); }
      const dominantGrp = [...topGrps.entries()].sort((a,b) => b[1]-a[1])[0];
      if (dominantGrp && dominantGrp[1] >= 3) {
        recommendations.push(`🏆 Groep "${dominantGrp[0]}" heeft ${dominantGrp[1]} van de top-${Math.ceil(n*0.10)} strategieën — de parameters in deze groep werken consistent goed.`);
      }
      // Sector die het beste scoort in top
      const topSectors = new Map<string, number>();
      for (const r of top10) { const s = (r.config.sector as string) || "all"; topSectors.set(s, (topSectors.get(s) ?? 0) + 1); }
      const bestSector = [...topSectors.entries()].sort((a,b) => b[1]-a[1])[0];
      if (bestSector && bestSector[0] !== "all" && bestSector[1] >= 3) {
        recommendations.push(`🎯 Sector "${bestSector[0]}" domineert de top-${Math.ceil(n*0.10)}: ${bestSector[1]} van de beste strategieën richten zich hierop. Overweeg de sector-weging in de score te verhogen.`);
      }
      // Verliezers — welke groep domineert de bodem?
      const btmGrps = new Map<string, number>();
      for (const r of bottom10) btmGrps.set(r.grp, (btmGrps.get(r.grp) ?? 0) + 1);
      const worstGrp = [...btmGrps.entries()].sort((a,b) => b[1]-a[1])[0];
      if (worstGrp && worstGrp[1] >= 3 && worstGrp[0] !== dominantGrp?.[0]) {
        recommendations.push(`⚠️ Groep "${worstGrp[0]}" heeft ${worstGrp[1]} van de slechtst presterende strategieën — wees voorzichtig met parameters uit deze hoek.`);
      }
    }
    if (recommendations.length === 0) {
      recommendations.push("⏳ Nog onvoldoende gesloten posities voor betrouwbare inzichten. Inzichten worden rijker na 30–60+ dagen.");
    }

    // Check last run
    const lastRun = results.find((r) => r.last_run_at)?.last_run_at ?? null;
    const runCount = results.filter((r) => r.closed_count > 0).length;

    return new Response(JSON.stringify({
      strategies: results,
      insights: insights.filter(Boolean),
      recommendations,
      meta: { total: results.length, last_run_at: lastRun, strategies_with_closed_positions: runCount },
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
  }
});
