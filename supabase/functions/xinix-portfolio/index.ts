// xinix-portfolio — read-only state van de fictieve $10K portefeuille.
// Geeft: state (cash, equity, return), open + gesloten posities (met
// huidige koers en P/L), equity-curve van laatste 90 dagen, en
// "lerende" inzichten per signal_type / sector op basis van gesloten
// posities (win-rate, gem. rendement). Geen auth nodig.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { TX_COST } from "../_shared/constants.ts";

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

interface OpenPosition {
  id: number;
  ticker: string;
  company: string | null;
  exchange: string | null;
  sector: string | null;
  qty: number;
  avg_price: number;
  current_price: number | null;
  cost_basis: number;
  market_value: number | null;
  unrealized_usd: number | null;
  unrealized_pct: number | null;
  entry_date: string;
  scheduled_exit_date: string;
  days_remaining: number;
  stop_loss_price: number | null;
  entry_reason: string;
  entry_signal_types: string[];
  entry_score: number | null;
}

interface ClosedPosition {
  id: number;
  ticker: string;
  company: string | null;
  qty: number;
  avg_price: number;
  closed_price: number;
  return_usd: number;
  return_pct: number;
  entry_date: string;
  closed_at: string;
  hold_days: number;
  entry_reason: string;
  closed_reason: string;
  entry_signal_types: string[];
  entry_sector: string | null;
}

interface SignalInsight {
  signal_type: string;
  closed_count: number;
  wins: number;
  win_rate: number;
  avg_return_pct: number;
  total_return_usd: number;
}

interface SectorInsight {
  sector: string;
  closed_count: number;
  wins: number;
  win_rate: number;
  avg_return_pct: number;
  total_return_usd: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const sb = getServiceClient();
    const [stateRes, openRes, closedRes, equityRes, tickersRes, summaryRes] = await Promise.all([
      sb.from("xinix_paper_state").select("*").eq("id", 1).single(),
      sb.from("xinix_paper_positions").select("*").is("closed_at", null).order("entry_date", { ascending: false }),
      sb.from("xinix_paper_positions").select("*").not("closed_at", "is", null).order("closed_at", { ascending: false }).limit(200),
      sb.from("xinix_paper_equity").select("date, cash, positions_value, total_equity, positions_count").order("date", { ascending: false }).limit(120),
      sb.from("signal_tickers").select("ticker, company, sector, exchange"),
      sb.from("signal_price_summary").select("ticker, last_close"),
    ]);

    if (stateRes.error || !stateRes.data) throw new Error(`state: ${stateRes.error?.message ?? "no state"}`);
    const state = stateRes.data as { cash: number; initial_capital: number; started_at: string; last_run_at: string | null };

    const tickerMeta = new Map<string, { company: string | null; sector: string | null; exchange: string | null }>();
    for (const t of (tickersRes.data ?? [])) {
      tickerMeta.set(t.ticker as string, {
        company: (t.company as string | null) ?? null,
        sector: (t.sector as string | null) ?? null,
        exchange: (t.exchange as string | null) ?? null,
      });
    }
    const priceByTicker = new Map<string, number>();
    for (const r of (summaryRes.data ?? [])) {
      if (r.last_close != null) priceByTicker.set(r.ticker as string, Number(r.last_close));
    }

    const now = Date.now();
    // die bij entry is betaald (cash -= qty × prijs × (1 + TX_COST)).
    const openPositions: OpenPosition[] = (openRes.data ?? []).map((p: Record<string, unknown>) => {
      const ticker = p.ticker as string;
      const qty = Number(p.qty);
      const avg = Number(p.avg_price);
      const cur = priceByTicker.get(ticker) ?? null;
      const cost = qty * avg * (1 + TX_COST);
      const mv = cur != null ? qty * cur : null;
      const unUsd = mv != null ? mv - cost : null;
      const unPct = mv != null && cost > 0 ? (unUsd! / cost) * 100 : null;
      const meta = tickerMeta.get(ticker);
      const exit = new Date(p.scheduled_exit_date as string).getTime();
      const days = Math.max(0, Math.ceil((exit - now) / 86_400_000));
      return {
        id: p.id as number,
        ticker,
        company: meta?.company ?? null,
        exchange: meta?.exchange ?? null,
        sector: meta?.sector ?? (p.entry_sector as string | null) ?? null,
        qty, avg_price: avg, current_price: cur,
        cost_basis: cost, market_value: mv,
        unrealized_usd: unUsd, unrealized_pct: unPct,
        entry_date: p.entry_date as string,
        scheduled_exit_date: p.scheduled_exit_date as string,
        days_remaining: days,
        stop_loss_price: p.stop_loss_price != null ? Number(p.stop_loss_price) : null,
        entry_reason: p.entry_reason as string,
        entry_signal_types: (p.entry_signal_types as string[]) ?? [],
        entry_score: p.entry_score != null ? Number(p.entry_score) : null,
      };
    });

    const closedPositions: ClosedPosition[] = (closedRes.data ?? []).map((p: Record<string, unknown>) => {
      const ticker = p.ticker as string;
      const meta = tickerMeta.get(ticker);
      return {
        id: p.id as number,
        ticker,
        company: meta?.company ?? null,
        qty: Number(p.qty), avg_price: Number(p.avg_price),
        closed_price: Number(p.closed_price),
        return_usd: Number(p.return_usd ?? 0),
        return_pct: Number(p.return_pct ?? 0),
        entry_date: p.entry_date as string,
        closed_at: p.closed_at as string,
        hold_days: Number(p.hold_days ?? 0),
        entry_reason: p.entry_reason as string,
        closed_reason: (p.closed_reason as string) ?? "",
        entry_signal_types: (p.entry_signal_types as string[]) ?? [],
        entry_sector: (p.entry_sector as string | null) ?? null,
      };
    });

    // ── Lerende inzichten per signal_type / sector ──
    const sigStats = new Map<string, { closed: number; wins: number; sumPct: number; sumUsd: number }>();
    const secStats = new Map<string, { closed: number; wins: number; sumPct: number; sumUsd: number }>();
    for (const c of closedPositions) {
      const types = c.entry_signal_types.length ? c.entry_signal_types : ["(geen signaal)"];
      for (const t of types) {
        const s = sigStats.get(t) ?? { closed: 0, wins: 0, sumPct: 0, sumUsd: 0 };
        s.closed++;
        if (c.return_pct > 0) s.wins++;
        s.sumPct += c.return_pct;
        s.sumUsd += c.return_usd;
        sigStats.set(t, s);
      }
      const sec = c.entry_sector ?? "other";
      const ss = secStats.get(sec) ?? { closed: 0, wins: 0, sumPct: 0, sumUsd: 0 };
      ss.closed++;
      if (c.return_pct > 0) ss.wins++;
      ss.sumPct += c.return_pct;
      ss.sumUsd += c.return_usd;
      secStats.set(sec, ss);
    }
    const signalInsights: SignalInsight[] = [...sigStats.entries()].map(([t, s]) => ({
      signal_type: t, closed_count: s.closed, wins: s.wins,
      win_rate: s.closed > 0 ? s.wins / s.closed : 0,
      avg_return_pct: s.closed > 0 ? s.sumPct / s.closed : 0,
      total_return_usd: s.sumUsd,
    })).sort((a, b) => b.closed_count - a.closed_count);
    const sectorInsights: SectorInsight[] = [...secStats.entries()].map(([sec, s]) => ({
      sector: sec, closed_count: s.closed, wins: s.wins,
      win_rate: s.closed > 0 ? s.wins / s.closed : 0,
      avg_return_pct: s.closed > 0 ? s.sumPct / s.closed : 0,
      total_return_usd: s.sumUsd,
    })).sort((a, b) => b.closed_count - a.closed_count);

    // ── AI-aanbevelingen op basis van >=3 gesloten posities per type ──
    const recommendations: string[] = [];
    for (const ins of signalInsights) {
      if (ins.closed_count < 3) continue;
      if (ins.win_rate < 0.4 && ins.avg_return_pct < 0) {
        recommendations.push(`⬇️ '${ins.signal_type}': ${(ins.win_rate * 100).toFixed(0)}% hit-rate, gem. ${ins.avg_return_pct.toFixed(1)}% — overweeg het signaal lager te wegen in de scoring of strenger te filteren.`);
      } else if (ins.win_rate >= 0.65 && ins.avg_return_pct > 10) {
        recommendations.push(`⬆️ '${ins.signal_type}': ${(ins.win_rate * 100).toFixed(0)}% hit-rate, gem. +${ins.avg_return_pct.toFixed(1)}% — sterk signaal, weeg dit zwaarder in de heat-bijdrage.`);
      }
    }
    // Sector-aanbeveling
    for (const sec of sectorInsights) {
      if (sec.closed_count < 3) continue;
      if (sec.avg_return_pct > 15) {
        recommendations.push(`💼 Sector '${sec.sector}' presteert sterk: ${(sec.win_rate * 100).toFixed(0)}% hit-rate, gem. +${sec.avg_return_pct.toFixed(1)}% — overweeg hierop te overwegen.`);
      } else if (sec.avg_return_pct < -10) {
        recommendations.push(`⚠️ Sector '${sec.sector}' presteert zwak: ${(sec.win_rate * 100).toFixed(0)}% hit-rate, gem. ${sec.avg_return_pct.toFixed(1)}% — overweeg te onderwegen of strenger te selecteren.`);
      }
    }
    // Holding-period inzicht: hoe lang houden winnaars het uit?
    const winners = closedPositions.filter((c) => c.return_pct > 0);
    const losers = closedPositions.filter((c) => c.return_pct < 0);
    if (winners.length >= 3 && losers.length >= 3) {
      const avgWinDays = winners.reduce((s, c) => s + c.hold_days, 0) / winners.length;
      const avgLossDays = losers.reduce((s, c) => s + c.hold_days, 0) / losers.length;
      if (avgWinDays < 30 && avgLossDays > 45) {
        recommendations.push(`⏱️ Winnaars piekten gemiddeld na ${avgWinDays.toFixed(0)}d, verliezers werden gemiddeld pas na ${avgLossDays.toFixed(0)}d gesloten — overweeg een kortere tijdvenster (bijv. 30-45 dagen).`);
      }
    }

    // ── Performance KPI's ──
    let positionsValue = 0;
    for (const op of openPositions) {
      if (op.market_value != null) positionsValue += op.market_value;
      else positionsValue += op.cost_basis; // fallback als prijs ontbreekt
    }
    const totalEquity = Number(state.cash) + positionsValue;
    const totalReturnUsd = totalEquity - Number(state.initial_capital);
    const totalReturnPct = Number(state.initial_capital) > 0
      ? (totalReturnUsd / Number(state.initial_capital)) * 100
      : 0;
    const realizedUsd = closedPositions.reduce((s, c) => s + c.return_usd, 0);
    const unrealizedUsd = openPositions.reduce((s, p) => s + (p.unrealized_usd ?? 0), 0);

    const equity = (equityRes.data ?? []).map((r: Record<string, unknown>) => ({
      date: r.date as string,
      cash: Number(r.cash),
      positions_value: Number(r.positions_value),
      total_equity: Number(r.total_equity),
      positions_count: Number(r.positions_count),
    })).reverse(); // oudste eerst voor de grafiek

    return new Response(JSON.stringify({
      state: {
        cash: Number(state.cash),
        initial_capital: Number(state.initial_capital),
        started_at: state.started_at,
        last_run_at: state.last_run_at,
        total_equity: totalEquity,
        positions_value: positionsValue,
        total_return_usd: totalReturnUsd,
        total_return_pct: totalReturnPct,
        realized_usd: realizedUsd,
        unrealized_usd: unrealizedUsd,
        open_count: openPositions.length,
        closed_count: closedPositions.length,
      },
      open_positions: openPositions,
      closed_positions: closedPositions,
      equity_history: equity,
      signal_insights: signalInsights,
      sector_insights: sectorInsights,
      recommendations,
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } }
    );
  }
});
