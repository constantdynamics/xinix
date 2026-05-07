// Briefing fase 1: voor elke actieve ticker een S/C/T scoring berekenen
// en wegschrijven naar signal_scores. Draait dagelijks 06:00 UTC, na
// compute-signals (05:00) zodat verse pre-catalyst signal events al in
// signal_events staan.
//
// Mode: trader (default — owner doel is swing trade, briefing §1.1).
// Investor mode kan triggered worden via ?mode=investor query op de
// trigger endpoint, dan worden beide modes opgeslagen.

import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { getWeights, type Mode } from "./_lib/scoring/weights.mts";
import { aggregate, buildSubScore } from "./_lib/scoring/aggregator.mts";
import {
  classify,
  type CatalystRow,
  type ClassifyContext,
  type MacroRow,
  type PriceSummary,
  type TickerRow,
} from "./_lib/scoring/classify.mts";
import { buildTradeSetup } from "./_lib/scoring/trade_setup.mts";
import { expectedOutcome } from "./_lib/scoring/expected_outcome.mts";

async function scoreOneTicker(
  supabase: ReturnType<typeof getServiceClient>,
  ticker: TickerRow,
  catalysts: CatalystRow[],
  price: PriceSummary | null,
  macro: MacroRow[],
  recentSignalTypes: Set<string>,
  mode: Mode,
  scanDate: string
): Promise<boolean> {
  const weights = getWeights(ticker.sector, mode);
  const ctx: ClassifyContext = {
    ticker,
    catalysts,
    price,
    macro,
    recentSignalTypes,
  };
  const c = classify(ctx);

  const structural = buildSubScore(weights.structural, c.triggeredStructural);
  const catalyst = buildSubScore(weights.catalyst, c.triggeredCatalyst);
  const timing = buildSubScore(weights.timing, c.triggeredTiming);

  const result = aggregate(
    structural,
    catalyst,
    timing,
    weights,
    c.triggeredRiskAdjusters,
    c.cyclePhase,
    mode
  );

  // Build TradeSetup for trader mode and BUY+ actions
  let tradeSetup = null;
  if (
    mode === "trader" &&
    (result.action === "BUY" || result.action === "STRONG_BUY") &&
    price?.last_close
  ) {
    tradeSetup = buildTradeSetup({
      currentPrice: price.last_close,
      catalystType: c.nearestCatalyst?.type ?? null,
      daysUntilCatalyst: c.nearestCatalyst?.daysUntil ?? null,
      finalScore: result.finalScore,
      sector: ticker.sector,
    });
  }

  // ExpectedOutcome (briefing §6.1.5/6) — ook bij WATCH zodat owner ziet
  // WAAROM watch (lage baseline hit-rate of zwakke catalyst type).
  let expOut = null;
  if (
    (result.action === "BUY" ||
      result.action === "STRONG_BUY" ||
      result.action === "WATCH") &&
    c.nearestCatalyst?.type
  ) {
    expOut = expectedOutcome({
      sector: ticker.sector,
      catalystType: c.nearestCatalyst.type,
      daysUntilCatalyst: c.nearestCatalyst.daysUntil ?? null,
      currentPrice: price?.last_close ?? null,
    });
  }

  const { error } = await supabase.from("signal_scores").upsert(
    {
      ticker: ticker.ticker,
      sector: ticker.sector,
      scan_date: scanDate,
      mode,
      structural: structural.normalized,
      catalyst: catalyst.normalized,
      timing: timing.normalized,
      confluence: result.confluence,
      risk_penalty: result.riskPenalty,
      cycle_multiplier: result.cycleMultiplier,
      final_score: result.finalScore,
      action: result.action,
      flagged_warnings: result.warnings,
      components: {
        structural: structural.components,
        catalyst: catalyst.components,
        timing: timing.components,
        nearest_catalyst: c.nearestCatalyst,
      },
      trade_setup: tradeSetup,
      expected_outcome: expOut,
      data_completeness: c.dataCompleteness,
    },
    { onConflict: "ticker,scan_date,mode" }
  );
  if (error) {
    console.error(`score upsert ${ticker.ticker}:`, error.message);
    return false;
  }
  return true;
}

export default async () => {
  await logRun("compute-scores", async () => {
    const supabase = getServiceClient();
    const scanDate = new Date().toISOString().slice(0, 10);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: tickers }, { data: catalysts }, { data: prices }, { data: macroRaw }, { data: events }] =
      await Promise.all([
        supabase.from("signal_tickers").select("*").eq("active", true),
        supabase.from("signal_catalysts").select("*").eq("status", "pending"),
        supabase.from("signal_price_summary").select("*"),
        supabase
          .from("signal_macro")
          .select("symbol, date, pct_change_30d, pct_change_90d, pct_change_365d")
          .order("date", { ascending: false }),
        supabase
          .from("signal_events")
          .select("ticker, signal_type")
          .gt("detected_at", since30),
      ]);

    // signal_macro heeft meerdere rijen per symbool (één per dag) — pak
    // alleen de meest recente per symbool.
    const latestMacro = new Map<string, MacroRow>();
    for (const m of (macroRaw ?? []) as (MacroRow & { date: string })[]) {
      if (!latestMacro.has(m.symbol)) latestMacro.set(m.symbol, m);
    }
    const macro = [...latestMacro.values()];

    if (!tickers || tickers.length === 0) {
      return { ok: true, message: "no active tickers", metrics: { scored: 0 } };
    }

    const catByTicker = new Map<string, CatalystRow[]>();
    for (const c of (catalysts ?? []) as CatalystRow[]) {
      const arr = catByTicker.get(c.ticker);
      if (arr) arr.push(c);
      else catByTicker.set(c.ticker, [c]);
    }
    const priceByTicker = new Map<string, PriceSummary>();
    for (const p of (prices ?? []) as PriceSummary[]) priceByTicker.set(p.ticker, p);
    const sigByTicker = new Map<string, Set<string>>();
    for (const e of events ?? []) {
      const s = sigByTicker.get(e.ticker) ?? new Set<string>();
      s.add(e.signal_type);
      sigByTicker.set(e.ticker, s);
    }

    // Cap op #tickers per run — Netlify background functions hebben 15min
    // limit. Bij 500+ tickers + Yahoo throttling van pollers loopt dit aan.
    // Cap is ruim boven huidige watchlist (49) en logt de skip helder.
    const MAX_TICKERS_PER_RUN = 400;
    const allTickers = tickers as TickerRow[];
    const toScore = allTickers.slice(0, MAX_TICKERS_PER_RUN);
    const skipped = allTickers.length - toScore.length;
    if (skipped > 0) {
      console.warn(
        `compute-scores: ${skipped} tickers overslagen (cap=${MAX_TICKERS_PER_RUN}). Verhoog limit of split in twee runs.`
      );
    }

    let scored = 0;
    let failed = 0;
    for (const t of toScore) {
      const ok = await scoreOneTicker(
        supabase,
        t,
        catByTicker.get(t.ticker) ?? [],
        priceByTicker.get(t.ticker) ?? null,
        (macro ?? []) as MacroRow[],
        sigByTicker.get(t.ticker) ?? new Set(),
        "trader",
        scanDate
      );
      if (ok) scored++;
      else failed++;
    }

    return {
      ok: failed < toScore.length / 2,
      message: `${scored} scored, ${failed} failed, ${skipped} skipped`,
      metrics: { scored, failed, skipped },
    };
  });
};

export const config: Config = {
  schedule: "0 6 * * *",
};
