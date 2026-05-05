import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

interface YahooBar {
  date: string;
  close: number | null;
  volume: number | null;
}

async function fetchYahoo(ticker: string): Promise<YahooBar[]> {
  // 120 days of daily bars, free unauthenticated endpoint
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=120d&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; BiotechSignalBot/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{ close: (number | null)[]; volume: (number | null)[] }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  const result = json.chart.result?.[0];
  if (!result) {
    const desc = json.chart.error?.description ?? "no result";
    throw new Error(`Yahoo ${ticker}: ${desc}`);
  }
  const ts = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  const volumes = result.indicators.quote[0]?.volume ?? [];
  return ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: closes[i] ?? null,
    volume: volumes[i] ?? null,
  }));
}

function pct(a: number, b: number): number {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

export default async () => {
  await logRun("poll-prices", async () => {
    const supabase = getServiceClient();
    const { data: tickers, error } = await supabase
      .from("signal_tickers")
      .select("ticker")
      .eq("active", true);
    if (error) throw error;
    if (!tickers) return { ok: true, message: "no tickers" };

    let updated = 0;
    let signalsInserted = 0;
    const errors: string[] = [];

    for (const { ticker } of tickers) {
      try {
        const bars = await fetchYahoo(ticker);
        if (bars.length === 0) continue;

        // Upsert all 120 bars
        const rows = bars
          .filter((b) => b.close !== null)
          .map((b) => ({
            ticker,
            date: b.date,
            close: b.close,
            volume: b.volume,
          }));
        if (rows.length === 0) continue;

        await supabase
          .from("signal_prices")
          .upsert(rows, { onConflict: "ticker,date" });

        // Compute summary
        const valid = bars.filter((b): b is YahooBar & { close: number } =>
          b.close !== null
        );
        const last = valid[valid.length - 1];
        const prev = valid[valid.length - 2];
        const fiveAgo = valid[valid.length - 6];
        const window90 = valid.slice(-90);
        const closes90 = window90.map((b) => b.close);
        const low90 = Math.min(...closes90);
        const high90 = Math.max(...closes90);
        const last30 = valid.slice(-30);
        const validVolumes = last30
          .map((b) => b.volume ?? 0)
          .filter((v) => v > 0);
        const avgVol =
          validVolumes.reduce((a, b) => a + b, 0) /
          (validVolumes.length || 1);
        const lastVol = last.volume ?? 0;
        const volRatio = avgVol > 0 ? lastVol / avgVol : 0;

        const summary = {
          ticker,
          last_close: last.close,
          last_volume: lastVol,
          low_90d: low90,
          high_90d: high90,
          pct_above_90d_low: low90 > 0 ? pct(last.close, low90) : 0,
          pct_change_1d: prev ? pct(last.close, prev.close) : 0,
          pct_change_5d: fiveAgo ? pct(last.close, fiveAgo.close) : 0,
          avg_volume_30d: Math.round(avgVol),
          volume_ratio: Number(volRatio.toFixed(2)),
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from("signal_price_summary")
          .upsert(summary, { onConflict: "ticker" });

        updated++;

        // ─── Signal detection ────────────────────────────────────────
        const today = new Date().toISOString().slice(0, 10);
        const expires7 = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();

        // Near 90d-low: within 5%
        if (summary.pct_above_90d_low <= 5) {
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "near_90d_low",
            severity: "yellow",
            title: `${ticker} binnen 5% van 90-dag low`,
            detail: `Koers $${last.close.toFixed(2)}, 90d-low $${low90.toFixed(
              2
            )} (+${summary.pct_above_90d_low.toFixed(1)}%)`,
            payload: { last_close: last.close, low_90d: low90 },
            expires_at: expires7,
            dedup_key: `near_90d_low:${ticker}:${today}`,
          });
          if (id) signalsInserted++;
        }

        // Price spike up — calibrated against the 100%/day or 250%/week bar.
        //   red:    ≥30% + 3× volume → almost certainly a net-event capable of
        //           leading to a goud-medaille spike (catches biotech/mining
        //           news the polls missed).
        //   orange: ≥15% + 2× volume → meaningful move, dashboard-only.
        //   yellow: ≥8%              → minor pop.
        if (summary.pct_change_1d >= 30 && volRatio >= 3) {
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "price_spike_up",
            severity: "red",
            title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% met volume ${volRatio.toFixed(1)}×`,
            detail: `Koers $${last.close.toFixed(2)} (was $${prev?.close.toFixed(
              2
            )}). Vrijwel zeker net-event.`,
            payload: { pct: summary.pct_change_1d, volume_ratio: volRatio },
            expires_at: expires7,
            dedup_key: `price_spike_up:${ticker}:${today}`,
          });
          if (id) signalsInserted++;
        } else if (summary.pct_change_1d >= 15 && volRatio >= 2) {
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "price_spike_up",
            severity: "orange",
            title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% (vol ${volRatio.toFixed(1)}×)`,
            detail: `Koers $${last.close.toFixed(2)}. Materiële beweging.`,
            payload: { pct: summary.pct_change_1d, volume_ratio: volRatio },
            expires_at: expires7,
            dedup_key: `price_spike_up:${ticker}:${today}`,
          });
          if (id) signalsInserted++;
        } else if (summary.pct_change_1d >= 8) {
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "price_spike_up",
            severity: "yellow",
            title: `${ticker} +${summary.pct_change_1d.toFixed(1)}% intraday`,
            detail: `Koers $${last.close.toFixed(2)}. Volume ratio ${volRatio.toFixed(1)}×.`,
            payload: { pct: summary.pct_change_1d, volume_ratio: volRatio },
            expires_at: expires7,
            dedup_key: `price_spike_up:${ticker}:${today}`,
          });
          if (id) signalsInserted++;
        }

        // Volume spike alone (no price move yet — could be accumulation)
        if (
          volRatio >= 3 &&
          Math.abs(summary.pct_change_1d) < 5 &&
          summary.pct_change_1d >= -5
        ) {
          const id = await insertSignal(supabase, {
            ticker,
            signal_type: "volume_spike",
            severity: "yellow",
            title: `${ticker} ongewoon volume (${volRatio.toFixed(1)}×)`,
            detail: `Volume ${lastVol.toLocaleString()} vs gem. ${Math.round(
              avgVol
            ).toLocaleString()}.`,
            payload: { volume_ratio: volRatio },
            expires_at: expires7,
            dedup_key: `volume_spike:${ticker}:${today}`,
          });
          if (id) signalsInserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${ticker}: ${msg}`);
      }
    }

    return {
      ok: errors.length === 0,
      message:
        `${updated}/${tickers.length} tickers updated, ${signalsInserted} signals` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: { updated, signals: signalsInserted, errors: errors.length },
    };
  });
};

export const config: Config = {
  schedule: "0 22 * * 1-5", // weekdays 22:00 UTC = after US close
};
