import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";
import { SEVERITY_RANK } from "./_lib/signals.mts";

export default async () => {
  const supabase = getServiceClient();

  const [tickersRes, summaryRes, signalsRes, catalystsRes, runLogRes] =
    await Promise.all([
      supabase.from("signal_tickers").select("*").eq("active", true),
      supabase.from("signal_price_summary").select("*"),
      supabase
        .from("signal_events")
        .select("*")
        .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
        .order("detected_at", { ascending: false })
        .limit(500),
      supabase
        .from("signal_catalysts")
        .select("*")
        .eq("status", "pending")
        .order("expected_date", { ascending: true }),
      supabase
        .from("signal_runs")
        .select("job, started_at, finished_at, ok, message")
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

  const tickers = tickersRes.data ?? [];
  const summaries = summaryRes.data ?? [];
  const signals = signalsRes.data ?? [];
  const catalysts = catalystsRes.data ?? [];
  const runLog = runLogRes.data ?? [];

  // Compute color per ticker:
  // - take max severity of active signals
  // - blend with goud_score baseline
  // Final: white (no signal & score<35), yellow, orange, red.
  const summaryByTicker = new Map(summaries.map((s) => [s.ticker, s]));
  const signalsByTicker = new Map<string, typeof signals>();
  for (const sig of signals) {
    const arr = signalsByTicker.get(sig.ticker) ?? [];
    arr.push(sig);
    signalsByTicker.set(sig.ticker, arr);
  }
  const catalystsByTicker = new Map<string, typeof catalysts>();
  for (const cat of catalysts) {
    const arr = catalystsByTicker.get(cat.ticker) ?? [];
    arr.push(cat);
    catalystsByTicker.set(cat.ticker, arr);
  }

  type Sev = "white" | "yellow" | "orange" | "red";
  const SEV_RANK: Record<Sev, number> = { white: 0, yellow: 1, orange: 2, red: 3 };

  const cards = tickers.map((t) => {
    const tSignals = signalsByTicker.get(t.ticker) ?? [];
    const tCatalysts = catalystsByTicker.get(t.ticker) ?? [];
    const summary = summaryByTicker.get(t.ticker);

    let signalSev: Sev = "white";
    for (const sig of tSignals) {
      const r = SEVERITY_RANK[sig.severity as keyof typeof SEVERITY_RANK];
      const asSev: Sev = r === 3 ? "red" : r === 2 ? "orange" : "yellow";
      if (SEV_RANK[asSev] > SEV_RANK[signalSev]) signalSev = asSev;
    }

    // Baseline from goud_score
    let baselineSev: Sev = "white";
    if (t.goud_score != null) {
      if (t.goud_score >= 80) baselineSev = "red";
      else if (t.goud_score >= 65) baselineSev = "orange";
      else if (t.goud_score >= 35) baselineSev = "yellow";
    }

    const finalSev: Sev =
      SEV_RANK[signalSev] > SEV_RANK[baselineSev] ? signalSev : baselineSev;

    const nextCatalyst = tCatalysts[0];
    const daysToNext = nextCatalyst?.expected_date
      ? Math.ceil(
          (new Date(nextCatalyst.expected_date).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000)
        )
      : null;

    return {
      ticker: t.ticker,
      company: t.company,
      sector: t.sector ?? "biotech",
      goud_score: t.goud_score,
      goud_type: t.goud_type,
      modality: t.modality,
      disease_area: t.disease_area,
      phase: t.phase,
      commodity: t.commodity,
      jurisdiction: t.jurisdiction,
      deposit_type: t.deposit_type,
      factor_count: t.factor_count ?? 0,
      trigger_event: t.trigger_event,
      color: finalSev,
      signal_color: signalSev,
      baseline_color: baselineSev,
      summary: summary ?? null,
      active_signals: tSignals.length,
      top_signal: tSignals[0] ?? null,
      next_catalyst: nextCatalyst ?? null,
      days_to_next_catalyst: daysToNext,
    };
  });

  cards.sort((a, b) => {
    if (SEV_RANK[b.color] !== SEV_RANK[a.color])
      return SEV_RANK[b.color] - SEV_RANK[a.color];
    return (b.goud_score ?? 0) - (a.goud_score ?? 0);
  });

  return new Response(
    JSON.stringify({
      cards,
      recent_signals: signals.slice(0, 50),
      upcoming_catalysts: catalysts.slice(0, 50),
      run_log: runLog,
      generated_at: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    }
  );
};

export const config: Config = {
  path: "/api/dashboard",
};
