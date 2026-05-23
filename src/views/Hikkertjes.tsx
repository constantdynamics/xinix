import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  fetchScanResults,
  triggerJob,
  getToken,
  type HikkertjeRankEntry,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat } from "../components/ui";
import { TickerSparkline } from "../components/TickerSparkline";
import { TAB_ICONS, GradientTabIcon } from "../tabIcons";
import { EditableLimit } from "../components/EditableLimit";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, StarCell, StarHeader, ShowSeenToggle, MarkAllSeenButton, HideFavoritesToggle, NotYetReviewedTile } from "../components/MarkCells";
import { ColumnPicker, useColumnLayout, type ColumnMeta } from "../components/ColumnPicker";
import { PriceChartModal } from "./PriceChartModal";

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

const HIKKERTJE_COLUMNS: ColumnMeta[] = [
  { key: "ticker", label: "Ticker" },
  { key: "company", label: "Bedrijf + sector" },
  { key: "sparkline", label: "Trend" },
  { key: "spikes", label: "Spikes" },
  { key: "koers", label: "Koers" },
  { key: "limit", label: "Limiet + afstand" },
];

function MedalPips({ g, s, b }: { g: number | null; s: number | null; b: number | null }) {
  const parts: string[] = [];
  if (g) for (let i = 0; i < Math.min(g, 5); i++) parts.push("🏆");
  if (s) for (let i = 0; i < Math.min(s, 5); i++) parts.push("🥈");
  if (b) for (let i = 0; i < Math.min(b, 5); i++) parts.push("🥉");
  if (!parts.length) return null;
  return <span className="text-xs">{parts.join("")}</span>;
}

export function HikkertjesView() {
  const [ranking, setRanking] = useState<HikkertjeRankEntry[]>([]);
  const [hikkertjeCount, setHikkertjeCount] = useState(0);
  const [unscanned, setUnscanned] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [limitFilter, setLimitFilter] = useState<"all" | "near" | "below">("all");
  const [sortBy, setSortBy] = useState<"spikes" | "limit">("spikes");
  const [fullScanRunning, setFullScanRunning] = useState(false);
  const [fullScanBatch, setFullScanBatch] = useState(0);
  const fullScanStopRef = useRef(false);
  const [showSeen, setShowSeen] = useState(false);
  const [hideFavorites, setHideFavorites] = useState(false);
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);
  const { visibleKeys } = useColumnLayout("hikkertjes", HIKKERTJE_COLUMNS, "ticker");
  const marks = useMarks();

  async function refreshData() {
    const r = await fetchScanResults();
    setRanking(r.hikkertje_ranking ?? []);
    setHikkertjeCount(r.hikkertje_count ?? 0);
    setUnscanned(r.hikkertje_unscanned ?? 0);
    return r.hikkertje_unscanned ?? 0;
  }

  useEffect(() => {
    setLoading(true);
    refreshData()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      await triggerJob("compute-hikkertjes-background");
      setScanMsg("Scan gestart — ververs over ~2 min.");
    } catch (e) {
      setScanMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  async function runFullScan() {
    if (fullScanRunning) return;
    fullScanStopRef.current = false;
    setFullScanRunning(true);
    setFullScanBatch(0);
    setScanMsg(null);
    const MAX_BATCHES = 60;
    const BATCH_WAIT_MS = 95_000;
    try {
      let batch = 0;
      while (!fullScanStopRef.current && batch < MAX_BATCHES) {
        const remaining = await refreshData();
        if (remaining === 0) { setScanMsg(`Volledige scan klaar — geen ongezicende tickers meer.`); break; }
        try { await triggerJob("compute-hikkertjes-background"); } catch (e) { setScanMsg(`Fout bij batch ${batch + 1}: ${e instanceof Error ? e.message : String(e)}`); break; }
        batch++;
        setFullScanBatch(batch);
        for (let waited = 0; waited < BATCH_WAIT_MS && !fullScanStopRef.current; waited += 1000) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      await refreshData();
    } finally {
      setFullScanRunning(false);
    }
  }
  function stopFullScan() { fullScanStopRef.current = true; }

  const isAdmin = !!getToken();

  if (loading) {
    return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  }
  if (error) {
    return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;
  }

  return (
    <div className="space-y-6">
      {/* Uitleg */}
      <Card className="p-4 tab-accent-panel">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none shrink-0"><GradientTabIcon tab="hikkertjes" /></span>
          <div className="flex-1">
            <div className="font-semibold tab-accent-text mb-1">Hikkertjes</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Aandelen die in het afgelopen jaar minimaal <strong>2×</strong> op één dag <strong>≥55%</strong> gestegen zijn
              en die stijging minimaal <strong>3 handelsdagen</strong> vasthielden. Dit patroon duidt op extreme
              volatiliteit en explosief koerspotentieel — maar ook hoog risico.
            </p>
          </div>
        </div>
      </Card>

      {/* Stats + trigger */}
      <div className="flex flex-wrap items-center gap-4">
        <Stat label="Hikkertjes gevonden" value={hikkertjeCount} icon={TAB_ICONS.hikkertjes} />
        <Stat
          label="Op/onder limiet"
          value={ranking.filter((r) => r.above_limit_pct != null && r.above_limit_pct <= 0).length}
          tone="lime"
        />
        <Stat
          label="≤10% boven limiet"
          value={ranking.filter((r) => r.above_limit_pct != null && r.above_limit_pct > 0 && r.above_limit_pct <= 10).length}
        />
        <Stat label="Nog te scannen" value={unscanned} />
        {isAdmin && (
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {scanMsg && <span className="text-xs text-neutral-400">{scanMsg}</span>}
            <Button size="sm" variant="secondary" onClick={runScan} disabled={scanning || fullScanRunning}>
              {scanning ? "…" : "⚡ Scan 1×"}
            </Button>
            {!fullScanRunning ? (
              <Button size="sm" onClick={runFullScan} disabled={scanning || unscanned === 0}>
                ⚡ Scan hele watchlist
              </Button>
            ) : (
              <>
                <span className="text-xs text-yellow-400 font-semibold">
                  Batch {fullScanBatch} · {unscanned} resterend
                </span>
                <Button size="sm" variant="secondary" onClick={stopFullScan}>Stop</Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Filter + sortering */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["all", "near", "below"] as const).map((f) => {
          const labels = { all: "Alle hikkertjes", near: "≤10% boven limiet", below: "Op/onder limiet" };
          return (
            <button
              key={f}
              onClick={() => setLimitFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                limitFilter === f
                  ? "border-yellow-500 bg-yellow-500/20 text-yellow-300"
                  : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {labels[f]}
            </button>
          );
        })}
        <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
        <HideFavoritesToggle hideFavorites={hideFavorites} onChange={setHideFavorites} />
        <NotYetReviewedTile
          tickers={ranking.map((h) => h.ticker)}
          onActivate={() => { setShowSeen(false); setHideFavorites(true); }}
        />
        <MarkAllSeenButton tickers={ranking.map((h) => h.ticker)} />
        <div className="ml-auto flex items-center gap-1 text-xs">
          <span className="text-neutral-500">Sorteer:</span>
          <button
            onClick={() => setSortBy("spikes")}
            className={`px-2 py-1 rounded font-semibold ${sortBy === "spikes" ? "bg-ink-3 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
          >Spikes</button>
          <button
            onClick={() => setSortBy("limit")}
            className={`px-2 py-1 rounded font-semibold ${sortBy === "limit" ? "bg-ink-3 text-neutral-100" : "text-neutral-500 hover:text-neutral-300"}`}
          >Dichtbij limiet</button>
        </div>
      </div>

      {/* Ranking */}
      {ranking.length === 0 ? (
        <Card className="p-10 text-center text-sm text-neutral-500">
          <div className="text-3xl mb-3">⚡</div>
          <div>Nog geen hikkertjes gevonden.</div>
          <div className="mt-1 text-neutral-600">
            {unscanned > 0
              ? `${unscanned} tickers wachten op scan — gebruik de knop hierboven (admin).`
              : "Alle tickers zijn gescand."}
          </div>
        </Card>
      ) : (() => {
          const filtered = ranking.filter((h) => {
            if (!showSeen && marks.isSeen(h.ticker)) return false;
            if (hideFavorites && marks.isFavorite(h.ticker)) return false;
            if (limitFilter === "below") return h.above_limit_pct != null && h.above_limit_pct <= 0;
            if (limitFilter === "near") return h.above_limit_pct != null && h.above_limit_pct <= 10;
            return true;
          });
          const sorted = sortBy === "limit"
            ? [...filtered].sort((a, b) => {
                const av = a.above_limit_pct ?? Number.POSITIVE_INFINITY;
                const bv = b.above_limit_pct ?? Number.POSITIVE_INFINITY;
                return av - bv;
              })
            : filtered;

          // Per-kolom render. visibleKeys (kolom-kiezer) bepaalt welke en in welke volgorde.
          const colMap: Record<string, { th: ReactNode; td: (h: HikkertjeRankEntry) => ReactNode }> = {
            ticker: {
              th: <th className="px-3 py-2 text-left">Ticker</th>,
              td: (h) => (
                <td className="px-3 py-2">
                  <a
                    href={googleFinanceUrl(h.ticker, h.exchange)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono font-semibold tab-accent-text hover:underline"
                  >
                    {h.ticker}
                  </a>
                  <div className="mt-0.5">
                    <MedalPips g={h.medal_gold} s={h.medal_silver} b={h.medal_bronze} />
                  </div>
                </td>
              ),
            },
            company: {
              th: <th className="px-3 py-2 text-left">Bedrijf</th>,
              td: (h) => (
                <td className="px-3 py-2 min-w-0">
                  {h.company ? (
                    <button
                      type="button"
                      onClick={() => setChartFor({ ticker: h.ticker, company: h.company ?? h.ticker, exchange: h.exchange })}
                      className="block w-full text-left truncate text-neutral-200 hover:text-fog-pink hover:underline transition-colors"
                      title={`Bekijk koersgrafiek van ${h.company}`}
                    >
                      {h.company}
                    </button>
                  ) : (
                    <div className="truncate text-neutral-200">—</div>
                  )}
                  {h.sector && (
                    <div className="mt-0.5">
                      <Pill>{h.sector}</Pill>
                    </div>
                  )}
                </td>
              ),
            },
            sparkline: {
              th: <th className="px-3 py-2 text-center w-20">Trend</th>,
              td: (h) => (
                <td className="px-3 py-2 text-center">
                  <TickerSparkline ticker={h.ticker} width={64} height={20} />
                </td>
              ),
            },
            spikes: {
              th: <th className="px-3 py-2 text-center w-16">Spikes</th>,
              td: (h) => (
                <td className="px-3 py-2 text-center">
                  <div className="font-semibold text-yellow-400 tabular">{h.hikkertje_spikes ?? "—"}×</div>
                </td>
              ),
            },
            koers: {
              th: <th className="px-3 py-2 text-right w-20">Koers</th>,
              td: (h) => (
                <td className="px-3 py-2 text-right tabular font-mono text-neutral-200">
                  {h.last_close != null ? `$${fmtPrice(h.last_close)}` : <span className="text-neutral-600">—</span>}
                </td>
              ),
            },
            limit: {
              th: <th className="px-3 py-2 text-right w-24">Limiet</th>,
              td: (h) => {
                const belowLim = h.above_limit_pct != null && h.above_limit_pct <= 0;
                const nearLim = h.above_limit_pct != null && h.above_limit_pct > 0 && h.above_limit_pct <= 10;
                return (
                  <td className="px-3 py-2 text-right">
                    <EditableLimit ticker={h.ticker} buyLimit={h.buy_limit} />
                    {h.buy_limit != null && h.above_limit_pct != null && (
                      <div className={`text-[10px] tabular font-semibold ${
                        belowLim ? "text-yellow-400" : nearLim ? "text-yellow-600" : "text-neutral-500"
                      }`}>
                        {h.above_limit_pct >= 0 ? "+" : ""}{h.above_limit_pct.toFixed(1)}%
                      </div>
                    )}
                  </td>
                );
              },
            },
          };

          return (
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-neutral-500">
              {sorted.length} hikkertjes getoond {sorted.length !== ranking.length && `(${ranking.length} totaal)`} · {sortBy === "limit" ? "gesorteerd op afstand tot limiet" : "gesorteerd op meeste spikes"}
            </div>
            <ColumnPicker tabKey="hikkertjes" columns={HIKKERTJE_COLUMNS} lockedKey="ticker" />
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                    <SeenHeader />
                    <HeartHeader />
                    <StarHeader />
                    {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.th}</Fragment>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {sorted.map((h) => {
                    const belowLimit = h.above_limit_pct != null && h.above_limit_pct <= 0;
                    const seen = marks.isSeen(h.ticker);
                    return (
                      <tr key={h.ticker} className={(belowLimit ? "bg-yellow-500/[0.06] " : "") + (seen ? "opacity-50" : "")}>
                        <SeenCell ticker={h.ticker} />
                        <HeartCell ticker={h.ticker} />
                        <StarCell ticker={h.ticker} />
                        {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.td(h)}</Fragment>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
          );
        })()}

      {chartFor && (
        <PriceChartModal
          ticker={chartFor.ticker}
          company={chartFor.company}
          exchange={chartFor.exchange}
          onClose={() => setChartFor(null)}
        />
      )}
    </div>
  );
}
