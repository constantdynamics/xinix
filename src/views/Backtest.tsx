import { useEffect, useState } from "react";
import { triggerJob, getToken } from "../api";

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
  const res = await fetch("/api/backtest");
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
    setMsg("Backtest gestart — Yahoo wordt nu langzaam doorlopen, dit duurt ~1 min. Vernieuw straks.");
    try {
      await triggerJob("backtest-background");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <h2 className="text-lg font-semibold mb-2">Historische backtest</h2>
        <p className="text-sm text-slate-400 mb-3">
          Voor elke gecureerde case (~107 biotech+mining events met datum +
          type) haalt de server Yahoo‑prijzen op rond de event‑datum en
          berekent: 1‑day return, 5‑day max return, en of de bar werd gehaald
          (≥100%/dag of ≥250%/5d). Resultaten per <code>sector/event_type</code>
          {" "}laten zien welke types echt goud‑medaille triggers zijn.
        </p>
        <div className="flex gap-2 items-center">
          <button
            onClick={runBacktest}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded"
          >
            {busy ? "Bezig..." : "Run backtest"}
          </button>
          <button
            onClick={load}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded"
          >
            Vernieuw
          </button>
          {data?.ran_at && (
            <span className="text-xs text-slate-500">
              Laatste run: {new Date(data.ran_at).toLocaleString("nl-NL")} ·{" "}
              {data.total} cases
            </span>
          )}
        </div>
        {msg && <div className="mt-2 text-xs text-emerald-400">{msg}</div>}
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
      </div>

      {data && data.aggregates.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded">
          <h3 className="px-4 py-2 text-sm uppercase tracking-wide text-slate-400 border-b border-slate-800">
            Hit‑rate per type
          </h3>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="text-left p-2">Sector / type</th>
                <th className="text-right p-2">n</th>
                <th className="text-right p-2">hit</th>
                <th className="text-right p-2">hit‑rate</th>
                <th className="text-right p-2">≥100%/1d</th>
                <th className="text-right p-2">≥250%/5d</th>
                <th className="text-right p-2">avg 1d</th>
                <th className="text-right p-2">avg 5d‑max</th>
              </tr>
            </thead>
            <tbody>
              {data.aggregates.map((a) => (
                <tr
                  key={`${a.sector}/${a.event_type}`}
                  className="border-t border-slate-800"
                >
                  <td className="p-2">
                    <span className="text-xs uppercase opacity-60 mr-1">
                      {a.sector}
                    </span>
                    <span className="font-mono">{a.event_type}</span>
                  </td>
                  <td className="p-2 text-right text-slate-400">{a.n}</td>
                  <td className="p-2 text-right">{a.hit}</td>
                  <td
                    className={`p-2 text-right font-semibold ${
                      a.hit_rate >= 0.5
                        ? "text-emerald-400"
                        : a.hit_rate >= 0.25
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {(a.hit_rate * 100).toFixed(0)}%
                  </td>
                  <td className="p-2 text-right text-slate-400">
                    {a.hit_1d_100}
                  </td>
                  <td className="p-2 text-right text-slate-400">
                    {a.hit_5d_max_250}
                  </td>
                  <td className="p-2 text-right text-slate-400">
                    {(a.avg_ret_1d * 100).toFixed(0)}%
                  </td>
                  <td className="p-2 text-right text-slate-400">
                    {(a.avg_ret_5d_max * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded">
          <h3 className="px-4 py-2 text-sm uppercase tracking-wide text-slate-400 border-b border-slate-800">
            Alle cases
          </h3>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400 sticky top-0 bg-slate-900">
                <tr>
                  <th className="text-left p-2">Sector</th>
                  <th className="text-left p-2">Ticker</th>
                  <th className="text-left p-2">Datum</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">1d</th>
                  <th className="text-right p-2">5d‑max</th>
                  <th className="text-left p-2">Hit?</th>
                  <th className="text-left p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="p-2 uppercase opacity-60">{r.sector}</td>
                    <td className="p-2 font-mono">{r.ticker}</td>
                    <td className="p-2 text-slate-400">{r.event_date}</td>
                    <td className="p-2 text-slate-300">{r.event_type}</td>
                    <td
                      className={`p-2 text-right ${
                        (r.ret_1d ?? 0) >= 1
                          ? "text-emerald-400"
                          : (r.ret_1d ?? 0) <= -0.2
                          ? "text-red-400"
                          : "text-slate-400"
                      }`}
                    >
                      {r.status === "ok" && r.ret_1d != null
                        ? `${(r.ret_1d * 100).toFixed(0)}%`
                        : r.status}
                    </td>
                    <td
                      className={`p-2 text-right ${
                        (r.ret_5d_max ?? 0) >= 2.5
                          ? "text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      {r.status === "ok" && r.ret_5d_max != null
                        ? `${(r.ret_5d_max * 100).toFixed(0)}%`
                        : ""}
                    </td>
                    <td className="p-2">
                      {r.hit_1d_100 ? "🥇1d" : ""}
                      {r.hit_5d_max_250 ? "🥈5d" : ""}
                    </td>
                    <td className="p-2 text-slate-500 truncate max-w-md">
                      {r.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
