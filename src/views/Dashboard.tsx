import { useEffect, useMemo, useState } from "react";
import type { Dashboard, Card as CardData } from "../types";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import { triggerJob } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { loadTilePrefs, type TilePrefs } from "../tilePrefs";
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
  Thermometer,
  MedalPills,
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
  yellow: "Watchlist",
  white: "Rust",
};
const COLOR_TIP: Record<CardData["color"], string> = {
  red: "Hot — meerdere harde signalen of catalyst dichtbij",
  orange: "Warm — één of meer actieve signalen",
  yellow: "Watchlist — pre-signaal: zacht-positief setup, geen trigger",
  white: "Rust — geen actieve signalen of catalysts",
};
// Heatmap: tile bg subtiel gekleurd op basis van c.color zodat de
// "heetheid" direct visueel afleesbaar is zonder badge. Border krijgt
// dezelfde tint maar feller; box-shadow voor lichte glow rondom de
// echt hete kaarten.
const HEAT_BG: Record<CardData["color"], string> = {
  white: "",
  yellow: "bg-fog-watch/[0.06] border-fog-watch/25",
  orange: "bg-fog-warn/[0.10] border-fog-warn/35",
  red: "bg-fog-loss/[0.13] border-fog-loss/45 shadow-[0_0_24px_-8px_rgba(255,26,26,0.45)]",
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

type NavTarget =
  | "dashboard"
  | "scores"
  | "tickers"
  | "limits"
  | "backtest"
  | "track-record"
  | "signal-log"
  | "status"
  | "settings";

export function DashboardView({ data, onNavigate }: { data: Dashboard; onRefresh: () => void; onNavigate?: (t: NavTarget) => void }) {
  const [filter, setFilter] = useState<ColorFilter>("all");
  const [tilePrefs, setTilePrefs] = useState<TilePrefs>(loadTilePrefs);
  // Re-load prefs wanneer de gebruiker de Settings tab heeft opengehad
  // — andere tabs/storage events triggeren dit zonder full refresh.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "xinix_tile_prefs_v4") setTilePrefs(loadTilePrefs());
    }
    function onVisible() {
      if (document.visibilityState === "visible") setTilePrefs(loadTilePrefs());
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

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

  // Compacte status-strip: groepeer recente run_log op job, vlag jobs met
  // een falende laatste run. Bron is hetzelfde dashboard-payload — geen
  // extra API-call nodig.
  const failedJobs = useMemo(() => {
    const seen = new Map<string, { ok: boolean | null; msg: string | null }>();
    for (const r of data.run_log ?? []) {
      if (seen.has(r.job)) continue;
      seen.set(r.job, { ok: r.ok, msg: r.message });
    }
    const failing: string[] = [];
    for (const [job, st] of seen) if (st.ok === false) failing.push(job);
    return failing;
  }, [data.run_log]);

  return (
    <div className="space-y-8">
      {failedJobs.length > 0 && (
        <button
          onClick={() => onNavigate?.("status")}
          className="w-full text-left rounded-xl border border-fog-loss/40 bg-fog-loss/10 hover:bg-fog-loss/15 transition px-4 py-2.5 flex items-center gap-3"
        >
          <Dot tone="loss" pulse />
          <span className="text-sm font-semibold text-fog-loss">
            {failedJobs.length} job{failedJobs.length > 1 ? "s" : ""} hebben fouten
          </span>
          <span className="hidden sm:inline text-xs text-neutral-400 truncate">
            {failedJobs.slice(0, 4).join(" · ")}
            {failedJobs.length > 4 && ` +${failedJobs.length - 4}`}
          </span>
          <span className="ml-auto text-xs text-fog-loss font-bold">Bekijk Status →</span>
        </button>
      )}

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
          title="Toon alle tickers"
        >
          Alles
        </Pill>
        <Pill
          tone="loss"
          active={filter === "red"}
          count={counts.red}
          onClick={() => setFilter("red")}
          title={COLOR_TIP.red}
        >
          Hot
        </Pill>
        <Pill
          tone="orange"
          active={filter === "orange"}
          count={counts.orange}
          onClick={() => setFilter("orange")}
          title={COLOR_TIP.orange}
        >
          Warm
        </Pill>
        <Pill
          tone="watch"
          active={filter === "yellow"}
          count={counts.yellow}
          onClick={() => setFilter("yellow")}
          title={COLOR_TIP.yellow}
        >
          Watchlist
        </Pill>
        <Pill
          tone="lime"
          active={filter === "white"}
          count={counts.white}
          onClick={() => setFilter("white")}
          title={COLOR_TIP.white}
        >
          Rust
        </Pill>
        <div className="ml-auto">
          <JobControls />
        </div>
      </div>

      {/* Cards grid */}
      <CardGrid cards={visibleCards} prefs={tilePrefs} />

      {/* Catalysts */}
      <Catalysts data={data} />

      {/* Recent signals */}
      <RecentSignals data={data} />

      {/* Run log */}
      <RunLog data={data} onNavigate={onNavigate} />
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

function CardGrid({ cards, prefs }: { cards: CardData[]; prefs: TilePrefs }) {
  if (cards.length === 0) {
    return (
      <Card className="p-10 text-center text-neutral-400 text-sm">
        Niets in deze filter. Voeg tickers toe via Watchlist.
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
      {cards.map((c) => (
        <CardTile key={c.ticker} card={c} prefs={prefs} />
      ))}
    </div>
  );
}

function CardTile({ card: c, prefs }: { card: CardData; prefs: TilePrefs }) {
  const px = c.summary;
  const tone = COLOR_TONE[c.color];
  const detailMeta =
    c.sector === "mining"
      ? [c.commodity, c.jurisdiction, c.deposit_type].filter(Boolean).join(" · ")
      : [c.modality, c.disease_area, c.phase].filter(Boolean).join(" · ");

  const has90d =
    px?.last_close != null && px.low_90d != null && px.high_90d != null;
  const has1y = px?.last_close != null && px.low_1y != null && px.high_1y != null;
  const has5y = px?.last_close != null && px.low_5y != null && px.high_5y != null;
  const showAnyRange =
    (prefs.showRange90d && has90d) ||
    (prefs.showRange1y && has1y) ||
    (prefs.showRange5y && has5y);

  return (
    <Card
      hover
      className={`p-4 group flex flex-col gap-3 ${HEAT_BG[c.color]}`}
      title={`Heat: ${COLOR_LABEL[c.color]}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={googleFinanceUrl(c.ticker, c.exchange)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-base tracking-tight text-neutral-50 group-hover:text-fog-pink transition"
              title={`Open ${c.ticker} op Google Finance`}
            >
              {c.ticker}
            </a>
            {prefs.showSector && (
              <Badge tone={SECTOR_TONE[c.sector]}>
                {SECTOR_LABEL[c.sector]}
              </Badge>
            )}
            {prefs.showPhase && (
              <span title={COLOR_TIP[c.color]}>
                <Badge tone={tone}>{COLOR_LABEL[c.color]}</Badge>
              </span>
            )}
            {prefs.showActiveSignalCount && c.active_signals > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-fog-pink/15 border border-fog-pink/30 px-2 py-0.5 text-[10px] font-bold text-fog-pink tabular"
                title={`${c.active_signals} actief signaal`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-fog-pink animate-pulse-soft" />
                {c.active_signals}
              </span>
            )}
            {prefs.showGoudType && c.goud_type && (
              <span className="text-[10px] uppercase tracking-wider text-neutral-400">
                {c.goud_type}
              </span>
            )}
          </div>
          <div className="text-xs text-neutral-400 truncate mt-0.5" title={c.company}>
            {c.company}
          </div>
          {prefs.showMedals && (
            <div className="mt-1.5">
              <MedalPills
                gold={c.medal_gold}
                silver={c.medal_silver}
                bronze={c.medal_bronze}
                size="sm"
              />
            </div>
          )}
        </div>
        {prefs.showScore && c.goud_score != null && <ScoreRing value={c.goud_score} />}
      </div>

      {prefs.showDetailMeta && detailMeta && (
        <div className="text-[11px] text-neutral-400 truncate">{detailMeta}</div>
      )}

      {prefs.showTriggerEvent && c.trigger_event && (
        <div className="text-[10px] text-neutral-500 italic line-clamp-2 leading-snug" title={c.trigger_event}>
          {c.trigger_event}
        </div>
      )}

      {/* Price + delta — geen valutateken (multi-exchange) */}
      {prefs.showPriceDelta && px && (
        <div className="flex items-baseline gap-3">
          <div className="text-2xl font-bold tabular tracking-tight">
            {px.last_close != null
              ? px.last_close < 1
                ? px.last_close.toFixed(4)
                : px.last_close < 10
                ? px.last_close.toFixed(3)
                : px.last_close.toFixed(2)
              : <span className="text-xs text-neutral-500 italic font-normal">geen koers</span>}
          </div>
          {px.last_close != null && <MiniDelta value={px.pct_change_1d ?? 0} />}
        </div>
      )}

      {/* Thermometers — fill = pctAboveLow / 200 (cap op +200% above low),
          gradient lime->yellow->orange->red. */}
      {showAnyRange && (
        <div className="rounded-lg border border-ink-5 bg-ink-2/40 p-2.5">
          <div className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1.5 text-center">
            Positie t.o.v. range
          </div>
          <div className="flex items-start justify-around gap-2">
            {prefs.showRange90d && has90d && (
              <Thermometer
                label="90D"
                low={px!.low_90d!}
                high={px!.high_90d!}
                current={px!.last_close!}
              />
            )}
            {prefs.showRange1y && has1y && (
              <Thermometer
                label="1Y"
                low={px!.low_1y!}
                high={px!.high_1y!}
                current={px!.last_close!}
              />
            )}
            {prefs.showRange5y && has5y && (
              <Thermometer
                label="5Y"
                low={px!.low_5y!}
                high={px!.high_5y!}
                current={px!.last_close!}
              />
            )}
            {prefs.showRange1y && !has1y && !prefs.showRange90d && (
              <div className="text-[10px] text-neutral-400 italic flex-1 self-center text-center">
                1y range nog niet opgehaald (komt binnen 7 dagen automatisch)
              </div>
            )}
          </div>
          {prefs.showRange1y && !has1y && (prefs.showRange90d && has90d) && (
            <div className="text-[10px] text-neutral-400 italic mt-2 text-center">
              1y nog te ophalen — komt binnen 7 dagen
            </div>
          )}
        </div>
      )}

      {/* Catalyst */}
      {prefs.showCatalyst && c.next_catalyst && (
        <div className="rounded-lg bg-ink-3 border border-ink-5 p-2.5">
          <div className="flex items-center gap-2">
            <Dot tone="pink" />
            <span className="text-[10px] uppercase tracking-wider text-fog-pink font-bold">
              Catalyst
            </span>
            {c.days_to_next_catalyst != null && (
              <span
                className={`ml-auto text-xs tabular font-bold ${
                  c.days_to_next_catalyst < 0
                    ? "text-neutral-500"
                    : c.days_to_next_catalyst < 7
                    ? "text-fog-loss"
                    : c.days_to_next_catalyst < 14
                    ? "text-fog-warn"
                    : "text-neutral-300"
                }`}
                title={
                  c.days_to_next_catalyst < 0
                    ? "Catalyst-datum is verstreken"
                    : c.days_to_next_catalyst < 7
                    ? "<7 dagen — zeer dichtbij"
                    : c.days_to_next_catalyst < 14
                    ? "<14 dagen — let op"
                    : "ruim de tijd"
                }
              >
                {c.days_to_next_catalyst < 0
                  ? `${-c.days_to_next_catalyst}d terug`
                  : `${c.days_to_next_catalyst}d`}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-neutral-200 truncate">
            {c.next_catalyst.catalyst_type}
          </div>
          {c.next_catalyst.description && (
            <div className="text-[11px] text-neutral-400 truncate">
              {c.next_catalyst.description}
            </div>
          )}
        </div>
      )}

      {/* Top signal */}
      {prefs.showTopSignal && c.top_signal && (
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
            <span className="text-[10px] uppercase tracking-wider text-neutral-300 font-bold">
              {c.top_signal.signal_type}
            </span>
            {c.active_signals > 1 && (
              <span className="ml-auto text-[10px] text-neutral-400">
                +{c.active_signals - 1}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs font-medium text-neutral-200 line-clamp-1">
            {c.top_signal.title}
          </div>
          {c.top_signal.detail && (
            <div className="text-[11px] text-neutral-400 line-clamp-2">
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
          <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40 sticky top-0">
            <tr>
              <th className="text-left p-3 font-semibold">Wanneer</th>
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
              const urgencyCls =
                days == null
                  ? "text-neutral-300"
                  : days < 0
                  ? "text-neutral-500"
                  : days < 7
                  ? "text-fog-loss"
                  : days < 14
                  ? "text-fog-warn"
                  : "text-neutral-100";
              return (
                <tr
                  key={c.id}
                  className="border-t border-ink-5 hover:bg-ink-3/40"
                >
                  <td className="p-3 whitespace-nowrap">
                    {days != null ? (
                      <>
                        <div className={`tabular font-bold ${urgencyCls}`}>
                          {days < 0 ? `${-days}d terug` : days === 0 ? "vandaag" : `over ${days}d`}
                        </div>
                        <div className="text-[10px] tabular text-neutral-500">
                          {c.expected_date}
                        </div>
                      </>
                    ) : (
                      <div className="text-neutral-500 italic text-xs">datum onbekend</div>
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
                  <td className="p-3 text-[10px] text-neutral-500 uppercase tracking-wider">
                    {(c.source ?? "").split(/[./]/)[0] || "—"}
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
          const borderCls =
            s.severity === "red"
              ? "border-l-4 border-l-fog-loss"
              : s.severity === "orange"
              ? "border-l-4 border-l-fog-warn"
              : "border-l-4 border-l-fog-watch";
          return (
            <Card
              key={s.id}
              hover
              className={`p-3 pl-3 flex items-start gap-3 ${borderCls}`}
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
              <span className="text-[11px] tabular text-neutral-400 whitespace-nowrap">
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

// Score-ring: cirkelvormige progress 0..100, kleur volgt waarde
// (rood/oranje/geel/lime). Maakt de score in één blik leesbaar zonder
// het getal te lezen.
function ScoreRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 18;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const color =
    v >= 80 ? "#a7ff1f" : v >= 60 ? "#ffd400" : v >= 40 ? "#ff8c00" : "#ff5a3a";
  return (
    <div
      className="shrink-0 relative flex items-center justify-center"
      style={{ width: 44, height: 44 }}
      title={`Score ${v}/100`}
    >
      <svg width={44} height={44} className="-rotate-90">
        <circle cx={22} cy={22} r={r} stroke="#262626" strokeWidth={3} fill="none" />
        <circle
          cx={22}
          cy={22}
          r={r}
          stroke={color}
          strokeWidth={3}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[14px] font-bold tabular text-neutral-50">{value}</span>
        <span className="text-[7px] uppercase tracking-wider text-neutral-500 mt-0.5">score</span>
      </div>
    </div>
  );
}

// Korte job-label-lookup voor de mini RunLog op het dashboard. Spiegelt
// JOB_META in Health.tsx maar met de `-background` suffix die in run_log
// staat.
const RUNLOG_LABEL: Record<string, string> = {
  "poll-prices-background": "Koersen",
  "poll-trials-background": "Trials",
  "poll-edgar-background": "SEC 8-K",
  "poll-fda-background": "FDA",
  "poll-biotech-news-background": "Biotech-nieuws",
  "poll-metals-background": "Metalen",
  "poll-mining-news-background": "Mining-nieuws",
  "poll-fundamentals-background": "Fundamentals",
  "compute-signals-background": "Signalen",
  "compute-scores-background": "Scores",
  "compute-extremes-background": "Extremes",
  "dispatch-alerts-background": "Alerts",
  "forward-returns-background": "Forward returns",
  "backtest-background": "Backtest",
  "scan-losers-background": "Scan losers",
  "scan-bottoms-background": "Scan bottoms",
  "losers-digest-background": "Losers digest",
};

function RunLog({ data, onNavigate }: { data: Dashboard; onNavigate?: (t: NavTarget) => void }) {
  if (data.run_log.length === 0) return null;
  // Compacter: laatste 5 unieke jobs, gegroepeerd op job-key
  const seen = new Set<string>();
  const recent = data.run_log.filter((r) => {
    if (seen.has(r.job)) return false;
    seen.add(r.job);
    return true;
  }).slice(0, 6);
  return (
    <section>
      <SectionHeader
        eyebrow="Systeem"
        title="Laatste runs"
        aside={
          onNavigate && (
            <button
              onClick={() => onNavigate("status")}
              className="text-xs text-fog-pink hover:underline"
            >
              Alle jobs in Status →
            </button>
          )
        }
      />
      <Card className="overflow-hidden">
        {recent.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 border-t border-ink-5 first:border-t-0 text-xs"
          >
            <Dot
              tone={r.ok === true ? "lime" : r.ok === false ? "loss" : "neutral"}
              pulse={r.ok === false}
            />
            <span className="font-semibold text-neutral-200 w-32 truncate" title={r.job}>
              {RUNLOG_LABEL[r.job] ?? r.job}
            </span>
            <span className="tabular text-neutral-500 w-24 text-[11px]">
              {new Date(r.started_at).toLocaleString("nl-NL", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className={`truncate flex-1 ${r.ok === false ? "text-fog-loss" : "text-neutral-500"}`}>
              {r.message ?? (r.finished_at ? "ok" : "loopt…")}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}
