import { useEffect, useRef, useState } from "react";
import {
  fetchScanResults,
  triggerJob,
  getToken,
  type HikkertjeRankEntry,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartInline, SeenInline, ShowSeenToggle, MarkAllSeenButton, HideFavoritesToggle, NotYetReviewedTile, StarRating } from "../components/MarkCells";

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

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
      <Card className="p-4 border-yellow-500/30 bg-yellow-500/[0.04]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚡</span>
          <div className="flex-1">
            <div className="font-semibold text-yellow-400 mb-1">Hikkertjes</div>
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
        <Stat label="Hikkertjes gevonden" value={hikkertjeCount} />
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
          return (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-5 flex items-center justify-between">
            <div className="font-semibold text-sm">
              {sorted.length} hikkertjes getoond {sorted.length !== ranking.length && <span className="text-neutral-500 font-normal">({ranking.length} totaal)</span>}
            </div>
            <div className="text-xs text-neutral-500">
              {sortBy === "limit" ? "gesorteerd op afstand tot limiet" : "gesorteerd op meeste spikes"}
            </div>
          </div>
          <div className="divide-y divide-ink-5">
            {sorted.map((h, idx) => {
              const gfUrl = googleFinanceUrl(h.ticker, h.exchange);
              const belowLimit = h.above_limit_pct != null && h.above_limit_pct <= 0;
              const nearLimit = h.above_limit_pct != null && h.above_limit_pct > 0 && h.above_limit_pct <= 10;

              const seen = marks.isSeen(h.ticker);
              return (
                <div
                  key={h.ticker}
                  className={`px-4 py-3 flex items-center gap-3 text-sm ${belowLimit ? "bg-yellow-500/[0.06]" : ""} ${seen ? "opacity-50" : ""}`}
                >
                  <SeenInline ticker={h.ticker} />
                  <HeartInline ticker={h.ticker} />
                  <StarRating ticker={h.ticker} />
                  <span className="text-neutral-600 w-6 text-right tabular shrink-0">{idx + 1}</span>

                  <div className="w-24 shrink-0">
                    <a
                      href={gfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono font-semibold text-yellow-400 hover:underline"
                    >
                      {h.ticker}
                    </a>
                    <div className="mt-0.5">
                      <MedalPips g={h.medal_gold} s={h.medal_silver} b={h.medal_bronze} />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="truncate text-neutral-200">{h.company ?? "—"}</div>
                    {h.sector && (
                      <div className="mt-0.5">
                        <Pill>{h.sector}</Pill>
                      </div>
                    )}
                  </div>

                  {/* Spikes */}
                  <div className="shrink-0 text-center w-14">
                    <div className="font-semibold text-yellow-400 tabular">{h.hikkertje_spikes ?? "—"}×</div>
                    <div className="text-[10px] text-neutral-500">spikes</div>
                  </div>

                  {/* Koers */}
                  <div className="shrink-0 text-right w-16">
                    <div className="tabular font-mono text-neutral-200">
                      {h.last_close != null ? `$${fmtPrice(h.last_close)}` : "—"}
                    </div>
                    <div className="text-[10px] text-neutral-500">koers</div>
                  </div>

                  {/* Limiet + afstand */}
                  <div className="shrink-0 text-right w-20">
                    {h.buy_limit != null ? (
                      <>
                        <div className="tabular font-mono text-neutral-400">${fmtPrice(h.buy_limit)}</div>
                        {h.above_limit_pct != null && (
                          <div className={`text-[10px] tabular font-semibold ${
                            belowLimit ? "text-yellow-400" : nearLimit ? "text-yellow-600" : "text-neutral-500"
                          }`}>
                            {h.above_limit_pct >= 0 ? "+" : ""}{h.above_limit_pct.toFixed(1)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-neutral-600 text-xs">geen limiet</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
          );
        })()}
    </div>
  );
}
