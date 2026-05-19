import { useEffect, useMemo, useState } from "react";
import {
  fetchDashboard,
  fetchScanResults,
  type ScanResults,
} from "../api";
import type { Dashboard, Card as CardType, Sector } from "../types";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Badge, Pill, Stat } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, ShowSeenToggle } from "../components/MarkCells";

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
  bronnen: Bron[];
}

type SortKey = "ticker" | "company" | "score" | "above_limit_pct" | "last_close";
type SortDir = "asc" | "desc";

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

export function FavorietenView() {
  const marks = useMarks();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [scans, setScans] = useState<ScanResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [bronFilter, setBronFilter] = useState<Set<Bron>>(new Set());
  const [sectorFilter, setSectorFilter] = useState<Set<Sector>>(new Set());
  const [showSeen, setShowSeen] = useState(false);

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

      const last_close = p?.last_close ?? null;
      const buy_limit = card?.buy_limit ?? p?.buy_limit ?? null;
      const above_limit_pct = p?.above_limit_pct
        ?? (last_close != null && buy_limit != null && buy_limit > 0
              ? ((last_close - buy_limit) / buy_limit) * 100
              : null);

      out.push({
        ticker: T,
        company: card?.company ?? p?.company ?? "—",
        sector: card?.sector ?? p?.sector ?? null,
        exchange: card?.exchange ?? p?.exchange ?? null,
        score: card?.goud_score ?? null,
        last_close,
        buy_limit,
        above_limit_pct,
        bronnen,
      });
    }
    return out;
  }, [dashboard, scans, marks]);

  const filtered = useMemo(() => {
    let list = rows;
    if (!showSeen) list = list.filter((r) => !marks.isSeen(r.ticker));
    if (bronFilter.size > 0) {
      list = list.filter((r) => r.bronnen.some((b) => bronFilter.has(b)));
    }
    if (sectorFilter.size > 0) {
      list = list.filter((r) => r.sector != null && sectorFilter.has(r.sector));
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
  }, [rows, sortKey, sortDir, bronFilter, sectorFilter, showSeen, marks]);

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

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const sectors: Sector[] = ["biotech", "mining", "other"];
  const allBronnen: Bron[] = ["feniks", "poefie", "hikkertje", "zwitserleven", "watchlist"];

  const bronCounts: Record<Bron, number> = { feniks: 0, poefie: 0, hikkertje: 0, zwitserleven: 0, watchlist: 0 };
  for (const r of rows) for (const b of r.bronnen) bronCounts[b]++;

  return (
    <div className="space-y-4">
      <Card className="p-4 border-red-500/30 bg-red-500/[0.04]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">♥</span>
          <div className="flex-1">
            <div className="font-semibold text-red-400 mb-1">Favorieten</div>
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
        <div className="ml-auto">
          <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
        </div>
      </div>

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
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  <tr>
                    <SeenHeader />
                    <HeartHeader />
                    <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("ticker")}>
                      Ticker <span className="text-fog-lime text-[9px]">{sortArrow("ticker")}</span>
                    </th>
                    <th className="px-3 py-2 text-left cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("company")}>
                      Bedrijf <span className="text-fog-lime text-[9px]">{sortArrow("company")}</span>
                    </th>
                    <th className="px-3 py-2 text-left">Sector</th>
                    <th className="px-3 py-2 text-left">Bron</th>
                    <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("score")}>
                      Score <span className="text-fog-lime text-[9px]">{sortArrow("score")}</span>
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("last_close")}>
                      Koers <span className="text-fog-lime text-[9px]">{sortArrow("last_close")}</span>
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer hover:text-neutral-300 select-none" onClick={() => toggleSort("above_limit_pct")}>
                      vs limiet <span className="text-fog-lime text-[9px]">{sortArrow("above_limit_pct")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-5/40">
                  {filtered.map((r) => {
                    const seen = marks.isSeen(r.ticker);
                    return (
                      <tr key={r.ticker} className={seen ? "opacity-50" : ""}>
                        <SeenCell ticker={r.ticker} />
                        <HeartCell ticker={r.ticker} />
                        <td className="px-3 py-2">
                          <a
                            href={googleFinanceUrl(r.ticker, r.exchange)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono font-semibold text-red-300 hover:underline"
                          >
                            {r.ticker}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-neutral-200">{r.company}</td>
                        <td className="px-3 py-2">
                          {r.sector ? <Badge tone={SECTOR_TONE[r.sector]}>{SECTOR_LABEL[r.sector]}</Badge> : <span className="text-neutral-600">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {r.bronnen.map((b) => (
                              <span key={b} className={`px-1.5 py-0.5 rounded text-[10px] border font-semibold whitespace-nowrap ${BRON_COLOR[b]}`}>
                                {BRON_LABEL[b]}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {r.score != null ? r.score.toFixed(0) : <span className="text-neutral-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">
                          {r.last_close != null ? fmtPrice(r.last_close) : <span className="text-neutral-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {r.above_limit_pct != null ? (
                            <span className={r.above_limit_pct <= 0 ? "text-fog-lime font-semibold" : r.above_limit_pct <= 10 ? "text-fog-warn" : "text-neutral-300"}>
                              {r.above_limit_pct <= 0 ? "✓ onder" : `+${r.above_limit_pct.toFixed(1)}%`}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
