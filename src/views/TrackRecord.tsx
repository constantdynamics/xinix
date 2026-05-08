import { useEffect, useState } from "react";
import { Card, SectionHeader, Stat } from "../components/ui";

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
  min_completeness: number;
  total_signals_unfiltered: number;
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
  const [minCompleteness, setMinCompleteness] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/track-record?min_completeness=${minCompleteness}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return (await r.json()) as TrackRecord;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [minCompleteness]);

  if (loading && !data)
    return <div className="text-neutral-500 text-sm">laden…</div>;
  if (error)
    return (
      <div className="rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
        {error}
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Validatie"
        title="Track record"
        subtitle={`Forward returns over de laatste ${data.window_days} dagen.`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Signalen"
          value={data.total_signals.toString()}
          hint={
            data.total_signals_unfiltered !== data.total_signals
              ? `${
                  data.total_signals_unfiltered - data.total_signals
                } gefilterd`
              : "alle in scope"
          }
          tone="pink"
        />
        <Stat
          label="Returns gemeten"
          value={data.total_returns_recorded.toString()}
          hint="met 7/14/30/90d data"
        />
        <Stat
          label="Window"
          value={`${data.window_days}d`}
          hint="rolling lookback"
        />
        <Stat
          label="Completeness filter"
          value={`${(minCompleteness * 100).toFixed(0)}%`}
          hint="min veld-vulling"
        />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold">
            Min data completeness
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={minCompleteness}
            onChange={(e) => setMinCompleteness(Number(e.target.value))}
            className="w-56"
          />
          <span className="text-fog-pink font-bold tabular text-sm">
            {(minCompleteness * 100).toFixed(0)}%
          </span>
          <span className="text-xs text-neutral-500">
            Filter ondergevulde tickers eruit om signaal van ruis te scheiden.
          </span>
        </div>
      </Card>

      <div className="rounded-xl border border-fog-warn/30 bg-fog-warn/10 p-3 text-xs text-fog-warn">
        ⚠ {data.caveat}
      </div>

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
          <div className="space-y-3">
            {Object.entries(data.by_catalyst).map(([cat, stats]) => (
              <Card key={cat} className="p-3">
                <div className="text-[11px] uppercase tracking-wider font-bold text-fog-pink mb-2">
                  {cat}
                </div>
                <ActionTable stats={stats} compact />
              </Card>
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
      <h3 className="text-[11px] uppercase tracking-[0.2em] font-bold text-neutral-500 mb-2">
        {title}
      </h3>
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
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500">
            <tr>
              <th className="p-2.5 text-left">Actie</th>
              <th className="p-2.5 text-left">Horizon</th>
              <th className="p-2.5 text-right">Signals</th>
              <th className="p-2.5 text-right">N</th>
              <th className="p-2.5 text-right">Mean</th>
              <th className="p-2.5 text-right">Median</th>
              {!compact && <th className="p-2.5 text-right">P25/P75</th>}
              <th className="p-2.5 text-right">≥50%</th>
              <th className="p-2.5 text-right">≥100%</th>
              <th className="p-2.5 text-right">≤−25%</th>
            </tr>
          </thead>
          <tbody>
            {ACTIONS.flatMap((a) =>
              HORIZONS.map((h) => {
                const b = stats[a]?.[h];
                if (!b) return null;
                const actionClass =
                  a === "STRONG_BUY"
                    ? "text-fog-lime font-bold"
                    : a === "BUY"
                    ? "text-fog-pink font-semibold"
                    : "text-neutral-400";
                return (
                  <tr
                    key={`${a}-${h}`}
                    className="border-t border-ink-5 hover:bg-ink-3/40"
                  >
                    <td className="p-2.5">
                      <span className={actionClass}>{a}</span>
                    </td>
                    <td className="p-2.5 text-neutral-500 tabular">{h}</td>
                    <td className="p-2.5 text-right tabular">{b.signals}</td>
                    <td className="p-2.5 text-right tabular text-neutral-400">
                      {b.n}
                    </td>
                    <td
                      className={`p-2.5 text-right tabular ${
                        b.mean >= 0 ? "text-fog-lime" : "text-fog-loss"
                      }`}
                    >
                      {b.n ? ret(b.mean) : "—"}
                    </td>
                    <td className="p-2.5 text-right tabular">
                      {b.n ? ret(b.median) : "—"}
                    </td>
                    {!compact && (
                      <td className="p-2.5 text-right tabular text-neutral-500">
                        {b.n ? `${ret(b.p25)} / ${ret(b.p75)}` : "—"}
                      </td>
                    )}
                    <td className="p-2.5 text-right tabular">
                      {b.n ? pct(b.hit_rate_50pct) : "—"}
                    </td>
                    <td className="p-2.5 text-right tabular">
                      {b.n ? pct(b.hit_rate_100pct) : "—"}
                    </td>
                    <td className="p-2.5 text-right tabular text-fog-loss">
                      {b.n ? pct(b.loss_rate_25pct) : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
