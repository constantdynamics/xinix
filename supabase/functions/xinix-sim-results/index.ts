// xinix-sim-results — rankings + lerende inzichten voor de 200-strategie simulatie.
// Geeft per strategie: rang, rendement, win-rate, medaille, generatie, bescherming.
// Geeft per configuratie-dimensie: welke waarde correleert met betere resultaten.
// Geeft evolutie-info: cycli, laatste cull, volgende verwachte cyclus, gepensioneerden.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { TX_COST } from "../_shared/constants.ts";

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
    const [stratRes, statesRes, closedRes, openRes, summaryRes, retiredRes, evolveRunRes, oldestStateRes, posDetailRes, famSeriesRes, posDaysRes, tickerMetaRes] = await Promise.all([
      sb.from("xinix_strategies").select("id, slug, name, grp, config, generation, protected, parent_id").eq("active", true),
      sb.from("xinix_strategy_state").select("strategy_id, cash, initial_capital, last_run_at, started_at"),
      sb.from("xinix_strategy_positions").select("strategy_id, ticker, return_usd, return_pct, entry_signal_types, entry_sector, closed_reason, qty, avg_price, partial_exits, entry_date, closed_at").not("closed_at","is",null),
      sb.from("xinix_strategy_positions").select("strategy_id, ticker, qty, avg_price, entry_signal_types, entry_sector, entry_date, entry_reason").is("closed_at", null),
      sb.from("signal_price_summary").select("ticker, last_close"),
      sb.from("xinix_strategies").select("id, slug, name, grp, generation, retired_at, config")
        .eq("active", false).order("retired_at", { ascending: false }).limit(30),
      sb.from("signal_runs").select("ran_at, message")
        .eq("job", "xinix-evolve").eq("ok", true)
        .order("ran_at", { ascending: false }).limit(10),
      sb.from("xinix_strategy_state").select("started_at")
        .order("started_at", { ascending: true }).limit(1),
      sb.from("xinix_strategy_positions")
        .select("strategy_id, ticker, entry_signal_types, entry_sector, entry_date, entry_reason, return_pct, closed_at, closed_reason")
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false })
        .limit(500),
      // Families-grafiek: per groep per handelsdag het gemiddelde rendement,
      // server-side geaggregeerd + gefilterd op echte handelsdagen via RPC.
      // NOOIT meer de volledige xinix_strategy_equity-tabel ophalen: dat liep
      // over de 10.000-rijenlimiet van de Data API (553 strategieën × dagen),
      // waardoor de laatste dag maar deels gevuld was en recente dagen wegvielen.
      // Zie migratie 2026-06-05_xinix_family_series_rpc.sql.
      sb.rpc("xinix_family_series", { p_max_days: 120 }),
      // Positieve-dagen per strategie (ook server-side geaggregeerd, zelfde reden).
      sb.rpc("xinix_strategy_positive_days"),
      // Datums waarop een ticker zijn feniks- of poefie-event had.
      // Gebruiken we voor date-overlap met de hold-periode van een
      // gesloten positie — eindelijk een accurate "capture"-teller.
      // Voor medailles en hikkertje-spikes hebben we geen earned-date;
      // die KPI's zijn vervangen door return-drempels.
      sb.from("signal_tickers")
        .select("ticker, phoenix_50x_date, poefie_last_date"),
    ]);

    type TickerDates = { phoenixDate: number | null; poefieDate: number | null };
    const tickerDates = new Map<string, TickerDates>();
    function parseDate(d: unknown): number | null {
      if (!d || typeof d !== "string") return null;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : null;
    }
    for (const r of (tickerMetaRes.data ?? [])) {
      tickerDates.set(r.ticker as string, {
        phoenixDate: parseDate(r.phoenix_50x_date),
        poefieDate:  parseDate(r.poefie_last_date),
      });
    }

    const priceMap = new Map<string, number>();
    for (const r of (summaryRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    type CloseReasonStat = { count: number; sumRetPct: number; sumUsd: number };
    type PartialStat = { count: number; sumQtyPct: number; sumTriggerPct: number; sumUsd: number };
    type Agg = {
      realizedUsd: number;
      closed: number;
      wins: number;
      sumRetPct: number;
      // Drempel-tellers: gesloten posities met return_pct ≥ N%.
      // Hogere drempels (200%, 500%) zijn vervangers voor de oude
      // medaille-tellers, omdat we geen "medaille verdiend op"-datum hebben.
      wins5: number; wins10: number; wins25: number; wins50: number;
      wins100: number; wins200: number; wins500: number;
      // Voor mediaan + best/slechtste trade
      returns: number[];
      bestRetPct: number;
      worstRetPct: number;
      // Profit factor: som winsten ($) / som verliezen ($, absoluut)
      sumWinUsd: number;
      sumLossUsd: number;  // positief; absolute waarde
      // Capture-tellers — DATE-OVERLAP based: een feniks/poefie geldt als
      // "gevangen" wanneer de respectievelijke event-datum binnen de
      // hold-periode van de positie viel.
      tickers: Set<string>;
      phoenixCaptured: Set<string>;
      poefieCaptured: Set<string>;
      // Exit-strategie breakdown
      byCloseReason: Map<string, CloseReasonStat>;
      // Deelwinst-verkopen aggregaten
      partial: PartialStat;
    };

    function newAgg(): Agg {
      return {
        realizedUsd: 0, closed: 0, wins: 0, sumRetPct: 0,
        wins5: 0, wins10: 0, wins25: 0, wins50: 0, wins100: 0, wins200: 0, wins500: 0,
        returns: [], bestRetPct: -Infinity, worstRetPct: Infinity,
        sumWinUsd: 0, sumLossUsd: 0,
        tickers: new Set(), phoenixCaptured: new Set(), poefieCaptured: new Set(),
        byCloseReason: new Map(),
        partial: { count: 0, sumQtyPct: 0, sumTriggerPct: 0, sumUsd: 0 },
      };
    }

    const agg = new Map<number, Agg>();
    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      let a = agg.get(sid);
      if (!a) { a = newAgg(); agg.set(sid, a); }
      const usd = Number(p.return_usd ?? 0);
      const r = Number(p.return_pct ?? 0);
      a.realizedUsd += usd;
      a.closed++;
      if (r > 0) a.wins++;
      if (r >= 5)   a.wins5++;
      if (r >= 10)  a.wins10++;
      if (r >= 25)  a.wins25++;
      if (r >= 50)  a.wins50++;
      if (r >= 100) a.wins100++;
      if (r >= 200) a.wins200++;
      if (r >= 500) a.wins500++;
      a.sumRetPct += r;
      a.returns.push(r);
      if (r > a.bestRetPct) a.bestRetPct = r;
      if (r < a.worstRetPct) a.worstRetPct = r;
      if (usd >= 0) a.sumWinUsd += usd; else a.sumLossUsd += -usd;

      // Date-overlap capture: viel de feniks-/poefie-datum binnen de
      // hold-periode van deze positie? Pas dan "gevangen" — als de event
      // ooit later (na sluiting) gebeurde telt die NIET.
      const t = (p.ticker as string) ?? "";
      if (t) {
        a.tickers.add(t);
        const dates = tickerDates.get(t);
        const entry = parseDate(p.entry_date);
        const close = parseDate(p.closed_at);
        if (dates && entry != null && close != null) {
          if (dates.phoenixDate != null && dates.phoenixDate >= entry && dates.phoenixDate <= close) {
            a.phoenixCaptured.add(t);
          }
          if (dates.poefieDate != null && dates.poefieDate >= entry && dates.poefieDate <= close) {
            a.poefieCaptured.add(t);
          }
        }
      }

      // Exit-strategie aggregaat
      const reason = (p.closed_reason as string) ?? "onbekend";
      const cr = a.byCloseReason.get(reason) ?? { count: 0, sumRetPct: 0, sumUsd: 0 };
      cr.count++; cr.sumRetPct += r; cr.sumUsd += usd;
      a.byCloseReason.set(reason, cr);

      // Deelwinst-verkopen: partial_exits is JSONB array [{qty_sold, net_proceeds, at, reason}]
      const partials = p.partial_exits as Array<{ qty_sold?: number; net_proceeds?: number; at?: string; reason?: string }> | null;
      if (Array.isArray(partials) && partials.length > 0) {
        const origQty = Number(p.qty ?? 0) + partials.reduce((s, x) => s + Number(x.qty_sold ?? 0), 0);
        for (const x of partials) {
          a.partial.count++;
          const qty = Number(x.qty_sold ?? 0);
          a.partial.sumQtyPct += origQty > 0 ? (qty / origQty) * 100 : 0;
          a.partial.sumUsd += Number(x.net_proceeds ?? 0);
        }
      }
    }

    type OpenDetail = { ticker: string; entry_signal_types: string[]; entry_sector: string | null; entry_date: string; entry_reason: string };
    type ClosedDetail = OpenDetail & { return_pct: number; closed_at: string; closed_reason: string };

    // TX_COST komt uit _shared/constants.ts — gebruikt om de echte cost basis
    // te bepalen i.p.v. een schatting (initial / maxPos).
    const openVal = new Map<number, { val: number; cnt: number; cost: number }>();
    const openDetailMap = new Map<number, OpenDetail[]>();
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const qty = Number(p.qty);
      const avg = Number(p.avg_price);
      const px = priceMap.get(p.ticker as string) ?? avg;
      const mv = qty * px;
      const cost = qty * avg * (1 + TX_COST);
      const cur = openVal.get(sid) ?? { val: 0, cnt: 0, cost: 0 };
      cur.val += mv; cur.cnt++; cur.cost += cost;
      openVal.set(sid, cur);
      const d = openDetailMap.get(sid) ?? [];
      d.push({
        ticker: p.ticker as string,
        entry_signal_types: (p.entry_signal_types as string[]) ?? [],
        entry_sector: (p.entry_sector as string) ?? null,
        entry_date: (p.entry_date as string) ?? "",
        entry_reason: (p.entry_reason as string) ?? "",
      });
      openDetailMap.set(sid, d);
      // Open posities ook meetellen in unique-tickers en in capture
      // (event-datum mag ook na entry vallen — positie is nog niet
      // gesloten, dus elke event-datum tussen entry en nu telt).
      const tk = (p.ticker as string) ?? "";
      if (tk) {
        let a = agg.get(sid);
        if (!a) { a = newAgg(); agg.set(sid, a); }
        a.tickers.add(tk);
        const dates = tickerDates.get(tk);
        const entry = parseDate(p.entry_date);
        const nowMs = Date.now();
        if (dates && entry != null) {
          if (dates.phoenixDate != null && dates.phoenixDate >= entry && dates.phoenixDate <= nowMs) {
            a.phoenixCaptured.add(tk);
          }
          if (dates.poefieDate != null && dates.poefieDate >= entry && dates.poefieDate <= nowMs) {
            a.poefieCaptured.add(tk);
          }
        }
      }
    }

    const closedDetailMap = new Map<number, ClosedDetail[]>();
    for (const p of (posDetailRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const d = closedDetailMap.get(sid) ?? [];
      if (d.length < 5) {
        d.push({
          ticker: p.ticker as string,
          entry_signal_types: (p.entry_signal_types as string[]) ?? [],
          entry_sector: (p.entry_sector as string) ?? null,
          entry_date: (p.entry_date as string) ?? "",
          entry_reason: (p.entry_reason as string) ?? "",
          return_pct: Number(p.return_pct ?? 0),
          closed_at: (p.closed_at as string) ?? "",
          closed_reason: (p.closed_reason as string) ?? "",
        });
        closedDetailMap.set(sid, d);
      }
    }

    const stateByStrat = new Map<number, Record<string, unknown>>();
    for (const s of (statesRes.data ?? [])) stateByStrat.set(s.strategy_id as number, s as Record<string, unknown>);

    // Positieve-dagen per strategie: aandeel equity-snapshots waar
    // total_equity > initial_capital. Server-side geaggregeerd via de RPC
    // xinix_strategy_positive_days zodat de 10k-rijenlimiet niet meer bijt.
    type PosDays = { pos: number; total: number };
    const posDaysByStrat = new Map<number, PosDays>();
    for (const r of (posDaysRes.data ?? [])) {
      posDaysByStrat.set(r.strategy_id as number, {
        pos: Number(r.pos_days ?? 0),
        total: Number(r.total_days ?? 0),
      });
    }

    interface ExitReason { reason: string; count: number; avg_return_pct: number; sum_usd: number }
    interface StratResult {
      id: number; slug: string; name: string; grp: string; config: Record<string, unknown>;
      generation: number; protected: boolean; parent_id: number | null;
      rank: number; medal: string | null;
      total_equity: number; total_return_pct: number; total_return_usd: number;
      realized_usd: number; unrealized_usd: number;
      open_count: number; closed_count: number;
      win_rate: number; avg_return_pct: number;
      // Aandeel gesloten posities met return ≥ N% (0..1).
      win_rate_5pct: number; win_rate_10pct: number; win_rate_25pct: number; win_rate_50pct: number; win_rate_100pct: number;
      // Absolute aantallen trades met ≥X% rendement (vervangen de oude
      // misleidende medaille-tellers).
      trades_50pct_count: number;
      trades_100pct_count: number;
      trades_200pct_count: number;
      trades_500pct_count: number;
      // Aandeel equity-snapshots waarop de portefeuille positief stond (0..1).
      positive_days_pct: number; total_days: number;
      // Nieuwe KPI's
      median_return_pct: number;
      best_trade_pct: number;
      worst_trade_pct: number;
      profit_factor: number;       // som winsten $ / som verliezen $
      expectancy_pct: number;      // verwachte % per trade (= avg_return_pct)
      unique_tickers: number;
      // Capture op date-overlap: event-datum binnen hold-periode.
      phoenix_captured: number;
      poefie_captured: number;
      // Exit-strategie: per reden teller + gemiddelde return
      exit_reasons: ExitReason[];
      // Deelwinsten: aantal partials + gem. verkochte % per partial
      partial_count: number;
      partial_avg_qty_pct: number;
      partial_total_usd: number;
      last_run_at: string | null;
      open_pos_detail: OpenDetail[];
      closed_pos_detail: ClosedDetail[];
    }

    function median(arr: number[]): number {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
      const openCost = ov?.cost ?? 0;
      const totalEquity = cash + posVal;
      const totalReturnUsd = totalEquity - initial;
      const totalReturnPct = initial > 0 ? (totalReturnUsd / initial) * 100 : 0;
      const a = agg.get(sid) ?? newAgg();
      // Marktwaarde open posities − werkelijke aankoopkost (incl. transactiekosten).
      const unrealizedUsd = posVal - openCost;
      const pd = posDaysByStrat.get(sid) ?? { pos: 0, total: 0 };
      const exitReasons: ExitReason[] = [...a.byCloseReason.entries()]
        .map(([reason, v]) => ({
          reason,
          count: v.count,
          avg_return_pct: v.count > 0 ? v.sumRetPct / v.count : 0,
          sum_usd: v.sumUsd,
        }))
        .sort((x, y) => y.count - x.count);
      // Profit factor: behandel "geen verliezen" als zeer hoog (toon ∞ in UI).
      const profitFactor = a.sumLossUsd > 0 ? a.sumWinUsd / a.sumLossUsd : (a.sumWinUsd > 0 ? Number.POSITIVE_INFINITY : 0);
      results.push({
        id: sid, slug: strat.slug as string, name: strat.name as string,
        grp: strat.grp as string, config: strat.config as Record<string, unknown>,
        generation: (strat.generation as number) ?? 1,
        protected: (strat.protected as boolean) ?? false,
        parent_id: (strat.parent_id as number | null) ?? null,
        rank: 0, medal: null,
        total_equity: totalEquity, total_return_pct: totalReturnPct, total_return_usd: totalReturnUsd,
        realized_usd: a.realizedUsd, unrealized_usd: unrealizedUsd,
        open_count: openCnt, closed_count: a.closed,
        win_rate: a.closed > 0 ? a.wins / a.closed : 0,
        avg_return_pct: a.closed > 0 ? a.sumRetPct / a.closed : 0,
        win_rate_5pct:   a.closed > 0 ? a.wins5   / a.closed : 0,
        win_rate_10pct:  a.closed > 0 ? a.wins10  / a.closed : 0,
        win_rate_25pct:  a.closed > 0 ? a.wins25  / a.closed : 0,
        win_rate_50pct:  a.closed > 0 ? a.wins50  / a.closed : 0,
        win_rate_100pct: a.closed > 0 ? a.wins100 / a.closed : 0,
        trades_50pct_count:  a.wins50,
        trades_100pct_count: a.wins100,
        trades_200pct_count: a.wins200,
        trades_500pct_count: a.wins500,
        positive_days_pct: pd.total > 0 ? pd.pos / pd.total : 0,
        total_days: pd.total,
        median_return_pct: median(a.returns),
        best_trade_pct: a.bestRetPct === -Infinity ? 0 : a.bestRetPct,
        worst_trade_pct: a.worstRetPct === Infinity ? 0 : a.worstRetPct,
        profit_factor: Number.isFinite(profitFactor) ? profitFactor : 999,
        expectancy_pct: a.closed > 0 ? a.sumRetPct / a.closed : 0,
        unique_tickers: a.tickers.size,
        phoenix_captured: a.phoenixCaptured.size,
        poefie_captured: a.poefieCaptured.size,
        exit_reasons: exitReasons,
        partial_count: a.partial.count,
        partial_avg_qty_pct: a.partial.count > 0 ? a.partial.sumQtyPct / a.partial.count : 0,
        partial_total_usd: a.partial.sumUsd,
        last_run_at: (state.last_run_at as string | null) ?? null,
        open_pos_detail: openDetailMap.get(sid) ?? [],
        closed_pos_detail: closedDetailMap.get(sid) ?? [],
      });
    }

    results.sort((a, b) => b.total_return_pct - a.total_return_pct);
    const n = results.length;
    results.forEach((r, i) => {
      r.rank = i + 1;
      r.medal = i < Math.ceil(n * 0.10) ? "🏆"
              : i < Math.ceil(n * 0.30) ? "🥈"
              : i < Math.ceil(n * 0.60) ? "🥉"
              : null;
    });

    // ── Lerende inzichten per configuratie-dimensie ───────────────────────────
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
      if (Math.abs(diff) < 0.1) return null;
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

    // ── Aanbevelingen ─────────────────────────────────────────────────────────
    const recommendations: string[] = [];
    for (const ins of insights) {
      if (!ins || ins.diff < 1.0) continue;
      recommendations.push(`📊 **${ins.dimension}**: "${ins.best}" scoort gem. ${ins.diff > 0 ? "+" : ""}${ins.diff.toFixed(1)}% beter dan "${ins.worst}" — overweeg het dashboard hierop af te stellen.`);
    }
    if (results.length >= 10) {
      const top10 = results.slice(0, Math.ceil(n * 0.10));
      const bottom10 = results.slice(-Math.ceil(n * 0.10));
      const topGrps = new Map<string, number>();
      for (const r of top10) { topGrps.set(r.grp, (topGrps.get(r.grp) ?? 0) + 1); }
      const dominantGrp = [...topGrps.entries()].sort((a,b) => b[1]-a[1])[0];
      if (dominantGrp && dominantGrp[1] >= 3) {
        recommendations.push(`🏆 Groep "${dominantGrp[0]}" heeft ${dominantGrp[1]} van de top-${Math.ceil(n*0.10)} strategieën — de parameters in deze groep werken consistent goed.`);
      }
      const topSectors = new Map<string, number>();
      for (const r of top10) { const s = (r.config.sector as string) || "all"; topSectors.set(s, (topSectors.get(s) ?? 0) + 1); }
      const bestSector = [...topSectors.entries()].sort((a,b) => b[1]-a[1])[0];
      if (bestSector && bestSector[0] !== "all" && bestSector[1] >= 3) {
        recommendations.push(`🎯 Sector "${bestSector[0]}" domineert de top-${Math.ceil(n*0.10)}: ${bestSector[1]} van de beste strategieën richten zich hierop.`);
      }
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

    // ── Signal-type statistieken (over alle strategieën, alle gesloten posities) ──
    const sigStats = new Map<string, { count: number; wins: number; sumRet: number }>();
    for (const p of (closedRes.data ?? [])) {
      const signals = (p.entry_signal_types as string[]) ?? [];
      const ret = Number(p.return_pct ?? 0);
      for (const s of signals) {
        if (!s) continue;
        const cur = sigStats.get(s) ?? { count: 0, wins: 0, sumRet: 0 };
        cur.count++;
        if (ret > 0) cur.wins++;
        cur.sumRet += ret;
        sigStats.set(s, cur);
      }
    }
    const signal_type_stats = [...sigStats.entries()]
      .map(([signal_type, v]) => ({
        signal_type,
        count: v.count,
        win_rate: v.count > 0 ? v.wins / v.count : 0,
        avg_return_pct: v.count > 0 ? v.sumRet / v.count : 0,
      }))
      .filter((v) => v.count >= 3)
      .sort((a, b) => b.avg_return_pct - a.avg_return_pct);

    // ── Evolutie-metadata ─────────────────────────────────────────────────────
    const evolveRuns = evolveRunRes.data ?? [];
    const lastEvolveAt = evolveRuns[0]?.ran_at ?? null;
    const oldestStartedAt = (oldestStateRes.data?.[0] as Record<string, unknown> | undefined)?.started_at as string | null ?? null;

    // Volgende evolutie: 180 dagen na laatste cyclus (of na startdatum als nog geen cyclus)
    let nextEvolveApprox: string | null = null;
    const base = lastEvolveAt ?? oldestStartedAt;
    if (base) {
      const d = new Date(base);
      d.setDate(d.getDate() + 180);
      nextEvolveApprox = d.toISOString();
    }

    const protectedCount = results.filter(r => r.protected).length;
    const maxGeneration  = Math.max(...results.map(r => r.generation ?? 1), 1);

    const lastRun = results.find((r) => r.last_run_at)?.last_run_at ?? null;
    const runCount = results.filter((r) => r.closed_count > 0).length;

    // ── Families: per-groep gemiddelde return-tijdreeks per handelsdag ─────
    // Komt server-side geaggregeerd + handelsdag-gefilterd uit de RPC
    // xinix_family_series: geen weekenden, geen dagen zonder koersbeweging
    // (stale data), en geen 10k-rijenlimiet meer. De portefeuilles handelen
    // internationaal (VS/CA/UK/DE/AU/HK), dus de RPC gebruikt bewust GEEN
    // vaste VS-feestdagkalender maar werkelijke koersbeweging als maatstaf.
    // seriesByGrp[grp][date] = { avg, n }.
    const seriesByGrp = new Map<string, Map<string, { avg: number; n: number }>>();
    const dateSet = new Set<string>();
    for (const r of (famSeriesRes.data ?? [])) {
      const grp = r.grp as string;
      const date = r.d as string;
      dateSet.add(date);
      let perGrp = seriesByGrp.get(grp);
      if (!perGrp) { perGrp = new Map(); seriesByGrp.set(grp, perGrp); }
      perGrp.set(date, { avg: Number(r.avg_return_pct), n: Number(r.n ?? 0) });
    }
    const allDates = [...dateSet].sort();

    // Per groep ook de huidige (laatste-dag) gemiddelde return, # strategieën,
    // beste en slechtste binnen de groep.
    const grpStats = new Map<string, { n: number; sumRetPct: number; best: number; worst: number; bestSlug: string | null; worstSlug: string | null }>();
    for (const r of results) {
      const g = r.grp;
      const cur = grpStats.get(g) ?? { n: 0, sumRetPct: 0, best: -Infinity, worst: Infinity, bestSlug: null, worstSlug: null };
      cur.n++;
      cur.sumRetPct += r.total_return_pct;
      if (r.total_return_pct > cur.best) { cur.best = r.total_return_pct; cur.bestSlug = r.slug; }
      if (r.total_return_pct < cur.worst) { cur.worst = r.total_return_pct; cur.worstSlug = r.slug; }
      grpStats.set(g, cur);
    }
    const families = [...grpStats.entries()]
      .map(([grp, s]) => {
        const series = seriesByGrp.get(grp);
        const points = allDates.map((d) => {
          const cur = series?.get(d);
          return cur ? { date: d, avg_return_pct: cur.avg, n: cur.n } : { date: d, avg_return_pct: null, n: 0 };
        });
        return {
          grp,
          n: s.n,
          avg_return_pct: s.n > 0 ? s.sumRetPct / s.n : 0,
          best_return_pct: s.best === -Infinity ? null : s.best,
          best_slug: s.bestSlug,
          worst_return_pct: s.worst === Infinity ? null : s.worst,
          worst_slug: s.worstSlug,
          series: points,
        };
      })
      .sort((a, b) => b.avg_return_pct - a.avg_return_pct);

    return new Response(JSON.stringify({
      strategies: results,
      insights: insights.filter(Boolean),
      recommendations,
      signal_type_stats,
      families: { groups: families, dates: allDates },
      meta: { total: results.length, last_run_at: lastRun, strategies_with_closed_positions: runCount },
      evolution: {
        cycles:            evolveRuns.length,
        max_generation:    maxGeneration,
        protected_count:   protectedCount,
        last_at:           lastEvolveAt,
        cycle_start:       base,
        next_approx:       nextEvolveApprox,
        retired:           (retiredRes.data ?? []).map(r => ({
          id:          r.id,
          slug:        r.slug,
          name:        r.name,
          grp:         r.grp,
          generation:  r.generation ?? 1,
          retired_at:  r.retired_at,
          holdDays:    (r.config as Record<string, unknown>).holdDays,
          sector:      (r.config as Record<string, unknown>).sector,
        })),
        run_log: evolveRuns.map(r => ({ at: r.ran_at, message: r.message })),
      },
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
  }
});
