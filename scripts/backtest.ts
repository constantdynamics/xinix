#!/usr/bin/env -S npx tsx
// Backtest historical event cases: fetch Yahoo prices around each event date,
// compute realised 1-day and 5-day returns, aggregate hit-rates per event type.
//
// Bar: ≥100% in 1 day OR ≥250% over 5 trading days.
//
// Run: npx tsx scripts/backtest.ts [--out scripts/backtest-results.json]

import fs from "node:fs";
import path from "node:path";

interface Case {
  sector: "biotech" | "mining";
  ticker: string;
  date: string; // YYYY-MM-DD event date
  type: string;
  note?: string;
}

interface Bar {
  date: string;
  close: number;
}

interface Result {
  case: Case;
  status: "ok" | "no_data" | "no_window" | "fetch_error";
  pre_close?: number;
  event_close?: number;
  ret_1d?: number; // event vs pre
  ret_5d?: number; // close 5 trading days after event vs pre
  ret_5d_max?: number; // max close in 5 trading days post vs pre
  hit_1d_100?: boolean;
  hit_5d_250?: boolean;
  hit_5d_max_250?: boolean;
  error?: string;
}

const inputPath = path.resolve("scripts/backtest-cases.json");
const outArgIdx = process.argv.indexOf("--out");
const outPath =
  outArgIdx >= 0
    ? process.argv[outArgIdx + 1]
    : path.resolve("scripts/backtest-results.json");

const cases: Case[] = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

async function fetchYahoo(ticker: string, fromTs: number, toTs: number): Promise<Bar[]> {
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
  if (!r) {
    const desc = json.chart.error?.description ?? "no result";
    throw new Error(desc);
  }
  const ts = r.timestamp ?? [];
  // Prefer adjusted close (handles splits/dividends)
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
  // returns highest idx where bars[idx].date <= date
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

async function backtestOne(c: Case): Promise<Result> {
  const eventTs = Math.floor(new Date(c.date + "T00:00:00Z").getTime() / 1000);
  const fromTs = eventTs - 20 * 86400;
  const toTs = eventTs + 20 * 86400;
  try {
    const bars = await fetchYahoo(c.ticker, fromTs, toTs);
    if (bars.length === 0) return { case: c, status: "no_data" };
    const eventIdx = findIdxAtOrBefore(bars, c.date);
    if (eventIdx < 1 || eventIdx >= bars.length - 1)
      return { case: c, status: "no_window" };
    const preClose = bars[eventIdx - 1].close;
    const eventClose = bars[eventIdx].close;
    const ret1d = (eventClose - preClose) / preClose;
    const post5Idx = Math.min(eventIdx + 5, bars.length - 1);
    const post5Close = bars[post5Idx].close;
    const ret5d = (post5Close - preClose) / preClose;
    let max5 = eventClose;
    for (let i = eventIdx; i <= post5Idx; i++) max5 = Math.max(max5, bars[i].close);
    const ret5dMax = (max5 - preClose) / preClose;
    return {
      case: c,
      status: "ok",
      pre_close: preClose,
      event_close: eventClose,
      ret_1d: ret1d,
      ret_5d: ret5d,
      ret_5d_max: ret5dMax,
      hit_1d_100: ret1d >= 1.0,
      hit_5d_250: ret5d >= 2.5,
      hit_5d_max_250: ret5dMax >= 2.5,
    };
  } catch (e) {
    return {
      case: c,
      status: "fetch_error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const results: Result[] = [];
  for (const c of cases) {
    process.stdout.write(`[${results.length + 1}/${cases.length}] ${c.sector} ${c.ticker} ${c.date} ${c.type} ... `);
    const r = await backtestOne(c);
    results.push(r);
    if (r.status === "ok") {
      const r1 = ((r.ret_1d ?? 0) * 100).toFixed(1);
      const r5m = ((r.ret_5d_max ?? 0) * 100).toFixed(1);
      const flag = r.hit_1d_100 ? "🥇1d" : r.hit_5d_max_250 ? "🥈5d" : "  ";
      process.stdout.write(`1d=${r1}% 5d_max=${r5m}% ${flag}\n`);
    } else {
      process.stdout.write(`${r.status}${r.error ? `: ${r.error}` : ""}\n`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  // Aggregate per type
  const byType = new Map<string, Result[]>();
  const bySectorType = new Map<string, Result[]>();
  for (const r of results) {
    const k = r.case.type;
    const sk = `${r.case.sector}/${r.case.type}`;
    if (!byType.has(k)) byType.set(k, []);
    byType.get(k)!.push(r);
    if (!bySectorType.has(sk)) bySectorType.set(sk, []);
    bySectorType.get(sk)!.push(r);
  }

  console.log("\n=== Hit-rate per event type (sector/type) ===");
  console.log("(n = sample size with valid data, hit = met >=100%/day or >=250%/5d-max)");
  const rows: Array<[string, number, number, number, number, number]> = [];
  for (const [k, list] of bySectorType.entries()) {
    const ok = list.filter((r) => r.status === "ok");
    if (ok.length === 0) continue;
    const hit = ok.filter((r) => r.hit_1d_100 || r.hit_5d_max_250).length;
    const hit1 = ok.filter((r) => r.hit_1d_100).length;
    const hit5 = ok.filter((r) => r.hit_5d_max_250).length;
    const avg1 =
      ok.reduce((s, r) => s + (r.ret_1d ?? 0), 0) / ok.length;
    const avg5 =
      ok.reduce((s, r) => s + (r.ret_5d_max ?? 0), 0) / ok.length;
    rows.push([k, ok.length, hit, hit1, hit5, avg1]);
    console.log(
      `  ${k.padEnd(38)} n=${ok.length}  hit=${hit}/${ok.length} (${(
        (hit / ok.length) *
        100
      ).toFixed(0)}%)  hit_1d=${hit1}  hit_5d_max=${hit5}  avg_1d=${(avg1 * 100).toFixed(
        1
      )}%  avg_5d_max=${(avg5 * 100).toFixed(1)}%`
    );
  }

  // Failures
  const fail = results.filter((r) => r.status !== "ok");
  if (fail.length > 0) {
    console.log(`\n=== ${fail.length} cases without usable data ===`);
    for (const r of fail) {
      console.log(
        `  ${r.case.sector} ${r.case.ticker} ${r.case.date} ${r.case.type}: ${r.status}${
          r.error ? ` (${r.error})` : ""
        }`
      );
    }
  }
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
