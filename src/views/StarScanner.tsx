import { useMemo, useState } from "react";
import type { ScanResults, StarScanEntry, StarArchetype } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Stat, CollapsibleIntro } from "../components/ui";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, HeartHeader } from "../components/MarkCells";
import { GradientTabIcon } from "../tabIcons";
import { PriceChartModal } from "./PriceChartModal";

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

  const ranking = useMemo(() => scans?.star_ranking ?? [], [scans]);
  const lastRun = scans?.star_last_run ?? null;

  const filtered = useMemo(() => {
    // Server sorteert al op score desc; hier alleen filteren. Favorieten die
    // sinds de laatste run zijn geharteld verbergen we direct (de scan zet
    // qualifies pas het volgende weekend op false).
    let list = ranking.filter((r) => !marks.favorites.has(r.ticker.toUpperCase()));
    if (archFilter.size > 0) list = list.filter((r) => archFilter.has(r.archetype));
    return list;
  }, [ranking, archFilter, marks]);

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
            Alleen kandidaten met fit-score ≥ 80 worden getoond, beste match bovenaan. De lijst
            blijft tussen runs staan en wordt aangevuld; <span className="px-1 py-0.5 rounded bg-fog-lime/15 text-fog-lime text-[10px] font-bold">NIEUW</span> markeert
            aandelen die dit weekend voor het eerst opdoken. Huidige favorieten worden overgeslagen.
            Verschijnt er een nieuwkomer met fit ≥ 90, dan krijg je daarvan een ntfy-melding.
          </p>
        </div>
      </CollapsibleIntro>

      <div className="flex flex-wrap items-center gap-3">
        <Stat label="Kandidaten" value={ranking.length} />
        <Stat label="Getoond" value={filtered.length} />
        {lastRun && (
          <div className="text-xs text-neutral-500">
            Laatste scan: {new Date(lastRun.started_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
            {lastRun.ok === false && <span className="text-fog-loss ml-1">(mislukt)</span>}
          </div>
        )}
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
                  <HeartHeader />
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Bedrijf</th>
                  <th className="px-3 py-2 text-right" title="Fit-score 0-100: hoe goed dit aandeel op het 5-sterren-profiel past">Fit</th>
                  <th className="px-3 py-2 text-left">Archetype</th>
                  <th className="px-3 py-2 text-right" title="Hoe ver onder de 5-jaarstop">vs 5j-top</th>
                  <th className="px-3 py-2 text-right" title="Hoeveel keer boven de 5-jaarsbodem">× bodem</th>
                  <th className="px-3 py-2 text-right" title="Koersverandering laatste ~22 handelsdagen">22d</th>
                  <th className="px-3 py-2 text-right">Mcap</th>
                  <th className="px-3 py-2 text-right" title="Gemiddeld dagvolume in dollars">$vol/dag</th>
                  <th className="px-3 py-2 text-right">Koers</th>
                  <th className="px-3 py-2 text-center">Medailles</th>
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
