import { useEffect, useMemo, useState } from "react";
import { triggerJob, getToken } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import {
  Card,
  Button,
  Pill,
  Badge,
  SectionHeader,
  DotBar,
} from "../components/ui";

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

const ACTION_TONE: Record<Action, "lime" | "pink" | "watch" | "neutral" | "loss"> = {
  STRONG_BUY: "lime",
  BUY: "pink",
  WATCH: "watch",
  HOLD: "neutral",
  AVOID: "loss",
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
  const [sectorFilter, setSectorFilter] = useState<
    "all" | "biotech" | "mining"
  >("all");

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
    if (sectorFilter !== "all")
      rows = rows.filter((r) => r.sector === sectorFilter);
    if (filter === "actionable")
      rows = rows.filter(
        (r) => r.action === "STRONG_BUY" || r.action === "BUY"
      );
    else if (filter !== "all") rows = rows.filter((r) => r.action === filter);
    return rows;
  }, [data, filter, sectorFilter]);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ranking"
        title="Scores"
        subtitle="Driedimensionaal: Structureel × Catalyst × Timing met geometrisch gemiddelde."
        aside={
          <>
            <Pill
              tone="pink"
              active={mode === "trader"}
              onClick={() => setMode("trader")}
              size="sm"
            >
              Trader
            </Pill>
            <Pill
              tone="cyan"
              active={mode === "investor"}
              onClick={() => setMode("investor")}
              size="sm"
            >
              Investor
            </Pill>
            <Button
              size="sm"
              variant="buy"
              onClick={recompute}
              disabled={busy}
            >
              {busy ? "Bezig…" : "↻ Herbereken"}
            </Button>
          </>
        }
      />

      {error && (
        <div className="rounded-xl border border-fog-loss/40 bg-fog-loss/10 p-3 text-sm text-fog-loss">
          {error}
        </div>
      )}

      {data && (
        <Card className="p-3 flex flex-wrap items-center gap-2">
          <Pill
            tone="lime"
            active={filter === "STRONG_BUY"}
            onClick={() =>
              setFilter(filter === "STRONG_BUY" ? "all" : "STRONG_BUY")
            }
            count={data.counts.STRONG_BUY}
            size="sm"
          >
            STRONG_BUY
          </Pill>
          <Pill
            tone="pink"
            active={filter === "BUY"}
            onClick={() => setFilter(filter === "BUY" ? "all" : "BUY")}
            count={data.counts.BUY}
            size="sm"
          >
            BUY
          </Pill>
          <Pill
            tone="watch"
            active={filter === "WATCH"}
            onClick={() => setFilter(filter === "WATCH" ? "all" : "WATCH")}
            count={data.counts.WATCH}
            size="sm"
          >
            WATCH
          </Pill>
          <Pill
            tone="neutral"
            active={filter === "HOLD"}
            onClick={() => setFilter(filter === "HOLD" ? "all" : "HOLD")}
            count={data.counts.HOLD}
            size="sm"
          >
            HOLD
          </Pill>
          <Pill
            tone="loss"
            active={filter === "AVOID"}
            onClick={() => setFilter(filter === "AVOID" ? "all" : "AVOID")}
            count={data.counts.AVOID}
            size="sm"
          >
            AVOID
          </Pill>
          <span className="mx-1 text-neutral-700">|</span>
          <Pill
            tone="orange"
            active={filter === "actionable"}
            onClick={() =>
              setFilter(filter === "actionable" ? "all" : "actionable")
            }
            size="sm"
          >
            Actionable
          </Pill>
          <span className="mx-1 text-neutral-700">|</span>
          {(["all", "biotech", "mining"] as const).map((s) => (
            <Pill
              key={s}
              tone={
                s === "biotech" ? "cyan" : s === "mining" ? "watch" : "neutral"
              }
              active={sectorFilter === s}
              onClick={() => setSectorFilter(s)}
              size="sm"
            >
              {s}
            </Pill>
          ))}
        </Card>
      )}

      {data && visibleRows.length === 0 && (
        <Card className="p-8 text-center text-sm text-neutral-500">
          Geen scores. Klik <strong className="text-fog-pink">Herbereken</strong>{" "}
          of voeg eerst tickers toe via Watchlist.
        </Card>
      )}

      <div className="space-y-2">
        {visibleRows.map((r) => (
          <ScoreCard
            key={r.ticker}
            row={r}
            expanded={expanded === r.ticker}
            onToggle={() =>
              setExpanded(expanded === r.ticker ? null : r.ticker)
            }
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
    <Card className="overflow-hidden">
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
        className="w-full p-3 flex items-center gap-3 hover:bg-ink-3/40 text-left cursor-pointer transition"
      >
        <Badge tone={ACTION_TONE[row.action]}>{row.action}</Badge>
        <a
          href={googleFinanceUrl(row.ticker)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-bold text-base text-fog-pink hover:underline"
          title={`Open ${row.ticker} op Google Finance`}
        >
          {row.ticker}
        </a>
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">
          {row.sector}
        </span>
        <span className="ml-auto flex items-center gap-4 text-xs">
          <SubBar label="S" value={row.structural} tone="cyan" />
          <SubBar label="C" value={row.catalyst} tone="pink" />
          <SubBar label="T" value={row.timing} tone="watch" />
          <span className="text-base font-bold tabular text-neutral-50 w-12 text-right">
            {row.final_score.toFixed(2)}
          </span>
          {row.components.nearest_catalyst && (
            <span className="text-neutral-500 hidden md:inline">
              {row.components.nearest_catalyst.type} ·{" "}
              <span className="tabular text-neutral-300">
                {row.components.nearest_catalyst.daysUntil}d
              </span>
            </span>
          )}
          <span className="text-neutral-600 w-3">{expanded ? "▾" : "▸"}</span>
        </span>
      </div>
      {expanded && (
        <div className="border-t border-ink-5 p-4 space-y-4 text-sm bg-ink-1/40">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <Breakdown
              title="Structureel"
              tone="cyan"
              comps={row.components.structural}
            />
            <Breakdown
              title="Catalyst"
              tone="pink"
              comps={row.components.catalyst}
            />
            <Breakdown
              title="Timing"
              tone="watch"
              comps={row.components.timing}
            />
          </div>
          <div className="text-xs text-neutral-500">
            Confluence{" "}
            <span className="text-neutral-200 tabular">
              {pct(row.confluence)}
            </span>{" "}
            − risk{" "}
            <span className="text-neutral-200 tabular">
              {pct(row.risk_penalty)}
            </span>{" "}
            {row.cycle_multiplier !== 1 && (
              <>
                × cycle{" "}
                <span className="text-neutral-200 tabular">
                  {row.cycle_multiplier.toFixed(2)}
                </span>{" "}
              </>
            )}
            ={" "}
            <strong className="text-neutral-100 tabular">
              {row.final_score.toFixed(3)}
            </strong>
            <span className="ml-3 text-neutral-600">
              · completeness{" "}
              <span className="text-neutral-300 tabular">
                {pct(row.data_completeness)}
              </span>
            </span>
            {row.flagged_warnings.length > 0 && (
              <div className="mt-1 text-fog-warn">
                ⚠ {row.flagged_warnings.join(", ")}
              </div>
            )}
          </div>
          {row.trade_setup && (
            <div className="rounded-xl border border-fog-lime/30 bg-fog-lime/[0.04] p-3">
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-fog-lime mb-2">
                Trade setup
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <SetupStat label="Entry" value={`$${row.trade_setup.entry}`} />
                <SetupStat
                  label="Target"
                  value={`$${row.trade_setup.target}`}
                  tone="lime"
                />
                <SetupStat
                  label="Stop"
                  value={`$${row.trade_setup.stop}`}
                  tone="loss"
                />
                <SetupStat
                  label="R:R"
                  value={row.trade_setup.rr.toFixed(2)}
                  tone="pink"
                />
                <SetupStat
                  label="Positie"
                  value={`$${row.trade_setup.positionSizeUsd.toLocaleString()}`}
                />
                <SetupStat
                  label="Max hold"
                  value={`${row.trade_setup.maxHoldDays}d`}
                />
              </div>
              <ul className="mt-3 text-xs text-neutral-300 space-y-1">
                {row.trade_setup.exits.map((e, i) => (
                  <li key={i}>
                    <strong className="text-neutral-100">{e.trigger}:</strong>{" "}
                    {e.detail}
                  </li>
                ))}
              </ul>
              {row.trade_setup.notes.length > 0 && (
                <ul className="mt-2 text-xs text-fog-warn space-y-0.5">
                  {row.trade_setup.notes.map((n, i) => (
                    <li key={i}>⚠ {n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {row.expected_outcome && (
            <div className="rounded-xl border border-fog-pink/30 bg-fog-pink/[0.04] p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-fog-pink">
                  Verwachte uitkomst
                </div>
                <span className="text-xs text-neutral-500">
                  ({row.expected_outcome.catalystLabel})
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                <SetupStat
                  label="Hit rate"
                  value={pct(row.expected_outcome.hitRateBaseline)}
                />
                <SetupStat
                  label="Peak ret"
                  value={pct(row.expected_outcome.peakReturnEst)}
                  tone="lime"
                />
                <SetupStat
                  label="T+90 ret"
                  value={pct(row.expected_outcome.t90ReturnEst)}
                />
                <SetupStat
                  label="Exit window"
                  value={`${row.expected_outcome.exitWindowDays}d`}
                />
                {row.expected_outcome.expectedPeakPrice != null && (
                  <SetupStat
                    label="Peak prijs"
                    value={`$${row.expected_outcome.expectedPeakPrice}`}
                    tone="lime"
                  />
                )}
                {row.expected_outcome.expectedT90Price != null && (
                  <SetupStat
                    label="T+90 prijs"
                    value={`$${row.expected_outcome.expectedT90Price}`}
                  />
                )}
              </div>
              <p className="mt-3 text-xs text-fog-warn">
                ⚠ {row.expected_outcome.warning}
              </p>
              <p className="mt-1 text-[11px] text-neutral-500">
                {row.expected_outcome.caveat}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SubBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "cyan" | "pink" | "watch";
}) {
  return (
    <span className="hidden sm:flex items-center gap-1.5">
      <span className="text-neutral-600 text-[10px] font-bold w-2">
        {label}
      </span>
      <DotBar
        progress={Math.max(0, Math.min(1, value))}
        count={8}
        invert={false}
      />
      <span className="text-neutral-500 tabular w-8 text-right">
        {(value * 100).toFixed(0)}%
      </span>
      <span className="sr-only">{tone}</span>
    </span>
  );
}

function Breakdown({
  title,
  tone,
  comps,
}: {
  title: string;
  tone: "cyan" | "pink" | "watch";
  comps: Component[];
}) {
  const triggered = comps.filter((c) => c.triggered);
  const titleColor =
    tone === "cyan"
      ? "text-fog-info"
      : tone === "pink"
      ? "text-fog-pink"
      : "text-fog-watch";
  return (
    <div className="bg-ink-1 border border-ink-5 rounded-lg p-2.5">
      <div className={`text-[10px] uppercase tracking-wider font-bold ${titleColor} mb-1.5`}>
        {title}
      </div>
      {triggered.length === 0 ? (
        <p className="text-neutral-600">Geen signalen actief</p>
      ) : (
        <ul className="space-y-1">
          {triggered.map((c) => (
            <li
              key={c.name}
              className="flex justify-between text-neutral-400 gap-2"
            >
              <span className="truncate">{c.name}</span>
              <span
                className={`tabular ${
                  c.weight < 0 ? "text-fog-loss" : "text-fog-lime"
                }`}
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

function SetupStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "lime" | "loss" | "pink";
}) {
  const c =
    tone === "lime"
      ? "text-fog-lime"
      : tone === "loss"
      ? "text-fog-loss"
      : tone === "pink"
      ? "text-fog-pink"
      : "text-neutral-100";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-600 font-bold">
        {label}
      </div>
      <div className={`tabular font-bold text-base ${c}`}>{value}</div>
    </div>
  );
}
