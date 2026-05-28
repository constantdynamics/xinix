// xinix-equity-backfill — reconstrueert historische dagelijkse equity
// per strategie en voor de single paper portfolio met terugwerkende kracht.
//
// Werking: voor elke positie (open + gesloten) bouwen we een tijdslijn van
// cash-mutaties (entry-cost, partial-proceeds, close-proceeds). Voor elke
// handelsdag (bepaald door de werkelijke Yahoo-bars die we ophalen) berekenen
// we per strategie:
//   cash_D      = initial_capital + Σ mutaties met date ≤ D
//   holdings_D = posities met entry_date ≤ D, qty na partials ≤ D, niet gesloten ≤ D
//   posVal_D    = Σ qty × close_price(ticker, D)   (close ≤ D als geen exacte match)
//   equity_D    = cash_D + posVal_D
// Geen fictieve nieuwe buys/sells — alleen mark-to-market op werkelijke posities.
//
// Idempotent: upsert op (strategy_id, date) overschrijft kapotte snapshots,
// voegt missende dagen toe. Voor de paper portfolio: upsert op (date).

import { getServiceClient, type RunResult } from "../_shared/supabase.ts";
import { runBackground } from "../_shared/runner.ts";
import { TX_COST } from "../_shared/constants.ts";

interface PositionRow {
  strategy_id?: number;
  ticker: string;
  qty: number | string;
  avg_price: number | string;
  entry_date: string;
  closed_at: string | null;
  closed_price: number | string | null;
  return_usd: number | string | null;
  partial_exits: Array<{ at?: string; qty_sold?: number; net_proceeds?: number }> | null;
}

interface ParsedPosition {
  ticker: string;
  origQty: number;
  avgPrice: number;
  entryDate: string;       // YYYY-MM-DD
  closedAt: string | null; // YYYY-MM-DD
  closedPrice: number | null;
  partials: Array<{ at: string; qty: number; net: number }>;
}

function ymd(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function parsePosition(p: PositionRow): ParsedPosition {
  const partialsRaw = Array.isArray(p.partial_exits) ? p.partial_exits : [];
  const partials = partialsRaw
    .filter((x) => x && x.at)
    .map((x) => ({
      at: ymd(x.at!) ?? "",
      qty: Number(x.qty_sold ?? 0),
      net: Number(x.net_proceeds ?? 0),
    }))
    .filter((x) => x.at);
  const currentQty = Number(p.qty);
  const origQty = currentQty + partials.reduce((s, x) => s + x.qty, 0);
  return {
    ticker: p.ticker,
    origQty,
    avgPrice: Number(p.avg_price),
    entryDate: ymd(p.entry_date) ?? "",
    closedAt: ymd(p.closed_at),
    closedPrice: p.closed_price != null ? Number(p.closed_price) : null,
    partials,
  };
}

async function fetchYahooCloses(ticker: string): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; XinixBackfill/1.0; +https://github.com)" };
  let lastErr: Error | null = null;
  for (const host of ["query1", "query2"]) {
    try {
      const u = url.replace("query1", host);
      const res = await fetch(u, { headers });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const json = await res.json() as {
        chart: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>; error?: { description?: string } | null };
      };
      const result = json.chart.result?.[0];
      if (!result) { lastErr = new Error(json.chart.error?.description ?? "no result"); continue; }
      const ts = result.timestamp ?? [];
      const cs = result.indicators?.quote?.[0]?.close ?? [];
      const map = new Map<string, number>();
      for (let i = 0; i < ts.length; i++) {
        const c = cs[i];
        if (typeof c === "number" && Number.isFinite(c)) {
          const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
          map.set(d, c);
        }
      }
      return map;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("yahoo fetch failed");
}

// Geeft de close-prijs op `date`, of de laatste bekende close vóór `date`.
// Loopt tot 14 dagen terug (overbrugt feestdagen + lange weekends).
function priceOnOrBefore(closes: Map<string, number>, date: string, fallback: number): number {
  if (closes.size === 0) return fallback;
  if (closes.has(date)) return closes.get(date)!;
  const d = new Date(date + "T00:00:00Z");
  for (let i = 1; i <= 14; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const k = d.toISOString().slice(0, 10);
    if (closes.has(k)) return closes.get(k)!;
  }
  return fallback;
}

interface EquityRow {
  strategy_id?: number;
  date: string;
  cash: number;
  positions_value: number;
  total_equity: number;
  positions_count: number;
  computed_at: string;
}

function computeEquityRows(
  positions: ParsedPosition[],
  initialCapital: number,
  startDate: string,
  dateList: string[],
  closesByTicker: Map<string, Map<string, number>>,
  computedAt: string,
  strategyId?: number,
): EquityRow[] {
  const rows: EquityRow[] = [];
  for (const date of dateList) {
    if (date < startDate) continue;
    let cash = initialCapital;
    let posVal = 0;
    let posCount = 0;
    for (const pos of positions) {
      if (!pos.entryDate || pos.entryDate > date) continue;
      // Initiele aankoopkosten incl. transactiekosten
      cash -= pos.origQty * pos.avgPrice * (1 + TX_COST);
      // Pas partials toe die ≤ date plaatsvonden
      let qty = pos.origQty;
      for (const pe of pos.partials) {
        if (pe.at <= date) {
          qty -= pe.qty;
          cash += pe.net;
        }
      }
      // Volledig gesloten?
      if (pos.closedAt != null && pos.closedAt <= date) {
        const closePx = pos.closedPrice ?? priceOnOrBefore(closesByTicker.get(pos.ticker) ?? new Map(), pos.closedAt, pos.avgPrice);
        cash += qty * closePx * (1 - TX_COST);
        qty = 0;
      }
      if (qty > 0) {
        const px = priceOnOrBefore(closesByTicker.get(pos.ticker) ?? new Map(), date, pos.avgPrice);
        posVal += qty * px;
        posCount++;
      }
    }
    const totalEquity = cash + posVal;
    rows.push({
      strategy_id: strategyId,
      date,
      cash: Number(cash.toFixed(2)),
      positions_value: Number(posVal.toFixed(2)),
      total_equity: Number(totalEquity.toFixed(4)),
      positions_count: posCount,
      computed_at: computedAt,
    });
  }
  return rows;
}

async function logic(): Promise<RunResult> {
  const sb = getServiceClient();
  const computedAt = new Date().toISOString();
  const today = computedAt.slice(0, 10);

  // 1) Strategieën + state + posities (alles, open én gesloten)
  const [stratRes, stateRes, posRes, paperStateRes, paperPosRes] = await Promise.all([
    sb.from("xinix_strategies").select("id, grp").eq("active", true),
    sb.from("xinix_strategy_state").select("strategy_id, initial_capital, started_at"),
    sb.from("xinix_strategy_positions").select("strategy_id, ticker, qty, avg_price, entry_date, closed_at, closed_price, return_usd, partial_exits"),
    sb.from("xinix_paper_state").select("*").eq("id", 1).maybeSingle(),
    sb.from("xinix_paper_positions").select("ticker, qty, avg_price, entry_date, closed_at, closed_price, return_usd, partial_exits"),
  ]);

  if (stratRes.error) throw new Error(`strategies: ${stratRes.error.message}`);
  if (stateRes.error) throw new Error(`state: ${stateRes.error.message}`);
  if (posRes.error)   throw new Error(`positions: ${posRes.error.message}`);

  const activeStratIds = new Set<number>((stratRes.data ?? []).map((r) => r.id as number));

  type StratInfo = { initial: number; started: string };
  const stateByStrat = new Map<number, StratInfo>();
  let earliestStarted = today;
  for (const r of (stateRes.data ?? [])) {
    const sid = r.strategy_id as number;
    if (!activeStratIds.has(sid)) continue;
    const started = ymd((r.started_at as string) ?? "") ?? "2026-05-13";
    stateByStrat.set(sid, {
      initial: Number(r.initial_capital ?? 10000),
      started,
    });
    if (started < earliestStarted) earliestStarted = started;
  }

  // 2) Posities per strategie + unieke ticker-set
  const posByStrat = new Map<number, ParsedPosition[]>();
  const tickerSet = new Set<string>();
  let earliestEntry = today;
  for (const p of ((posRes.data ?? []) as PositionRow[])) {
    const sid = p.strategy_id as number;
    if (!activeStratIds.has(sid)) continue;
    const parsed = parsePosition(p);
    if (!parsed.entryDate) continue;
    if (parsed.entryDate < earliestEntry) earliestEntry = parsed.entryDate;
    tickerSet.add(parsed.ticker);
    const arr = posByStrat.get(sid) ?? [];
    arr.push(parsed);
    posByStrat.set(sid, arr);
  }

  // Paper portfolio posities
  const paperPositions: ParsedPosition[] = ((paperPosRes.data ?? []) as PositionRow[])
    .map(parsePosition)
    .filter((p) => p.entryDate);
  for (const p of paperPositions) {
    tickerSet.add(p.ticker);
    if (p.entryDate < earliestEntry) earliestEntry = p.entryDate;
  }
  const paperState = paperStateRes.data as Record<string, unknown> | null;
  const paperInitial = paperState ? Number(paperState.initial_capital ?? 10000) : 10000;
  const paperStarted = ymd((paperState?.started_at as string) ?? "") ?? earliestEntry;

  const globalStart = earliestStarted < earliestEntry ? earliestStarted : earliestEntry;

  // 3) Yahoo bars per unieke ticker (parallel, gelimiteerd)
  const tickerList = [...tickerSet];
  const closesByTicker = new Map<string, Map<string, number>>();
  let fetchOk = 0, fetchFail = 0;
  const failSamples: string[] = [];
  const CONCURRENCY = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < tickerList.length) {
      const i = cursor++;
      const t = tickerList[i];
      try {
        const m = await fetchYahooCloses(t);
        closesByTicker.set(t, m);
        fetchOk++;
      } catch (e) {
        fetchFail++;
        if (failSamples.length < 10) failSamples.push(`${t}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickerList.length) }, () => worker()));

  // 4) Verzamel handelsdagen uit ALLE bars (union), filter op range
  const dateSet = new Set<string>();
  for (const closes of closesByTicker.values()) {
    for (const d of closes.keys()) {
      if (d >= globalStart && d <= today) dateSet.add(d);
    }
  }
  // Voeg vandaag toe als trading day ontbreekt — geeft altijd minstens 1 punt
  if (dateSet.size === 0) dateSet.add(today);
  const dateList = [...dateSet].sort();

  // 5) Reken equity per strategie + upsert in batches
  let stratRowsWritten = 0;
  const stratBatch: EquityRow[] = [];
  for (const [sid, positions] of posByStrat) {
    const info = stateByStrat.get(sid);
    if (!info) continue;
    const rows = computeEquityRows(positions, info.initial, info.started, dateList, closesByTicker, computedAt, sid);
    stratBatch.push(...rows);
  }
  // Voeg ook strategieën zonder posities toe — die hebben gewoon cash = initial
  for (const [sid, info] of stateByStrat) {
    if (posByStrat.has(sid)) continue;
    for (const d of dateList) {
      if (d < info.started) continue;
      stratBatch.push({
        strategy_id: sid, date: d,
        cash: info.initial, positions_value: 0,
        total_equity: info.initial, positions_count: 0,
        computed_at: computedAt,
      });
    }
  }
  for (let i = 0; i < stratBatch.length; i += 500) {
    const slice = stratBatch.slice(i, i + 500);
    const { error } = await sb.from("xinix_strategy_equity").upsert(slice, { onConflict: "strategy_id,date" });
    if (error) throw new Error(`strategy_equity upsert: ${error.message}`);
    stratRowsWritten += slice.length;
  }

  // 6) Paper portfolio equity
  let paperRowsWritten = 0;
  if (paperPositions.length > 0 || paperState) {
    const paperRows = computeEquityRows(paperPositions, paperInitial, paperStarted, dateList, closesByTicker, computedAt)
      .map(({ strategy_id: _ignore, ...rest }) => rest);
    for (let i = 0; i < paperRows.length; i += 500) {
      const slice = paperRows.slice(i, i + 500);
      const { error } = await sb.from("xinix_paper_equity").upsert(slice, { onConflict: "date" });
      if (error) throw new Error(`paper_equity upsert: ${error.message}`);
      paperRowsWritten += slice.length;
    }
  }

  const msg = `${stratRowsWritten} strat-rijen + ${paperRowsWritten} paper-rijen over ${dateList.length} dagen (${dateList[0] ?? "?"} → ${dateList[dateList.length - 1] ?? "?"}). Yahoo: ${fetchOk} ok / ${fetchFail} fail van ${tickerList.length} tickers.`;
  return {
    ok: true,
    message: msg,
    metrics: {
      tickers: tickerList.length,
      yahoo_ok: fetchOk,
      yahoo_fail: fetchFail,
      yahoo_fail_samples: failSamples,
      strategies: posByStrat.size,
      strategies_total: stateByStrat.size,
      paper_positions: paperPositions.length,
      dates: dateList.length,
      date_from: dateList[0] ?? null,
      date_to: dateList[dateList.length - 1] ?? null,
      strategy_equity_rows: stratRowsWritten,
      paper_equity_rows: paperRowsWritten,
    },
  };
}

Deno.serve(runBackground("xinix-equity-backfill", logic));
