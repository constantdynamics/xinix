import { useEffect, useState } from "react";
import { fetchScanResults, type ScanTicker, type ScanRun } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { SECTOR_LABEL, SECTOR_TONE } from "../types";
import {
  Card,
  Badge,
  Pill,
  SectionHeader,
  Dot,
} from "../components/ui";

type SourceFilter = "all" | "losers" | "bottoms";

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

function medalStr(t: ScanTicker): string {
  const parts: string[] = [];
  if (t.medal_gold) parts.push(`🥇${t.medal_gold}`);
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

export function ScansView() {
  const [data, setData] = useState<{ tickers: ScanTicker[]; runs: { "scan-losers": ScanRun[]; "scan-bottoms": ScanRun[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceFilter>("all");

  useEffect(() => {
    fetchScanResults()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, []);

  const tickers = data?.tickers ?? [];
  const visible = source === "all" ? tickers : tickers.filter((t) => t.source === source);

  const countLosers = tickers.filter((t) => t.source === "losers").length;
  const countBottoms = tickers.filter((t) => t.source === "bottoms").length;

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

        {/* Filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill tone="neutral" active={source === "all"} count={tickers.length} onClick={() => setSource("all")}>
            Alles
          </Pill>
          <Pill tone="loss" active={source === "losers"} count={countLosers} onClick={() => setSource("losers")}>
            Grootste dalers
          </Pill>
          <Pill tone="watch" active={source === "bottoms"} count={countBottoms} onClick={() => setSource("bottoms")}>
            5y-bodem
          </Pill>
        </div>

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
