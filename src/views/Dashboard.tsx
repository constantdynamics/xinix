import { useMemo, useState } from "react";
import type { Dashboard, Card as CardData } from "../types";
import { triggerJob } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import {
  Card,
  Badge,
  Button,
  Pill,
  Stat,
  SectionHeader,
  Dot,
  DotBar,
  MiniDelta,
} from "../components/ui";

type ToneByColor = "lime" | "watch" | "orange" | "loss";
const COLOR_TONE: Record<CardData["color"], ToneByColor> = {
  white: "lime",
  yellow: "watch",
  orange: "orange",
  red: "loss",
};
const COLOR_LABEL: Record<CardData["color"], string> = {
  red: "Hot",
  orange: "Warm",
  yellow: "Pre",
  white: "Rust",
};

const JOBS = [
  ["poll-prices-background", "Prijzen"],
  ["poll-trials-background", "Trials"],
  ["poll-edgar-background", "SEC 8-K"],
  ["poll-fda-background", "FDA"],
  ["poll-biotech-news-background", "Biotech nws"],
  ["poll-metals-background", "Metalen"],
  ["poll-mining-news-background", "Mining nws"],
  ["compute-signals-background", "Signals"],
  ["compute-scores-background", "Scores"],
  ["dispatch-alerts-background", "Alerts"],
];

type ColorFilter = "all" | "red" | "orange" | "yellow" | "white";

export function DashboardView({ data }: { data: Dashboard; onRefresh: () => void }) {
  const [filter, setFilter] = useState<ColorFilter>("all");

  const counts = useMemo(
    () =>
      data.cards.reduce(
        (acc, c) => {
          acc[c.color]++;
          return acc;
        },
        { white: 0, yellow: 0, orange: 0, red: 0 }
      ),
    [data.cards]
  );

  const visibleCards = useMemo(
    () =>
      filter === "all"
        ? data.cards
        : data.cards.filter((c) => c.color === filter),
    [data.cards, filter]
  );

  // KPIs
  const totalSignals = data.cards.reduce((s, c) => s + c.active_signals, 0);
  const upcomingNext30 = data.upcoming_catalysts.filter((c) => {
    if (!c.expected_date) return false;
    const days =
      (new Date(c.expected_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 30;
  }).length;
  const recentRedSignals = data.recent_signals.filter(
    (s) => s.severity === "red"
  ).length;

  return (
    <div className="space-y-8">
      {/* KPI rij */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Watchlist"
          value={data.cards.length}
          tone="pink"
          hint={`${counts.red + counts.orange} actief`}
        />
        <Stat
          label="Actieve signalen"
          value={totalSignals}
          hint={`${recentRedSignals} rood (24u)`}
        />
        <Stat
          label="Catalysts ≤30d"
          value={upcomingNext30}
          hint="Binnenkomende events"
        />
        <Stat
          label="Laatste run"
          value={
            data.run_log[0]
              ? new Date(data.run_log[0].started_at).toLocaleTimeString(
                  "nl-NL",
                  { hour: "2-digit", minute: "2-digit" }
                )
              : "—"
          }
          hint={data.run_log[0]?.job ?? ""}
        />
      </div>

      {/* Filter pills + jobs */}
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          tone="neutral"
          active={filter === "all"}
          count={data.cards.length}
          onClick={() => setFilter("all")}
        >
          Alles
        </Pill>
        <Pill
          tone="loss"
          active={filter === "red"}
          count={counts.red}
          onClick={() => setFilter("red")}
        >
          Hot
        </Pill>
        <Pill
          tone="orange"
          active={filter === "orange"}
          count={counts.orange}
          onClick={() => setFilter("orange")}
        >
          Warm
        </Pill>
        <Pill
          tone="watch"
          active={filter === "yellow"}
          count={counts.yellow}
          onClick={() => setFilter("yellow")}
        >
          Pre
        </Pill>
        <Pill
          tone="lime"
          active={filter === "white"}
          count={counts.white}
          onClick={() => setFilter("white")}
        >
          Rust
        </Pill>
        <div className="ml-auto">
          <JobControls />
        </div>
      </div>

      {/* Cards grid */}
      <CardGrid cards={visibleCards} />

      {/* Catalysts */}
      <Catalysts data={data} />

      {/* Recent signals */}
      <RecentSignals data={data} />

      {/* Run log */}
      <RunLog data={data} />
    </div>
  );
}

function JobControls() {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(job: string) {
    setBusy(job);
    setMsg(null);
    try {
      await triggerJob(job);
      setMsg(`${job} getriggerd`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen((v) => !v)}
      >
        ⚙ jobs
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-72 animate-fade-up">
          <Card className="p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-fog-pink mb-2">
              Handmatig triggeren
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {JOBS.map(([job, label]) => (
                <button
                  key={job}
                  onClick={() => run(job)}
                  disabled={busy === job}
                  className="px-2 py-1.5 text-xs rounded-md bg-ink-3 hover:bg-ink-4 border border-ink-5 disabled:opacity-40 text-left"
                >
                  {busy === job ? "…" : label}
                </button>
              ))}
            </div>
            {msg && <div className="mt-2 text-[11px] text-neutral-400">{msg}</div>}
          </Card>
        </div>
      )}
    </div>
  );
}

function CardGrid({ cards }: { cards: CardData[] }) {
  if (cards.length === 0) {
    return (
      <Card className="p-10 text-center text-neutral-500 text-sm">
        Niets in deze filter. Voeg tickers toe via Watchlist.
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {cards.map((c) => (
        <CardTile key={c.ticker} card={c} />
      ))}
    </div>
  );
}

function CardTile({ card: c }: { card: CardData }) {
  const px = c.summary;
  const tone = COLOR_TONE[c.color];

  // proximity: dichter bij 90d-low = goede entry. dotbar laat zien hoe
  // ver boven de low de prijs zit (dichter bij low = meer rood).
  const aboveLow = px?.pct_above_90d_low ?? null;
  const proximity = aboveLow != null ? Math.min(1, aboveLow / 100) : null;

  return (
    <Card hover className="p-4 group flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <a
              href={googleFinanceUrl(c.ticker)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-base tracking-tight text-neutral-50 group-hover:text-fog-pink transition"
              title={`Open ${c.ticker} op Google Finance`}
            >
              {c.ticker}
            </a>
            <Badge tone={c.sector === "mining" ? "watch" : "cyan"}>
              {c.sector === "mining" ? "MIN" : "BIO"}
            </Badge>
            <Badge tone={tone}>{COLOR_LABEL[c.color]}</Badge>
          </div>
          <div className="text-xs text-neutral-400 truncate mt-0.5">
            {c.company}
          </div>
        </div>
        {c.goud_score != null && (
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-neutral-600">
              Score
            </div>
            <div className="text-lg font-bold tabular text-neutral-100">
              {c.goud_score}
            </div>
          </div>
        )}
      </div>

      {/* Detail meta */}
      <div className="text-[11px] text-neutral-500 truncate">
        {c.sector === "mining"
          ? [c.commodity, c.jurisdiction, c.deposit_type]
              .filter(Boolean)
              .join(" · ")
          : [c.modality, c.disease_area, c.phase].filter(Boolean).join(" · ")}
      </div>

      {/* Price + DotBar */}
      {px && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-lg font-bold tabular">
              ${px.last_close?.toFixed(2)}
            </div>
            <MiniDelta value={px.pct_change_1d ?? 0} />
          </div>
          {proximity != null && (
            <div className="flex flex-col items-end gap-1">
              <div className="text-[10px] uppercase tracking-wider text-neutral-600">
                90d low
              </div>
              <DotBar progress={proximity} count={10} />
              <div className="text-[10px] tabular text-neutral-500">
                +{Math.round(aboveLow ?? 0)}%
              </div>
            </div>
          )}
        </div>
      )}

      {/* Catalyst */}
      {c.next_catalyst && (
        <div className="rounded-lg bg-ink-3 border border-ink-5 p-2.5">
          <div className="flex items-center gap-2">
            <Dot tone="pink" />
            <span className="text-[10px] uppercase tracking-wider text-fog-pink font-bold">
              Catalyst
            </span>
            {c.days_to_next_catalyst != null && (
              <span className="ml-auto text-xs tabular text-neutral-400">
                {c.days_to_next_catalyst}d
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-neutral-200 truncate">
            {c.next_catalyst.catalyst_type}
          </div>
          {c.next_catalyst.description && (
            <div className="text-[11px] text-neutral-500 truncate">
              {c.next_catalyst.description}
            </div>
          )}
        </div>
      )}

      {/* Top signal */}
      {c.top_signal && (
        <div className="rounded-lg border border-ink-5 p-2.5">
          <div className="flex items-center gap-2">
            <Dot
              tone={
                c.top_signal.severity === "red"
                  ? "loss"
                  : c.top_signal.severity === "orange"
                  ? "orange"
                  : "watch"
              }
              pulse={c.top_signal.severity === "red"}
            />
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
              {c.top_signal.signal_type}
            </span>
            {c.active_signals > 1 && (
              <span className="ml-auto text-[10px] text-neutral-600">
                +{c.active_signals - 1}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs font-medium text-neutral-200 line-clamp-1">
            {c.top_signal.title}
          </div>
          {c.top_signal.detail && (
            <div className="text-[11px] text-neutral-500 line-clamp-2">
              {c.top_signal.detail}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Catalysts({ data }: { data: Dashboard }) {
  const cats = data.upcoming_catalysts.slice(0, 15);
  if (cats.length === 0) return null;
  return (
    <section>
      <SectionHeader
        eyebrow="Komende"
        title="Verwachte katalysators"
        subtitle="Tot 30 dagen vooruit · gesorteerd op datum"
      />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40">
            <tr>
              <th className="text-left p-3 font-semibold">Datum</th>
              <th className="text-left p-3 font-semibold">Ticker</th>
              <th className="text-left p-3 font-semibold">Type</th>
              <th className="text-left p-3 font-semibold">Omschrijving</th>
              <th className="text-left p-3 font-semibold">Bron</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => {
              const days = c.expected_date
                ? Math.round(
                    (new Date(c.expected_date).getTime() - Date.now()) /
                      86400000
                  )
                : null;
              return (
                <tr
                  key={c.id}
                  className="border-t border-ink-5 hover:bg-ink-3/40"
                >
                  <td className="p-3 whitespace-nowrap">
                    <div className="tabular text-neutral-200">
                      {c.expected_date}
                    </div>
                    {days != null && (
                      <div className="text-[10px] tabular text-neutral-500">
                        {days >= 0 ? `over ${days}d` : `${-days}d geleden`}
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-bold">
                    <a
                      href={googleFinanceUrl(c.ticker)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-fog-pink hover:underline"
                    >
                      {c.ticker}
                    </a>
                  </td>
                  <td className="p-3">
                    <Badge tone="cyan">{c.catalyst_type}</Badge>
                  </td>
                  <td className="p-3 text-neutral-400 truncate max-w-md">
                    {c.description}
                  </td>
                  <td className="p-3 text-[11px] text-neutral-600">
                    {c.source}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

function RecentSignals({ data }: { data: Dashboard }) {
  const sigs = data.recent_signals.slice(0, 20);
  if (sigs.length === 0) return null;
  return (
    <section>
      <SectionHeader
        eyebrow="Activiteit"
        title="Recente signalen"
        subtitle="Laatste 24-48 uur · alle severities"
      />
      <div className="space-y-1.5">
        {sigs.map((s) => {
          const tone =
            s.severity === "red"
              ? "loss"
              : s.severity === "orange"
              ? "orange"
              : "watch";
          return (
            <Card
              key={s.id}
              hover
              className="p-3 flex items-start gap-3"
            >
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <Dot tone={tone} pulse={s.severity === "red"} />
              </div>
              <a
                href={googleFinanceUrl(s.ticker)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-sm w-20 hover:text-fog-pink"
              >
                {s.ticker}
              </a>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone={tone}>{s.signal_type}</Badge>
                  <span className="text-sm font-medium text-neutral-100 truncate">
                    {s.title}
                  </span>
                </div>
                {s.detail && (
                  <div className="text-xs text-neutral-500 truncate mt-0.5">
                    {s.detail}
                  </div>
                )}
              </div>
              <span className="text-[11px] tabular text-neutral-600 whitespace-nowrap">
                {new Date(s.detected_at).toLocaleString("nl-NL", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function RunLog({ data }: { data: Dashboard }) {
  if (data.run_log.length === 0) return null;
  return (
    <section>
      <SectionHeader eyebrow="Systeem" title="Job log" />
      <Card className="overflow-hidden">
        {data.run_log.slice(0, 10).map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 border-t border-ink-5 first:border-t-0 text-xs"
          >
            <Dot
              tone={r.ok === true ? "lime" : r.ok === false ? "loss" : "neutral"}
            />
            <span className="font-mono text-neutral-300 w-44 truncate">
              {r.job}
            </span>
            <span className="tabular text-neutral-600 w-32">
              {new Date(r.started_at).toLocaleString("nl-NL", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-neutral-400 truncate flex-1">
              {r.message ?? (r.finished_at ? "ok" : "running…")}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}
