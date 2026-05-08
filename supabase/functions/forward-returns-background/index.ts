import { getServiceClient } from "../_shared/supabase.ts";
import { runBackground } from "../_shared/runner.ts";

const TARGET_DAYS = [7, 14, 30, 90];

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchYahooClose(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?range=5d&interval=1d`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) Xinix/SignalForwardReturns",
        },
      });
      if (!r.ok) {
        if ((r.status === 429 || r.status >= 500) && attempt < 2) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        return null;
      }
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
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

async function fetchStooqClose(ticker: string): Promise<number | null> {
  if (ticker.includes(".")) return null;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(
    ticker.toLowerCase()
  )}.us&i=d`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Xinix/ForwardReturnsFallback" },
    });
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(",");
    const close = Number(last[4]);
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch {
    return null;
  }
}

async function fetchCurrentClose(ticker: string): Promise<number | null> {
  const yahoo = await fetchYahooClose(ticker);
  if (yahoo != null) return yahoo;
  return await fetchStooqClose(ticker);
}

interface ScoreRow {
  id: number;
  ticker: string;
  scan_date: string;
  trade_setup: { entry?: number } | null;
}

Deno.serve(
  runBackground("forward-returns", async () => {
    const supabase = getServiceClient();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let recorded = 0;
    let failed = 0;
    let skipped = 0;

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
        (existing ?? []).map((e: any) => e.signal_score_id)
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
          current = await fetchCurrentClose(s.ticker);
          priceCache.set(s.ticker, current);
          await sleep(250);
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
  })
);
