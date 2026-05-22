import { useEffect, useMemo, useState } from "react";
import { fetchScanResults, type ScanTicker, type ScanRun } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { EditableLimit } from "../components/EditableLimit";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import {
  Card,
  Badge,
  Pill,
  SectionHeader,
  Dot,
  Input,
  Select,
} from "../components/ui";

type SourceFilter = "all" | "losers" | "bottoms";
type SectorFilter = "all" | "biotech" | "mining" | "other";
type SortBy = "date_desc" | "date_asc" | "medals" | "gold" | "ticker";

const SOURCE_LABEL: Record<"losers" | "bottoms" | "unknown", string> = {
  losers: "Grootste dalers",
  bottoms: "5y-bodem",
  unknown: "Onbekend",
};
const SOURCE_TONE: Record<"losers" | "bottoms" | "unknown", "loss" | "watch" | "neutral"> = {
  losers: "loss",
  bottoms: "watch",
  unknown: "neutral",
};

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

function medalStr(t: ScanTicker): string {
  const parts: string[] = [];
  if (t.medal_gold) parts.push(`🏆${t.medal_gold}`);
  if (t.medal_silver) parts.push(`🥈${t.medal_silver}`);
  if (t.medal_bronze) parts.push(`🥉${t.medal_bronze}`);
  return parts.join(" ") || "—";
}

function RunMini({ runs, job }: { runs: ScanRun[]; job: string }) {
  if (!runs.length) {
    return (
      <Card className="p-4 text-center text-xs text-neutral-500">
        Nog geen runs voor {job}.
      </Card>
    );
  }
  const last = runs[0];
  const metrics = last.metrics as Record<string, unknown> | null;
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-start gap-3">
        <Dot
          tone={last.ok === true ? "lime" : last.ok === false ? "loss" : "neutral"}
          pulse={last.ok === false}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-neutral-200 truncate">
            {job === "scan-losers"
              ? "TradingView: grootste dalers → ≥1× goud + ≥1× zilver"
              : "TradingView: bij 5y-bodem → ≥3× goud"}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            Laatste run:{" "}
            {new Date(last.started_at).toLocaleString("nl-NL", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          {last.message && (
            <div className={`text-[11px] mt-1 ${last.ok === false ? "text-fog-loss" : "text-neutral-400"}`}>
              {last.message}
            </div>
          )}
          {metrics && (
            <div className="flex flex-wrap gap-3 mt-2">
              {metrics.losers != null && (
                <span className="text-[11px] text-neutral-400">
                  <span className="font-semibold text-neutral-200">{String(metrics.losers)}</span> dalers
                </span>
              )}
              {metrics.candidates != null && (
                <span className="text-[11px] text-neutral-400">
                  <span className="font-semibold text-neutral-200">{String(metrics.candidates)}</span> nieuw
                </span>
              )}
              {metrics.candidates_new != null && (
                <span className="text-[11px] text-neutral-400">
                  <span className="font-semibold text-neutral-200">{String(metrics.candidates_new)}</span> nieuw
                </span>
              )}
              {metrics.checked != null && (
                <span className="text-[11px] text-neutral-400">
                  <span className="font-semibold text-neutral-200">{String(metrics.checked)}</span> gecheckt
                </span>
              )}
              {metrics.gems != null && (
                <span className={`text-[11px] ${Number(metrics.gems) > 0 ? "text-fog-watch font-semibold" : "text-neutral-400"}`}>
                  <span className={Number(metrics.gems) > 0 ? "text-fog-watch" : "text-neutral-200"}>{String(metrics.gems)}</span> treffer{Number(metrics.gems) !== 1 ? "s" : ""}
                </span>
              )}
              {metrics.added != null && Number(metrics.added) > 0 && (
                <span className="text-[11px] text-lime-400 font-semibold">
                  +{String(metrics.added)} toegevoegd
                </span>
              )}
              {Array.isArray(metrics.markets) && (
                <span className="text-[11px] text-neutral-500">
                  markten: {(metrics.markets as string[]).join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function totalMedals(t: ScanTicker): number {
  return (t.medal_gold ?? 0) + (t.medal_silver ?? 0) + (t.medal_bronze ?? 0);
}

function olympicCmp(a: ScanTicker, b: ScanTicker): number {
  const ag = a.medal_gold ?? 0, bg = b.medal_gold ?? 0;
  if (bg !== ag) return bg - ag;
  const as = a.medal_silver ?? 0, bs = b.medal_silver ?? 0;
  if (bs !== as) return bs - as;
  const ab = a.medal_bronze ?? 0, bb = b.medal_bronze ?? 0;
  return bb - ab;
}

const SORT_LABELS: Record<SortBy, string> = {
  date_desc: "Datum (nieuw → oud)",
  date_asc: "Datum (oud → nieuw)",
  medals: "Medailleklassement (Olympisch)",
  gold: "Aantal gouden medailles",
  ticker: "Ticker A–Z",
};

export function ScansView() {
  const [data, setData] = useState<{ tickers: ScanTicker[]; runs: { "scan-losers": ScanRun[]; "scan-bottoms": ScanRun[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceFilter>("all");
  const [sector, setSector] = useState<SectorFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date_desc");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetchScanResults()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, []);

  const tickers = data?.tickers ?? [];
  const countLosers = tickers.filter((t) => t.source === "losers").length;
  const countBottoms = tickers.filter((t) => t.source === "bottoms").length;

  const visible = useMemo(() => {
    let r = tickers;
    if (source !== "all") r = r.filter((t) => t.source === source);
    if (sector !== "all") r = r.filter((t) => (t.sector ?? "other") === sector);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter((t) =>
        t.ticker.toLowerCase().includes(q) ||
        (t.company ?? "").toLowerCase().includes(q)
      );
    }
    const sorted = [...r];
    switch (sortBy) {
      case "date_desc":
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
      case "date_asc":
        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "medals":
        sorted.sort((a, b) => olympicCmp(a, b) || totalMedals(b) - totalMedals(a));
        break;
      case "gold":
        sorted.sort((a, b) => (b.medal_gold ?? 0) - (a.medal_gold ?? 0) || olympicCmp(a, b));
        break;
      case "ticker":
        sorted.sort((a, b) => a.ticker.localeCompare(b.ticker));
        break;
    }
    return sorted;
  }, [tickers, source, sector, sortBy, search]);

  return (
    <div className="space-y-8">
      {/* Run-status bovenaan */}
      <section>
        <SectionHeader
          eyebrow="Achtergrond-scans"
          title="Scan-status"
          subtitle="Dagelijks automatisch doorzoeken van TradingView op medaille-waardige aandelen"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RunMini runs={data?.runs["scan-losers"] ?? []} job="scan-losers" />
          <RunMini runs={data?.runs["scan-bottoms"] ?? []} job="scan-bottoms" />
        </div>
      </section>

      {/* Gevonden tickers */}
      <section>
        <SectionHeader
          eyebrow="Resultaten"
          title="Auto-toegevoegde tickers"
          subtitle="Aandelen die door de dagelijkse scans zijn gevonden en aan de watchlist zijn toegevoegd"
        />

        {/* Filter + sort */}
        <Card className="p-3 mb-4 space-y-3">
          {/* Bron-filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold w-12">Bron</span>
            <Pill tone="neutral" active={source === "all"} count={tickers.length} onClick={() => setSource("all")} size="sm">
              Alles
            </Pill>
            <Pill tone="loss" active={source === "losers"} count={countLosers} onClick={() => setSource("losers")} size="sm">
              Grootste dalers
            </Pill>
            <Pill tone="watch" active={source === "bottoms"} count={countBottoms} onClick={() => setSource("bottoms")} size="sm">
              5y-bodem
            </Pill>
          </div>

          {/* Sector-filter */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold w-12">Sector</span>
            {(["all", "biotech", "mining", "other"] as SectorFilter[]).map((s) => (
              <Pill
                key={s}
                tone={s === "biotech" ? "cyan" : s === "mining" ? "watch" : "neutral"}
                active={sector === s}
                onClick={() => setSector(s)}
                size="sm"
              >
                {s === "all" ? "Alle" : s === "biotech" ? "Biotech" : s === "mining" ? "Mining" : "Overig"}
              </Pill>
            ))}
          </div>

          {/* Zoek + sorteer */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold w-12">Zoek</span>
            <Input
              placeholder="Ticker of bedrijf…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px]"
            />
            <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              {(Object.entries(SORT_LABELS) as Array<[SortBy, string]>).map(([k, v]) => (
                <option key={k} value={k}>Sorteer: {v}</option>
              ))}
            </Select>
          </div>

          {/* Result count */}
          <div className="text-[11px] text-neutral-500 tabular">
            {visible.length} {visible.length === 1 ? "resultaat" : "resultaten"}
            {visible.length !== tickers.length && ` (uit ${tickers.length} totaal)`}
          </div>
        </Card>

        {loading && (
          <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>
        )}

        {error && (
          <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>
        )}

        {!loading && !error && visible.length === 0 && (
          <Card className="p-10 text-center text-sm text-neutral-500">
            {source === "all"
              ? "Nog geen auto-toegevoegde aandelen gevonden. De scans draaien dagelijks en voegen alleen toe bij ≥1× goud + ≥1× zilver (dalers) of ≥3× goud + binnen 10% van 5y-bodem (bottoms)."
              : `Geen tickers van de "${SOURCE_LABEL[source]}"-scan.`}
          </Card>
        )}

        {!loading && visible.length > 0 && (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-[10px] uppercase tracking-wider text-neutral-500 bg-ink-3/40 sticky top-0">
                <tr>
                  <th className="text-left p-3 font-semibold">Ticker</th>
                  <th className="text-left p-3 font-semibold">Bedrijf</th>
                  <th className="text-left p-3 font-semibold">Sector</th>
                  <th className="text-left p-3 font-semibold">Bron</th>
                  <th className="text-left p-3 font-semibold">Medailles</th>
                  <th className="text-right p-3 font-semibold">Koers</th>
                  <th className="text-right p-3 font-semibold">Slim limit</th>
                  <th className="text-left p-3 font-semibold">Toegevoegd</th>
                  <th className="text-left p-3 font-semibold">Reden</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.ticker} className="border-t border-ink-5 hover:bg-ink-3/40">
                    <td className="p-3 font-bold whitespace-nowrap">
                      <a
                        href={googleFinanceUrl(t.ticker, t.exchange)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-fog-pink hover:underline"
                      >
                        {t.ticker}
                      </a>
                    </td>
                    <td className="p-3 text-neutral-300 max-w-[180px] truncate" title={t.company ?? ""}>
                      {t.company ?? "—"}
                    </td>
                    <td className="p-3">
                      {t.sector && t.sector !== "other" ? (
                        <Badge tone={SECTOR_TONE[t.sector as "biotech" | "mining"]}>
                          {SECTOR_LABEL[t.sector as "biotech" | "mining"]}
                        </Badge>
                      ) : (
                        <span className="text-neutral-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge tone={SOURCE_TONE[t.source]}>
                        {SOURCE_LABEL[t.source]}
                      </Badge>
                    </td>
                    <td className="p-3 whitespace-nowrap text-base leading-none">
                      {medalStr(t)}
                    </td>
                    <td className="p-3 text-right tabular text-[12px] text-neutral-300 whitespace-nowrap">
                      {t.last_close != null ? fmtPrice(t.last_close) : "—"}
                    </td>
                    <td className="p-3 text-right tabular text-[12px] whitespace-nowrap">
                      <EditableLimit ticker={t.ticker} buyLimit={t.buy_limit} />
                    </td>
                    <td className="p-3 whitespace-nowrap text-[11px] tabular text-neutral-400">
                      {new Date(t.created_at).toLocaleString("nl-NL", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-3 text-[11px] text-neutral-400 max-w-xs truncate" title={t.notes ?? ""}>
                      {t.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
