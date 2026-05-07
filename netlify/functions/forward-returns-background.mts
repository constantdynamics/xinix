// Briefing §8.3: nightly forward returns recorder.
// Voor elke STRONG_BUY/BUY uit N=7/14/30/90 dagen geleden, fetch
// huidige prijs en record return. Owner kan zo per actie/sector/
// catalyst type de echte hit-rate zien (briefing §10).

import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";

const TARGET_DAYS = [7, 14, 30, 90];

async function fetchYahooClose(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) Xinix/SignalForwardReturns",
      },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{
          indicators?: {
            adjclose?: Array<{ adjclose?: (number | null)[] }>;
            quote?: Array<{ close?: (number | null)[] }>;
          };
        }>;
      };
    };
    const result = j.chart?.result?.[0];
    const closes =
      result?.indicators?.adjclose?.[0]?.adjclose ??
      result?.indicators?.quote?.[0]?.close ??
      [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const v = closes[i];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  } catch {
    return null;
  }
}

interface ScoreRow {
  id: number;
  ticker: string;
  scan_date: string;
  trade_setup: { entry?: number } | null;
}

export default async () => {
  await logRun("forward-returns", async () => {
    const supabase = getServiceClient();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let recorded = 0;
    let failed = 0;
    let skipped = 0;

    // Cache per ticker — current price is identical across all horizon
    // iterations, so fetch Yahoo at most once per ticker per run.
    const priceCache = new Map<string, number | null>();

    for (const days of TARGET_DAYS) {
      const target = new Date(today.getTime() - days * 86400000)
        .toISOString()
        .slice(0, 10);

      const { data: scores } = await supabase
        .from("signal_scores")
        .select("id, ticker, scan_date, trade_setup")
        .eq("scan_date", target)
        .in("action", ["STRONG_BUY", "BUY"])
        .returns<ScoreRow[]>();

      if (!scores || scores.length === 0) continue;

      const ids = scores.map((s) => s.id);
      const { data: existing } = await supabase
        .from("signal_forward_returns")
        .select("signal_score_id")
        .in("signal_score_id", ids)
        .eq("days_after_signal", days);
      const existingIds = new Set(
        (existing ?? []).map((e) => e.signal_score_id)
      );

      for (const s of scores) {
        if (existingIds.has(s.id)) {
          skipped++;
          continue;
        }
        const entry = s.trade_setup?.entry;
        if (typeof entry !== "number") {
          skipped++;
          continue;
        }
        let current = priceCache.get(s.ticker);
        if (current === undefined) {
          current = await fetchYahooClose(s.ticker);
          priceCache.set(s.ticker, current);
          await new Promise((r) => setTimeout(r, 250));
        }
        if (current == null) {
          failed++;
          continue;
        }
        const ret = (current - entry) / entry;
        const { error } = await supabase.from("signal_forward_returns").upsert(
          {
            signal_score_id: s.id,
            ticker: s.ticker,
            signal_date: s.scan_date,
            measurement_date: todayStr,
            days_after_signal: days,
            entry_price: entry,
            measurement_price: current,
            return_pct: +ret.toFixed(4),
          },
          { onConflict: "signal_score_id,days_after_signal" }
        );
        if (error) {
          failed++;
          console.error("forward-return upsert", s.ticker, error.message);
        } else {
          recorded++;
        }
      }
    }

    return {
      ok: true,
      message: `recorded=${recorded} failed=${failed} skipped=${skipped}`,
      metrics: { recorded, failed, skipped },
    };
  });
};

export const config: Config = {
  schedule: "30 7 * * *", // 07:30 UTC, na compute-scores
};
