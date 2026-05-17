import { useEffect, useMemo, useState } from "react";
import {
  fetchZwitserlevenResults,
  triggerJob,
  getToken,
  type ZwitserlevenStock,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat } from "../components/ui";

function fmtPct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(decimals)}%`;
}
function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}
function fmtPayout(v: number | null): string {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}
function fmtCurrency(v: number | null, currency: string | null): string {
  const c = currency ?? "USD";
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : c === "CHF" ? "CHF " : `${c} `;
  return `${sym}${fmtPrice(v)}`;
}

const RISK_COLORS: Record<string, string> = {
  "Laag":      "text-emerald-400 bg-emerald-400/10",
  "Matig":     "text-yellow-400 bg-yellow-400/10",
  "Hoog":      "text-orange-400 bg-orange-400/10",
  "Zeer hoog": "text-red-400 bg-red-400/10",
};

type SortKey =
  | "dividend_yield_pct"
  | "pct_under_5y_high"
  | "max_annual_gain_5y"
  | "years_5pct_growth_5y"
  | "payout_ratio"
  | "dividend_cuts_5y"
  | "risk_label";

type ShowFilter = "all" | "meets" | "near";

export function ZwitserlevenView() {
  const [data, setData] = useState<{ stocks: ZwitserlevenStock[]; total_scanned: number; meets_criteria_count: number; unscanned_count: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("dividend_yield_pct");
  const [sortAsc, setSortAsc] = useState(false);
  const [showFilter, setShowFilter] = useState<ShowFilter>("meets");

  useEffect(() => {
    setLoading(true);
    fetchZwitserlevenResults()
      .then((r) => { setData(r); setLoading(false); })
      .catch((e) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, []);

  async function runScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      await triggerJob("compute-zwitserleven-background");
      setScanMsg("Scan gestart — ververs over ~2 min.");
    } catch (e) {
      setScanMsg(`Fout: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setScanning(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  const filtered = useMemo<ZwitserlevenStock[]>(() => {
    if (!data) return [];
    let list = data.stocks.filter((s) => {
      if (showFilter === "meets") return s.meets_criteria === true;
      if (showFilter === "near") {
        // Bijna-voldoet: minstens yield ≥4% en pct_under_5y_high ≥30%
        return (s.dividend_yield_pct ?? 0) >= 4 && (s.pct_under_5y_high ?? 0) >= 30;
      }
      return s.meets_criteria === true || (s.dividend_yield_pct ?? 0) > 0;
    });

    list = [...list].sort((a, b) => {
      let av: number | string | null = null;
      let bv: number | string | null = null;
      if (sortKey === "risk_label") {
        const order: Record<string, number> = { "Laag": 0, "Matig": 1, "Hoog": 2, "Zeer hoog": 3 };
        av = order[a.risk_label ?? ""] ?? 99;
        bv = order[b.risk_label ?? ""] ?? 99;
      } else {
        av = a[sortKey] as number | null;
        bv = b[sortKey] as number | null;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const diff = (av as number) - (bv as number);
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [data, showFilter, sortKey, sortAsc]);

  const isAdmin = !!getToken();

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const SortHeader = ({ col, label }: { col: SortKey; label: string }) => (
    <th
      className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide cursor-pointer hover:text-neutral-200 whitespace-nowrap select-none"
      onClick={() => toggleSort(col)}
    >
      {label}
      {sortKey === col ? (sortAsc ? " ▲" : " ▼") : " ·"}
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Uitleg */}
      <Card className="p-4 border-blue-500/30 bg-blue-500/[0.04]">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🏦</span>
          <div className="flex-1">
            <div className="font-semibold text-blue-400 mb-1">Zwitserleven</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Fallen angels met dividendzekerheid — aandelen met een <strong>TTM-dividend ≥6,5%</strong>,
              die minstens <strong>50% onder hun 5-jaars-hoog</strong> noteren, én die in de afgelopen
              5 jaar minstens <strong>eenmalig ≥25%</strong> stegen en in <strong>≥2 jaren ≥5%</strong> groeiden.
              Geen dividend-traps: het gaat om echte kwaliteit die tijdelijk uit de gratie is.
            </p>
            <p className="text-xs text-neutral-500 mt-2">
              Scope: alle actieve tickers in de watchlist · Criteria worden automatisch dagelijks gescand · Herscan elke 90 dagen per ticker
            </p>
          </div>
        </div>
      </Card>

      {/* Stats + trigger */}
      <div className="flex flex-wrap items-center gap-4">
        <Stat label="Voldoen aan criteria" value={data?.meets_criteria_count ?? 0} />
        <Stat label="Totaal gescand" value={data?.total_scanned ?? 0} />
        <Stat label="Nog te scannen" value={data?.unscanned_count ?? 0} />
        {isAdmin && (
          <div className="flex items-center gap-2 ml-auto">
            {scanMsg && <span className="text-xs text-neutral-400">{scanMsg}</span>}
            <Button size="sm" variant="secondary" onClick={runScan} disabled={scanning}>
              {scanning ? "…" : "🏦 Scan starten"}
            </Button>
          </div>
        )}
      </div>

      {/* Filter knoppen */}
      <div className="flex gap-2 flex-wrap">
        {(["meets", "near", "all"] as ShowFilter[]).map((f) => {
          const labels: Record<ShowFilter, string> = { meets: "Voldoet aan criteria", near: "Bijna (yield ≥4% + val ≥30%)", all: "Alle gescand (met dividend)" };
          return (
            <button
              key={f}
              onClick={() => setShowFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                showFilter === f
                  ? "border-blue-500 bg-blue-500/20 text-blue-300"
                  : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {labels[f]}
            </button>
          );
        })}
        {filtered.length > 0 && (
          <span className="ml-auto text-xs text-neutral-500 self-center">{filtered.length} aandelen getoond</span>
        )}
      </div>

      {/* Tabel */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-neutral-500">
          <div className="text-3xl mb-3">🏦</div>
          {(data?.total_scanned ?? 0) === 0 ? (
            <>
              <div>Nog geen tickers gescand.</div>
              <div className="mt-1 text-neutral-600">
                {(data?.unscanned_count ?? 0) > 0
                  ? `${data?.unscanned_count} tickers wachten op scan — gebruik de knop hierboven (admin).`
                  : "Voeg actieve tickers toe aan de watchlist."}
              </div>
            </>
          ) : (
            <>
              <div>Geen aandelen gevonden voor dit filter.</div>
              <div className="mt-1 text-neutral-600">
                Probeer het filter te verruimen of wacht op meer scan-resultaten.
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-5 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold text-sm text-blue-400">
              🏦 Zwitserleven ranking
            </div>
            <div className="text-xs text-neutral-500">klik kolomkop om te sorteren</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="border-b border-ink-5 bg-ink-2/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide w-8">#</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Ticker / Naam</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Beurs / Land</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Sector</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Koers</th>
                  <SortHeader col="dividend_yield_pct" label="Div %" />
                  <SortHeader col="pct_under_5y_high" label="Val v 5j%" />
                  <SortHeader col="max_annual_gain_5y" label="Max jaar +" />
                  <SortHeader col="years_5pct_growth_5y" label="Groeijr" />
                  <SortHeader col="payout_ratio" label="Payout" />
                  <SortHeader col="dividend_cuts_5y" label="Cuts" />
                  <SortHeader col="risk_label" label="Risico" />
                  <th className="px-3 py-2 text-center text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">✓</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5">
                {filtered.map((s, idx) => {
                  const gfUrl = googleFinanceUrl(s.ticker, s.exchange);
                  const riskCls = RISK_COLORS[s.risk_label ?? ""] ?? "text-neutral-400";
                  const highYield = (s.dividend_yield_pct ?? 0) >= 8;
                  const veryFallen = (s.pct_under_5y_high ?? 0) >= 60;

                  return (
                    <tr
                      key={s.ticker}
                      className={`hover:bg-ink-3/30 transition-colors ${s.meets_criteria ? "bg-blue-500/[0.03]" : ""}`}
                    >
                      <td className="px-3 py-2.5 text-neutral-600 tabular text-xs">{idx + 1}</td>

                      {/* Ticker + naam */}
                      <td className="px-3 py-2.5">
                        <a
                          href={gfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-semibold text-blue-400 hover:underline"
                        >
                          {s.ticker}
                        </a>
                        <div className="text-[11px] text-neutral-400 truncate max-w-[160px]">{s.company ?? "—"}</div>
                      </td>

                      {/* Beurs + land */}
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-neutral-300">{s.exchange ?? "—"}</div>
                        <div className="text-[11px] text-neutral-500">{s.country ?? "—"}</div>
                      </td>

                      {/* Sector */}
                      <td className="px-3 py-2.5">
                        {s.sector ? <Pill>{s.sector}</Pill> : <span className="text-neutral-600 text-xs">—</span>}
                      </td>

                      {/* Koers */}
                      <td className="px-3 py-2.5 text-right tabular font-mono text-neutral-200 text-xs">
                        {fmtCurrency(s.last_close, s.currency)}
                      </td>

                      {/* Dividend % */}
                      <td className="px-3 py-2.5 text-left tabular">
                        <span className={`font-semibold text-xs ${highYield ? "text-emerald-400" : "text-neutral-200"}`}>
                          {fmtPct(s.dividend_yield_pct)}
                        </span>
                      </td>

                      {/* Val van 5j-hoog % */}
                      <td className="px-3 py-2.5 text-left tabular">
                        <span className={`text-xs ${veryFallen ? "text-orange-400" : "text-neutral-300"}`}>
                          {fmtPct(s.pct_under_5y_high)}
                        </span>
                      </td>

                      {/* Max jaargain */}
                      <td className="px-3 py-2.5 text-left tabular text-xs text-neutral-300">
                        {fmtPct(s.max_annual_gain_5y)}
                      </td>

                      {/* Groeijaren */}
                      <td className="px-3 py-2.5 text-left tabular text-xs">
                        <span className={s.years_5pct_growth_5y != null && s.years_5pct_growth_5y >= 2 ? "text-emerald-400" : "text-neutral-400"}>
                          {s.years_5pct_growth_5y ?? "—"}
                        </span>
                      </td>

                      {/* Payout ratio */}
                      <td className="px-3 py-2.5 text-left tabular text-xs">
                        <span className={
                          s.payout_ratio == null ? "text-neutral-500"
                          : s.payout_ratio > 1.0 ? "text-red-400"
                          : s.payout_ratio > 0.85 ? "text-orange-400"
                          : "text-neutral-300"
                        }>
                          {fmtPayout(s.payout_ratio)}
                        </span>
                      </td>

                      {/* Dividend cuts */}
                      <td className="px-3 py-2.5 text-left tabular text-xs">
                        <span className={
                          (s.dividend_cuts_5y ?? 0) === 0 ? "text-emerald-400"
                          : (s.dividend_cuts_5y ?? 0) <= 1 ? "text-yellow-400"
                          : "text-red-400"
                        }>
                          {s.dividend_cuts_5y ?? "—"}
                        </span>
                      </td>

                      {/* Risico label */}
                      <td className="px-3 py-2.5 text-left">
                        {s.risk_label ? (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${riskCls}`}>
                            {s.risk_label}
                          </span>
                        ) : (
                          <span className="text-neutral-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Voldoet */}
                      <td className="px-3 py-2.5 text-center">
                        {s.meets_criteria
                          ? <span className="text-emerald-400 text-sm">✓</span>
                          : <span className="text-neutral-700 text-xs">·</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
