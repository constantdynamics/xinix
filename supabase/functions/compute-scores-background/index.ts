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

// Round-robin scoring met slimme prioriteit. Per run worden tot
// SCORE_BATCH tickers gescoord, gekozen op tier:
//   A (curated of buy_limit gezet)              -> herscore als score_at > 1u oud
//   B (factor_count >= 2 of recent signaal 7d)  -> > 12u oud
//   C (de rest, screening-junk)                 -> > 30 dagen oud
// Binnen een tier: meest-stale eerst (NULL = nooit gescoord = bovenaan).
// Zo krijgen tickers die kans maken op een hot/strong-buy positie veel
// vaker een herscore; de 3600 no-data tickers rouleren traag door.
//
// In het weekend (markten dicht, alle tijd) vervalt de tier-prioriteit:
// dan is het een vlakke round-robin over de hele watchlist met een grote
// batch, zodat ook tier C volledig aan bod komt.
const SCORE_BATCH = 250;
const WEEKEND_BATCH = 600;
const SCORE_BUDGET_MS = 110_000;
const STALE_A_MS = 1 * 60 * 60 * 1000;
const STALE_B_MS = 12 * 60 * 60 * 1000;
const STALE_C_MS = 30 * 24 * 60 * 60 * 1000;
const WEEKEND_STALE_MS = 1 * 60 * 60 * 1000;

Deno.serve(
  runBackground("compute-scores", async () => {
    const supabase = getServiceClient();
    const startMs = Date.now();
    const scanDate = new Date().toISOString().slice(0, 10);
    const since30 = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const since7Ms = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const [tickersRes, catalystsRes, pricesRes, macroRes, eventsRes] =
      await Promise.all([
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
          .select("ticker, signal_type, detected_at")
          .gt("detected_at", since30),
      ]);

    // Een mislukte tickers- of prijzenquery is een mislukte run. Voorheen werd
    // dit als "no active tickers" / lege prijzen behandeld: de run logde ok
    // terwijl er niets (of met foute timing-scores) gescoord werd.
    if (tickersRes.error) {
      return { ok: false, message: `signal_tickers query faalde: ${tickersRes.error.message}` };
    }
    if (pricesRes.error) {
      return { ok: false, message: `signal_price_summary query faalde: ${pricesRes.error.message}` };
    }
    for (const [name, res] of ([["signal_catalysts", catalystsRes], ["signal_macro", macroRes], ["signal_events", eventsRes]] as const)) {
      if (res.error) console.error(`compute-scores: query ${name} faalde:`, res.error.message);
    }
    const tickers = tickersRes.data;
    const catalysts = catalystsRes.data;
    const prices = pricesRes.data;
    const macroRaw = macroRes.data;
    const events = eventsRes.data;

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
    const recentSigSet = new Set<string>();
    for (const e of events ?? []) {
      const s = sigByTicker.get(e.ticker) ?? new Set<string>();
      s.add(e.signal_type);
      sigByTicker.set(e.ticker, s);
      const dt = (e as { detected_at?: string }).detected_at;
      if (dt && new Date(dt).getTime() >= since7Ms) recentSigSet.add(e.ticker);
    }

    type TR = TickerRow & {
      goud_score?: number | null;
      buy_limit?: number | null;
      factor_count?: number | null;
      score_at?: string | null;
    };
    const now = Date.now();
    const staleMs = (t: TR): number =>
      t.score_at ? now - new Date(t.score_at).getTime() : Number.MAX_SAFE_INTEGER;
    const tierOf = (t: TR): "A" | "B" | "C" => {
      if (t.goud_score != null || t.buy_limit != null) return "A";
      if ((t.factor_count ?? 0) >= 2 || recentSigSet.has(t.ticker)) return "B";
      return "C";
    };
    const day = new Date().getUTCDay(); // 0 = zondag, 6 = zaterdag
    const isWeekend = day === 0 || day === 6;
    const batchSize = isWeekend ? WEEKEND_BATCH : SCORE_BATCH;
    const TIER_THRESH: Record<"A" | "B" | "C", number> = isWeekend
      ? { A: WEEKEND_STALE_MS, B: WEEKEND_STALE_MS, C: WEEKEND_STALE_MS }
      : { A: STALE_A_MS, B: STALE_B_MS, C: STALE_C_MS };
    const TIER_RANK: Record<"A" | "B" | "C", number> = { A: 0, B: 1, C: 2 };

    const queue = (tickers as TR[])
      .map((t) => ({ t, tier: tierOf(t), stale: staleMs(t) }))
      .filter((x) => x.stale >= TIER_THRESH[x.tier])
      .sort((a, b) => {
        if (!isWeekend && TIER_RANK[a.tier] !== TIER_RANK[b.tier])
          return TIER_RANK[a.tier] - TIER_RANK[b.tier];
        return b.stale - a.stale;
      })
      .slice(0, batchSize);

    if (queue.length === 0) {
      return { ok: true, message: "alle scores zijn vers", metrics: { scored: 0, queued: 0 } };
    }

    let scored = 0;
    let failed = 0;
    let processed = 0;
    const tierCounts = { A: 0, B: 0, C: 0 };
    for (const { t, tier } of queue) {
      if (Date.now() - startMs > SCORE_BUDGET_MS) break;
      processed++;
      tierCounts[tier]++;
      const ok = await scoreOneTicker(
        supabase,
        t as TickerRow,
        catByTicker.get(t.ticker) ?? [],
        priceByTicker.get(t.ticker) ?? null,
        (macro ?? []) as MacroRow[],
        sigByTicker.get(t.ticker) ?? new Set(),
        "trader",
        scanDate
      );
      // Markeer als gescoord (ook bij upsert-fout, anders blokkeert de
      // ticker de queue). Fouten staan in de edge function logs.
      await supabase
        .from("signal_tickers")
        .update({ score_at: new Date().toISOString() })
        .eq("ticker", t.ticker);
      if (ok) scored++;
      else failed++;
    }

    const stillStale =
      (tickers as TR[]).filter((t) => staleMs(t) >= TIER_THRESH[tierOf(t)]).length -
      processed;
    return {
      ok: processed === 0 || failed < processed / 2,
      message: `${scored} gescoord (A:${tierCounts.A} B:${tierCounts.B} C:${tierCounts.C}), ${failed} fout, ~${Math.max(0, stillStale)} nog te doen`,
      metrics: {
        scored,
        failed,
        processed,
        tier_a: tierCounts.A,
        tier_b: tierCounts.B,
        tier_c: tierCounts.C,
        queue_remaining: Math.max(0, stillStale),
      },
    };
  })
);
