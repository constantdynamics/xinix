import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

interface Row {
  ticker: string;
  sector: string;
  event_date: string;
  event_type: string;
  note: string | null;
  status: string;
  pre_close: number | null;
  event_close: number | null;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_5d_max: number | null;
  hit_1d_100: boolean | null;
  hit_5d_max_250: boolean | null;
  error: string | null;
  ran_at: string;
}

export default async () => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("signal_backtest_results")
    .select("*")
    .order("ran_at", { ascending: false });
  if (error) return new Response(error.message, { status: 500 });

  const rows = (data ?? []) as Row[];

  // Aggregate by sector/event_type
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.sector}/${r.event_type}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(r);
  }

  const aggregates = [...byKey.entries()].map(([k, list]) => {
    const ok = list.filter((r) => r.status === "ok");
    const hit = ok.filter(
      (r) => r.hit_1d_100 === true || r.hit_5d_max_250 === true
    ).length;
    const hit1d = ok.filter((r) => r.hit_1d_100 === true).length;
    const hit5d = ok.filter((r) => r.hit_5d_max_250 === true).length;
    const sum1 = ok.reduce((s, r) => s + (r.ret_1d ?? 0), 0);
    const sum5 = ok.reduce((s, r) => s + (r.ret_5d_max ?? 0), 0);
    const [sector, event_type] = k.split("/");
    return {
      sector,
      event_type,
      n: ok.length,
      n_total: list.length,
      hit,
      hit_1d_100: hit1d,
      hit_5d_max_250: hit5d,
      hit_rate: ok.length ? hit / ok.length : 0,
      avg_ret_1d: ok.length ? sum1 / ok.length : 0,
      avg_ret_5d_max: ok.length ? sum5 / ok.length : 0,
    };
  });

  aggregates.sort((a, b) => b.hit_rate - a.hit_rate);

  return new Response(
    JSON.stringify({
      rows,
      aggregates,
      ran_at: rows[0]?.ran_at ?? null,
      total: rows.length,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};

export const config: Config = {
  path: "/api/backtest",
};
