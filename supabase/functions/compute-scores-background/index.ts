import { getServiceClient } from "../_shared/supabase.ts";
import { runBackground } from "../_shared/runner.ts";
import { getWeights, type Mode } from "../_shared/scoring/weights.ts";
import { aggregate, buildSubScore } from "../_shared/scoring/aggregator.ts";
import {
  classify,
  type CatalystRow,
  type ClassifyContext,
  type MacroRow,
  type PriceSummary,
  type TickerRow,
} from "../_shared/scoring/classify.ts";
import { buildTradeSetup } from "../_shared/scoring/trade_setup.ts";
import { expectedOutcome } from "../_shared/scoring/expected_outcome.ts";

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

Deno.serve(
  runBackground("compute-scores", async () => {
    const supabase = getServiceClient();
    const scanDate = new Date().toISOString().slice(0, 10);
    const since30 = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const [
      { data: tickers },
      { data: catalysts },
      { data: prices },
      { data: macroRaw },
      { data: events },
    ] = await Promise.all([
      supabase.from("signal_tickers").select("*").eq("active", true),
      supabase.from("signal_catalysts").select("*").eq("status", "pending"),
      supabase.from("signal_price_summary").select("*"),
      supabase
        .from("signal_macro")
        .select(
          "symbol, date, pct_change_30d, pct_change_90d, pct_change_365d"
        )
        .order("date", { ascending: false }),
      supabase
        .from("signal_events")
        .select("ticker, signal_type")
        .gt("detected_at", since30),
    ]);

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
    for (const p of (prices ?? []) as PriceSummary[])
      priceByTicker.set(p.ticker, p);
    const sigByTicker = new Map<string, Set<string>>();
    for (const e of events ?? []) {
      const s = sigByTicker.get(e.ticker) ?? new Set<string>();
      s.add(e.signal_type);
      sigByTicker.set(e.ticker, s);
    }

    const MAX_TICKERS_PER_RUN = 400;
    const allTickers = tickers as TickerRow[];
    const toScore = allTickers.slice(0, MAX_TICKERS_PER_RUN);
    const skipped = allTickers.length - toScore.length;
    if (skipped > 0) {
      console.warn(
        `compute-scores: ${skipped} tickers overslagen (cap=${MAX_TICKERS_PER_RUN}).`
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
  })
);
