// xinix-knowledge-export — Maandelijkse kenniscumulatie-snapshot
//
// Compileert een volledig beeld van:
//   - Alle 100 strategieën (config + performance + generatie-historie)
//   - Gepensioneerde strategieën
//   - Alle gesloten posities (uitgesplitst per signaal + sector)
//   - Huidige open posities
//   - Watchlist (alle tickers met limieten, medailles, sector, company, notes)
//   - Configuratie-inzichten (welke parameterwaarden presteren het best)
//   - Evolutie-log
//   - Automatisch gegenereerde samenvatting (markdown)
//
// GET  /xinix-knowledge-export            → lijst van eerdere exports
// GET  /xinix-knowledge-export?id=N       → JSON van een specifieke export
// POST /xinix-knowledge-export            → maak nieuwe export (cron of admin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function sb() {
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
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const NTFY_TOPIC  = Deno.env.get("NTFY_TOPIC")      ?? "";
const NTFY_BASE   = "https://ntfy.sh";
const RESEND_KEY  = Deno.env.get("RESEND_API_KEY")  ?? "";
const RESEND_FROM = "Xinix <noreply@constantdynamics.nl>";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")   ?? "";

async function sendNtfy(title: string, message: string, clickUrl?: string) {
  if (!NTFY_TOPIC) return;
  const payload: Record<string, unknown> = { topic: NTFY_TOPIC, title, message, priority: 3, tags: ["chart_with_upwards_trend"] };
  if (clickUrl) { payload.click = clickUrl; payload.actions = [{ action: "view", label: "Open dashboard", url: clickUrl, clear: false }]; }
  await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
}

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND_KEY || !to) return;
  function esc(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;font-size:13px;white-space:pre-wrap;max-width:720px">${
    esc(text).replace(/https?:\/\/[^\s<"]+/g, u => `<a href="${u}" style="color:#3b82f6">${u}</a>`)
  }</body></html>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, text, html }),
  }).catch(() => {});
}

// ── Samenvatting genereren ─────────────────────────────────────────────────────

function buildSummary(data: Record<string, unknown>, now: Date): string {
  const strategies = data.strategies as Record<string, unknown>;
  const active = (strategies.active as unknown[]) ?? [];
  const retired = (strategies.retired as unknown[]) ?? [];
  const evo = strategies.evolution as Record<string, unknown>;
  const positions = data.positions as Record<string, unknown>;
  const watchlist = data.watchlist as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown>;
  const insights = (data.config_insights as unknown[]) ?? [];

  const dateStr = now.toLocaleDateString("nl-NL", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  lines.push(`# Xinix Kennisexport — ${dateStr}`);
  lines.push(`Gegenereerd: ${now.toISOString()}`);
  lines.push("");

  lines.push("## Strategieën");
  lines.push(`- **${active.length} actieve strategieën** in simulatie`);
  lines.push(`- ${(summary.strategies_in_profit as number) ?? 0} in winst (${Math.round(((summary.strategies_in_profit as number) ?? 0) / Math.max(1, active.length) * 100)}%), ${(summary.strategies_at_loss as number) ?? 0} in verlies`);
  lines.push(`- Mediaan rendement: ${((summary.median_return_pct as number) ?? 0).toFixed(2)}%`);
  lines.push(`- Beste: **${summary.best_strategy_name ?? "—"}** (+${((summary.best_strategy_return as number) ?? 0).toFixed(2)}%)`);
  lines.push(`- Slechtste: **${summary.worst_strategy_name ?? "—"}** (${((summary.worst_strategy_return as number) ?? 0).toFixed(2)}%)`);
  if ((evo.cycles as number) > 0) {
    lines.push(`- Evolutie: ${evo.cycles} cycli, max generatie Gen-${evo.max_generation}, ${retired.length} gepensioneerd`);
  }
  lines.push("");

  lines.push("## Posities");
  lines.push(`- ${(positions.closed_count as number) ?? 0} gesloten trades in totaal`);
  lines.push(`- ${(positions.open_count as number) ?? 0} open posities nu`);
  if ((positions.closed_count as number) > 0) {
    lines.push(`- Algehele hitrate: ${Math.round(((summary.overall_win_rate as number) ?? 0) * 100)}%`);
    const bySig = (positions.closed_by_signal as Record<string, Record<string, number>>) ?? {};
    const topSigs = Object.entries(bySig)
      .filter(([,v]) => v.count >= 3)
      .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct)
      .slice(0, 3);
    if (topSigs.length > 0) {
      lines.push(`- Beste signaaltype: **${topSigs[0][0]}** — gem. +${(topSigs[0][1].avg_return_pct ?? 0).toFixed(1)}%, ${topSigs[0][1].count} trades`);
    }
    const bySector = (positions.closed_by_sector as Record<string, Record<string, number>>) ?? {};
    const topSectors = Object.entries(bySector)
      .filter(([,v]) => v.count >= 3)
      .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct)
      .slice(0, 2);
    if (topSectors.length > 0) {
      lines.push(`- Beste sector: **${topSectors[0][0]}** — gem. +${(topSectors[0][1].avg_return_pct ?? 0).toFixed(1)}%`);
    }
  }
  lines.push("");

  lines.push("## Configuratie-inzichten");
  if (insights.length === 0) {
    lines.push("Nog onvoldoende data voor configuratie-inzichten.");
  } else {
    for (const ins of insights.slice(0, 5)) {
      const i = ins as Record<string, unknown>;
      lines.push(`- **${i.dimension}**: "${i.best_value}" scoort +${((i.diff_pct as number) ?? 0).toFixed(1)}% beter dan "${i.worst_value}"`);
    }
  }
  lines.push("");

  lines.push("## Watchlist");
  lines.push(`- ${(watchlist.total as number) ?? 0} tickers (${(watchlist.active as number) ?? 0} actief, ${(watchlist.benched as number) ?? 0} op de bank)`);
  lines.push(`- ${(watchlist.with_buy_limit as number) ?? 0} tickers met een buy-limit ingesteld`);
  const bySect = (watchlist.by_sector as Record<string, number>) ?? {};
  for (const [sector, count] of Object.entries(bySect)) {
    lines.push(`  - ${sector}: ${count} tickers`);
  }
  lines.push("");

  lines.push("---");
  lines.push("Download de volledige JSON via het dashboard > 100 Strategieën > Evolutie > Kennis-export.");

  return lines.join("\n");
}

// ── Dimsnion insight helper (same as in sim-results but returns simple object) ─

function dimensionInsight(
  results: Array<{ config: Record<string, unknown>; total_return_pct: number }>,
  dim: string,
  getValue: (cfg: Record<string, unknown>) => string | null,
) {
  const vals = new Map<string, { sumRet: number; cnt: number }>();
  for (const r of results) {
    const v = getValue(r.config);
    if (v == null) continue;
    const cur = vals.get(v) ?? { sumRet: 0, cnt: 0 };
    cur.sumRet += r.total_return_pct; cur.cnt++;
    vals.set(v, cur);
  }
  const entries = [...vals.entries()]
    .map(([k, v]) => ({ value: k, avgRet: v.cnt > 0 ? v.sumRet / v.cnt : 0 }))
    .sort((a, b) => b.avgRet - a.avgRet);
  if (entries.length < 2) return null;
  const best = entries[0]; const worst = entries[entries.length - 1];
  const diff = best.avgRet - worst.avgRet;
  if (Math.abs(diff) < 0.5) return null;
  return { dimension: dim, best_value: best.value, worst_value: worst.value, diff_pct: +diff.toFixed(2) };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const db = sb();
  const url = new URL(req.url);

  try {
    // GET: lijst of download
    if (req.method === "GET") {
      const id = url.searchParams.get("id");

      if (id) {
        // Download specifieke export
        const { data, error } = await db.from("xinix_knowledge_exports")
          .select("*").eq("id", parseInt(id)).single();
        if (error || !data) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...cors(req), "content-type": "application/json" } });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...cors(req),
            "content-type": "application/json",
            "content-disposition": `attachment; filename="xinix-export-${id}-${new Date((data as Record<string, unknown>).exported_at as string).toISOString().slice(0,10)}.json"`,
          },
        });
      }

      // Lijst van exports (zonder export_data om bandbreedte te sparen)
      const { data, error } = await db.from("xinix_knowledge_exports")
        .select("id, exported_at, period_start, period_end, type, strategy_count, ticker_count, closed_positions_count, open_positions_count, best_strategy_name, best_strategy_return, worst_strategy_name, worst_strategy_return, avg_portfolio_return, strategies_in_profit, evolution_cycles, summary")
        .order("exported_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return new Response(JSON.stringify({ exports: data ?? [] }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
    }

    // POST: maak nieuwe export
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

    const now = new Date();

    // ── Parallel queries ────────────────────────────────────────────────────────
    const [
      stratRes, stateRes, closedRes, openRes,
      retiredRes, evolveRes, tickerRes, priceRes,
    ] = await Promise.all([
      db.from("xinix_strategies")
        .select("id, slug, name, grp, config, generation, protected, parent_id, active")
        .eq("active", true),
      db.from("xinix_strategy_state")
        .select("strategy_id, cash, initial_capital, started_at, last_run_at"),
      db.from("xinix_strategy_positions")
        .select("strategy_id, ticker, return_usd, return_pct, entry_signal_types, entry_sector, entry_date, closed_at, entry_reason, closed_reason")
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false }),
      db.from("xinix_strategy_positions")
        .select("strategy_id, ticker, qty, avg_price, entry_date, entry_signal_types, entry_sector")
        .is("closed_at", null),
      db.from("xinix_strategies")
        .select("id, name, grp, generation, retired_at, config")
        .eq("active", false)
        .order("retired_at", { ascending: false })
        .limit(100),
      db.from("signal_runs")
        .select("ran_at, message")
        .eq("job", "xinix-evolve").eq("ok", true)
        .order("ran_at", { ascending: false }).limit(20),
      db.from("signal_tickers")
        .select("ticker, company, sector, buy_limit, medal_gold, medal_silver, medal_bronze, goud_score, active, price_benched, notes, exchange, goud_type, trigger_event, trigger_date, market_cap_bucket, phase, disease_area, modality, commodity, jurisdiction"),
      db.from("signal_price_summary")
        .select("ticker, last_close"),
    ]);

    // ── Price map ────────────────────────────────────────────────────────────────
    const priceMap = new Map<string, number>();
    for (const r of (priceRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    // ── State map ───────────────────────────────────────────────────────────────
    const stateMap = new Map<number, Record<string, unknown>>();
    for (const s of (stateRes.data ?? [])) stateMap.set(s.strategy_id as number, s as Record<string, unknown>);

    // ── Open positions per strategy ─────────────────────────────────────────────
    const openByStrat = new Map<number, { val: number; cnt: number }>();
    const openList: unknown[] = [];
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const px = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      const cur = openByStrat.get(sid) ?? { val: 0, cnt: 0 };
      cur.val += Number(p.qty) * px; cur.cnt++;
      openByStrat.set(sid, cur);
      openList.push({ strategy_id: sid, ticker: p.ticker, qty: p.qty, avg_price: p.avg_price, entry_date: p.entry_date, entry_signal_types: p.entry_signal_types, entry_sector: p.entry_sector });
    }

    // ── Closed positions aggregation ─────────────────────────────────────────────
    const closedBySig = new Map<string, { cnt: number; wins: number; sumRet: number }>();
    const closedBySector = new Map<string, { cnt: number; wins: number; sumRet: number }>();
    const closedByStrat = new Map<number, { cnt: number; wins: number; sumRet: number; totalRetUsd: number }>();
    const allClosed: unknown[] = [];

    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const ret = Number(p.return_pct ?? 0);
      const retUsd = Number(p.return_usd ?? 0);
      const win = ret > 0;

      // by strategy
      const sc = closedByStrat.get(sid) ?? { cnt: 0, wins: 0, sumRet: 0, totalRetUsd: 0 };
      sc.cnt++; if (win) sc.wins++; sc.sumRet += ret; sc.totalRetUsd += retUsd;
      closedByStrat.set(sid, sc);

      // by signal
      for (const sig of ((p.entry_signal_types as string[]) ?? [])) {
        const s = closedBySig.get(sig) ?? { cnt: 0, wins: 0, sumRet: 0 };
        s.cnt++; if (win) s.wins++; s.sumRet += ret;
        closedBySig.set(sig, s);
      }

      // by sector
      const sect = (p.entry_sector as string) || "other";
      const ss = closedBySector.get(sect) ?? { cnt: 0, wins: 0, sumRet: 0 };
      ss.cnt++; if (win) ss.wins++; ss.sumRet += ret;
      closedBySector.set(sect, ss);

      allClosed.push({
        strategy_id: sid, ticker: p.ticker,
        return_pct: ret, return_usd: retUsd,
        entry_date: p.entry_date, closed_at: p.closed_at,
        entry_signal_types: p.entry_signal_types,
        entry_reason: p.entry_reason, closed_reason: p.closed_reason,
      });
    }

    // sort: best trades + worst trades
    const sortedClosed = [...allClosed].sort((a, b) => (b as Record<string,number>).return_pct - (a as Record<string,number>).return_pct);
    const bestTrades  = sortedClosed.slice(0, 10);
    const worstTrades = sortedClosed.slice(-10).reverse();

    // ── Strategy performance ─────────────────────────────────────────────────────
    type StratPerf = {
      id: number; slug: string; name: string; grp: string;
      generation: number; protected: boolean; config: unknown;
      total_equity: number; total_return_pct: number;
      open_count: number; closed_count: number;
      win_rate: number; avg_return_pct: number;
      started_at: string | null; last_run_at: string | null;
    };

    const activeStrategies: StratPerf[] = [];
    for (const strat of (stratRes.data ?? [])) {
      const sid = strat.id as number;
      const state = stateMap.get(sid);
      if (!state) continue;
      const cash = Number(state.cash);
      const initial = Number(state.initial_capital ?? 10000);
      const ov = openByStrat.get(sid);
      const totalEquity = cash + (ov?.val ?? 0);
      const cStat = closedByStrat.get(sid) ?? { cnt: 0, wins: 0, sumRet: 0, totalRetUsd: 0 };
      activeStrategies.push({
        id: sid, slug: strat.slug as string, name: strat.name as string,
        grp: strat.grp as string, generation: (strat.generation as number) ?? 1,
        protected: (strat.protected as boolean) ?? false,
        config: strat.config,
        total_equity: +totalEquity.toFixed(2),
        total_return_pct: +((totalEquity - initial) / initial * 100).toFixed(4),
        open_count: ov?.cnt ?? 0,
        closed_count: cStat.cnt,
        win_rate: cStat.cnt > 0 ? +(cStat.wins / cStat.cnt).toFixed(4) : 0,
        avg_return_pct: cStat.cnt > 0 ? +(cStat.sumRet / cStat.cnt).toFixed(4) : 0,
        started_at: (state.started_at as string) ?? null,
        last_run_at: (state.last_run_at as string) ?? null,
      });
    }
    activeStrategies.sort((a, b) => b.total_return_pct - a.total_return_pct);
    activeStrategies.forEach((s, i) => { (s as Record<string,unknown>).rank = i + 1; });

    // ── Portfolio summary stats ──────────────────────────────────────────────────
    const returns = activeStrategies.map(s => s.total_return_pct).sort((a, b) => a - b);
    const median = returns.length > 0 ? returns[Math.floor(returns.length / 2)] : 0;
    const inProfit = returns.filter(r => r > 0).length;
    const inLoss   = returns.filter(r => r < 0).length;
    const totalClosed = allClosed.length;
    const totalWins = (closedRes.data ?? []).filter(p => Number(p.return_pct ?? 0) > 0).length;
    const overallWinRate = totalClosed > 0 ? totalWins / totalClosed : 0;
    const avgPortfolioReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

    // ── Watchlist ────────────────────────────────────────────────────────────────
    const tickers = (tickerRes.data ?? []).map(t => ({
      ticker: t.ticker,
      company: t.company,
      sector: t.sector,
      exchange: t.exchange,
      buy_limit: t.buy_limit,
      medal_gold: t.medal_gold,
      medal_silver: t.medal_silver,
      medal_bronze: t.medal_bronze,
      goud_score: t.goud_score,
      goud_type: t.goud_type,
      active: t.active,
      benched: t.price_benched,
      notes: t.notes,
      last_close: priceMap.get(t.ticker as string) ?? null,
      // Biotech-specifiek
      phase: t.phase,
      disease_area: t.disease_area,
      modality: t.modality,
      trigger_event: t.trigger_event,
      trigger_date: t.trigger_date,
      market_cap_bucket: t.market_cap_bucket,
      // Mining-specifiek
      commodity: t.commodity,
      jurisdiction: t.jurisdiction,
    }));

    const watchlistBySector: Record<string, number> = {};
    for (const t of tickers) {
      const s = (t.sector as string) || "other";
      watchlistBySector[s] = (watchlistBySector[s] ?? 0) + 1;
    }

    // ── Config insights ─────────────────────────────────────────────────────────
    const cfgInsights = [
      dimensionInsight(activeStrategies, "Score-drempel",     cfg => cfg.minScore != null ? `≥${cfg.minScore}` : null),
      dimensionInsight(activeStrategies, "Tijdvenster (hold)", cfg => cfg.holdDays != null ? `${cfg.holdDays}d` : null),
      dimensionInsight(activeStrategies, "Stop-loss",          cfg => cfg.stop != null ? `-${(Number(cfg.stop)*100).toFixed(0)}%` : "geen stop"),
      dimensionInsight(activeStrategies, "Take-profit",        cfg => cfg.tp != null ? `+${(Number(cfg.tp)*100).toFixed(0)}%` : "geen TP"),
      dimensionInsight(activeStrategies, "Sector",             cfg => (cfg.sector as string) || "all"),
      dimensionInsight(activeStrategies, "Max posities",       cfg => cfg.maxPos != null ? `${cfg.maxPos} pos` : null),
      dimensionInsight(activeStrategies, "Positiegrootte",     cfg => cfg.posSize != null ? `$${cfg.posSize}` : null),
      dimensionInsight(activeStrategies, "Rood-signaal vereist", cfg => cfg.redReq ? "Rood vereist" : "Rood optioneel"),
      dimensionInsight(activeStrategies, "Limiet-buffer",       cfg => cfg.limitBuf != null ? `+${(Number(cfg.limitBuf)*100).toFixed(0)}%` : "geen limiet"),
      dimensionInsight(activeStrategies, "Min goud-medailles",  cfg => cfg.minGold != null ? `≥${cfg.minGold} goud` : null),
    ].filter(Boolean);

    // ── Evolutie ─────────────────────────────────────────────────────────────────
    const evolveRuns = evolveRes.data ?? [];
    const maxGen = Math.max(...activeStrategies.map(s => s.generation), 1);
    const protectedCount = activeStrategies.filter(s => s.protected).length;

    // ── Samenvoegen tot export ───────────────────────────────────────────────────
    const exportData = {
      meta: {
        exported_at: now.toISOString(),
        period_start: null as string | null,
        period_end: now.toISOString(),
        type: "manual",
        version: 1,
      },
      strategies: {
        active: activeStrategies,
        retired: (retiredRes.data ?? []).map(r => ({
          id: r.id, name: r.name, grp: r.grp, generation: r.generation ?? 1,
          retired_at: r.retired_at, config: r.config,
        })),
        evolution: {
          cycles: evolveRuns.length,
          max_generation: maxGen,
          protected_count: protectedCount,
          last_evolved_at: evolveRuns[0]?.ran_at ?? null,
          run_log: evolveRuns.map(r => ({ at: r.ran_at, message: r.message })),
        },
      },
      positions: {
        open_count: openList.length,
        open_positions: openList,
        closed_count: totalClosed,
        closed_by_strategy: Object.fromEntries(
          [...closedByStrat.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            total_return_usd: +v.totalRetUsd.toFixed(2),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        closed_by_signal: Object.fromEntries(
          [...closedBySig.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        closed_by_sector: Object.fromEntries(
          [...closedBySector.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        best_trades: bestTrades,
        worst_trades: worstTrades,
      },
      watchlist: {
        total: tickers.length,
        active: tickers.filter(t => t.active).length,
        benched: tickers.filter(t => t.benched).length,
        with_buy_limit: tickers.filter(t => t.buy_limit != null).length,
        by_sector: watchlistBySector,
        tickers,
      },
      config_insights: cfgInsights,
      summary: {
        best_strategy_name: activeStrategies[0]?.name ?? null,
        best_strategy_return: activeStrategies[0]?.total_return_pct ?? null,
        worst_strategy_name: activeStrategies[activeStrategies.length - 1]?.name ?? null,
        worst_strategy_return: activeStrategies[activeStrategies.length - 1]?.total_return_pct ?? null,
        median_return_pct: +median.toFixed(4),
        avg_portfolio_return: +avgPortfolioReturn.toFixed(4),
        strategies_in_profit: inProfit,
        strategies_at_loss: inLoss,
        total_closed_trades: totalClosed,
        overall_win_rate: +overallWinRate.toFixed(4),
      },
    };

    // Bereken period_start: vorige maand 1e dag
    const ps = new Date(now);
    ps.setDate(1); ps.setMonth(ps.getMonth() - 1); ps.setHours(0,0,0,0);
    exportData.meta.period_start = ps.toISOString();

    // ── Markdown samenvatting ────────────────────────────────────────────────────
    const summaryText = buildSummary(exportData as unknown as Record<string, unknown>, now);

    // ── Opslaan in DB ─────────────────────────────────────────────────────────────
    const { data: savedRow, error: saveErr } = await db.from("xinix_knowledge_exports").insert({
      exported_at: now.toISOString(),
      period_start: exportData.meta.period_start,
      period_end: now.toISOString(),
      type: "monthly_auto",
      strategy_count: activeStrategies.length,
      ticker_count: tickers.length,
      closed_positions_count: totalClosed,
      open_positions_count: openList.length,
      best_strategy_name: exportData.summary.best_strategy_name,
      best_strategy_return: exportData.summary.best_strategy_return,
      worst_strategy_name: exportData.summary.worst_strategy_name,
      worst_strategy_return: exportData.summary.worst_strategy_return,
      avg_portfolio_return: exportData.summary.avg_portfolio_return,
      strategies_in_profit: inProfit,
      evolution_cycles: evolveRuns.length,
      export_data: exportData,
      summary: summaryText,
    }).select("id").single();

    if (saveErr) console.error("save error:", saveErr.message);
    const savedId = (savedRow as Record<string,unknown> | null)?.id as number | null;

    // ── Log in signal_runs ────────────────────────────────────────────────────────
    await db.from("signal_runs").insert({
      job: "xinix-knowledge-export", ok: true,
      message: `Export #${savedId ?? "?"}: ${activeStrategies.length} strategieën, ${totalClosed} gesloten trades, ${tickers.length} tickers`,
    });

    // ── Notificaties ─────────────────────────────────────────────────────────────
    const best = exportData.summary;
    const notifMsg = `${activeStrategies.length} strategieën · ${totalClosed} gesloten trades · beste: ${best.best_strategy_name} +${(best.best_strategy_return ?? 0).toFixed(1)}% · mediaan: ${median.toFixed(1)}%`;
    await Promise.all([
      sendNtfy("📊 Xinix maandelijkse kennisexport", notifMsg),
      sendEmail(NOTIFY_EMAIL, `📊 Xinix kennisexport — ${now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" })}`, summaryText),
    ]);

    return new Response(JSON.stringify({
      ok: true,
      export_id: savedId,
      strategy_count: activeStrategies.length,
      ticker_count: tickers.length,
      closed_positions_count: totalClosed,
      best_strategy: { name: best.best_strategy_name, return_pct: best.best_strategy_return },
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("knowledge-export error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
  }
});
