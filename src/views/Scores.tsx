import { useEffect, useMemo, useState } from "react";
import { triggerJob, getToken } from "../api";
import { googleFinanceUrl } from "../tickerLinks";

type Action = "STRONG_BUY" | "BUY" | "WATCH" | "HOLD" | "AVOID";

interface Component {
  name: string;
  weight: number;
  triggered: boolean;
}

interface NearestCatalyst {
  type: string;
  daysUntil: number;
}

interface ExitRule {
  trigger: string;
  detail: string;
}

interface TradeSetup {
  entry: number;
  target: number;
  stop: number;
  rr: number;
  positionSizeUsd: number;
  maxHoldDays: number;
  exits: ExitRule[];
  notes: string[];
}

interface ScoreRow {
  ticker: string;
  sector: "biotech" | "mining";
  scan_date: string;
  mode: string;
  structural: number;
  catalyst: number;
  timing: number;
  confluence: number;
  risk_penalty: number;
  cycle_multiplier: number;
  final_score: number;
  action: Action;
  flagged_warnings: string[];
  components: {
    structural: Component[];
    catalyst: Component[];
    timing: Component[];
    nearest_catalyst: NearestCatalyst | null;
  };
  trade_setup: TradeSetup | null;
  expected_outcome: ExpectedOutcome | null;
  data_completeness: number;
}

interface ExpectedOutcome {
  catalystType: string;
  catalystLabel: string;
  hitRateBaseline: number;
  peakReturnEst: number;
  t90ReturnEst: number;
  expectedPeakPrice: number | null;
  expectedT90Price: number | null;
  exitWindowDays: number;
  warning: string;
  caveat: string;
}

interface Payload {
  rows: ScoreRow[];
  counts: Record<Action, number>;
  mode: string;
  scan_date: string;
}

const ACTION_STYLE: Record<Action, string> = {
  STRONG_BUY: "bg-emerald-500 text-slate-950",
  BUY: "bg-emerald-700 text-white",
  WATCH: "bg-amber-600 text-white",
  HOLD: "bg-slate-600 text-slate-200",
  AVOID: "bg-red-700 text-white",
};

async function fetchScores(mode: string): Promise<Payload> {
  const res = await fetch(`/api/scores?mode=${encodeURIComponent(mode)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Payload;
}

export function ScoresView() {
  const [data, setData] = useState<Payload | null>(null);
  const [mode, setMode] = useState<"trader" | "investor">("trader");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "actionable" | Action>("all");
  const [sectorFilter, setSectorFilter] = useState<"all" | "biotech" | "mining">(
    "all"
  );

  async function load() {
    try {
      setData(await fetchScores(mode));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, [mode]);

  async function recompute() {
    if (!getToken()) {
      setError("Eerst Admin token instellen bovenaan");
      return;
    }
    setBusy(true);
    try {
      await triggerJob("compute-scores-background");
      // Wacht 3s dan reload
      await new Promise((r) => setTimeout(r, 3000));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const visibleRows = useMemo(() => {
    if (!data) return [];
    let rows = data.rows;
    if (sectorFilter !== "all") rows = rows.filter((r) => r.sector === sectorFilter);
    if (filter === "actionable")
      rows = rows.filter((r) => r.action === "STRONG_BUY" || r.action === "BUY");
    else if (filter !== "all") rows = rows.filter((r) => r.action === filter);
    return rows;
  }, [data, filter, sectorFilter]);

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Scores</h2>
            <p className="text-xs text-slate-400">
              Driedimensionaal: Structureel × Catalyst × Timing met geometrisch
              gemiddelde. Trader mode is geoptimaliseerd voor swing trades op
              piek‑detectie.
            </p>
          </div>
          <div className="flex gap-2 text-xs items-center">
            <span className="text-slate-400">Mode:</span>
            <button
              onClick={() => setMode("trader")}
              className={`px-2 py-1 rounded border ${
                mode === "trader"
                  ? "bg-slate-100 text-slate-900 border-slate-100"
                  : "border-slate-700 text-slate-300"
              }`}
            >
              Trader (default)
            </button>
            <button
              onClick={() => setMode("investor")}
              className={`px-2 py-1 rounded border ${
                mode === "investor"
                  ? "bg-slate-100 text-slate-900 border-slate-100"
                  : "border-slate-700 text-slate-300"
              }`}
            >
              Investor
            </button>
            <button
              onClick={recompute}
              disabled={busy}
              className="px-3 py-1 ml-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white"
            >
              {busy ? "Bezig..." : "Herbereken"}
            </button>
          </div>
        </div>
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        {data && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {(["STRONG_BUY", "BUY", "WATCH", "HOLD", "AVOID"] as Action[]).map(
              (a) => (
                <button
                  key={a}
                  onClick={() => setFilter(a === filter ? "all" : a)}
                  className={`px-2 py-1 rounded border ${
                    filter === a
                      ? `${ACTION_STYLE[a]} border-transparent`
                      : "border-slate-700 text-slate-300"
                  }`}
                >
                  {a} <span className="opacity-70">{data.counts[a]}</span>
                </button>
              )
            )}
            <button
              onClick={() =>
                setFilter(filter === "actionable" ? "all" : "actionable")
              }
              className={`px-2 py-1 rounded border ${
                filter === "actionable"
                  ? "bg-slate-100 text-slate-900 border-slate-100"
                  : "border-slate-700 text-slate-300"
              }`}
            >
              Alleen actionable
            </button>
            <span className="mx-2 text-slate-700">|</span>
            {(["all", "biotech", "mining"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSectorFilter(s)}
                className={`px-2 py-1 rounded border ${
                  sectorFilter === s
                    ? "bg-slate-100 text-slate-900 border-slate-100"
                    : "border-slate-700 text-slate-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {data && visibleRows.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded p-4 text-sm text-slate-400">
          Geen scores. Klik <strong>Herbereken</strong> of voeg eerst tickers
          toe via de Watchlist tab.
        </div>
      )}

      <div className="space-y-2">
        {visibleRows.map((r) => (
          <ScoreCard
            key={r.ticker}
            row={r}
            expanded={expanded === r.ticker}
            onToggle={() => setExpanded(expanded === r.ticker ? null : r.ticker)}
          />
        ))}
      </div>
    </div>
  );
}

function ScoreCard({
  row,
  expanded,
  onToggle,
}: {
  row: ScoreRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  return (
    <div className="bg-slate-900 border border-slate-800 rounded">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full p-3 flex items-center gap-3 hover:bg-slate-800/40 text-left cursor-pointer"
      >
        <span
          className={`px-2 py-0.5 text-xs font-bold rounded ${
            ACTION_STYLE[row.action]
          }`}
        >
          {row.action}
        </span>
        <a
          href={googleFinanceUrl(row.ticker)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono font-bold text-base text-sky-300 hover:underline"
          title={`Open ${row.ticker} op Google Finance`}
        >
          {row.ticker}
        </a>
        <span className="text-xs text-slate-400 uppercase">{row.sector}</span>
        <span className="ml-auto flex gap-3 text-xs items-center">
          <SubBar label="S" value={row.structural} color="cyan" />
          <SubBar label="C" value={row.catalyst} color="violet" />
          <SubBar label="T" value={row.timing} color="amber" />
          <span className="font-mono text-base font-bold">
            {row.final_score.toFixed(2)}
          </span>
          {row.components.nearest_catalyst && (
            <span className="text-slate-400">
              {row.components.nearest_catalyst.type} ·{" "}
              {row.components.nearest_catalyst.daysUntil}d
            </span>
          )}
          <span className="text-slate-600">{expanded ? "▾" : "▸"}</span>
        </span>
      </div>
      {expanded && (
        <div className="border-t border-slate-800 p-3 space-y-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <Breakdown title="Structureel" comps={row.components.structural} />
            <Breakdown title="Catalyst" comps={row.components.catalyst} />
            <Breakdown title="Timing" comps={row.components.timing} />
          </div>
          <div className="text-xs text-slate-400">
            Confluence {pct(row.confluence)} − risk {pct(row.risk_penalty)}{" "}
            {row.cycle_multiplier !== 1 &&
              `× cycle ${row.cycle_multiplier.toFixed(2)}`}{" "}
            = <strong className="text-slate-200">{row.final_score.toFixed(3)}</strong>
            {row.flagged_warnings.length > 0 && (
              <span className="ml-2 text-amber-400">
                ⚠ {row.flagged_warnings.join(", ")}
              </span>
            )}
            <span className="ml-2 text-slate-600">
              · data completeness {pct(row.data_completeness)}
            </span>
          </div>
          {row.trade_setup && (
            <div className="border border-emerald-900 bg-emerald-950/30 rounded p-3">
              <h4 className="text-sm font-semibold mb-2">Trade setup</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat label="Entry" value={`$${row.trade_setup.entry}`} />
                <Stat
                  label="Target"
                  value={`$${row.trade_setup.target}`}
                  hl="emerald"
                />
                <Stat label="Stop" value={`$${row.trade_setup.stop}`} hl="red" />
                <Stat label="R:R" value={row.trade_setup.rr.toFixed(2)} />
                <Stat
                  label="Positie"
                  value={`$${row.trade_setup.positionSizeUsd.toLocaleString()}`}
                />
                <Stat
                  label="Max hold"
                  value={`${row.trade_setup.maxHoldDays}d`}
                />
              </div>
              <ul className="mt-2 text-xs text-slate-300 space-y-1">
                {row.trade_setup.exits.map((e, i) => (
                  <li key={i}>
                    <strong className="text-slate-100">{e.trigger}:</strong>{" "}
                    {e.detail}
                  </li>
                ))}
              </ul>
              {row.trade_setup.notes.length > 0 && (
                <ul className="mt-2 text-xs text-amber-400 space-y-0.5">
                  {row.trade_setup.notes.map((n, i) => (
                    <li key={i}>⚠ {n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {row.expected_outcome && (
            <div className="border border-violet-900 bg-violet-950/30 rounded p-3">
              <h4 className="text-sm font-semibold mb-2">
                Verwachte uitkomst{" "}
                <span className="text-xs font-normal text-slate-400">
                  ({row.expected_outcome.catalystLabel})
                </span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <Stat
                  label="Hit rate baseline"
                  value={pct(row.expected_outcome.hitRateBaseline)}
                />
                <Stat
                  label="Peak ret est."
                  value={pct(row.expected_outcome.peakReturnEst)}
                  hl="emerald"
                />
                <Stat
                  label="T+90 ret est."
                  value={pct(row.expected_outcome.t90ReturnEst)}
                />
                <Stat
                  label="Exit window"
                  value={`${row.expected_outcome.exitWindowDays}d`}
                />
                {row.expected_outcome.expectedPeakPrice != null && (
                  <Stat
                    label="Peak prijs"
                    value={`$${row.expected_outcome.expectedPeakPrice}`}
                    hl="emerald"
                  />
                )}
                {row.expected_outcome.expectedT90Price != null && (
                  <Stat
                    label="T+90 prijs"
                    value={`$${row.expected_outcome.expectedT90Price}`}
                  />
                )}
              </div>
              <p className="mt-2 text-xs text-amber-400">
                ⚠ {row.expected_outcome.warning}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {row.expected_outcome.caveat}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "cyan" | "violet" | "amber";
}) {
  const colors = {
    cyan: "bg-cyan-600",
    violet: "bg-violet-600",
    amber: "bg-amber-600",
  };
  return (
    <span className="flex items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className="w-16 h-1.5 bg-slate-800 rounded overflow-hidden">
        <span
          className={`block h-full ${colors[color]}`}
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      </span>
      <span className="text-slate-400 w-9">{(value * 100).toFixed(0)}%</span>
    </span>
  );
}

function Breakdown({ title, comps }: { title: string; comps: Component[] }) {
  const triggered = comps.filter((c) => c.triggered);
  return (
    <div className="bg-slate-950/50 border border-slate-800 rounded p-2">
      <h5 className="text-slate-300 mb-1">{title}</h5>
      {triggered.length === 0 ? (
        <p className="text-slate-600">Geen signalen actief</p>
      ) : (
        <ul className="space-y-0.5">
          {triggered.map((c) => (
            <li key={c.name} className="flex justify-between text-slate-400">
              <span className="truncate">{c.name}</span>
              <span
                className={c.weight < 0 ? "text-red-400" : "text-emerald-400"}
              >
                {c.weight >= 0 ? "+" : ""}
                {c.weight}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hl,
}: {
  label: string;
  value: string;
  hl?: "emerald" | "red";
}) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] uppercase">{label}</div>
      <div
        className={`font-mono font-semibold ${
          hl === "emerald"
            ? "text-emerald-300"
            : hl === "red"
            ? "text-red-300"
            : "text-slate-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
