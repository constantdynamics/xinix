import { useEffect, useMemo, useState } from "react";
import { fetchPriceHistory } from "../api";
import type { Dashboard, Card as CardType } from "../types";
import type { ScanResults } from "../api";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Badge, Stat, CollapsibleIntro, BlockBar } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";
import {
  analyzePriceHistory,
  scoreDoubling,
  type DoublingCardInput,
  type DoublingResult,
  type PriceStats,
  type Confidence,
} from "./doublingModel";

interface Props {
  dashboard: Dashboard | null;
  scans: ScanResults | null;
}

// Module-level cache: koershistorie-statistieken per ticker. Blijft bewaard
// zolang de pagina open is, zodat heen-en-weer wisselen tussen sub-tabs niet
// opnieuw fetcht. `undefined` = nog niet gefetcht, `null` = gefetcht maar geen
// bruikbare data.
const statsCache = new Map<string, PriceStats | null>();
// Tickers waarvoor nu een fetch loopt — voorkomt dubbele fetches wanneer het
// effect opnieuw draait (bv. zodra scans ná het dashboard binnenkomen).
const inflight = new Set<string>();

function toSector(s: string | null | undefined): DoublingCardInput["sector"] {
  return s === "biotech" || s === "mining" || s === "other" ? s : null;
}

const CONF_TONE: Record<Confidence, "lime" | "watch" | "loss"> = {
  hoog: "lime",
  middel: "watch",
  laag: "loss",
};
const CONF_LABEL: Record<Confidence, string> = {
  hoog: "Betrouwbaar",
  middel: "Redelijk",
  laag: "Indicatief",
};

// Score → kleur. Hoger = heter (lime → geel → oranje → pink).
function scoreColor(score: number): string {
  if (score >= 50) return "#ff1f8f"; // hot pink
  if (score >= 35) return "#ff5a3a"; // rood-oranje
  if (score >= 22) return "#ffa800"; // oranje
  if (score >= 12) return "#ffd400"; // geel
  return "#8aa0a8"; // gedempt blauwgrijs
}

function buildInputs(dashboard: Dashboard | null, scans: ScanResults | null, favSet: Set<string>): DoublingCardInput[] {
  if (!dashboard) return [];
  const cardByTicker = new Map<string, CardType>();
  for (const c of dashboard.cards) cardByTicker.set(c.ticker.toUpperCase(), c);

  const poefieByTicker = new Map<string, ScanResults["poefie_ranking"][number]>();
  for (const p of scans?.poefie_ranking ?? []) poefieByTicker.set(p.ticker.toUpperCase(), p);
  const phoenixByTicker = new Map<string, ScanResults["phoenix_ranking"][number]>();
  for (const p of scans?.phoenix_ranking ?? []) phoenixByTicker.set(p.ticker.toUpperCase(), p);
  const hikkertjeByTicker = new Map<string, ScanResults["hikkertje_ranking"][number]>();
  for (const h of scans?.hikkertje_ranking ?? []) hikkertjeByTicker.set(h.ticker.toUpperCase(), h);

  const out: DoublingCardInput[] = [];
  for (const T of favSet) {
    const card = cardByTicker.get(T);
    const p = poefieByTicker.get(T);
    const ph = phoenixByTicker.get(T);
    const hk = hikkertjeByTicker.get(T);
    // Sla wezen (favoriet zonder enige data) over — daar valt niets te analyseren.
    if (!card && !p && !ph) continue;

    const sector: DoublingCardInput["sector"] = card?.sector ?? toSector(p?.sector);
    const lastClose = card?.summary?.last_close ?? p?.last_close ?? null;
    const buyLimit = card?.buy_limit ?? p?.buy_limit ?? null;
    const aboveLimitPct =
      p?.above_limit_pct ??
      (lastClose != null && buyLimit != null && buyLimit > 0 ? ((lastClose - buyLimit) / buyLimit) * 100 : null);

    out.push({
      ticker: T,
      company: card?.company ?? p?.company ?? T,
      sector,
      goudScore: card?.goud_score ?? null,
      finalScore: card?.final_score ?? null,
      signalAction: card?.signal_action ?? null,
      color: card?.color ?? null,
      medalGold: card?.medal_gold ?? p?.medal_gold ?? 0,
      medalSilver: card?.medal_silver ?? p?.medal_silver ?? 0,
      medalBronze: card?.medal_bronze ?? p?.medal_bronze ?? 0,
      dividendYield: card?.dividend_yield ?? null,
      marketCapUsd: card?.market_cap_usd ?? null,
      shareCountMillions: card?.share_count_millions ?? null,
      lastClose,
      low1y: card?.summary?.low_1y ?? null,
      high1y: card?.summary?.high_1y ?? null,
      low5y: card?.summary?.low_5y ?? null,
      high5y: card?.summary?.high_5y ?? null,
      pctChange5d: card?.summary?.pct_change_5d ?? null,
      volumeRatio: card?.summary?.volume_ratio ?? null,
      buyLimit,
      aboveLimitPct,
      daysToNextCatalyst: card?.days_to_next_catalyst ?? null,
      poefieMaxGrowthPct: p?.poefie_max_growth_pct ?? null,
      poefieCount1y: p?.poefie_count_1y ?? null,
      poefieCount2y: p?.poefie_count_2y ?? null,
      poefieCount5y: p?.poefie_count_5y ?? null,
      phoenixMaxGrowth180dPct: ph?.phoenix_max_growth_180d_pct ?? null,
      phoenixIncidentCount: ph?.phoenix_incident_count ?? null,
      hikkertjeSpikes: hk?.hikkertje_spikes ?? null,
    });
  }
  return out;
}

export function VerdubbelaarsView({ dashboard, scans }: Props) {
  const marks = useMarks();
  const [statsVersion, setStatsVersion] = useState(0); // bump zodra een ticker klaar is
  const [reloadKey, setReloadKey] = useState(0); // bump om de fetch-effect te herstarten (Herbereken)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);

  const inputs = useMemo(
    () => buildInputs(dashboard, scans, marks.favorites),
    [dashboard, scans, marks.favorites, marks.favorites.size],
  );

  // Progressief koershistorie fetchen (max 4 tegelijk) en de cache vullen.
  // Voortgang wordt afgeleid uit de cache (niet uit een teller), zodat een
  // herberekening of een nieuwe favorieten-set nooit een teller laat lekken.
  useEffect(() => {
    const todo = inputs.map((i) => i.ticker).filter((t) => !statsCache.has(t) && !inflight.has(t));
    if (todo.length === 0) return;
    let cancelled = false;
    todo.forEach((t) => inflight.add(t));

    const CONCURRENCY = 4;
    let idx = 0;
    async function worker() {
      // Stop bij annulering, zodat een oude run geen tickers blijft fetchen die
      // een nieuwe run al overneemt (voorkomt dubbele fetches).
      while (!cancelled && idx < todo.length) {
        const t = todo[idx++];
        try {
          const hist = await fetchPriceHistory(t, "5y");
          statsCache.set(t, analyzePriceHistory(hist.points));
        } catch {
          statsCache.set(t, null); // geprobeerd; valt terug op proxy-model
        }
        inflight.delete(t);
        if (!cancelled) setStatsVersion((v) => v + 1);
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker());
    Promise.all(workers).catch(() => {});
    return () => {
      cancelled = true;
      // Tickers die nog niet gefetcht waren weer vrijgeven voor een volgende run.
      todo.forEach((t) => {
        if (!statsCache.has(t)) inflight.delete(t);
      });
    };
    // reloadKey forceert een herstart na "Herbereken" (statsCache is dan geleegd).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, reloadKey]);

  const results = useMemo<DoublingResult[]>(() => {
    const out = inputs.map((c) => scoreDoubling(c, statsCache.get(c.ticker) ?? null));
    out.sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
    return out;
    // statsVersion forceert herberekening zodra nieuwe historie binnen is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, statsVersion]);

  const summary = useMemo(() => {
    if (results.length === 0) return null;
    const scores = results.map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const top = results[0];
    const highConf = results.filter((r) => r.confidence === "hoog").length;
    const strong = results.filter((r) => r.score >= 30).length;
    return { avg, top, highConf, strong };
  }, [results]);

  function toggleExpand(t: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  function recompute() {
    statsCache.clear();
    inflight.clear();
    setStatsVersion((v) => v + 1);
    setReloadKey((k) => k + 1); // herstart de fetch-effect zodat de cache opnieuw vult
  }

  const exchangeByTicker = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of dashboard?.cards ?? []) m.set(c.ticker.toUpperCase(), c.exchange ?? null);
    return m;
  }, [dashboard]);

  const total = inputs.length;
  // Voortgang afgeleid uit de cache (statsVersion bumpt zodra een ticker klaar is).
  const analysed = useMemo(
    () => inputs.reduce((n, i) => n + (statsCache.has(i.ticker) ? 1 : 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs, statsVersion],
  );
  const remaining = total - analysed;
  const loadingHistory = remaining > 0;

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="Verdubbelaars — kans op +100% binnen 12 maanden" icon={<GradientTabIcon tab="favorieten" />}>
        <div className="space-y-2">
          <p>
            Elk favoriet-aandeel krijgt een <strong>score 1–100</strong> die staat voor de geschatte kans dat de koers
            binnen 12 maanden <strong>verdubbelt</strong> (1 = laagste, 100 = hoogste kans). De score is letterlijk die
            kans in procenten — niet opgerekt. Dat de meeste aandelen laag scoren is eerlijk: verdubbelen binnen een jaar
            is zeldzaam.
          </p>
          <p>De schatting combineert drie onafhankelijke pijlers, en is daardoor zo betrouwbaar mogelijk:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Volatiliteit (theorie)</strong> — uit 5 jaar koershistorie wordt de jaarvolatiliteit σ berekend.
              Onder een lognormaal koersmodel volgt daaruit een kans op +100%. Beweeglijke aandelen hebben een dikkere
              kans-staart omhoog (maar ook omlaag — dat houdt het eerlijk).
            </li>
            <li>
              <strong>Eigen historie (empirisch)</strong> — vanaf hoeveel willekeurige startpunten in de afgelopen 5 jaar
              verdubbelde dít aandeel daadwerkelijk binnen een jaar? De meest directe maatstaf.
            </li>
            <li>
              <strong>Structurele factoren</strong> — kwaliteitsscore, medailles, marktomvang, koerspositie, dividend,
              katalysator en signaalkleur stellen de kans bescheiden bij.
            </li>
          </ul>
          <p className="text-neutral-400">
            De <strong>betrouwbaarheidsbadge</strong> zegt hoe hard de onderbouwing is (afhankelijk van beschikbare data).
            Klik een kaart open voor de volledige onderbouwing. Geen voorspelling of advies — een transparante,
            data-gedreven schatting.
          </p>
        </div>
      </CollapsibleIntro>

      {total === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">♡</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen favorieten om te analyseren</div>
          <div className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            Klik op het hartje bij een aandeel in Watchlist, Feniks, Poefies, Hikkertjes of Zwitserleven. Verschijnt het
            hier niet, dan ontbreekt de koersdata (zie de reparatie-knop op het Lijst-tabblad).
          </div>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Stat label="Geanalyseerd" value={`${analysed}/${total}`} />
            {summary && <Stat label="Gem. score" value={summary.avg.toFixed(0)} />}
            {summary && <Stat label="Sterke kandidaten (≥30)" value={summary.strong} />}
            {summary && summary.top && (
              <Stat label="Hoogste" value={`${summary.top.ticker} · ${summary.top.score}`} tone="pink" />
            )}
            <div className="ml-auto flex items-center gap-2">
              {loadingHistory && (
                <span className="text-xs text-neutral-500 animate-pulse">
                  koershistorie laden… ({remaining} resterend)
                </span>
              )}
              <Button size="sm" variant="secondary" onClick={recompute} disabled={loadingHistory}>
                ↻ Herbereken
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {results.map((r, i) => {
              const isOpen = expanded.has(r.ticker);
              const exch = exchangeByTicker.get(r.ticker) ?? null;
              const pending = !statsCache.has(r.ticker) && loadingHistory;
              return (
                <DoublingCard
                  key={r.ticker}
                  rank={i + 1}
                  result={r}
                  exchange={exch}
                  open={isOpen}
                  pending={pending}
                  onToggle={() => toggleExpand(r.ticker)}
                  onChart={() => setChartFor({ ticker: r.ticker, company: r.company, exchange: exch })}
                />
              );
            })}
          </div>

          <p className="text-[11px] text-neutral-600 leading-relaxed">
            ⚠️ Geen beleggingsadvies. Het verdubbelen van een koers binnen een jaar is fundamenteel onzeker; deze scores
            zijn modelmatige schattingen op basis van historische data en kunnen er flink naast zitten. Koersdata via
            Yahoo Finance.
          </p>
        </>
      )}

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

function DoublingCard({
  rank,
  result,
  exchange,
  open,
  pending,
  onToggle,
  onChart,
}: {
  rank: number;
  result: DoublingResult;
  exchange: string | null;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onChart: () => void;
}) {
  const color = scoreColor(result.score);
  const confTone = CONF_TONE[result.confidence];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-stretch gap-0">
        {/* Score-blok */}
        <div
          className="flex flex-col items-center justify-center px-4 py-3 shrink-0 w-[92px] border-r border-ink-5"
          style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
        >
          <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-bold">#{rank}</div>
          <div className="text-3xl font-bold tabular-nums leading-none mt-0.5" style={{ color }}>
            {result.score}
          </div>
          <div className="text-[9px] text-neutral-500 mt-0.5">/ 100</div>
          <div className="w-full h-1.5 mt-1.5">
            <BlockBar fill={result.score / 100} orientation="horizontal" count={10} />
          </div>
        </div>

        {/* Hoofdinhoud */}
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={googleFinanceUrl(result.ticker, exchange)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono font-bold tab-accent-text hover:underline"
                >
                  {result.ticker}
                </a>
                {result.sector && (
                  <Badge tone={SECTOR_TONE[result.sector]}>{SECTOR_LABEL[result.sector]}</Badge>
                )}
                <Badge tone={confTone} title="Hoe hard de onderbouwing is, op basis van beschikbare data">
                  {CONF_LABEL[result.confidence]}
                </Badge>
                {pending && <span className="text-[10px] text-neutral-500 animate-pulse">historie laden…</span>}
              </div>
              <button
                type="button"
                onClick={onChart}
                className="block text-left text-xs text-neutral-400 truncate mt-0.5 hover:text-fog-pink transition-colors max-w-full"
                title={`Bekijk koersgrafiek van ${result.company}`}
              >
                {result.company}
              </button>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[10px] text-neutral-500">kans op +100%</div>
              <div className="text-sm font-bold tabular-nums" style={{ color }}>
                ~{result.score}%
              </div>
            </div>
          </div>

          {/* Kerncijfers */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-neutral-400">
            {result.annualVolPct != null && (
              <span title="Geannualiseerde volatiliteit">
                σ <span className="text-neutral-200 font-semibold tabular-nums">{result.annualVolPct.toFixed(0)}%</span>
              </span>
            )}
            {result.historicalDoublings != null && result.stats && (
              <span title="Niet-overlappende verdubbelingen in de gemeten koershistorie">
                verdubbelde{" "}
                <span className={result.historicalDoublings > 0 ? "text-fog-lime font-semibold" : "text-neutral-300"}>
                  {result.historicalDoublings}×
                </span>{" "}
                in {result.stats.yearsCovered.toFixed(1)}j
              </span>
            )}
            {result.stats && (
              <span title="Beste stijging binnen een 12-maands venster in de gemeten koershistorie">
                beste run{" "}
                <span className="text-neutral-200 font-semibold tabular-nums">
                  +{(result.stats.maxWindowGain * 100).toFixed(0)}%
                </span>
              </span>
            )}
            {result.stats?.posInRange != null && (
              <span title="Positie in de koers-range van de gemeten historie (0% = bodem, 100% = top)">
                positie{" "}
                <span className="text-neutral-200 font-semibold tabular-nums">
                  {Math.round(result.stats.posInRange * 100)}%
                </span>
              </span>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="ml-auto text-[11px] text-neutral-400 hover:text-neutral-100 underline-offset-2 hover:underline"
            >
              {open ? "▾ verberg onderbouwing" : "▸ toon onderbouwing"}
            </button>
          </div>

          {/* Onderbouwing */}
          {open && (
            <div className="mt-3 pt-3 border-t border-ink-5/60 space-y-3">
              <p className="text-xs text-neutral-300 leading-relaxed">{result.narrative}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {result.factors.map((f, k) => (
                  <div key={k} className="flex items-start gap-2 text-[11px]">
                    <span
                      className={
                        "mt-0.5 shrink-0 w-4 text-center font-bold " +
                        (f.impact === "up" ? "text-fog-lime" : f.impact === "down" ? "text-fog-loss" : "text-neutral-500")
                      }
                    >
                      {f.impact === "up" ? "▲" : f.impact === "down" ? "▼" : "•"}
                    </span>
                    <div className="min-w-0">
                      <span className="text-neutral-200 font-semibold">{f.label}</span>
                      <span className="text-neutral-500"> — {f.detail}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Schatter-uitsplitsing */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500 pt-1">
                <span>
                  Volatiliteit-baseline:{" "}
                  <span className="text-neutral-300 tabular-nums">{(result.pVol * 100).toFixed(1)}%</span>
                </span>
                {result.pEmp != null && (
                  <span>
                    Empirisch:{" "}
                    <span className="text-neutral-300 tabular-nums">{(result.pEmp * 100).toFixed(1)}%</span>
                  </span>
                )}
                <span>
                  Structurele factor:{" "}
                  <span className="text-neutral-300 tabular-nums">×{result.structuralMultiplier.toFixed(2)}</span>
                </span>
              </div>

              {result.missing.length > 0 && (
                <div className="text-[10px] text-fog-warn/80">
                  Ontbrekende data (drukt de betrouwbaarheid): {result.missing.join(" · ")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
