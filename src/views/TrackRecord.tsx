import { useEffect, useState } from "react";

interface BucketStats {
  signals: number;
  n: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
  hit_rate_50pct: number;
  hit_rate_100pct: number;
  loss_rate_25pct: number;
}

type ActionStats = Record<string, BucketStats>;
type SectorStats = Record<string, ActionStats>;

interface TrackRecord {
  as_of: string;
  window_days: number;
  total_signals: number;
  total_returns_recorded: number;
  overall: Record<string, ActionStats>;
  by_sector: Record<string, SectorStats>;
  by_catalyst: Record<string, SectorStats>;
  caveat: string;
}

const HORIZONS = ["d7", "d14", "d30", "d90"];
const ACTIONS = ["STRONG_BUY", "BUY", "WATCH"];

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function ret(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

export function TrackRecordView() {
  const [data, setData] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/track-record")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return (await r.json()) as TrackRecord;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-slate-400">laden...</div>;
  if (error) return <div className="text-red-400 text-sm">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Track record</h2>
        <p className="text-xs text-slate-400">
          Forward returns per actie/sector/catalyst over de laatste{" "}
          {data.window_days} dagen. {data.total_signals} signalen,{" "}
          {data.total_returns_recorded} returns vastgelegd.
        </p>
        <p className="mt-1 text-xs text-amber-400">⚠ {data.caveat}</p>
      </header>

      <Section title="Overall (alle sectoren)">
        <ActionTable stats={data.overall} />
      </Section>

      {Object.entries(data.by_sector).map(([sector, stats]) => (
        <Section key={sector} title={`Sector: ${sector}`}>
          <ActionTable stats={stats} />
        </Section>
      ))}

      {Object.keys(data.by_catalyst).length > 0 && (
        <Section title="Per catalyst type (top 10 by signal count)">
          <div className="space-y-4">
            {Object.entries(data.by_catalyst).map(([cat, stats]) => (
              <div
                key={cat}
                className="border border-slate-800 rounded p-3 bg-slate-900/50"
              >
                <div className="text-sm font-mono text-violet-300 mb-2">
                  {cat}
                </div>
                <ActionTable stats={stats} compact />
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold mb-2 text-slate-200">{title}</h3>
      {children}
    </section>
  );
}

function ActionTable({
  stats,
  compact,
}: {
  stats: Record<string, ActionStats>;
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-slate-800">
        <thead className="bg-slate-900 text-slate-400">
          <tr>
            <th className="p-2 text-left">Actie</th>
            <th className="p-2 text-left">Horizon</th>
            <th className="p-2 text-right">Signals</th>
            <th className="p-2 text-right">N (met return)</th>
            <th className="p-2 text-right">Mean</th>
            <th className="p-2 text-right">Median</th>
            {!compact && <th className="p-2 text-right">P25/P75</th>}
            <th className="p-2 text-right">Hit ≥50%</th>
            <th className="p-2 text-right">Hit ≥100%</th>
            <th className="p-2 text-right">Loss ≥25%</th>
          </tr>
        </thead>
        <tbody>
          {ACTIONS.flatMap((a) =>
            HORIZONS.map((h) => {
              const b = stats[a]?.[h];
              if (!b) return null;
              return (
                <tr
                  key={`${a}-${h}`}
                  className="border-t border-slate-800 hover:bg-slate-900/40"
                >
                  <td className="p-2">
                    <span
                      className={
                        a === "STRONG_BUY"
                          ? "text-emerald-400 font-semibold"
                          : a === "BUY"
                          ? "text-cyan-400"
                          : "text-slate-400"
                      }
                    >
                      {a}
                    </span>
                  </td>
                  <td className="p-2 text-slate-400">{h}</td>
                  <td className="p-2 text-right">{b.signals}</td>
                  <td className="p-2 text-right">{b.n}</td>
                  <td
                    className={`p-2 text-right font-mono ${
                      b.mean >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {b.n ? ret(b.mean) : "—"}
                  </td>
                  <td className="p-2 text-right font-mono">
                    {b.n ? ret(b.median) : "—"}
                  </td>
                  {!compact && (
                    <td className="p-2 text-right font-mono text-slate-500">
                      {b.n ? `${ret(b.p25)} / ${ret(b.p75)}` : "—"}
                    </td>
                  )}
                  <td className="p-2 text-right">
                    {b.n ? pct(b.hit_rate_50pct) : "—"}
                  </td>
                  <td className="p-2 text-right">
                    {b.n ? pct(b.hit_rate_100pct) : "—"}
                  </td>
                  <td className="p-2 text-right text-red-400">
                    {b.n ? pct(b.loss_rate_25pct) : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
