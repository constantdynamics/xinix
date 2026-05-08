import { getServiceClient } from "../_shared/supabase.ts";
import { insertSignal } from "../_shared/signals.ts";
import { runBackground } from "../_shared/runner.ts";

Deno.serve(
  runBackground("compute-signals", async () => {
    const supabase = getServiceClient();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const horizon = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data: catalysts, error } = await supabase
      .from("signal_catalysts")
      .select("*")
      .eq("status", "pending")
      .gte("expected_date", todayStr)
      .lte("expected_date", horizon);
    if (error) throw error;

    let signalsInserted = 0;

    for (const c of catalysts ?? []) {
      const expected = new Date(c.expected_date);
      const days = Math.ceil(
        (expected.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
      );

      let severity: "yellow" | "orange" | "red";
      let label: string;
      if (days <= 14) {
        severity = "red";
        label = "≤14 dagen";
      } else if (days <= 30) {
        severity = "orange";
        label = "≤30 dagen";
      } else {
        severity = "yellow";
        label = "≤60 dagen";
      }

      const id = await insertSignal(supabase, {
        ticker: c.ticker,
        signal_type: `pre_catalyst_${
          days <= 7 ? "7d" : days <= 14 ? "14d" : days <= 30 ? "30d" : "60d"
        }`,
        severity,
        title: `${c.ticker}: ${c.catalyst_type} over ${days} dagen`,
        detail: `${c.description ?? ""} — verwacht ${c.expected_date} (${label}).`,
        payload: {
          catalyst_id: c.id,
          catalyst_type: c.catalyst_type,
          expected_date: c.expected_date,
          days_until: days,
        },
        expires_at: new Date(
          expected.getTime() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
        dedup_key: `pre_catalyst:${c.id}:${todayStr}`,
      });
      if (id) signalsInserted++;
    }

    const passedCutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await supabase
      .from("signal_catalysts")
      .update({
        status: "occurred",
        occurred_at: new Date().toISOString(),
      })
      .eq("status", "pending")
      .lt("expected_date", passedCutoff);

    const { data: miningTickers } = await supabase
      .from("signal_tickers")
      .select(
        "id, ticker, goud_score, goud_type, share_count_millions, reverse_split_history"
      )
      .eq("active", true)
      .eq("sector", "mining");

    if (miningTickers && miningTickers.length > 0) {
      const since30 = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      const { data: recentSig } = await supabase
        .from("signal_events")
        .select("ticker, signal_type, severity")
        .gt("detected_at", since30);

      const sigByTicker = new Map<
        string,
        { types: Set<string>; sev: Set<string> }
      >();
      for (const s of recentSig ?? []) {
        const e =
          sigByTicker.get(s.ticker) ?? { types: new Set(), sev: new Set() };
        e.types.add(s.signal_type);
        e.sev.add(s.severity);
        sigByTicker.set(s.ticker, e);
      }

      const upcomingByTicker = new Set<string>();
      for (const c of catalysts ?? []) upcomingByTicker.add(c.ticker);

      for (const t of miningTickers) {
        const sigs = sigByTicker.get(t.ticker);
        const factors: string[] = [];
        if (sigs?.types.has("macro_tide")) factors.push("macro_tide");
        if (
          t.share_count_millions != null &&
          Number(t.share_count_millions) <= 100
        )
          factors.push("tight_share_count");
        if (["phoenix", "multi-bagger"].includes(t.goud_type ?? ""))
          factors.push("history");
        if (t.reverse_split_history) factors.push("post_consolidation");
        if (typeof t.goud_score === "number" && t.goud_score >= 70)
          factors.push("baseline_high");
        if (upcomingByTicker.has(t.ticker)) factors.push("upcoming_catalyst");
        if (sigs?.sev.has("red")) factors.push("active_red_signal");
        if (
          sigs?.types.has("bonanza_au") ||
          sigs?.types.has("bonanza_ag") ||
          sigs?.types.has("bonanza_cu") ||
          sigs?.types.has("step_out_drill")
        )
          factors.push("geology_event");

        await supabase
          .from("signal_tickers")
          .update({
            factor_count: factors.length,
            factors_json: factors,
          })
          .eq("id", t.id);
      }
    }

    return {
      ok: true,
      message: `${signalsInserted} pre-catalyst signals from ${
        catalysts?.length ?? 0
      } catalysts`,
      metrics: { signals: signalsInserted },
    };
  })
);
