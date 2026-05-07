// Briefing §10: track record API. Per actie + sector + horizon
// retourneer hit-rate en mean return. Owner kan zo zien of het
// systeem überhaupt edge heeft, en welke parts van de logica wel/
// niet werken.

import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

interface ScoreRow {
  id: number;
  ticker: string;
  scan_date: string;
  sector: string;
  action: string;
  final_score: number;
  components: { nearest_catalyst?: { type?: string } | null } | null;
}

interface ReturnRow {
  signal_score_id: number;
  days_after_signal: number;
  return_pct: number | null;
}

function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined)
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function summarize(returns: number[]) {
  if (returns.length === 0)
    return {
      n: 0,
      mean: 0,
      median: 0,
      p25: 0,
      p75: 0,
      hit_rate_50pct: 0,
      hit_rate_100pct: 0,
      loss_rate_25pct: 0,
    };
  const mean = returns.reduce((s, x) => s + x, 0) / returns.length;
  const median = quantile(returns, 0.5);
  const hits50 = returns.filter((r) => r >= 0.5).length;
  const hits100 = returns.filter((r) => r >= 1.0).length;
  const losses = returns.filter((r) => r <= -0.25).length;
  return {
    n: returns.length,
    mean: +mean.toFixed(4),
    median: +median.toFixed(4),
    p25: +quantile(returns, 0.25).toFixed(4),
    p75: +quantile(returns, 0.75).toFixed(4),
    hit_rate_50pct: +(hits50 / returns.length).toFixed(3),
    hit_rate_100pct: +(hits100 / returns.length).toFixed(3),
    loss_rate_25pct: +(losses / returns.length).toFixed(3),
  };
}

export default async () => {
  const supabase = getServiceClient();
  const since = new Date(Date.now() - 365 * 86400000)
    .toISOString()
    .slice(0, 10);

  const { data: scoresRaw } = await supabase
    .from("signal_scores")
    .select("id, ticker, scan_date, sector, action, final_score, components")
    .in("action", ["STRONG_BUY", "BUY", "WATCH"])
    .gte("scan_date", since)
    .returns<ScoreRow[]>();

  const scores = scoresRaw ?? [];
  const ids = scores.map((s) => s.id);
  let returns: ReturnRow[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from("signal_forward_returns")
      .select("signal_score_id, days_after_signal, return_pct")
      .in("signal_score_id", ids)
      .returns<ReturnRow[]>();
    returns = data ?? [];
  }

  // Index returns by signal_score_id+days
  const retByKey = new Map<string, number>();
  for (const r of returns) {
    if (r.return_pct == null) continue;
    retByKey.set(`${r.signal_score_id}_${r.days_after_signal}`, r.return_pct);
  }

  const HORIZONS = [7, 14, 30, 90];
  const ACTIONS = ["STRONG_BUY", "BUY", "WATCH"] as const;
  const SECTORS = ["biotech", "mining"] as const;

  type Bucket = { key: string; returns: number[]; signals: number };
  const buckets = new Map<string, Bucket>();

  function bucket(key: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = { key, returns: [], signals: 0 };
      buckets.set(key, b);
    }
    return b;
  }

  for (const s of scores) {
    for (const days of HORIZONS) {
      const ret = retByKey.get(`${s.id}_${days}`);
      const cat = s.components?.nearest_catalyst?.type ?? "unknown";

      const all = bucket(`all|${s.action}|${days}`);
      const sec = bucket(`sector|${s.sector}|${s.action}|${days}`);
      const catB = bucket(`catalyst|${cat}|${s.action}|${days}`);

      all.signals += 1;
      sec.signals += 1;
      catB.signals += 1;
      if (ret != null) {
        all.returns.push(ret);
        sec.returns.push(ret);
        catB.returns.push(ret);
      }
    }
  }

  const overall: Record<string, unknown> = {};
  for (const a of ACTIONS) {
    overall[a] = {};
    for (const days of HORIZONS) {
      const b = bucket(`all|${a}|${days}`);
      (overall[a] as Record<string, unknown>)[`d${days}`] = {
        signals: b.signals,
        ...summarize(b.returns),
      };
    }
  }

  const bySector: Record<string, Record<string, unknown>> = {};
  for (const sec of SECTORS) {
    bySector[sec] = {};
    for (const a of ACTIONS) {
      bySector[sec][a] = {};
      for (const days of HORIZONS) {
        const b = bucket(`sector|${sec}|${a}|${days}`);
        (bySector[sec][a] as Record<string, unknown>)[`d${days}`] = {
          signals: b.signals,
          ...summarize(b.returns),
        };
      }
    }
  }

  // Top catalyst types by signal count
  const catCounts = new Map<string, number>();
  for (const [k, b] of buckets) {
    if (k.startsWith("catalyst|") && k.endsWith("|STRONG_BUY|30")) {
      const cat = k.split("|")[1];
      catCounts.set(cat, b.signals);
    }
  }
  const topCats = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat]) => cat);

  const byCatalyst: Record<string, unknown> = {};
  for (const cat of topCats) {
    byCatalyst[cat] = {};
    for (const a of ACTIONS) {
      (byCatalyst[cat] as Record<string, unknown>)[a] = {};
      for (const days of HORIZONS) {
        const b = bucket(`catalyst|${cat}|${a}|${days}`);
        (
          (byCatalyst[cat] as Record<string, Record<string, unknown>>)[a]
        )[`d${days}`] = {
          signals: b.signals,
          ...summarize(b.returns),
        };
      }
    }
  }

  return new Response(
    JSON.stringify(
      {
        as_of: new Date().toISOString(),
        window_days: 365,
        total_signals: scores.length,
        total_returns_recorded: returns.length,
        overall,
        by_sector: bySector,
        by_catalyst: byCatalyst,
        caveat:
          "Sample sizes klein in eerste maanden. Briefing §10: pas na 90+ STRONG_BUY signals over 6+ maanden bevatten deze cijfers signaal boven ruis.",
      },
      null,
      2
    ),
    { headers: { "Content-Type": "application/json" } }
  );
};

export const config: Config = {
  path: "/api/track-record",
};
