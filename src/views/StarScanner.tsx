import { useMemo, useState } from "react";
import type { ScanResults, StarScanEntry, StarArchetype } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Stat, CollapsibleIntro } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader, SeenCell, SeenHeader, ShowSeenToggle } from "../components/MarkCells";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

type SortKey = "score" | "ticker" | "company" | "pct_vs_high5y" | "x_above_low5y" | "pct_change_22d" | "market_cap_usd" | "dollar_volume" | "last_close" | "medals";
type SortDir = "asc" | "desc";

const ARCHETYPE_LABEL: Record<StarArchetype, string> = {
  herstelde_reus: "🏛️ Herstelde reus",
  capitulatie: "🎣 Capitulatie",
  spike_machine: "🎇 Spike-machine",
  crypto_infra: "⛏️ Crypto/AI-infra",
};

const ARCHETYPE_COLOR: Record<StarArchetype, string> = {
  herstelde_reus: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  capitulatie: "border-fog-loss/40 text-fog-loss bg-fog-loss/10",
  spike_machine: "border-fog-pink/40 text-fog-pink bg-fog-pink/10",
  crypto_infra: "border-amber-500/40 text-amber-300 bg-amber-500/10",
};

const ARCHETYPE_HINT: Record<StarArchetype, string> = {
  herstelde_reus: "Mid/large-cap, comeback bewezen (ver boven de bodem), nu in terugval",
  capitulatie: "90%+ onder de top, op of vlak bij de 5-jaarsbodem — loterijbriefje",
  spike_machine: "Small/microcap met bewezen explosieve runs, zweeft tussen bodem en top",
  crypto_infra: "Bitcoin-miners / AI-datacenters — hoge bèta op BTC en AI-capex",
};

function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtMcap(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} mrd`;
  return `$${Math.round(v / 1e6)} mln`;
}
function fmtDollarVol(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)} mrd`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)} mln`;
  return `$${Math.round(v / 1e3)}k`;
}
function fmtSignedPct(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${Math.abs(v).toFixed(1)}%` : `+${v.toFixed(1)}%`;
}
function isNew(firstSeen: string): boolean {
  return Date.now() - new Date(firstSeen).getTime() < 8 * 24 * 60 * 60 * 1000;
}

// Kleurband voor de fit-score: hoe groener, hoe beter de match met het 5★-DNA.
function scoreTone(score: number): string {
  if (score >= 90) return "text-fog-lime font-bold";
  if (score >= 85) return "text-emerald-300 font-semibold";
  return "text-neutral-300";
}

export function StarScannerView({ scans }: { scans: ScanResults | null }) {
  const marks = useMarks();
  const [archFilter, setArchFilter] = useState<Set<StarArchetype>>(new Set());
  const [chartFor, setChartFor] = useState<{ ticker: string; company: string; exchange: string | null } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showSeen, setShowSeen] = useState(false);

  const ranking = useMemo(() => scans?.star_ranking ?? [], [scans]);
  const lastRun = scans?.star_last_run ?? null;

  // "Beoordeeld" = favoriet gemaakt, sterren gegeven of als gezien gemarkeerd
  // (via het beoordeelscherm of de kolom-iconen). Die verdwijnen uit de ranking.
  const isReviewed = (ticker: string) => {
    const T = ticker.toUpperCase();
    return marks.favorites.has(T) || marks.isSeen(T) || marks.getRating(T) != null;
  };

  const filtered = useMemo(() => {
    let list = ranking;
    if (!showSeen) list = list.filter((r) => !isReviewed(r.ticker));
    else list = list.filter((r) => !marks.favorites.has(r.ticker.toUpperCase()));
    if (archFilter.size > 0) list = list.filter((r) => archFilter.has(r.archetype));
    list = [...list].sort((a, b) => {
      let av: number | string | null;
      let bv: number | string | null;
      switch (sortKey) {
        case "score": av = a.score; bv = b.score; break;
        case "ticker": av = a.ticker; bv = b.ticker; break;
        case "company": av = a.company; bv = b.company; break;
        case "pct_vs_high5y": av = a.pct_vs_high5y; bv = b.pct_vs_high5y; break;
        case "x_above_low5y": av = a.x_above_low5y; bv = b.x_above_low5y; break;
        case "pct_change_22d": av = a.pct_change_22d; bv = b.pct_change_22d; break;
        case "market_cap_usd": av = a.market_cap_usd; bv = b.market_cap_usd; break;
        case "dollar_volume": av = a.dollar_volume; bv = b.dollar_volume; break;
        case "last_close": av = a.last_close; bv = b.last_close; break;
        case "medals": av = (a.medal_gold ?? 0) * 10 + (a.medal_silver ?? 0); bv = (b.medal_gold ?? 0) * 10 + (b.medal_silver ?? 0); break;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking, archFilter, marks, sortKey, sortDir, showSeen]);

  const reviewedCount = useMemo(
    () => ranking.filter((r) => !marks.favorites.has(r.ticker.toUpperCase()) && isReviewed(r.ticker)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ranking, marks],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "ticker" || key === "company" ? "asc" : "desc"); }
  }
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");
  // Volledige klassenamen (geen template-interpolatie) zodat Tailwind ze meeneemt.
  const thCls = (align: "left" | "right" | "center") =>
    (align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center") +
    " px-3 py-2 cursor-pointer hover:text-neutral-300 select-none whitespace-nowrap";

  const archCounts = useMemo(() => {
    const c: Record<StarArchetype, number> = { herstelde_reus: 0, capitulatie: 0, spike_machine: 0, crypto_infra: 0 };
    for (const r of ranking) if (r.archetype in c) c[r.archetype]++;
    return c;
  }, [ranking]);

  function toggleArch(a: StarArchetype) {
    setArchFilter((prev) => { const n = new Set(prev); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  }

  const allArchetypes: StarArchetype[] = ["herstelde_reus", "capitulatie", "spike_machine", "crypto_infra"];

  return (
    <div className="space-y-4">
      <CollapsibleIntro title="5-sterren-scanner" icon={<GradientTabIcon tab="favorieten" />}>
        <div className="text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>
            Elk weekend (zaterdag &amp; zondag) doorzoekt de scanner de volledige watchlist naar
            aandelen met het <strong>5-sterren-DNA</strong> — het profiel van de aandelen die je zelf
            5 sterren gaf. De criteria, van zwaar naar licht wegend:
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-xs text-neutral-400">
            <li><strong className="text-neutral-300">Bewezen explosiviteit</strong> — 5-jaars top/bodem-ratio ≥ 10× (ideaal ≥ 20×)</li>
            <li><strong className="text-neutral-300">Diep gecrasht</strong> — 40–99% onder de 5-jaarstop (zoete zone 75–95%)</li>
            <li><strong className="text-neutral-300">Verse dip</strong> — -20% tot -40% in de laatste ~22 handelsdagen</li>
            <li><strong className="text-neutral-300">Substantie</strong> — market cap $25 mln – $10 mrd (zoet punt $100 mln – $3 mrd)</li>
            <li><strong className="text-neutral-300">Liquiditeit</strong> — voldoende dollarvolume per dag</li>
          </ul>
          <p className="text-xs text-neutral-400">
            Alleen kandidaten met fit-score ≥ 80 worden getoond, beste match bovenaan (klik op een
            kolomtitel om anders te sorteren). De lijst blijft tussen runs staan en wordt aangevuld;{" "}
            <span className="px-1 py-0.5 rounded bg-fog-lime/15 text-fog-lime text-[10px] font-bold">NIEUW</span> markeert
            aandelen die dit weekend voor het eerst opdoken. Beoordeelde aandelen (gezien, favoriet of
            sterren — bijvoorbeeld via het beoordeelscherm) verdwijnen uit de ranking. Verschijnt er
            een nieuwkomer met fit ≥ 90, dan krijg je daarvan een ntfy-melding.
          </p>
        </div>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Kandidaten" value={ranking.length} />
        <Stat label="Getoond" value={filtered.length} />
        <Stat label="Beoordeeld" value={reviewedCount} />
        {lastRun && (
          <div className="text-xs text-neutral-500">
            Laatste scan: {new Date(lastRun.started_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
            {lastRun.ok === false && <span className="text-fog-loss ml-1">(mislukt)</span>}
          </div>
        )}
        <div className="ml-auto">
          <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 font-bold mr-1">Archetype:</span>
        {allArchetypes.map((a) => {
          const active = archFilter.has(a);
          const cls = active ? ARCHETYPE_COLOR[a] : "border-ink-5 text-neutral-400 hover:text-neutral-200";
          return (
            <button
              key={a}
              onClick={() => toggleArch(a)}
              title={ARCHETYPE_HINT[a]}
              className={`px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors ${cls}`}
              disabled={archCounts[a] === 0 && !active}
            >
              {ARCHETYPE_LABEL[a]} <span className="opacity-70">{archCounts[a]}</span>
            </button>
          );
        })}
      </div>

      {ranking.length === 0 ? (
        <Card className="p-10 text-center space-y-3">
          <div className="text-4xl">🌟</div>
          <div className="text-sm font-semibold text-neutral-300">Nog geen scanresultaten</div>
          <div className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
            De scanner draait elk weekend (zaterdag en zondag). Na de eerste run verschijnen hier
            de aandelen die goed op je 5-sterren-profiel passen.
          </div>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-5 bg-ink-3/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                <tr>
                  <th className="px-2 py-2 text-right">#</th>
                  <SeenHeader />
                  <HeartHeader />
                  <th className={thCls("left")} onClick={() => toggleSort("ticker")}>
                    Ticker <span className="text-fog-lime text-[9px]">{sortArrow("ticker")}</span>
                  </th>
                  <th className={thCls("left")} onClick={() => toggleSort("company")}>
                    Bedrijf <span className="text-fog-lime text-[9px]">{sortArrow("company")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("score")} title="Fit-score 0-100: hoe goed dit aandeel op het 5-sterren-profiel past">
                    Fit <span className="text-fog-lime text-[9px]">{sortArrow("score")}</span>
                  </th>
                  <th className="px-3 py-2 text-left">Archetype</th>
                  <th className={thCls("right")} onClick={() => toggleSort("pct_vs_high5y")} title="Hoe ver onder de 5-jaarstop">
                    vs 5j-top <span className="text-fog-lime text-[9px]">{sortArrow("pct_vs_high5y")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("x_above_low5y")} title="Hoeveel keer boven de 5-jaarsbodem">
                    × bodem <span className="text-fog-lime text-[9px]">{sortArrow("x_above_low5y")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("pct_change_22d")} title="Koersverandering laatste ~22 handelsdagen">
                    22d <span className="text-fog-lime text-[9px]">{sortArrow("pct_change_22d")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("market_cap_usd")}>
                    Mcap <span className="text-fog-lime text-[9px]">{sortArrow("market_cap_usd")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("dollar_volume")} title="Gemiddeld dagvolume in dollars">
                    $vol/dag <span className="text-fog-lime text-[9px]">{sortArrow("dollar_volume")}</span>
                  </th>
                  <th className={thCls("right")} onClick={() => toggleSort("last_close")}>
                    Koers <span className="text-fog-lime text-[9px]">{sortArrow("last_close")}</span>
                  </th>
                  <th className={thCls("center")} onClick={() => toggleSort("medals")}>
                    Medailles <span className="text-fog-lime text-[9px]">{sortArrow("medals")}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5/40">
                {filtered.map((r, i) => (
                  <StarRow key={r.ticker} r={r} rank={i + 1} onCompanyClick={() => setChartFor({ ticker: r.ticker, company: r.company ?? r.ticker, exchange: r.exchange })} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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

function StarRow({ r, rank, onCompanyClick }: { r: StarScanEntry; rank: number; onCompanyClick: () => void }) {
  return (
    <tr>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-neutral-500 text-xs">{rank}</td>
      <SeenCell ticker={r.ticker} />
      <HeartCell ticker={r.ticker} />
      <td className="px-3 py-2 whitespace-nowrap">
        <a href={googleFinanceUrl(r.ticker, r.exchange)} target="_blank" rel="noreferrer" className="font-mono font-semibold tab-accent-text hover:underline">
          {r.ticker}
        </a>
        {isNew(r.first_seen_at) && (
          <span className="ml-1.5 px-1 py-0.5 rounded bg-fog-lime/15 text-fog-lime text-[9px] font-bold align-middle">NIEUW</span>
        )}
      </td>
      <td className="px-3 py-2 max-w-[220px]">
        <button
          type="button"
          onClick={onCompanyClick}
          className="text-left text-neutral-200 hover:text-fog-pink hover:underline transition-colors truncate block w-full"
          title={`Bekijk koersgrafiek van ${r.company ?? r.ticker}`}
        >
          {r.company ?? "—"}
        </button>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        <span className={scoreTone(r.score)} title={r.breakdown ? Object.entries(r.breakdown).map(([k, v]) => `${k}: ${v}`).join(" · ") : undefined}>
          {r.score.toFixed(0)}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={`px-1.5 py-0.5 rounded text-[10px] border font-semibold whitespace-nowrap ${ARCHETYPE_COLOR[r.archetype]}`} title={ARCHETYPE_HINT[r.archetype]}>
          {ARCHETYPE_LABEL[r.archetype]}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-fog-loss">{fmtSignedPct(r.pct_vs_high5y)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300">{r.x_above_low5y != null ? `${r.x_above_low5y.toFixed(1)}×` : "—"}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        <span className={r.pct_change_22d != null && r.pct_change_22d < 0 ? "text-fog-loss" : "text-fog-lime"}>
          {fmtSignedPct(r.pct_change_22d)}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-300 whitespace-nowrap">{fmtMcap(r.market_cap_usd)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-400 whitespace-nowrap">{fmtDollarVol(r.dollar_volume)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-neutral-200">{fmtPrice(r.last_close)}</td>
      <td className="px-3 py-2 text-center text-xs whitespace-nowrap">
        {(r.medal_gold ?? 0) + (r.medal_silver ?? 0) > 0 ? (
          <span>
            {(r.medal_gold ?? 0) > 0 && `🏆${r.medal_gold} `}
            {(r.medal_silver ?? 0) > 0 && `🥈${r.medal_silver}`}
          </span>
        ) : (
          <span className="text-neutral-600">—</span>
        )}
      </td>
    </tr>
  );
}
