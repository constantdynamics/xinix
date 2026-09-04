import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  addMark,
  batchAddTickers,
  fetchDashboard,
  fetchScanResults,
  fetchSettings,
  getToken,
  lookupTickers,
  patchTicker,
  type LookupResult,
  type ScanResults,
  type TickerInput,
} from "../api";
import type { Dashboard, Card as CardType, Sector } from "../types";
import { SECTOR_LABEL, SECTOR_TONE, SECTOR_NAAM, SECTORS } from "../types";
import { googleFinanceUrl } from "../tickerLinks";
import { inferSector as inferSectorUitNaam } from "../sectorGuess";
import { Card, Button, Badge, Select, Stat, CollapsibleIntro } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, ShowSeenToggle, StarRating } from "../components/MarkCells";
import { ColumnPicker, useColumnLayout, type ColumnMeta } from "../components/ColumnPicker";
import { useColumnColors } from "../hooks/useUiSettings";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";
import { RakettenView } from "./Raketten";
import { StarScannerView } from "./StarScanner";

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
  price_polled_at: string | null;
  buy_limit: number | null;
  above_limit_pct: number | null;
  dividend_yield: number | null;
  // Koersverandering in % over de laatste dag, week (~5 handelsdagen),
  // maand (~22 handelsdagen) en ~6 maanden. NULL = geen koersdata.
  chg_1d: number | null;
  chg_1w: number | null;
  chg_1m: number | null;
  chg_6m: number | null;
  medal_gold: number;
  medal_silver: number;
  medal_bronze: number;
  bronnen: Bron[];
  /** Wanneer het aandeel favoriet werd (ISO). NULL bij oude rijen zonder tijdstip. */
  favorited_at: string | null;
  // True wanneer de ticker als favoriet bestaat maar niet (meer) in de watchlist
  // staat — alle data is dan onbekend en de rij toont enkel streepjes.
  orphan: boolean;
}

type SortKey =
  | "ticker" | "company" | "score" | "above_limit_pct" | "last_close" | "rating" | "medals" | "dividend"
  | "chg_1d" | "chg_1w" | "chg_1m" | "chg_6m" | "favorited_at";
type SortDir = "asc" | "desc";
type ViewMode = "table" | "tiles";

const VIEW_KEY = "xinix_favorieten_view";
const SUBTAB_KEY = "xinix_favorieten_subtab";

type FavSubTab = "lijst" | "verdubbelaars" | "scanner";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

// Datum kort: "4 sep" binnen het lopende jaar, anders met jaartal.
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const zelfdeJaar = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    ...(zelfdeJaar ? {} : { year: "numeric" }),
  });
}

// Nieuw toegevoegd (< 14 dagen) krijgt accentkleur — dat zijn de rijen
// waarvan de limiet nog gecontroleerd moet worden.
function isRecent(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < 14 * 24 * 60 * 60 * 1000;
}

function fmtYield(v: number | null): string {
  if (v == null || v <= 0) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

// Koersverandering in %: groen bij winst, rood bij verlies, streepje als de
// koershistorie te kort is (of de ticker geen koersdata heeft).
function ChangePct({ value, className }: { value: number | null; className?: string }) {
  if (value == null) return <span className={`text-neutral-600 ${className ?? ""}`}>—</span>;
  const tone = value > 0 ? "text-fog-gain" : value < 0 ? "text-fog-loss" : "text-neutral-400";
  return (
    <span className={`${tone} ${className ?? ""}`}>
      {value < 0 ? "−" : "+"}{Math.abs(value).toFixed(1)}%
    </span>
  );
}

// Geeft "Xd" als de koers meer dan 2 dagen oud is (mogelijk gemiste poll).
function priceAge(polledAt: string | null): string | null {
  if (!polledAt) return null;
  const days = (Date.now() - new Date(polledAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 2) return null;
  if (days < 30) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 30)}mnd`;
}

// Zet de gekozen kolomkleur op de cel. De CSS-regel voor .col-tint forceert
// 'm ook op de inhoud, want cellen bevatten spans met een eigen text-kleur.
function tintCell(cell: ReactNode, hex: string | undefined): ReactNode {
  if (!hex || !isValidElement(cell)) return cell;
  const el = cell as ReactElement<{ className?: string; style?: React.CSSProperties }>;
  return cloneElement(el, {
    className: `${el.props.className ?? ""} col-tint`,
    style: { ...(el.props.style ?? {}), ["--col-tint" as string]: hex },
  });
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
  { key: "chg_1d", label: "Δ 1 dag" },
  { key: "chg_1w", label: "Δ 1 week" },
  { key: "chg_1m", label: "Δ 1 maand" },
  { key: "chg_6m", label: "Δ 6 maanden" },
  { key: "above_limit_pct", label: "vs limiet" },
  { key: "limiet", label: "Limiet" },
  { key: "favorited_at", label: "Toegevoegd" },
];

// Optionele props: als App.tsx al een dashboard/scans-fetch heeft gedaan, kunnen
// die hergebruikt worden in plaats van opnieuw te halen. Scheelt een dubbele
// fetch en een merkbaar laadmoment bij het openen van de tab.
interface FavorietenViewProps {
  initialDashboard?: Dashboard | null;
  initialScans?: ScanResults | null;
}

export function FavorietenView({ initialDashboard, initialScans }: FavorietenViewProps = {}) {
  const marks = useMarks();
  const [dashboard, setDashboard] = useState<Dashboard | null>(initialDashboard ?? null);
  const [scans, setScans] = useState<ScanResults | null>(initialScans ?? null);
  const [loading, setLoading] = useState(!(initialDashboard && initialScans));
  const [error, setError] = useState<string | null>(null);
  // Default: sorteer op afstand tot aankooplimiet (oplopend) — wat het dichtst
  // bij de koop-trigger zit komt bovenaan.
  const [sortKey, setSortKey] = useState<SortKey>("above_limit_pct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bronFilter, setBronFilter] = useState<Set<Bron>>(new Set());
  const [sectorFilter, setSectorFilter] = useState<Set<Sector>>(new Set());
  const [showSeen, setShowSeen] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  // Minimum sterren-filter: 0 = alles, 1..5 = alleen rijen met ≥ N sterren.
  const [minRating, setMinRating] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_KEY) === "tiles" ? "tiles" : "table"),
  );
  function pickView(v: ViewMode) {
    setViewMode(v);
    localStorage.setItem(VIEW_KEY, v);
  }
  const [subTab, setSubTab] = useState<FavSubTab>(() => {
    const saved = localStorage.getItem(SUBTAB_KEY);
    return saved === "verdubbelaars" || saved === "scanner" ? saved : "lijst";
  });
  function pickSubTab(v: FavSubTab) {
    setSubTab(v);
    localStorage.setItem(SUBTAB_KEY, v);
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
  const columnColors = useColumnColors("favorieten");

  // Sync dashboard/scans wanneer de parent ze (later) doorgeeft — anders
  // zelf één keer fetchen. Wanneer beide al binnen zijn slaan we de fetch
  // volledig over, zodat de favorieten-tab direct getoond wordt.
  useEffect(() => {
    if (initialDashboard) setDashboard(initialDashboard);
  }, [initialDashboard]);
  useEffect(() => {
    if (initialScans) setScans(initialScans);
  }, [initialScans]);
  useEffect(() => {
    if (dashboard && scans) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const needs: Promise<unknown>[] = [];
    if (!dashboard) needs.push(fetchDashboard().then(setDashboard));
    if (!scans) needs.push(fetchScanResults().then(setScans));
    Promise.all(needs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        price_polled_at: card?.price_polled_at ?? null,
        buy_limit,
        above_limit_pct,
        dividend_yield: card?.dividend_yield ?? null,
        chg_1d: card?.summary?.pct_change_1d ?? null,
        chg_1w: card?.summary?.pct_change_5d ?? null,
        chg_1m: card?.summary?.pct_change_22d ?? null,
        chg_6m: card?.summary?.pct_change_6mo ?? null,
        medal_gold: card?.medal_gold ?? 0,
        medal_silver: card?.medal_silver ?? 0,
        medal_bronze: card?.medal_bronze ?? 0,
        bronnen,
        favorited_at: marks.favoritedAt.get(T) ?? null,
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
    // Verberg orphans (favorieten zonder data) tenzij de toggle aan staat.
    // Anders zou een rij met overal "—" altijd verschijnen, wat verwarrend is.
    if (!showOrphans) list = list.filter((r) => !r.orphan);
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
        case "chg_1d": av = a.chg_1d; bv = b.chg_1d; break;
        case "chg_1w": av = a.chg_1w; bv = b.chg_1w; break;
        case "chg_1m": av = a.chg_1m; bv = b.chg_1m; break;
        case "chg_6m": av = a.chg_6m; bv = b.chg_6m; break;
        case "favorited_at":
          av = a.favorited_at ? Date.parse(a.favorited_at) : null;
          bv = b.favorited_at ? Date.parse(b.favorited_at) : null;
          break;
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
  }, [rows, sortKey, sortDir, bronFilter, sectorFilter, showSeen, showOrphans, minRating, marks]);

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

  const sectors: Sector[] = SECTORS;
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
      td: (r) => {
        const age = priceAge(r.price_polled_at);
        return (
          <td className="px-3 py-2 text-right font-mono tabular-nums">
            {r.last_close != null ? (
              <>
                <span className="text-neutral-200">{fmtPrice(r.last_close)}</span>
                {age && (
                  <span
                    className={`ml-1 text-[9px] ${parseInt(age) >= 7 ? "text-fog-loss" : "text-fog-warn"}`}
                    title={r.price_polled_at ? `Gepollt op ${new Date(r.price_polled_at).toLocaleDateString("nl-NL")}` : undefined}
                  >
                    {age}
                  </span>
                )}
              </>
            ) : (
              <span className="text-neutral-600">—</span>
            )}
          </td>
        );
      },
    },
    chg_1d: {
      th: (
        <th
          className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
          title="Koersverandering sinds de vorige slotkoers"
          onClick={() => toggleSort("chg_1d")}
        >
          1D <span className="text-fog-lime text-[9px]">{sortArrow("chg_1d")}</span>
        </th>
      ),
      td: (r) => <td className="px-3 py-2 text-right font-mono tabular-nums"><ChangePct value={r.chg_1d} /></td>,
    },
    chg_1w: {
      th: (
        <th
          className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
          title="Koersverandering over ~1 week (5 handelsdagen)"
          onClick={() => toggleSort("chg_1w")}
        >
          1W <span className="text-fog-lime text-[9px]">{sortArrow("chg_1w")}</span>
        </th>
      ),
      td: (r) => <td className="px-3 py-2 text-right font-mono tabular-nums"><ChangePct value={r.chg_1w} /></td>,
    },
    chg_1m: {
      th: (
        <th
          className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
          title="Koersverandering over ~1 maand (22 handelsdagen)"
          onClick={() => toggleSort("chg_1m")}
        >
          1M <span className="text-fog-lime text-[9px]">{sortArrow("chg_1m")}</span>
        </th>
      ),
      td: (r) => <td className="px-3 py-2 text-right font-mono tabular-nums"><ChangePct value={r.chg_1m} /></td>,
    },
    chg_6m: {
      th: (
        <th
          className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
          title="Koersverandering over ~6 maanden"
          onClick={() => toggleSort("chg_6m")}
        >
          6M <span className="text-fog-lime text-[9px]">{sortArrow("chg_6m")}</span>
        </th>
      ),
      td: (r) => <td className="px-3 py-2 text-right font-mono tabular-nums"><ChangePct value={r.chg_6m} /></td>,
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
              {r.above_limit_pct < 0
                ? `−${Math.abs(r.above_limit_pct).toFixed(1)}%`
                : `+${r.above_limit_pct.toFixed(1)}%`}
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
    favorited_at: {
      th: (
        <th
          className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none"
          title="Wanneer dit aandeel favoriet werd — sorteer aflopend om de nieuwste bovenaan te zetten en te controleren of de limiet klopt"
          onClick={() => toggleSort("favorited_at")}
        >
          Toegevoegd <span className="text-fog-lime text-[9px]">{sortArrow("favorited_at")}</span>
        </th>
      ),
      td: (r) => (
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
          {r.favorited_at ? (
            <span
              className={isRecent(r.favorited_at) ? "text-fog-lime" : "text-neutral-400"}
              title={new Date(r.favorited_at).toLocaleString("nl-NL")}
            >
              {fmtDate(r.favorited_at)}
            </span>
          ) : (
            <span className="text-neutral-600">—</span>
          )}
        </td>
      ),
    },
  };

  return (
    <div className="space-y-4">
      {/* Sub-tabs binnen Favorieten: de lijst zelf + de verdubbel-analyse */}
      <div className="flex items-center gap-1 border-b border-ink-5">
        {([
          ["lijst", "♥ Lijst"],
          ["verdubbelaars", "🚀 Raketten"],
          ["scanner", "🌟 Scanner"],
        ] as Array<[FavSubTab, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => pickSubTab(key)}
            className={`px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${
              subTab === key
                ? "border-fog-pink text-neutral-50"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "verdubbelaars" ? (
        <RakettenView />
      ) : subTab === "scanner" ? (
        <StarScannerView scans={scans} />
      ) : (
        <>
      <CollapsibleIntro title="Favorieten" icon={<GradientTabIcon tab="favorieten" />}>
        <p className="text-sm text-neutral-300 leading-relaxed">
          Aandelen die je hebt aangemerkt met het hartje op een ander tabblad.
          De badges tonen op welke lijst ze voorkomen (Feniks, Poefie, Hikkertje, Zwitserleven of alleen watchlist).
          Sorteer of filter op bron of sector om snel te vinden wat je zoekt.
        </p>
      </CollapsibleIntro>

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

      {/* Compacte reparatie-balk voor orphans (favorieten zonder data).
          Default verborgen uit de tabel — de banner is je enige aanwijzing. */}
      {orphans.length > 0 && (
        <Card className="p-2 border-fog-warn/30 bg-fog-warn/[0.04]">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-fog-warn font-semibold">
              {orphans.length} {orphans.length === 1 ? "favoriet" : "favorieten"} zonder data
              {!showOrphans && <span className="text-neutral-500 font-normal"> · verborgen uit lijst</span>}
            </span>
            <span className="text-neutral-500 truncate">
              ({orphans.slice(0, 5).map((o) => o.ticker).join(", ")}{orphans.length > 5 ? `, …` : ""})
            </span>
            <button
              onClick={() => setShowOrphans((v) => !v)}
              className="text-[11px] text-neutral-400 hover:text-neutral-200 underline ml-auto"
            >
              {showOrphans ? "verberg" : "toon"}
            </button>
            {repairMsg && (
              <span className={`text-[11px] ${repairMsg.startsWith("Fout") ? "text-fog-loss" : "text-fog-lime"}`}>
                {repairMsg}
              </span>
            )}
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
              ["chg_1d", "1D"],
              ["chg_1w", "1W"],
              ["chg_1m", "1M"],
              ["chg_6m", "6M"],
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
            {/* Eén scroll-container voor horizontaal én verticaal, zodat de
                kopregel er sticky binnen kan blijven staan. Sticky t.o.v. de
                pagina kan niet: de app-header is zelf al sticky en een
                overflow-container breekt de koppeling met de viewport. */}
            <div className="overflow-auto max-h-[calc(100vh-15rem)] [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-ink-3">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-5 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  <tr>
                    <SeenHeader />
                    <HeartHeader />
                    {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.th}</Fragment>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {filtered.map((r, i) => {
                    const seen = marks.isSeen(r.ticker);
                    // Zebra: oneven rijen een haartje lichter, puur om de
                    // regels uit elkaar te houden bij veel kolommen.
                    const bg = r.orphan
                      ? "bg-fog-warn/[0.06]"
                      : i % 2 === 1
                      ? "bg-white/[0.022]"
                      : "";
                    const cls = [seen ? "opacity-50" : "", bg].filter(Boolean).join(" ");
                    return (
                      <tr
                        key={r.ticker}
                        className={cls}
                        title={r.orphan ? "Data ontbreekt — gebruik de reparatie-knop bovenaan" : undefined}
                      >
                        <SeenCell ticker={r.ticker} />
                        <HeartCell ticker={r.ticker} />
                        {visibleKeys.map((k) => (
                          <Fragment key={k}>{tintCell(colMap[k]?.td(r), columnColors[k])}</Fragment>
                        ))}
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
        </>
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
              <span className="flex items-center gap-1 shrink-0">
                {r.favorited_at && (
                  <span
                    className={`text-[9px] tabular-nums ${isRecent(r.favorited_at) ? "text-fog-lime" : "text-neutral-600"}`}
                    title={`Favoriet sinds ${new Date(r.favorited_at).toLocaleString("nl-NL")}`}
                  >
                    {fmtDate(r.favorited_at)}
                  </span>
                )}
                {r.sector && <span className="text-[9px] uppercase tracking-wider text-neutral-500 font-bold">{SECTOR_LABEL[r.sector]}</span>}
              </span>
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
                  {r.above_limit_pct < 0
                    ? `−${Math.abs(r.above_limit_pct).toFixed(1)}%`
                    : `+${r.above_limit_pct.toFixed(1)}%`}
                </span>
              ) : (
                <span className="text-neutral-600 text-xs">geen limiet</span>
              )}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-neutral-500 mt-0.5">
              {r.last_close != null ? `$${fmtPrice(r.last_close)}` : "—"}
              {r.buy_limit != null && <span className="text-neutral-600"> / lim ${fmtPrice(r.buy_limit)}</span>}
            </div>
            {/* Koersverandering over dag/week/maand/half jaar — zelfde vier
                waarden als de kolommen in de lijstweergave. */}
            <div className="grid grid-cols-4 gap-0.5 mt-1 text-center font-mono tabular-nums">
              {([["1D", r.chg_1d], ["1W", r.chg_1w], ["1M", r.chg_1m], ["6M", r.chg_6m]] as Array<[string, number | null]>).map(([label, v]) => (
                <div key={label}>
                  <div className="text-[8px] uppercase tracking-wider text-neutral-600 font-bold">{label}</div>
                  <ChangePct value={v} className="text-[10px]" />
                </div>
              ))}
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


// ── Inladen van favorieten ────────────────────────────────────────────────
// Plak tickers → opzoeken bij Yahoo → controleer/pas per rij aan (limiet,
// sector, sterren, wel/niet meenemen) → pas dán toevoegen. De voorgestelde
// limiet is standaard een percentage boven de 5-jaarsbodem; dat percentage
// komt uit de instellingen en is per inlaadsessie te overrulen.

type SuggestieModus = "low5y" | "koers";

interface ImportRij {
  key: string;
  input_ticker: string;
  ticker: string;
  company: string;
  sector: Sector;
  /** False zodra de gebruiker de sector zelf koos — auto-detect blijft er dan af. */
  sectorAuto: boolean;
  currency: string | null;
  exchange: string | null;
  last_close: number | null;
  low_5y: number | null;
  high_5y: number | null;
  recognized: boolean;
  error?: string;
  alreadyFavorite: boolean;
  /** Limiet als tekst zodat half-getypte waarden ("12,") niet omvallen. */
  limiet: string;
  /** False zodra de gebruiker de limiet handmatig aanpaste. */
  limietAuto: boolean;
  rating: number | null;
  selected: boolean;
}

// Afronden op een zinnig aantal decimalen voor de koershoogte.
function roundLimiet(v: number): number {
  const d = v < 1 ? 4 : v < 10 ? 3 : 2;
  return Number(v.toFixed(d));
}

function berekenSuggestie(
  rij: Pick<ImportRij, "low_5y" | "last_close">,
  modus: SuggestieModus,
  pct: number
): number | null {
  if (modus === "low5y") {
    if (rij.low_5y == null || rij.low_5y <= 0) return null;
    return roundLimiet(rij.low_5y * (1 + pct / 100));
  }
  if (rij.last_close == null || rij.last_close <= 0) return null;
  return roundLimiet(rij.last_close * (1 - pct / 100));
}

function BulkAddFavoritesPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const marks = useMarks();
  const [input, setInput] = useState("");
  const [resolving, setResolving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rijen, setRijen] = useState<ImportRij[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voortgang, setVoortgang] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sector die alle nieuwe rijen krijgen (auto = raden uit de bedrijfsnaam).
  const [bulkSector, setBulkSector] = useState<Sector | "auto">("auto");
  const [modus, setModus] = useState<SuggestieModus>("low5y");
  const [pct, setPct] = useState<string>("10");

  // Standaardpercentage uit de instellingen; per sessie te overrulen.
  useEffect(() => {
    inputRef.current?.focus();
    fetchSettings()
      .then((s) => {
        if (s.limit_suggest_pct != null) setPct(String(s.limit_suggest_pct));
      })
      .catch(() => {
        // Geen instellingen (of geen token) — de 10% default blijft staan.
      });
  }, []);

  const pctNum = Number(pct.replace(",", "."));
  const pctGeldig = Number.isFinite(pctNum) && pctNum >= 0;

  async function onLookup() {
    setError(null);
    const parsed = parseTickerInput(input);
    if (parsed.length === 0) {
      setError("Geen herkenbare tickers gevonden.");
      return;
    }
    setResolving(true);
    setVoortgang(null);
    try {
      // De lookup pakt maximaal 50 tickers per call; bij een grotere plak
      // hakken we 'm in stukken zodat er niets stilletjes wegvalt.
      const alle = parsed.map((p) => p.ticker);
      const resultaten: LookupResult[] = [];
      const CHUNK = 40;
      for (let i = 0; i < alle.length; i += CHUNK) {
        setVoortgang(`Opzoeken… ${Math.min(i + CHUNK, alle.length)}/${alle.length}`);
        resultaten.push(...(await lookupTickers(alle.slice(i, i + CHUNK))));
      }
      const p0 = Number.isFinite(pctNum) ? pctNum : 0;
      setRijen(
        resultaten.map((r, i) => {
          const sector: Sector =
            bulkSector === "auto" ? inferSectorUitNaam(r.company) : bulkSector;
          const suggestie = berekenSuggestie(r, modus, p0);
          return {
            key: `${r.input_ticker ?? r.ticker}-${i}`,
            input_ticker: r.input_ticker ?? r.ticker,
            ticker: r.ticker,
            company: r.company ?? r.ticker,
            sector,
            sectorAuto: bulkSector === "auto",
            currency: r.currency,
            exchange: r.exchange,
            last_close: r.last_close,
            low_5y: r.low_5y,
            high_5y: r.high_5y,
            recognized: r.recognized,
            error: r.error,
            alreadyFavorite: marks.favorites.has(r.ticker.toUpperCase()),
            limiet: suggestie != null ? String(suggestie) : "",
            limietAuto: true,
            rating: null,
            selected: r.recognized,
          };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
      setVoortgang(null);
    }
  }

  // Herbereken alleen de limieten die de gebruiker niet zelf heeft aangeraakt.
  function herberekenLimieten(nieuweModus: SuggestieModus, nieuwPct: number) {
    setRijen((prev) =>
      prev == null
        ? prev
        : prev.map((r) => {
            if (!r.limietAuto) return r;
            const s = berekenSuggestie(r, nieuweModus, nieuwPct);
            return { ...r, limiet: s != null ? String(s) : "" };
          })
    );
  }

  function zetModus(m: SuggestieModus) {
    setModus(m);
    if (pctGeldig) herberekenLimieten(m, pctNum);
  }
  function zetPct(v: string) {
    setPct(v);
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n) && n >= 0) herberekenLimieten(modus, n);
  }
  function zetBulkSector(s: Sector | "auto") {
    setBulkSector(s);
    setRijen((prev) =>
      prev == null
        ? prev
        : prev.map((r) =>
            s === "auto"
              ? { ...r, sector: inferSectorUitNaam(r.company), sectorAuto: true }
              : { ...r, sector: s, sectorAuto: false }
          )
    );
  }
  function patchRij(key: string, patch: Partial<ImportRij>) {
    setRijen((prev) => (prev == null ? prev : prev.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  }

  const teVoegen = (rijen ?? []).filter((r) => r.selected && r.recognized);

  async function onConfirmAdd() {
    if (teVoegen.length === 0) return;
    setAdding(true);
    setError(null);
    try {
      // 1) Watchlist: ticker, bedrijfsnaam, sector, beurs en de gekozen limiet.
      //    Een lege limiet sturen we níet mee — anders zou een bestaande
      //    limiet bij een her-import op NULL gezet worden.
      const rows: TickerInput[] = teVoegen.map((r) => {
        const n = Number(r.limiet.replace(",", "."));
        const limiet = r.limiet.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
        return {
          ticker: r.ticker,
          company: r.company || r.ticker,
          sector: r.sector,
          exchange: r.exchange ?? undefined,
          ...(limiet !== undefined ? { buy_limit: limiet } : {}),
        };
      });
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setVoortgang(`Toevoegen… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
        await batchAddTickers(rows.slice(i, i + CHUNK));
      }

      // 2) Hartje + eventuele sterren per ticker, zodat de lokale marks-state
      //    meteen klopt en de rij direct in de lijst verschijnt.
      const mislukt: string[] = [];
      for (const r of teVoegen) {
        try {
          if (!r.alreadyFavorite) await addMark("favorite", r.ticker);
          if (r.rating != null) await marks.setRating(r.ticker, r.rating);
        } catch (err) {
          console.error("favoriet toevoegen mislukt voor", r.ticker, err);
          mislukt.push(r.ticker);
        }
      }
      if (mislukt.length > 0) {
        setError(`Niet gelukt voor: ${mislukt.join(", ")}`);
        return;
      }
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
      setVoortgang(null);
    }
  }

  const geparseerd = parseTickerInput(input).length;

  return (
    <Card className="p-4 space-y-3 border-fog-lime/30">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">Favorieten toevoegen</div>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300">
          Sluiten
        </button>
      </div>
      <div className="text-[11px] text-neutral-500 leading-relaxed">
        Plak tickers (één per regel, met komma's of spaties), of Google-Finance URL's zoals{" "}
        <code className="text-fog-lime">https://www.google.com/finance/beta/quote/FRMM:NASDAQ?window=1Y</code>.
        Na het opzoeken zie je per aandeel de koers, de 5-jaarsbodem en een
        voorgestelde aankooplimiet — die je kunt aanpassen vóór het toevoegen.
      </div>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={4}
        placeholder={"AAPL\nMSFT\nhttps://www.google.com/finance/beta/quote/FRMM:NASDAQ?window=1Y"}
        className="w-full px-2 py-1.5 rounded bg-ink-3 border border-ink-5 text-xs font-mono text-neutral-100 focus:outline-none focus:border-fog-lime"
      />

      {/* Instellingen voor deze inlaadsessie */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Limiet-suggestie</span>
        <Select value={modus} onChange={(e) => zetModus(e.target.value as SuggestieModus)} className="h-7 text-xs">
          <option value="low5y">% boven 5-jaarsbodem</option>
          <option value="koers">% onder huidige koers</option>
        </Select>
        <input
          type="text"
          inputMode="decimal"
          value={pct}
          onChange={(e) => zetPct(e.target.value)}
          className={
            "w-16 px-1.5 py-0.5 rounded bg-ink-3 border text-right font-mono text-xs text-neutral-100 focus:outline-none " +
            (pctGeldig ? "border-ink-5 focus:border-fog-lime" : "border-fog-loss")
          }
        />
        <span className="text-neutral-500">%</span>
        <span className="w-px h-4 bg-ink-5 mx-1" />
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">Sector</span>
        <Select
          value={bulkSector}
          onChange={(e) => zetBulkSector(e.target.value as Sector | "auto")}
          className="h-7 text-xs"
        >
          <option value="auto">auto (uit naam)</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {SECTOR_NAAM[s]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={onLookup} disabled={resolving || adding || input.trim() === ""}>
          {resolving ? "Opzoeken…" : "Opzoeken"}
        </Button>
        {rijen && (
          <Button size="sm" onClick={onConfirmAdd} disabled={adding || teVoegen.length === 0}>
            {adding ? "Bezig…" : `${teVoegen.length} toevoegen`}
          </Button>
        )}
        <span className="text-[10px] text-neutral-500 ml-1">{geparseerd} tickers geparseerd</span>
        {voortgang && <span className="text-[10px] text-fog-lime">{voortgang}</span>}
      </div>
      {error && <div className="text-xs text-fog-loss">{error}</div>}

      {rijen && (
        <div className="border border-ink-5 rounded overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead className="bg-ink-3/40 text-[10px] uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1 text-left w-8">
                  <input
                    type="checkbox"
                    title="Alles aan/uit"
                    checked={rijen.every((r) => r.selected || !r.recognized)}
                    onChange={(e) =>
                      setRijen((prev) =>
                        prev == null
                          ? prev
                          : prev.map((r) => (r.recognized ? { ...r, selected: e.target.checked } : r))
                      )
                    }
                  />
                </th>
                <th className="px-2 py-1 text-left">Ticker</th>
                <th className="px-2 py-1 text-left">Bedrijf</th>
                <th className="px-2 py-1 text-left">Sector</th>
                <th className="px-2 py-1 text-right">Koers</th>
                <th className="px-2 py-1 text-right" title="Laagste weekslot in 5 jaar">5j-bodem</th>
                <th className="px-2 py-1 text-right" title="Hoogste weekslot in 5 jaar">5j-top</th>
                <th className="px-2 py-1 text-right">Limiet</th>
                <th className="px-2 py-1 text-right" title="Hoe ver de koers boven de gekozen limiet staat">vs limiet</th>
                <th className="px-2 py-1 text-left">Sterren</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-5/40">
              {rijen.map((r) => {
                const limietNum = Number(r.limiet.replace(",", "."));
                const limietGeldig = r.limiet.trim() === "" || (Number.isFinite(limietNum) && limietNum > 0);
                const vsLimiet =
                  r.last_close != null && limietGeldig && r.limiet.trim() !== "" && limietNum > 0
                    ? ((r.last_close - limietNum) / limietNum) * 100
                    : null;
                return (
                  <tr key={r.key} className={r.recognized ? "" : "opacity-60"}>
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        disabled={!r.recognized}
                        onChange={(e) => patchRij(r.key, { selected: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {r.ticker}
                      {r.input_ticker !== r.ticker && (
                        <span className="text-neutral-600"> ←{r.input_ticker}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-neutral-300 max-w-[220px] truncate" title={r.company}>
                      {r.company}
                      {r.currency && r.currency !== "USD" && (
                        <span className="ml-1 text-[9px] text-fog-warn font-bold">{r.currency}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <Select
                        value={r.sector}
                        onChange={(e) => patchRij(r.key, { sector: e.target.value as Sector, sectorAuto: false })}
                        className="h-6 text-[11px]"
                      >
                        {SECTORS.map((s) => (
                          <option key={s} value={s}>
                            {SECTOR_NAAM[s]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {r.last_close != null ? fmtPrice(r.last_close) : <span className="text-neutral-600">—</span>}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-500">
                      {r.low_5y != null ? fmtPrice(r.low_5y) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-500">
                      {r.high_5y != null ? fmtPrice(r.high_5y) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={r.limiet}
                        onChange={(e) => patchRij(r.key, { limiet: e.target.value, limietAuto: false })}
                        placeholder="—"
                        className={
                          "w-20 px-1.5 py-0.5 rounded bg-ink-3 border text-right font-mono text-xs text-neutral-100 focus:outline-none " +
                          (limietGeldig ? "border-ink-5 focus:border-fog-lime" : "border-fog-loss")
                        }
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {vsLimiet != null ? (
                        <span className={vsLimiet <= 0 ? "text-fog-lime" : vsLimiet <= 10 ? "text-fog-warn" : "text-neutral-400"}>
                          {vsLimiet < 0 ? "−" : "+"}
                          {Math.abs(vsLimiet).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            title={`${n} ster${n > 1 ? "ren" : ""}`}
                            onClick={() => patchRij(r.key, { rating: r.rating === n ? null : n })}
                            className={
                              "text-[11px] leading-none transition-colors " +
                              ((r.rating ?? 0) >= n ? "text-fog-warn" : "text-neutral-700 hover:text-neutral-500")
                            }
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      {!r.recognized ? (
                        <span className="text-fog-loss">Onbekend{r.error ? ` (${r.error})` : ""}</span>
                      ) : r.alreadyFavorite ? (
                        <span className="text-neutral-500">Al favoriet — limiet wordt bijgewerkt</span>
                      ) : (
                        <span className="text-fog-lime">Klaar om toe te voegen</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
