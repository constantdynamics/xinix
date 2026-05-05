import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import casesJson from "./_lib/backtest-cases.json" with { type: "json" };

interface Case {
  sector: "biotech" | "mining";
  ticker: string;
  date: string;
  type: string;
  note?: string;
}

const CASES = casesJson as Case[];

interface Bar {
  date: string;
  close: number;
}

async function fetchYahoo(
  ticker: string,
  fromTs: number,
  toTs: number
): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    ticker
  )}?period1=${fromTs}&period2=${toTs}&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SignalBacktest/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          adjclose?: Array<{ adjclose: (number | null)[] }>;
          quote: Array<{ close: (number | null)[] }>;
        };
      }>;
      error?: { description?: string } | null;
    };
  };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(json.chart.error?.description ?? "no result");
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  return ts
    .map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: closes[i] ?? NaN,
    }))
    .filter((b): b is Bar => Number.isFinite(b.close));
}

function findIdxAtOrBefore(bars: Bar[], date: string): number {
  let lo = 0,
    hi = bars.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export default async () => {
  await logRun("backtest", async () => {
    const supabase = getServiceClient();
    let ok = 0;
    let fail = 0;
    const errors: string[] = [];

    for (const c of CASES) {
      const eventTs = Math.floor(
        new Date(c.date + "T00:00:00Z").getTime() / 1000
      );
      const fromTs = eventTs - 20 * 86400;
      const toTs = eventTs + 20 * 86400;
      let row: Record<string, unknown> = {
        ticker: c.ticker,
        sector: c.sector,
        event_date: c.date,
        event_type: c.type,
        note: c.note ?? null,
        status: "fetch_error",
      };
      try {
        const bars = await fetchYahoo(c.ticker, fromTs, toTs);
        if (bars.length === 0) row.status = "no_data";
        else {
          const eIdx = findIdxAtOrBefore(bars, c.date);
          if (eIdx < 1 || eIdx >= bars.length - 1) row.status = "no_window";
          else {
            const pre = bars[eIdx - 1].close;
            const ev = bars[eIdx].close;
            const post5 = bars[Math.min(eIdx + 5, bars.length - 1)].close;
            let max5 = ev;
            for (let i = eIdx; i <= Math.min(eIdx + 5, bars.length - 1); i++)
              max5 = Math.max(max5, bars[i].close);
            const ret1d = (ev - pre) / pre;
            const ret5d = (post5 - pre) / pre;
            const ret5dMax = (max5 - pre) / pre;
            row = {
              ...row,
              status: "ok",
              pre_close: pre,
              event_close: ev,
              ret_1d: Number(ret1d.toFixed(4)),
              ret_5d: Number(ret5d.toFixed(4)),
              ret_5d_max: Number(ret5dMax.toFixed(4)),
              hit_1d_100: ret1d >= 1.0,
              hit_5d_250: ret5d >= 2.5,
              hit_5d_max_250: ret5dMax >= 2.5,
            };
            ok++;
          }
        }
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
        fail++;
        errors.push(`${c.ticker}@${c.date}: ${row.error}`);
      }

      await supabase
        .from("signal_backtest_results")
        .upsert(row, { onConflict: "ticker,event_date,event_type" });
      // Yahoo fair-use: ~5 req/sec
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      ok: fail < CASES.length / 2,
      message: `${ok}/${CASES.length} fetched, ${fail} errors${
        errors.length ? `; first: ${errors.slice(0, 2).join("; ")}` : ""
      }`,
      metrics: { cases: CASES.length, ok, fail },
    };
  });
};

export const config: Config = {
  // No schedule — invoked manually via /api/trigger?job=backtest-background
};
