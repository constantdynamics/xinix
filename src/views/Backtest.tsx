import { useEffect, useState } from "react";
import { triggerJob, getToken, apiUrl } from "../api";
import { SECTOR_TONE, type Sector } from "../types";
import {
  Card,
  Button,
  Badge,
  SectionHeader,
  DotBar,
} from "../components/ui";

interface Aggregate {
  sector: string;
  event_type: string;
  n: number;
  n_total: number;
  hit: number;
  hit_1d_100: number;
  hit_5d_max_250: number;
  hit_rate: number;
  avg_ret_1d: number;
  avg_ret_5d_max: number;
}

interface Row {
  ticker: string;
  sector: string;
  event_date: string;
  event_type: string;
  note: string | null;
  status: string;
  ret_1d: number | null;
  ret_5d_max: number | null;
  hit_1d_100: boolean | null;
  hit_5d_max_250: boolean | null;
  error: string | null;
}

interface Payload {
  rows: Row[];
  aggregates: Aggregate[];
  ran_at: string | null;
  total: number;
}

async function fetchBacktest(): Promise<Payload> {
  const res = await fetch(apiUrl("/api/backtest"));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Payload;
}

export function BacktestView() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await fetchBacktest());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function runBacktest() {
    if (!getToken()) {
      setError("Eerst Admin token instellen bovenaan");
      return;
    }
    setBusy(true);
    setMsg(
      "Backtest gestart — Yahoo wordt nu langzaam doorlopen, dit duurt ~1 min. Vernieuw straks."
    );
    try {
      await triggerJob("backtest-background");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Historisch"
        title="Backtest"
        subtitle="Gecureerde cases · Yahoo prijzen rond event-datum · 1d en 5d-max returns."
        aside={
          <>
            <Button variant="ghost" size="sm" onClick={load}>
              ↻ vernieuw
            </Button>
            <Button
              variant="buy"
              size="sm"
              onClick={runBacktest}
              disabled={busy}
            >
              {busy ? "Bezig…" : "Run backtest"}
            </Button>
          </>
        }
      />

      {data?.ran_at && (
        <div className="text-xs text-neutral-500">
          Laatste run:{" "}
          <span className="text-neutral-300 tabular">
            {new Date(data.ran_at).toLocaleString("nl-NL")}
          </span>{" "}
          · {data.total} cases
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-fog-lime/40 bg-fog-lime/10 p-3 text-sm text-fog-lime">
          {msg}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
          {error}
        </div>
      )}

      {data && data.aggregates.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-neutral-500 mb-2">
            Hit-rate per type
          </h3>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
                  <tr>
                    <th className="text-left p-3">Sector / type</th>
                    <th className="text-right p-3">n</th>
                    <th className="text-right p-3">hit</th>
                    <th className="text-right p-3">hit-rate</th>
                    <th className="p-3 w-32">distribution</th>
                    <th className="text-right p-3">≥100%/1d</th>
                    <th className="text-right p-3">≥250%/5d</th>
                    <th className="text-right p-3">avg 1d</th>
                    <th className="text-right p-3">avg 5d-max</th>
                  </tr>
                </thead>
                <tbody>
                  {data.aggregates.map((a) => {
                    const tone =
                      a.hit_rate >= 0.5
                        ? "text-fog-lime"
                        : a.hit_rate >= 0.25
                        ? "text-fog-watch"
                        : "text-fog-loss";
                    return (
                      <tr
                        key={`${a.sector}/${a.event_type}`}
                        className="border-t border-ink-5 hover:bg-ink-3/40"
                      >
                        <td className="p-3">
                          <Badge
                            tone={SECTOR_TONE[(a.sector as Sector) ?? "other"] ?? "neutral"}
                          >
                            {a.sector}
                          </Badge>
                          <span className="font-mono text-xs ml-2 text-neutral-300">
                            {a.event_type}
                          </span>
                        </td>
                        <td className="p-3 text-right tabular text-neutral-400">
                          {a.n}
                        </td>
                        <td className="p-3 text-right tabular">{a.hit}</td>
                        <td
                          className={`p-3 text-right tabular font-bold ${tone}`}
                        >
                          {(a.hit_rate * 100).toFixed(0)}%
                        </td>
                        <td className="p-3">
                          <DotBar progress={a.hit_rate} count={10} />
                        </td>
                        <td className="p-3 text-right tabular text-neutral-400">
                          {a.hit_1d_100}
                        </td>
                        <td className="p-3 text-right tabular text-neutral-400">
                          {a.hit_5d_max_250}
                        </td>
                        <td
                          className={`p-3 text-right tabular ${
                            a.avg_ret_1d > 0
                              ? "text-fog-lime"
                              : "text-fog-loss"
                          }`}
                        >
                          {(a.avg_ret_1d * 100).toFixed(0)}%
                        </td>
                        <td className="p-3 text-right tabular text-neutral-400">
                          {(a.avg_ret_5d_max * 100).toFixed(0)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      {data && data.rows.length > 0 && (
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-neutral-500 mb-2">
            Alle cases
          </h3>
          <Card className="overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/60 sticky top-0">
                  <tr>
                    <th className="text-left p-2.5">Sector</th>
                    <th className="text-left p-2.5">Ticker</th>
                    <th className="text-left p-2.5">Datum</th>
                    <th className="text-left p-2.5">Type</th>
                    <th className="text-right p-2.5">1d</th>
                    <th className="text-right p-2.5">5d-max</th>
                    <th className="text-left p-2.5">Hit?</th>
                    <th className="text-left p-2.5">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr
                      key={i}
                      className="border-t border-ink-5 hover:bg-ink-3/40"
                    >
                      <td className="p-2.5">
                        <Badge tone={SECTOR_TONE[(r.sector as Sector) ?? "other"] ?? "neutral"}>
                          {r.sector}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-mono font-bold text-fog-pink">
                        {r.ticker}
                      </td>
                      <td className="p-2.5 text-neutral-500 tabular">
                        {r.event_date}
                      </td>
                      <td className="p-2.5 text-neutral-300">{r.event_type}</td>
                      <td
                        className={`p-2.5 text-right tabular ${
                          (r.ret_1d ?? 0) >= 1
                            ? "text-fog-lime font-bold"
                            : (r.ret_1d ?? 0) <= -0.2
                            ? "text-fog-loss"
                            : "text-neutral-400"
                        }`}
                      >
                        {r.status === "ok" && r.ret_1d != null
                          ? `${(r.ret_1d * 100).toFixed(0)}%`
                          : r.status}
                      </td>
                      <td
                        className={`p-2.5 text-right tabular ${
                          (r.ret_5d_max ?? 0) >= 2.5
                            ? "text-fog-lime font-bold"
                            : "text-neutral-400"
                        }`}
                      >
                        {r.status === "ok" && r.ret_5d_max != null
                          ? `${(r.ret_5d_max * 100).toFixed(0)}%`
                          : ""}
                      </td>
                      <td className="p-2.5 space-x-1">
                        {r.hit_1d_100 && <Badge tone="lime">1D</Badge>}
                        {r.hit_5d_max_250 && <Badge tone="pink">5D</Badge>}
                      </td>
                      <td className="p-2.5 text-neutral-400 truncate max-w-md">
                        {r.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}
