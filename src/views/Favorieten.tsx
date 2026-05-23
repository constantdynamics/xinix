import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addMark,
  batchAddTickers,
  fetchDashboard,
  fetchScanResults,
  getToken,
  lookupTickers,
  patchTicker,
  type LookupResult,
  type ScanResults,
  type TickerInput,
} from "../api";
import type { Dashboard, Card as CardType, Sector } from "../types";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Badge, Stat } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, ShowSeenToggle, StarRating } from "../components/MarkCells";
import { ColumnPicker, useColumnLayout, type ColumnMeta } from "../components/ColumnPicker";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

type Bron = "feniks" | "poefie" | "hikkertje" | "zwitserleven" | "watchlist";

const BRON_LABEL: Record<Bron, string> = {
  feniks: "🦅 Feniks",
  poefie: "🎆 Poefie",
  hikkertje: "⚡ Hikkertje",
  zwitserleven: "🌴 Zwitserleven",
  watchlist: "Watchlist",
};

const BRON_COLOR: Record<Bron, string> = {
  feniks: "border-orange-500/40 text-orange-300 bg-orange-500/10",
  poefie: "border-fog-pink/40 text-fog-pink bg-fog-pink/10",
  hikkertje: "border-yellow-500/40 text-yellow-300 bg-yellow-500/10",
  zwitserleven: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  watchlist: "border-ink-5 text-neutral-400 bg-ink-3/40",
};

interface FavRow {
  ticker: string;
  company: string;
  sector: Sector | null;
  exchange: string | null;
  score: number | null;
  last_close: number | null;
  buy_limit: number | null;
  above_limit_pct: number | null;
  dividend_yield: number | null;
  medal_gold: number;
  medal_silver: number;
  medal_bronze: number;
  bronnen: Bron[];
  // True wanneer de ticker als favoriet bestaat maar niet (meer) in de watchlist
  // staat — alle data is dan onbekend en de rij toont enkel streepjes.
  orphan: boolean;
}

type SortKey = "ticker" | "company" | "score" | "above_limit_pct" | "last_close" | "rating" | "medals" | "dividend";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "tiles";

const VIEW_KEY = "xinix_favorieten_view";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

function fmtYield(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

// Tabelkolommen voor de kolom-kiezer. Ticker is de vaste anker-kolom
// (altijd zichtbaar, altijd vooraan).
const FAV_COLUMNS: ColumnMeta[] = [
  { key: "ticker", label: "Ticker" },
  { key: "rating", label: "Sterren" },
  { key: "company", label: "Bedrijf" },
  { key: "sector", label: "Sector" },
  { key: "bron", label: "Bron" },
  { key: "score", label: "Score" },
  { key: "medals", label: "Medailles" },
  { key: "dividend", label: "Dividend" },
  { key: "last_close", label: "Koers" },
  { key: "above_limit_pct", label: "vs limiet" },
  { key: "limiet", label: "Limiet" },
];

export function FavorietenView() {
  const marks = useMarks();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [scans, setScans] = useState<ScanResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default: sorteer op afstand tot aankooplimiet (oplopend) — wat het dichtst
  // bij de koop-trigger zit komt bovenaan.
  const [sortKey, setSortKey] = useState<SortKey>("above_limit_pct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bronFilter, setBronFilter] = useState<Set<Bron>>(new Set());
  const [sectorFilter, setSectorFilter] = useState<Set<Sector>>(new Set());
  const [showSeen, setShowSeen] = useState(false);
  // Minimum sterren-filter: 0 = alles, 1..5 = alleen rijen met ≥ N sterren.
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) === "tiles" ? "tiles" : "table"),
  );
  function pickView(v: ViewMode) {
    setViewMode(v);
    localStorage.setItem(VIEW_KEY, v);
  }

  // Inline buy_limit editing: track welke ticker bewerkt wordt + de tekstwaarde.
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState<string | null>(null);
  // Locale optimistische overrides van buy_limit (na inline-save, voordat
  // dashboard opnieuw geladen is).
  const [limitOverrides, setLimitOverrides] = useState<Record<string, number | null>>({});
  // Bulk-add panel
  const [showAdd, setShowAdd] = useState(false);
  // Koersgrafiek-popup — geopend door op een bedrijfsnaam te klikken.
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);

  const isAdmin = !!getToken();
  const { visibleKeys } = useColumnLayout("favorieten", FAV_COLUMNS, "ticker");

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDashboard(), fetchScanResults()])
      .then(([d, s]) => {
        setDashboard(d);
        setScans(s);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo<FavRow[]>(() => {
    if (!dashboard) return [];
    const favSet = marks.favorites;
    if (favSet.size === 0) return [];

    const cardByTicker = new Map<string, CardType>();
    for (const c of dashboard.cards) cardByTicker.set(c.ticker.toUpperCase(), c);

    const poefieByTicker = new Map<string, { last_close: number | null; buy_limit: number | null; above_limit_pct: number | null; score: number | null; sector: Sector | null; company: string | null; exchange: string | null }>();
    for (const p of scans?.poefie_ranking ?? []) {
      poefieByTicker.set(p.ticker.toUpperCase(), {
        last_close: p.last_close,
        buy_limit: p.buy_limit,
        above_limit_pct: p.above_limit_pct,
        score: null,
        sector: (p.sector as Sector | null) ?? null,
        company: p.company,
        exchange: p.exchange,
      });
    }
    const phoenixSet = new Set((scans?.phoenix_ranking ?? []).map((r) => r.ticker.toUpperCase()));
    const hikkertjeSet = new Set((scans?.hikkertje_ranking ?? []).map((r) => r.ticker.toUpperCase()));

    const out: FavRow[] = [];
    for (const T of favSet) {
      const card = cardByTicker.get(T);
      const p = poefieByTicker.get(T);
      const bronnen: Bron[] = [];
      if (phoenixSet.has(T) || card?.is_phoenix) bronnen.push("feniks");
      if (p) bronnen.push("poefie");
      if (hikkertjeSet.has(T) || card?.is_hikkertje) bronnen.push("hikkertje");
      if (card?.is_zwitserleven) bronnen.push("zwitserleven");
      if (card && bronnen.length === 0) bronnen.push("watchlist");

      const last_close = p?.last_close ?? card?.summary?.last_close ?? null;
      const override = limitOverrides[T];
      const buy_limit = override !== undefined ? override : (card?.buy_limit ?? p?.buy_limit ?? null);
      // Hergebruik above_limit_pct alleen als override ongebruikt is — anders
      // herberekenen uit de bijgewerkte limiet.
      const above_limit_pct = override !== undefined
        ? (last_close != null && buy_limit != null && buy_limit > 0
            ? ((last_close - buy_limit) / buy_limit) * 100
            : null)
        : (p?.above_limit_pct
            ?? (last_close != null && buy_limit != null && buy_limit > 0
                  ? ((last_close - buy_limit) / buy_limit) * 100
                  : null));

      // Orphan = favoriet zonder enige data-bron. Komt voor wanneer een ticker
      // wel in xinix_favorites staat maar niet (meer) actief in signal_tickers.
      const orphan = !card && !p;

      out.push({
        ticker: T,
        company: card?.company ?? p?.company ?? "—",
        sector: card?.sector ?? p?.sector ?? null,
        exchange: card?.exchange ?? p?.exchange ?? null,
        score: card?.goud_score ?? null,
        last_close,
        buy_limit,
        above_limit_pct,
        dividend_yield: card?.dividend_yield ?? null,
        medal_gold: card?.medal_gold ?? 0,
        medal_silver: card?.medal_silver ?? 0,
        medal_bronze: card?.medal_bronze ?? 0,
        bronnen,
        orphan,
      });
    }
    return out;
  }, [dashboard, scans, marks, limitOverrides]);

  // Wezen — favorieten zonder enige data — apart bij elkaar voor de reparatie-knop.
  const orphans = useMemo(() => rows.filter((r) => r.orphan), [rows]);
  const [repairing, setRepairing] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  async function repairOrphans() {
    if (orphans.length === 0 || repairing) return;
    setRepairing(true);
    setRepairMsg(null);
    try {
      // Lookup om bedrijfsnaam + exchange op te halen (Yahoo via lookupTickers).
      const tickers = orphans.map((o) => o.ticker);
      let lookups: LookupResult[] = [];
      try {
        lookups = await lookupTickers(tickers);
      } catch {
        // Lookup mag falen — voeg dan toch toe met alleen ticker als naam.
      }
      const lookupByTicker = new Map(lookups.map((l) => [l.ticker.toUpperCase(), l]));
      const toAdd: TickerInput[] = tickers.map((t) => {
        const l = lookupByTicker.get(t);
        return {
          ticker: t,
          company: l?.recognized ? (l.company ?? t) : t,
          sector: "other" as const,
        };
      });
      await batchAddTickers(toAdd);
      setRepairMsg(`${toAdd.length} favorieten teruggezet in watchlist — data wordt bij de volgende poll opgehaald.`);
      // Herlaad dashboard zodat de nieuwe ticker-rijen verschijnen.
      const d = await fetchDashboard();
      setDashboard(d);
    } catch (err) {
      setRepairMsg(`Fout bij repareren: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRepairing(false);
    }
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (!showSeen) list = list.filter((r) => !marks.isSeen(r.ticker));
    if (bronFilter.size > 0) {
      list = list.filter((r) => r.bronnen.some((b) => bronFilter.has(b)));
    }
    if (sectorFilter.size > 0) {
      list = list.filter((r) => r.sector != null && sectorFilter.has(r.sector));
    }
    if (minRating > 0) {
      list = list.filter((r) => (marks.getRating(r.ticker) ?? 0) >= minRating);
    }
    list = [...list].sort((a, b) => {
      let av: number | string | null = null;
      let bv: number | string | null = null;
      switch (sortKey) {
        case "ticker": av = a.ticker; bv = b.ticker; break;
        case "company": av = a.company; bv = b.company; break;
        case "score": av = a.score; bv = b.score; break;
        case "above_limit_pct": av = a.above_limit_pct; bv = b.above_limit_pct; break;
        case "last_close": av = a.last_close; bv = b.last_close; break;
        case "rating": av = marks.getRating(a.ticker); bv = marks.getRating(b.ticker); break;
        case "medals": av = a.medal_gold * 100 + a.medal_silver * 10 + a.medal_bronze; bv = b.medal_gold * 100 + b.medal_silver * 10 + b.medal_bronze; break;
        case "dividend": av = a.dividend_yield; bv = b.dividend_yield; break;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return list;
  }, [rows, sortKey, sortDir, bronFilter, sectorFilter, showSeen, minRating, marks]);

  function startEditLimit(row: FavRow) {
    if (!isAdmin) return;
    setEditingLimit(row.ticker);
    setEditValue(row.buy_limit != null ? String(row.buy_limit) : "");
  }
  async function commitEditLimit(ticker: string) {
    const trimmed = editValue.trim();
    let newLimit: number | null;
    if (trimmed === "") {
      newLimit = null;
    } else {
      const parsed = Number(trimmed.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEditingLimit(null);
        return;
      }
      newLimit = parsed;
    }
    setEditingLimit(null);
    setSavingLimit(ticker);
    setLimitOverrides((m) => ({ ...m, [ticker]: newLimit }));
    try {
      await patchTicker(ticker, { buy_limit: newLimit });
    } catch (err) {
      console.error("save buy_limit failed", err);
      // rollback: verwijder override zodat de oude DB-waarde weer zichtbaar wordt
      setLimitOverrides((m) => { const n = { ...m }; delete n[ticker]; return n; });
    } finally {
      setSavingLimit(null);
    }
  }
  function cancelEditLimit() { setEditingLimit(null); setEditValue(""); }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "ticker" || key === "company" ? "asc" : "desc"); }
  }
  function toggleBron(b: Bron) {
    setBronFilter((prev) => { const n = new Set(prev); if (n.has(b)) n.delete(b); else n.add(b); return n; });
  }
  function toggleSector(s: Sector) {
    setSectorFilter((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  }
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "";

  // (BulkAddFavoritesPanel staat onderaan dit bestand)

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const sectors: Sector[] = ["biotech", "mining", "other"];
  const allBronnen: Bron[] = ["feniks", "poefie", "hikkertje", "zwitserleven", "watchlist"];

  const bronCounts: Record<Bron, number> = { feniks: 0, poefie: 0, hikkertje: 0, zwitserleven: 0, watchlist: 0 };
  for (const r of rows) for (const b of r.bronnen) bronCounts[b]++;

  // Per kolom-key de header- en cel-render. De kolom-kiezer bepaalt welke
  // hiervan in welke volgorde getoond worden (zie visibleKeys).
  const colMap: Record<string, { th: ReactNode; td: (r: FavRow) => ReactNode }> = {
    ticker: {
      th: (
        <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("ticker")}>
          Ticker <span className="text-fog-lime text-[9px]">{sortArrow("ticker")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2">
          <a href={googleFinanceUrl(r.ticker, r.exchange)} target="_blank" rel="noreferrer" className="font-mono font-semibold tab-accent-text hover:underline">
            {r.ticker}
          </a>
        </td>
      ),
    },
    rating: {
      th: (
        <th className="px-3 py-2 text-center cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("rating")}>
          Sterren <span className="text-fog-lime text-[9px]">{sortArrow("rating")}</span>
        </th>
      ),
      td: (r) => <td className="px-3 py-2 text-center"><StarRating ticker={r.ticker} /></td>,
    },
    company: {
      th: (
        <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("company")}>
          Bedrijf <span className="text-fog-lime text-[9px]">{sortArrow("company")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setChartFor({ ticker: r.ticker, company: r.company, exchange: r.exchange })}
            className="text-left text-neutral-200 hover:text-fog-pink hover:underline transition-colors"
            title={`Bekijk koersgrafiek van ${r.company}`}
          >
            {r.company}
          </button>
        </td>
      ),
    },
    sector: {
      th: <th className="px-3 py-2 text-left">Sector</th>,
      td: (r) => (
        <td className="px-3 py-2">
          {r.sector ? <Badge tone={SECTOR_TONE[r.sector]}>{SECTOR_LABEL[r.sector]}</Badge> : <span className="text-neutral-600">—</span>}
        </td>
      ),
    },
    bron: {
      th: <th className="px-3 py-2 text-left">Bron</th>,
      td: (r) => (
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {r.bronnen.map((b) => (
              <span key={b} className={`px-1.5 py-0.5 rounded text-[10px] border font-semibold whitespace-nowrap ${BRON_COLOR[b]}`}>
                {BRON_LABEL[b]}
              </span>
            ))}
          </div>
        </td>
      ),
    },
    score: {
      th: (
        <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("score")}>
          Score <span className="text-fog-lime text-[9px]">{sortArrow("score")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
          {r.score != null ? r.score.toFixed(0) : <span className="text-neutral-600">—</span>}
        </td>
      ),
    },
    medals: {
      th: (
        <th className="px-3 py-2 text-center cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("medals")}>
          Medailles <span className="text-fog-lime text-[9px]">{sortArrow("medals")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
          {r.medal_gold + r.medal_silver + r.medal_bronze > 0 ? (
            <span>
              {r.medal_gold > 0 && `🏆${r.medal_gold} `}
              {r.medal_silver > 0 && `🥈${r.medal_silver} `}
              {r.medal_bronze > 0 && `🥉${r.medal_bronze}`}
            </span>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </td>
      ),
    },
    dividend: {
      th: (
        <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("dividend")}>
          Dividend <span className="text-fog-lime text-[9px]">{sortArrow("dividend")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-right font-mono tabular-nums">
          {r.dividend_yield != null && r.dividend_yield > 0 ? (
            <span className="text-emerald-300">{fmtYield(r.dividend_yield)}</span>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </td>
      ),
    },
    last_close: {
      th: (
        <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("last_close")}>
          Koers <span className="text-fog-lime text-[9px]">{sortArrow("last_close")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
          {r.last_close != null ? fmtPrice(r.last_close) : <span className="text-neutral-600">—</span>}
        </td>
      ),
    },
    above_limit_pct: {
      th: (
        <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("above_limit_pct")}>
          vs limiet <span className="text-fog-lime text-[9px]">{sortArrow("above_limit_pct")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-right font-mono tabular-nums">
          {r.above_limit_pct != null ? (
            <span className={r.above_limit_pct <= 0 ? "text-fog-lime font-semibold" : r.above_limit_pct <= 10 ? "text-fog-warn" : "text-neutral-300"}>
              {r.above_limit_pct <= 0 ? "✓ onder" : `+${r.above_limit_pct.toFixed(1)}%`}
            </span>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </td>
      ),
    },
    limiet: {
      th: <th className="px-3 py-2 text-right" title="Aankooplimiet — klik om in te vullen">Limiet</th>,
      td: (r) => (
        <td className="px-3 py-2 text-right font-mono tabular-nums">
          {editingLimit === r.ticker ? (
            <input
              autoFocus
              type="text"
              inputMode="decimal"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitEditLimit(r.ticker)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEditLimit(r.ticker);
                else if (e.key === "Escape") cancelEditLimit();
              }}
              className="w-20 px-1.5 py-0.5 rounded bg-ink-3 border border-fog-lime text-right font-mono text-xs text-neutral-100 focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => startEditLimit(r)}
              disabled={!isAdmin}
              className={
                "px-1.5 py-0.5 rounded text-xs font-mono tabular-nums transition-colors " +
                (isAdmin ? "hover:bg-ink-3 cursor-pointer" : "cursor-default") +
                " " + (r.buy_limit != null ? "text-neutral-200" : "text-neutral-600")
              }
              title={isAdmin ? "Klik om de aankooplimiet aan te passen" : "Login vereist"}
            >
              {savingLimit === r.ticker ? "…" : (r.buy_limit != null ? fmtPrice(r.buy_limit) : "+")}
            </button>
          )}
        </td>
      ),
    },
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 tab-accent-panel">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none shrink-0"><GradientTabIcon tab="favorieten" /></span>
          <div className="flex-1">
            <div className="font-semibold tab-accent-text mb-1">Favorieten</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Aandelen die je hebt aangemerkt met het hartje op een ander tabblad.
              De badges tonen op welke lijst ze voorkomen (Feniks, Poefie, Hikkertje, Zwitserleven of alleen watchlist).
              Sorteer of filter op bron of sector om snel te vinden wat je zoekt.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Favorieten" value={marks.favorites.size} />
        <Stat label="Getoond" value={filtered.length} />
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Sluit" : "+ Toevoegen"}
            </Button>
          )}
          <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
        </div>
      </div>

      {/* Reparatie-banner: favorieten zonder data terugzetten in watchlist. */}
      {orphans.length > 0 && (
        <Card className="p-3 border-fog-warn/40 bg-fog-warn/[0.06]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-fog-warn">
                {orphans.length} {orphans.length === 1 ? "favoriet ontbreekt" : "favorieten ontbreken"} in de watchlist
              </div>
              <div className="text-xs text-neutral-400 mt-0.5 leading-snug">
                Deze tickers ({orphans.slice(0, 5).map((o) => o.ticker).join(", ")}{orphans.length > 5 ? `, …` : ""}) staan als favoriet
                maar zijn niet (meer) actief in de watchlist — daarom missen koers, sector en medailles. Klik op
                "Repareren" om ze terug in de watchlist te zetten; de data wordt bij de volgende poll opgehaald.
              </div>
              {repairMsg && (
                <div className={`text-xs mt-1 ${repairMsg.startsWith("Fout") ? "text-fog-loss" : "text-fog-lime"}`}>
                  {repairMsg}
                </div>
              )}
            </div>
            {isAdmin && (
              <Button size="sm" onClick={repairOrphans} disabled={repairing}>
                {repairing ? "Bezig…" : `🔧 Repareer ${orphans.length}`}
              </Button>
            )}
          </div>
        </Card>
      )}

      {showAdd && isAdmin && (
        <BulkAddFavoritesPanel
          onClose={() => setShowAdd(false)}
          onDone={() => {
            // Herlaad dashboard om de nieuwe tickers met data te tonen
            fetchDashboard().then(setDashboard).catch(() => {});
          }}
        />
      )}

      {rows.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">♡</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen favorieten</div>
          <div className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            Klik op het hartje vooraan een rij in Watchlist, Feniks, Poefies, Hikkertjes of Zwitserleven om dat aandeel hier te verzamelen.
          </div>
        </Card>
      ) : (
        <>
          {/* Bron-filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Bron:</span>
            {allBronnen.map((b) => {
              const active = bronFilter.has(b);
              const count = bronCounts[b];
              const cls = active ? BRON_COLOR[b] : "border-ink-5 text-neutral-400 hover:text-neutral-200";
              return (
                <button
                  key={b}
                  onClick={() => toggleBron(b)}
                  className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${cls}`}
                  disabled={count === 0 && !active}
                >
                  {BRON_LABEL[b]} <span className="opacity-70">{count}</span>
                </button>
              );
            })}
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold ml-3 mr-1">Sector:</span>
            {sectors.map((s) => {
              const active = sectorFilter.has(s);
              return (
                <button
                  key={s}
                  onClick={() => toggleSector(s)}
                  className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                    active ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {SECTOR_LABEL[s]}
                </button>
              );
            })}
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold ml-3 mr-1">Min. sterren:</span>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setMinRating(n)}
                className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  minRating === n ? "border-yellow-400/50 text-yellow-300 bg-yellow-400/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {n === 0 ? "alle" : `${n}★+`}
              </button>
            ))}
          </div>

          {/* Sorteer + weergave-controls */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Sorteer:</span>
            {([
              ["above_limit_pct", "Afstand limiet"],
              ["rating", "Sterren"],
              ["score", "Score"],
              ["medals", "Medailles"],
              ["dividend", "Dividend"],
              ["last_close", "Koers"],
              ["ticker", "Ticker"],
            ] as Array<[SortKey, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  sortKey === key ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {label} {sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : ""}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => pickView("table")}
                className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  viewMode === "table" ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                ☰ Lijst
              </button>
              <button
                onClick={() => pickView("tiles")}
                className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  viewMode === "tiles" ? "border-fog-lime/50 text-fog-lime bg-fog-lime/10" : "border-ink-5 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                ▦ Tegels
              </button>
            </div>
          </div>

          {viewMode === "tiles" ? (
            <FavorietenTiles
              rows={filtered}
              onCompanyClick={(r) => setChartFor({ ticker: r.ticker, company: r.company, exchange: r.exchange })}
            />
          ) : (
          <>
          {/* Kolom-kiezer — alleen in lijstweergave; keuze synct over devices */}
          <div className="flex items-center justify-end">
            <ColumnPicker tabKey="favorieten" columns={FAV_COLUMNS} lockedKey="ticker" />
          </div>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  <tr>
                    <SeenHeader />
                    <HeartHeader />
                    {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.th}</Fragment>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {filtered.map((r) => {
                    const seen = marks.isSeen(r.ticker);
                    const cls = [
                      seen ? "opacity-50" : "",
                      r.orphan ? "bg-fog-warn/[0.06]" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <tr
                        key={r.ticker}
                        className={cls}
                        title={r.orphan ? "Data ontbreekt — gebruik de reparatie-knop bovenaan" : undefined}
                      >
                        <SeenCell ticker={r.ticker} />
                        <HeartCell ticker={r.ticker} />
                        {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.td(r)}</Fragment>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          </>
          )}
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

// Tegelweergave — compacte grid-kaarten, één per favoriet. Toont sterren,
// afstand tot limiet, medailles en bron-badges. Klik op de ticker opent
// Google Finance; klik op de bedrijfsnaam opent de koersgrafiek.
function FavorietenTiles({ rows, onCompanyClick }: { rows: FavRow[]; onCompanyClick: (r: FavRow) => void }) {
  const marks = useMarks();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {rows.map((r) => {
        const seen = marks.isSeen(r.ticker);
        const atOrUnder = r.above_limit_pct != null && r.above_limit_pct <= 0;
        const near = r.above_limit_pct != null && r.above_limit_pct > 0 && r.above_limit_pct <= 10;
        const toneRing = atOrUnder ? "ring-fog-lime/40" : near ? "ring-fog-warn/30" : "ring-ink-5";
        return (
          <div
            key={r.ticker}
            className={`rounded-xl border border-ink-5 bg-ink-2/60 ring-1 ${toneRing} p-2.5 transition ${seen ? "opacity-50" : ""}`}
          >
            <div className="flex items-center justify-between gap-1 mb-1">
              <a
                href={googleFinanceUrl(r.ticker, r.exchange)}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-bold text-sm tab-accent-text hover:underline truncate"
              >
                {r.ticker}
              </a>
              {r.sector && <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-bold">{SECTOR_LABEL[r.sector]}</span>}
            </div>
            <button
              type="button"
              onClick={() => onCompanyClick(r)}
              className="block w-full text-left text-[10px] text-neutral-400 truncate mb-1 hover:text-fog-pink transition-colors"
              title={`Bekijk koersgrafiek van ${r.company}`}
            >
              {r.company}
            </button>
            <div className="font-mono tabular-nums text-base font-bold leading-none">
              {r.above_limit_pct != null ? (
                <span className={atOrUnder ? "text-fog-lime" : near ? "text-fog-warn" : "text-neutral-300"}>
                  {atOrUnder ? "✓ onder limiet" : `+${r.above_limit_pct.toFixed(1)}%`}
                </span>
              ) : (
                <span className="text-neutral-600 text-xs">geen limiet</span>
              )}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-neutral-500 mt-0.5">
              {r.last_close != null ? `$${fmtPrice(r.last_close)}` : "—"}
              {r.buy_limit != null && <span className="text-neutral-600"> / lim ${fmtPrice(r.buy_limit)}</span>}
            </div>
            <div className="mt-1"><StarRating ticker={r.ticker} /></div>
            <div className="flex items-center gap-1.5 mt-1 text-[10px]">
              {r.score != null && <span className="text-neutral-400">S{r.score.toFixed(0)}</span>}
              {r.medal_gold + r.medal_silver + r.medal_bronze > 0 && (
                <span>
                  {r.medal_gold > 0 && `🏆${r.medal_gold}`}
                  {r.medal_silver > 0 && `🥈${r.medal_silver}`}
                  {r.medal_bronze > 0 && `🥉${r.medal_bronze}`}
                </span>
              )}
              {r.dividend_yield != null && r.dividend_yield > 0 && (
                <span className="text-emerald-300">💰{fmtYield(r.dividend_yield)}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {r.bronnen.map((b) => (
                <span key={b} className={`px-1 py-0.5 rounded text-[9px] border font-semibold ${BRON_COLOR[b]}`}>
                  {BRON_LABEL[b]}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Parse vrije tekst input naar (ticker, optionele exchange) paren.
// Ondersteund:
//   - Plain ticker: "AAPL"
//   - Google Finance URL: "https://www.google.com/finance/beta/quote/FRMM:NASDAQ?window=1Y"
//     → ticker=FRMM exchange=NASDAQ
//   - Ticker met exchange: "FRMM:NASDAQ"
// Separators: nieuwe regels, komma's, whitespace.
function parseTickerInput(input: string): Array<{ ticker: string; exchange?: string }> {
  const out: Array<{ ticker: string; exchange?: string }> = [];
  const seen = new Set<string>();
  const tokens = input.split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length > 0);
  for (const tok of tokens) {
    let ticker: string | null = null;
    let exchange: string | undefined;
    // Google Finance URL: ".../quote/TICKER:EXCHANGE?..." of "/quote/TICKER:EXCHANGE"
    const gfMatch = tok.match(/\/quote\/([A-Z0-9.\-]+):([A-Z]+)(?:[/?#]|$)/i);
    if (gfMatch) {
      ticker = gfMatch[1].toUpperCase();
      exchange = gfMatch[2].toUpperCase();
    } else {
      // TICKER:EXCHANGE losse vorm
      const colonMatch = tok.match(/^([A-Z0-9.\-]+):([A-Z]+)$/i);
      if (colonMatch) {
        ticker = colonMatch[1].toUpperCase();
        exchange = colonMatch[2].toUpperCase();
      } else if (/^[A-Z0-9.\-]+$/i.test(tok)) {
        ticker = tok.toUpperCase();
      }
    }
    if (ticker && !seen.has(ticker)) {
      seen.add(ticker);
      out.push({ ticker, exchange });
    }
  }
  return out;
}

interface ResolvedRow extends LookupResult {
  alreadyFavorite: boolean;
}

function BulkAddFavoritesPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const marks = useMarks();
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resolved, setResolved] = useState<ResolvedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function onLookup() {
    setError(null);
    const parsed = parseTickerInput(input);
    if (parsed.length === 0) {
      setError("Geen herkenbare tickers gevonden.");
      return;
    }
    setResolving(true);
    try {
      const tickers = parsed.map((p) => p.ticker);
      const results = await lookupTickers(tickers);
      const rows: ResolvedRow[] = results.map((r) => ({
        ...r,
        alreadyFavorite: marks.favorites.has(r.ticker.toUpperCase()),
      }));
      setResolved(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }

  async function onConfirmAdd() {
    if (!resolved) return;
    setAdding(true);
    setError(null);
    try {
      // 1) Nieuwe tickers (recognized && niet al in favorieten) toevoegen aan watchlist
      const toAddWatchlist: TickerInput[] = resolved
        .filter((r) => r.recognized && !r.alreadyFavorite)
        .map((r) => ({
          ticker: r.ticker,
          company: r.company ?? r.ticker,
          sector: "other" as const,
        }));
      if (toAddWatchlist.length > 0) {
        try {
          await batchAddTickers(toAddWatchlist);
        } catch {
          // Watchlist-add mag falen (bv. al bestaand) — favoriet-toevoeging is
          // het belangrijkst en gebeurt onafhankelijk hieronder.
        }
      }
      // 2) Alle herkende tickers favorieten — gebruik addMark per ticker zodat
      //    de hook-state ook ge-update wordt en optimistic UI klopt.
      for (const r of resolved) {
        if (!r.recognized || r.alreadyFavorite) continue;
        try {
          await addMark("favorite", r.ticker);
        } catch (err) {
          console.error("favorite add failed for", r.ticker, err);
        }
      }
      // 3) Sluit het panel en herlaad data
      onDone();
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card className="p-4 space-y-3 border-fog-lime/30">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Favorieten toevoegen</div>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300">Sluiten</button>
      </div>
      <div className="text-[11px] text-neutral-500 leading-relaxed">
        Plak tickers (één per regel, met komma's of spaties), of Google-Finance URL's zoals{" "}
        <code className="text-fog-lime">https://www.google.com/finance/beta/quote/FRMM:NASDAQ?window=1Y</code>.
        Onbekende tickers worden eerst aan de watchlist toegevoegd en daarna als favoriet gemarkeerd.
      </div>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder={"AAPL\nMSFT\nhttps://www.google.com/finance/beta/quote/FRMM:NASDAQ?window=1Y"}
        className="w-full px-2 py-1.5 rounded bg-ink-3 border border-ink-5 text-xs font-mono text-neutral-100 focus:outline-none focus:border-fog-lime"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onLookup} disabled={resolving || adding || input.trim() === ""}>
          {resolving ? "Opzoeken…" : "Opzoeken"}
        </Button>
        {resolved && (
          <Button size="sm" onClick={onConfirmAdd} disabled={adding || resolved.every((r) => !r.recognized || r.alreadyFavorite)}>
            {adding ? "Bezig…" : `${resolved.filter((r) => r.recognized && !r.alreadyFavorite).length} toevoegen`}
          </Button>
        )}
        <span className="text-[10px] text-neutral-500 ml-2">{parseTickerInput(input).length} tickers geparseerd</span>
      </div>
      {error && <div className="text-xs text-fog-loss">{error}</div>}
      {resolved && (
        <div className="border border-ink-5 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-ink-3/40 text-[10px] uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">Bedrijf</th>
                <th className="px-2 py-1 text-left">Beurs</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-5/40">
              {resolved.map((r) => (
                <tr key={r.ticker}>
                  <td className="px-2 py-1 font-mono">{r.ticker}</td>
                  <td className="px-2 py-1 text-neutral-300">{r.company ?? "—"}</td>
                  <td className="px-2 py-1 text-neutral-500">{r.exchange ?? "—"}</td>
                  <td className="px-2 py-1">
                    {!r.recognized ? (
                      <span className="text-fog-loss">Onbekend{r.error ? ` (${r.error})` : ""}</span>
                    ) : r.alreadyFavorite ? (
                      <span className="text-neutral-500">Al favoriet</span>
                    ) : (
                      <span className="text-fog-lime">Klaar om toe te voegen</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
