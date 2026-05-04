import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

// Generates pre-event signals from upcoming catalysts (the "bijna gaan gebeuren" side).
// Also marks past-date pending catalysts as 'occurred' (they should be picked up by
// the post-event channels — 8-K, FDA, trial status — but we still flag them).

export default async () => {
  await logRun("compute-signals", async () => {
    const supabase = getServiceClient();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    // Pull all pending catalysts with a date in the next 60 days
    const horizon = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const { data: catalysts, error } = await supabase
      .from("biotech_catalysts")
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
        signal_type: `pre_catalyst_${days <= 7 ? "7d" : days <= 14 ? "14d" : days <= 30 ? "30d" : "60d"}`,
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

    // Mark catalysts whose date has passed by >7 days as occurred (no payload)
    const passedCutoff = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await supabase
      .from("biotech_catalysts")
      .update({
        status: "occurred",
        occurred_at: new Date().toISOString(),
      })
      .eq("status", "pending")
      .lt("expected_date", passedCutoff);

    return {
      ok: true,
      message: `${signalsInserted} pre-catalyst signals from ${catalysts?.length ?? 0} catalysts`,
      metrics: { signals: signalsInserted },
    };
  });
};

export const config: Config = {
  schedule: "0 5 * * *", // daily 05:00 UTC, before trial polling
};
