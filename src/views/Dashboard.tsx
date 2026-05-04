import type { Dashboard, Card } from "../types";
import { COLOR_BG, COLOR_DOT, COLOR_LABEL_NL } from "../colors";
import { triggerJob } from "../api";
import { useState } from "react";

const JOBS = [
  ["poll-prices-background", "Prijzen"],
  ["poll-trials-background", "Klinische trials"],
  ["poll-edgar-background", "SEC 8-K"],
  ["poll-fda-background", "FDA approvals"],
  ["compute-signals-background", "Pre-catalyst signalen"],
  ["dispatch-alerts-background", "Verstuur alerts"],
];

export function DashboardView({
  data,
}: {
  data: Dashboard;
  onRefresh: () => void;
}) {
  const counts = data.cards.reduce(
    (acc, c) => {
      acc[c.color]++;
      return acc;
    },
    { white: 0, yellow: 0, orange: 0, red: 0 }
  );
  return (
    <div className="space-y-6">
      <Legend counts={counts} />
      <JobControls />
      <CardGrid cards={data.cards} />
      <Catalysts data={data} />
      <RecentSignals data={data} />
      <RunLog data={data} />
    </div>
  );
}

function Legend({
  counts,
}: {
  counts: Record<"white" | "yellow" | "orange" | "red", number>;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {(["red", "orange", "yellow", "white"] as const).map((c) => (
        <div
          key={c}
          className="flex items-center gap-2 px-3 py-2 bg-slate-900 rounded border border-slate-800"
        >
          <span
            className={`inline-block w-3 h-3 rounded-full ring-2 ${COLOR_DOT[c]}`}
          />
          <span className="text-sm text-slate-300">
            {COLOR_LABEL_NL[c]}{" "}
            <span className="text-slate-500">({counts[c]})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function JobControls() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(job: string) {
    setBusy(job);
    setMsg(null);
    try {
      await triggerJob(job);
      setMsg(`${job}: getriggerd. Resultaat verschijnt in run log over 1-2 min.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">
        Handmatig triggeren (vereist admin token)
      </div>
      <div className="flex flex-wrap gap-2">
        {JOBS.map(([job, label]) => (
          <button
            key={job}
            onClick={() => run(job)}
            disabled={busy === job}
            className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded disabled:opacity-50"
          >
            {busy === job ? "..." : label}
          </button>
        ))}
      </div>
      {msg && <div className="mt-2 text-xs text-slate-300">{msg}</div>}
    </div>
  );
}

function CardGrid({ cards }: { cards: Card[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {cards.map((c) => (
        <CardTile key={c.ticker} card={c} />
      ))}
    </div>
  );
}

function CardTile({ card: c }: { card: Card }) {
  const px = c.summary;
  return (
    <div
      className={`rounded-lg border-2 p-3 shadow-sm ${COLOR_BG[c.color]}`}
      title={`${c.color} = ${COLOR_LABEL_NL[c.color]}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-bold text-lg">{c.ticker}</div>
        <div className="text-xs opacity-80">
          score {c.goud_score ?? "?"}
          {c.goud_type ? ` · ${c.goud_type}` : ""}
        </div>
      </div>
      <div className="text-xs opacity-90 truncate">{c.company}</div>
      <div className="text-xs opacity-75 truncate">
        {[c.modality, c.disease_area, c.phase].filter(Boolean).join(" · ")}
      </div>

      {px && (
        <div className="mt-2 text-xs opacity-90">
          ${px.last_close?.toFixed(2)}{" "}
          <span
            className={
              (px.pct_change_1d ?? 0) > 0
                ? "text-emerald-700"
                : (px.pct_change_1d ?? 0) < 0
                ? "text-red-900"
                : ""
            }
          >
            ({(px.pct_change_1d ?? 0).toFixed(1)}% 1d)
          </span>
          {" · "}
          {(px.pct_above_90d_low ?? 0).toFixed(0)}% boven 90d-low
        </div>
      )}

      {c.next_catalyst && (
        <div className="mt-2 text-xs opacity-90">
          ⏱ {c.next_catalyst.catalyst_type} over {c.days_to_next_catalyst}d
          <div className="opacity-75 truncate">
            {c.next_catalyst.description}
          </div>
        </div>
      )}

      {c.top_signal && (
        <div className="mt-2 pt-2 border-t border-current/20 text-xs">
          <div className="font-semibold">{c.top_signal.title}</div>
          {c.top_signal.detail && (
            <div className="opacity-80 line-clamp-2">{c.top_signal.detail}</div>
          )}
        </div>
      )}

      {c.active_signals > 1 && (
        <div className="mt-1 text-[10px] opacity-70">
          {c.active_signals} actieve signalen
        </div>
      )}
    </div>
  );
}

function Catalysts({ data }: { data: Dashboard }) {
  const cats = data.upcoming_catalysts.slice(0, 15);
  if (cats.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-2">
        Verwachte katalysators
      </h2>
      <div className="bg-slate-900 border border-slate-800 rounded">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="text-left p-2">Datum</th>
              <th className="text-left p-2">Ticker</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Omschrijving</th>
              <th className="text-left p-2">Bron</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className="border-t border-slate-800">
                <td className="p-2 whitespace-nowrap text-slate-300">
                  {c.expected_date}
                </td>
                <td className="p-2 font-semibold">{c.ticker}</td>
                <td className="p-2 text-slate-300">{c.catalyst_type}</td>
                <td className="p-2 text-slate-400 truncate max-w-md">
                  {c.description}
                </td>
                <td className="p-2 text-xs text-slate-500">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentSignals({ data }: { data: Dashboard }) {
  const sigs = data.recent_signals.slice(0, 20);
  if (sigs.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-2">
        Recente signalen
      </h2>
      <div className="space-y-1">
        {sigs.map((s) => (
          <div
            key={s.id}
            className={`flex items-start gap-2 p-2 rounded border ${COLOR_BG[s.severity]}`}
          >
            <span className="font-bold w-16">{s.ticker}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{s.title}</div>
              {s.detail && (
                <div className="text-xs opacity-80 truncate">{s.detail}</div>
              )}
            </div>
            <span className="text-xs opacity-70 whitespace-nowrap">
              {new Date(s.detected_at).toLocaleString("nl-NL")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RunLog({ data }: { data: Dashboard }) {
  if (data.run_log.length === 0) return null;
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-2">
        Job log
      </h2>
      <div className="bg-slate-900 border border-slate-800 rounded text-xs">
        {data.run_log.slice(0, 10).map((r, i) => (
          <div
            key={i}
            className="flex gap-3 p-2 border-t border-slate-800 first:border-t-0"
          >
            <span
              className={
                r.ok === true
                  ? "text-emerald-400"
                  : r.ok === false
                  ? "text-red-400"
                  : "text-slate-500"
              }
            >
              ●
            </span>
            <span className="font-mono text-slate-300 w-44">{r.job}</span>
            <span className="text-slate-500 w-44">
              {new Date(r.started_at).toLocaleString("nl-NL")}
            </span>
            <span className="text-slate-400 truncate flex-1">
              {r.message ?? (r.finished_at ? "ok" : "running...")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
