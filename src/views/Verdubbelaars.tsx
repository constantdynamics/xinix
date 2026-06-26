import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchPriceHistory } from "../api";
import type { Dashboard, Card as CardType, Sector } from "../types";
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

const CONF_TONE: Record<Confidence, "lime" | "cyan" | "watch" | "loss"> = {
  "zeer-hoog": "lime",
  hoog: "cyan",
  middel: "watch",
  laag: "loss",
};
const CONF_LABEL: Record<Confidence, string> = {
  "zeer-hoog": "Zeer betrouwbaar",
  hoog: "Betrouwbaar",
  middel: "Redelijk",
  laag: "Indicatief",
};
const CONF_SHORT: Record<Confidence, string> = {
  "zeer-hoog": "Zeer betr.",
  hoog: "Betrouwbaar",
  middel: "Redelijk",
  laag: "Indicatief",
};
const CONF_RANK: Record<Confidence, number> = { "zeer-hoog": 3, hoog: 2, middel: 1, laag: 0 };
const ALL_CONF: Confidence[] = ["zeer-hoog", "hoog", "middel", "laag"];

// Score → kleur. Hoger = heter (lime → geel → oranje → pink).
function scoreColor(score: number): string {
  if (score >= 50) return "#ff1f8f"; // hot pink
  if (score >= 35) return "#ff5a3a"; // rood-oranje
  if (score >= 22) return "#ffa800"; // oranje
  if (score >= 12) return "#ffd400"; // geel
  return "#8aa0a8"; // gedempt blauwgrijs
}

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
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

type SortKey = "score" | "confidence" | "vol" | "doublings" | "price" | "advies_dist" | "ticker";
type SortDir = "asc" | "desc";

function sortValue(r: DoublingResult, key: SortKey): number | string | null {
  switch (key) {
    case "score": return r.score;
    case "confidence": return CONF_RANK[r.confidence];
    case "vol": return r.annualVolPct;
    case "doublings": return r.historicalDoublings;
    case "price": return r.lastClose;
    case "advies_dist": return r.adviesDistancePct;
    case "ticker": return r.ticker;
  }
}

export function VerdubbelaarsView({ dashboard, scans }: Props) {
  const marks = useMarks();
  const [statsVersion, setStatsVersion] = useState(0); // bump zodra een ticker klaar is
  const [reloadKey, setReloadKey] = useState(0); // bump om de fetch-effect te herstarten (Herbereken)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);

  // Filters + sortering (boven de tabel, net als de Lijst-tab).
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sectorFilter, setSectorFilter] = useState<Set<Sector>>(new Set());
  const [confFilter, setConfFilter] = useState<Set<Confidence>>(new Set());
  const [minScore, setMinScore] = useState(0);
  const [onlyBuyZone, setOnlyBuyZone] = useState(false);

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

  const filtered = useMemo<DoublingResult[]>(() => {
    let list = results;
    if (sectorFilter.size > 0) list = list.filter((r) => r.sector != null && sectorFilter.has(r.sector));
    if (confFilter.size > 0) list = list.filter((r) => confFilter.has(r.confidence));
    if (minScore > 0) list = list.filter((r) => r.score >= minScore);
    if (onlyBuyZone) list = list.filter((r) => r.adviesDistancePct != null && r.adviesDistancePct <= 0);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls altijd onderaan
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return dir * av.localeCompare(bv);
      }
      return dir * ((av as number) - (bv as number));
    });
  }, [results, sectorFilter, confFilter, minScore, onlyBuyZone, sortKey, sortDir]);

  const summary = useMemo(() => {
    if (results.length === 0) return null;
    const scores = results.map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const top = results.reduce((m, r) => (r.score > m.score ? r : m), results[0]);
    const strong = results.filter((r) => r.score >= 30).length;
    const trusted = results.filter((r) => r.confidence === "zeer-hoog" || r.confidence === "hoog").length;
    return { avg, top, strong, trusted };
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Sensibele standaardrichting per kolom.
      setSortDir(key === "ticker" || key === "advies_dist" || key === "price" ? "asc" : "desc");
    }
  }
  function toggleSector(s: Sector) {
    setSectorFilter((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  }
  function toggleConf(c: Confidence) {
    setConfFilter((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
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

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");
  const sectorCounts: Record<Sector, number> = { biotech: 0, mining: 0, other: 0 };
  for (const r of results) if (r.sector) sectorCounts[r.sector]++;
  const confCounts: Record<Confidence, number> = { "zeer-hoog": 0, hoog: 0, middel: 0, laag: 0 };
  for (const r of results) confCounts[r.confidence]++;

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
              Onder een lognormaal koersmodel volgt daaruit een kans dat de koers 2× aantikt binnen een jaar.
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
            De <strong>betrouwbaarheid</strong> (Zeer betrouwbaar → Indicatief) zegt hoe hard de onderbouwing is. De
            <strong> advies-koers</strong> is de aankooplimiet (indien ingesteld) of anders een model-afleiding: koop op
            een terugval, niet op kracht. <strong>vs advies</strong> toont hoe ver de koers nu boven dat instapniveau
            zit. Klik een rij open voor de volledige onderbouwing. Geen advies — een transparante schatting.
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
            {summary && <Stat label="Getoond" value={filtered.length} />}
            {summary && <Stat label="Gem. score" value={summary.avg.toFixed(0)} />}
            {summary && <Stat label="Betrouwbaar+" value={summary.trusted} />}
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

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Betrouwbaarheid:</span>
            {ALL_CONF.map((cf) => {
              const active = confFilter.has(cf);
              const count = confCounts[cf];
              const tone = CONF_TONE[cf];
              const cls = active
                ? toneActive(tone)
                : "border-ink-5 text-neutral-400 hover:text-neutral-200";
              return (
                <button
                  key={cf}
                  onClick={() => toggleConf(cf)}
                  disabled={count === 0 && !active}
                  className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-40 ${cls}`}
                >
                  {CONF_SHORT[cf]} <span className="opacity-70">{count}</span>
                </button>
              );
            })}
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold ml-3 mr-1">Sector:</span>
            {(["biotech", "mining", "other"] as Sector[]).map((s) => {
              const active = sectorFilter.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSector(s)}
                  disabled={sectorCounts[s] === 0 && !active}
                  className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-40 ${
                    active ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {SECTOR_LABEL[s]} <span className="opacity-70">{sectorCounts[s]}</span>
                </button>
              );
            })}
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold ml-3 mr-1">Min. score:</span>
            {[0, 10, 20, 30, 50].map((n) => (
              <button
                key={n}
                onClick={() => setMinScore(n)}
                className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  minScore === n ? "border-fog-pink/50 text-fog-pink bg-fog-pink/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {n === 0 ? "alle" : `${n}+`}
              </button>
            ))}
            <button
              onClick={() => setOnlyBuyZone((v) => !v)}
              title="Alleen aandelen die op of onder de advies-koers staan"
              className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ml-3 ${
                onlyBuyZone ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              🎯 In koopzone
            </button>
          </div>

          {/* Sortering */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Sorteer:</span>
            {([
              ["score", "Score"],
              ["confidence", "Betrouwbaarheid"],
              ["advies_dist", "vs advies"],
              ["vol", "Volatiliteit"],
              ["doublings", "Verdubbeld"],
              ["price", "Koers"],
              ["ticker", "Ticker"],
            ] as Array<[SortKey, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  sortKey === key ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label} {sortArrow(key)}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Card className="p-8 text-center text-sm text-neutral-500">Geen aandelen voldoen aan de filters.</Card>
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                    <tr>
                      <th className="px-2 py-2 w-6" />
                      <th className="px-2 py-2 text-right">#</th>
                      <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("ticker")}>
                        Ticker <span className="text-fog-lime text-[9px]">{sortArrow("ticker")}</span>
                      </th>
                      <th className="px-3 py-2 text-left">Bedrijf</th>
                      <th className="px-3 py-2 text-left">Sector</th>
                      <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("score")}>
                        Score <span className="text-fog-lime text-[9px]">{sortArrow("score")}</span>
                      </th>
                      <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("confidence")}>
                        Betrouwbaarheid <span className="text-fog-lime text-[9px]">{sortArrow("confidence")}</span>
                      </th>
                      <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("vol")}>
                        σ <span className="text-fog-lime text-[9px]">{sortArrow("vol")}</span>
                      </th>
                      <th className="px-3 py-2 text-center cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("doublings")}>
                        Verdubbeld <span className="text-fog-lime text-[9px]">{sortArrow("doublings")}</span>
                      </th>
                      <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("price")}>
                        Koers <span className="text-fog-lime text-[9px]">{sortArrow("price")}</span>
                      </th>
                      <th className="px-3 py-2 text-right" title="Geadviseerde maximale instapkoers">Advies-koers</th>
                      <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("advies_dist")} title="Hoe ver de huidige koers boven het advies zit">
                        vs advies <span className="text-fog-lime text-[9px]">{sortArrow("advies_dist")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-5/40">
                    {filtered.map((r, i) => {
                      const isOpen = expanded.has(r.ticker);
                      const exch = exchangeByTicker.get(r.ticker) ?? null;
                      const pending = !statsCache.has(r.ticker) && loadingHistory;
                      const color = scoreColor(r.score);
                      const dist = r.adviesDistancePct;
                      const distCls =
                        dist == null
                          ? "text-neutral-600"
                          : dist <= 0
                            ? "text-fog-lime font-semibold"
                            : dist <= 10
                              ? "text-fog-warn"
                              : "text-neutral-300";
                      return (
                        <Fragment key={r.ticker}>
                          <tr
                            className="hover:bg-ink-3/30 cursor-pointer"
                            onClick={() => toggleExpand(r.ticker)}
                          >
                            <td className="px-2 py-2 text-neutral-500 text-center">{isOpen ? "▾" : "▸"}</td>
                            <td className="px-2 py-2 text-right text-[10px] text-neutral-500 tabular-nums">{i + 1}</td>
                            <td className="px-3 py-2">
                              <a
                                href={googleFinanceUrl(r.ticker, exch)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="font-mono font-semibold tab-accent-text hover:underline"
                              >
                                {r.ticker}
                              </a>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChartFor({ ticker: r.ticker, company: r.company, exchange: exch });
                                }}
                                className="text-left text-neutral-200 hover:text-fog-pink hover:underline transition-colors max-w-[160px] truncate block"
                                title={`Bekijk koersgrafiek van ${r.company}`}
                              >
                                {r.company}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              {r.sector ? (
                                <Badge tone={SECTOR_TONE[r.sector]}>{SECTOR_LABEL[r.sector]}</Badge>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <span className="font-bold tabular-nums text-base" style={{ color }}>
                                  {r.score}
                                </span>
                                <span className="w-10 h-1.5 hidden sm:block">
                                  <BlockBar fill={r.score / 100} orientation="horizontal" count={10} />
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <Badge tone={CONF_TONE[r.confidence]} title={`${CONF_LABEL[r.confidence]} — hoe hard de onderbouwing is, op basis van beschikbare data`}>
                                {CONF_SHORT[r.confidence]}
                              </Badge>
                              {pending && <span className="ml-1 text-[10px] text-neutral-500 animate-pulse">…</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300">
                              {r.annualVolPct != null ? `${r.annualVolPct.toFixed(0)}%` : <span className="text-neutral-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.historicalDoublings != null ? (
                                <span className={r.historicalDoublings > 0 ? "text-fog-lime font-semibold" : "text-neutral-400"}>
                                  {r.historicalDoublings}×
                                </span>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                              {r.lastClose != null ? `$${fmtPrice(r.lastClose)}` : <span className="text-neutral-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {r.adviesPrice != null ? (
                                <span
                                  className="text-neutral-100"
                                  title={r.adviesSource === "limiet" ? "Aankooplimiet" : "Model-afleiding (terugval richting steun)"}
                                >
                                  ${fmtPrice(r.adviesPrice)}
                                  <span className="ml-1 text-[9px] text-neutral-500">{r.adviesSource === "limiet" ? "lim" : "mdl"}</span>
                                </span>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">
                              {dist != null ? (
                                <span className={distCls}>
                                  {dist <= 0 ? `${dist.toFixed(1)}%` : `+${dist.toFixed(1)}%`}
                                </span>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-ink-2/40">
                              <td />
                              <td colSpan={11} className="px-4 py-3">
                                <DoublingDetail result={r} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <p className="text-[11px] text-neutral-600 leading-relaxed">
            ⚠️ Geen beleggingsadvies. Het verdubbelen van een koers binnen een jaar is fundamenteel onzeker; deze scores
            en advies-koersen zijn modelmatige schattingen op basis van historische data en kunnen er flink naast zitten.
            Koersdata via Yahoo Finance.
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

// Helper: actieve-pill-stijl per tone (voor de betrouwbaarheids-filterknoppen).
function toneActive(tone: "lime" | "cyan" | "watch" | "loss"): string {
  switch (tone) {
    case "lime": return "border-fog-lime/50 text-fog-lime bg-fog-lime/10";
    case "cyan": return "border-fog-info/50 text-fog-info bg-fog-info/10";
    case "watch": return "border-fog-watch/50 text-fog-watch bg-fog-watch/10";
    case "loss": return "border-fog-loss/50 text-fog-loss bg-fog-loss/10";
  }
}

// Uitklapbare onderbouwing onder een tabelrij.
function DoublingDetail({ result }: { result: DoublingResult }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-300 leading-relaxed">{result.narrative}</p>

      {result.adviesPrice != null && result.lastClose != null && (
        <div className="text-[11px] text-neutral-400">
          <span className="text-neutral-200 font-semibold">Advies-koers:</span> $
          {fmtPrice(result.adviesPrice)}{" "}
          {result.adviesSource === "limiet" ? "(je aankooplimiet)" : "(model: terugval richting steun)"} — de koers staat
          nu{" "}
          {result.adviesDistancePct != null && result.adviesDistancePct > 0
            ? `+${result.adviesDistancePct.toFixed(1)}% bóven het advies (wachten op een dip kan)`
            : `op of onder het advies — in de koopzone`}
          .
        </div>
      )}

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

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500 pt-1">
        <span>
          Volatiliteit-baseline: <span className="text-neutral-300 tabular-nums">{(result.pVol * 100).toFixed(1)}%</span>
        </span>
        {result.pEmp != null && (
          <span>
            Empirisch: <span className="text-neutral-300 tabular-nums">{(result.pEmp * 100).toFixed(1)}%</span>
          </span>
        )}
        <span>
          Structurele factor: <span className="text-neutral-300 tabular-nums">×{result.structuralMultiplier.toFixed(2)}</span>
        </span>
      </div>

      {result.missing.length > 0 && (
        <div className="text-[10px] text-fog-warn/80">
          Ontbrekende data (drukt de betrouwbaarheid): {result.missing.join(" · ")}
        </div>
      )}
    </div>
  );
}
