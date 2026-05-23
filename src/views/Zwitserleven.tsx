import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addZwitserlevenManual,
  fetchZwitserlevenResults,
  removeZwitserlevenStock,
  triggerJob,
  type ZwitserlevenStock,
} from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { Card, Button, Pill, Stat } from "../components/ui";
import { TickerSparkline } from "../components/TickerSparkline";
import { TAB_ICONS, GradientTabIcon } from "../tabIcons";
import { useMarks } from "../hooks/useMarks";
import {
  HeartCell,
  HeartHeader,
  SeenCell,
  SeenHeader,
  ShowSeenToggle,
  MarkAllSeenButton,
  HideFavoritesToggle,
  NotYetReviewedTile,
  StarCell,
  StarHeader,
} from "../components/MarkCells";
import { ColumnPicker, useColumnLayout } from "../components/ColumnPicker";

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

// ── Dividend-bronbelasting per land ──────────────────────────────────────────
// Geschatte percentages die voor NL-particuliere beleggers worden ingehouden
// vóór uitkering. Lopen via belastingverdrag — soms gedeeltelijk terugvorderbaar.
// Bron: praktijktarief (broker IBKR/DEGIRO) voor particulieren in NL,
// op basis van verdragen Nederland-XX (W4-formulier / equivalent). Indicatief.
const DIVIDEND_TAX_BY_COUNTRY: Record<string, { rate: number; note: string }> = {
  "United States":    { rate: 15, note: "Verdragstarief NL-VS (W-8BEN)" },
  "Netherlands":      { rate: 15, note: "NL dividendbelasting, verrekenbaar in box 3" },
  "United Kingdom":   { rate: 0,  note: "GB heft geen bronheffing op dividend" },
  "Germany":          { rate: 26, note: "DE 26,375% — verdrag cap 15%, deels terug te vragen" },
  "Switzerland":      { rate: 35, note: "CH 35% — 20% terugvorderbaar via verdrag (eindheffing 15%)" },
  "France":           { rate: 25, note: "FR 25–28% — refund tot 15% via verdrag" },
  "Canada":           { rate: 15, note: "CA verdragstarief 15% (NR-301)" },
  "Australia":        { rate: 30, note: "AU 30% op unfranked, 0% op franked deel" },
  "Japan":            { rate: 15, note: "JP verdragstarief 15% (van 20,315% nominaal)" },
  "Belgium":          { rate: 30, note: "BE 30% — refund tot 15% via verdrag" },
  "Spain":            { rate: 19, note: "ES 19% — refund tot 15% via verdrag" },
  "Italy":            { rate: 26, note: "IT 26% — refund tot 15% via verdrag" },
  "Norway":           { rate: 25, note: "NO 25% — refund tot 15% via verdrag" },
  "Sweden":           { rate: 30, note: "SE 30% — refund tot 15% via verdrag" },
  "Denmark":          { rate: 27, note: "DK 27% — refund tot 15% via verdrag" },
  "Finland":          { rate: 30, note: "FI 30% — refund tot 15% via verdrag" },
  "Ireland":          { rate: 25, note: "IE 25% — refund tot 0% via verdrag (NL-IE)" },
  "Hong Kong":        { rate: 0,  note: "HK heft geen bronheffing op dividend" },
  "Singapore":        { rate: 0,  note: "SG heft geen bronheffing op dividend" },
  "Brazil":           { rate: 0,  note: "BR heft sinds 1996 geen bronheffing op dividend" },
};

function dividendTax(country: string | null): { rate: number; note: string } | null {
  if (!country) return null;
  return DIVIDEND_TAX_BY_COUNTRY[country] ?? null;
}

// ── Kolom-definities ─────────────────────────────────────────────────────────
type SortKey =
  | "dividend_yield_pct"
  | "net_yield_pct"
  | "pct_under_5y_high"
  | "max_annual_gain_5y"
  | "years_5pct_growth_5y"
  | "payout_ratio"
  | "dividend_cuts_5y"
  | "tax_rate"
  | "risk_label";

type ColKey =
  | "idx" | "ticker" | "company" | "exchange" | "sector" | "price" | "sparkline"
  | "yield" | "tax" | "net_yield"
  | "under5y" | "max_gain" | "growth_years"
  | "year1" | "year2" | "year3" | "year4" | "year5"
  | "payout" | "cuts" | "risk" | "meets" | "actions";

interface ColDef { key: ColKey; label: string; defaultVisible: boolean; sortable?: SortKey; align?: "left" | "right" | "center"; }

const COLUMNS_BASE: ColDef[] = [
  { key: "idx",          label: "#",              defaultVisible: true,  align: "left" },
  { key: "ticker",       label: "Ticker",         defaultVisible: true,  align: "left" },
  { key: "company",      label: "Naam",           defaultVisible: true,  align: "left" },
  { key: "exchange",     label: "Beurs / Land",   defaultVisible: true,  align: "left" },
  { key: "sector",       label: "Sector",         defaultVisible: true,  align: "left" },
  { key: "price",        label: "Koers",          defaultVisible: true,  align: "right" },
  { key: "sparkline",    label: "Trend (1m)",     defaultVisible: true,  align: "center" },
  { key: "yield",        label: "Div % bruto",    defaultVisible: true,  align: "left",  sortable: "dividend_yield_pct" },
  { key: "tax",          label: "Bronbel %",      defaultVisible: true,  align: "left",  sortable: "tax_rate" },
  { key: "net_yield",    label: "Div % netto",    defaultVisible: true,  align: "left",  sortable: "net_yield_pct" },
  { key: "under5y",      label: "Val v 5j%",      defaultVisible: true,  align: "left",  sortable: "pct_under_5y_high" },
  { key: "max_gain",     label: "Max jaar +",     defaultVisible: true,  align: "left",  sortable: "max_annual_gain_5y" },
  { key: "growth_years", label: "Groeijr",        defaultVisible: true,  align: "left",  sortable: "years_5pct_growth_5y" },
  { key: "year1",        label: "Div Y-1",        defaultVisible: true,  align: "left" },
  { key: "year2",        label: "Div Y-2",        defaultVisible: true,  align: "left" },
  { key: "year3",        label: "Div Y-3",        defaultVisible: true,  align: "left" },
  { key: "year4",        label: "Div Y-4",        defaultVisible: true,  align: "left" },
  { key: "year5",        label: "Div Y-5",        defaultVisible: true,  align: "left" },
  { key: "payout",       label: "Payout",         defaultVisible: true,  align: "left",  sortable: "payout_ratio" },
  { key: "cuts",         label: "Cuts",           defaultVisible: true,  align: "left",  sortable: "dividend_cuts_5y" },
  { key: "risk",         label: "Risico",         defaultVisible: true,  align: "left",  sortable: "risk_label" },
  { key: "meets",        label: "✓",              defaultVisible: true,  align: "center" },
  { key: "actions",      label: "Acties",         defaultVisible: true,  align: "center" },
];

type ShowFilter = "all" | "meets" | "near";
const AUTO_SCAN_TOTAL = 20;
const AUTO_SCAN_INTERVAL_MS = 6_000; // 6s per scan-cycle (scan loopt async op de backend)

export function ZwitserlevenView() {
  const [data, setData] = useState<{ stocks: ZwitserlevenStock[]; total_scanned: number; meets_criteria_count: number; manual_count?: number; unscanned_count: number; universe_size?: number; universe_scanned?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("dividend_yield_pct");
  const [sortAsc, setSortAsc] = useState(false);
  const [showFilter, setShowFilter] = useState<ShowFilter>("meets");

  const { visibleKeys } = useColumnLayout("zwitserleven", COLUMNS_BASE, "ticker");

  const [manualInput, setManualInput] = useState("");
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [deletingTicker, setDeletingTicker] = useState<string | null>(null);

  // Auto-scan state
  const [autoRun, setAutoRun] = useState(false);
  const [autoStep, setAutoStep] = useState(0);
  const [autoFoundDelta, setAutoFoundDelta] = useState(0);
  const [showSeen, setShowSeen] = useState(false);
  const [hideFavorites, setHideFavorites] = useState(false);
  const marks = useMarks();
  const stopRef = useRef(false);

  function refresh() {
    return fetchZwitserlevenResults()
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, []);

  async function runOneScan() {
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

  const runAutoScan = useCallback(async () => {
    if (autoRun) return;
    stopRef.current = false;
    setAutoRun(true);
    setAutoStep(0);
    setAutoFoundDelta(0);
    const startCount = data?.meets_criteria_count ?? 0;
    try {
      for (let i = 1; i <= AUTO_SCAN_TOTAL; i++) {
        if (stopRef.current) break;
        try { await triggerJob("compute-zwitserleven-background"); } catch (e) {
          setScanMsg(`Auto-scan stap ${i} fout: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        setAutoStep(i);
        // wacht zodat de backend tijd heeft af te ronden voordat we de volgende batch vragen
        await new Promise<void>((resolve) => {
          const id = setTimeout(resolve, AUTO_SCAN_INTERVAL_MS);
          // Sneller stoppen als gebruiker op stop drukt
          const poll = setInterval(() => {
            if (stopRef.current) { clearTimeout(id); clearInterval(poll); resolve(); }
          }, 300);
          setTimeout(() => clearInterval(poll), AUTO_SCAN_INTERVAL_MS + 100);
        });
        if (stopRef.current) break;
        // Verfris tussendoor zodat de gebruiker progressie ziet
        await refresh();
        const nowCount = data?.meets_criteria_count ?? startCount;
        setAutoFoundDelta(nowCount - startCount);
      }
    } finally {
      await refresh();
      setAutoRun(false);
      stopRef.current = false;
    }
  }, [autoRun, data?.meets_criteria_count]);

  function stopAutoScan() {
    stopRef.current = true;
  }

  async function deleteRow(ticker: string, company: string | null) {
    const label = company ? `${ticker} (${company})` : ticker;
    if (!confirm(`Weet je zeker dat je ${label} uit de Zwitserleven-tabel wilt verwijderen?`)) return;
    setDeletingTicker(ticker);
    try {
      const r = await removeZwitserlevenStock(ticker);
      setManualMsg(`${ticker}: ${r.message ?? "verwijderd"}`);
      await refresh();
    } catch (err) {
      setManualMsg(`Fout bij verwijderen ${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingTicker(null);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const t = manualInput.trim().toUpperCase();
    if (!t) return;
    setManualBusy(true);
    setManualMsg(null);
    try {
      const r = await addZwitserlevenManual(t);
      setManualMsg(`${t}: ${r.message ?? (r.ok ? "toegevoegd & gescand" : "klaar")}`);
      setManualInput("");
      await refresh();
    } catch (err) {
      setManualMsg(`Fout: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setManualBusy(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  const filtered = useMemo<ZwitserlevenStock[]>(() => {
    if (!data) return [];
    let list = data.stocks.filter((s) => {
      if (!showSeen && marks.isSeen(s.ticker)) return false;
      if (hideFavorites && marks.isFavorite(s.ticker)) return false;
      if (showFilter === "meets") return s.meets_criteria === true || s.is_manual === true;
      if (showFilter === "near") {
        return (s.dividend_yield_pct ?? 0) >= 4 && (s.pct_under_5y_high ?? 0) >= 30;
      }
      return s.meets_criteria === true || s.is_manual === true || (s.dividend_yield_pct ?? 0) > 0;
    });

    list = [...list].sort((a, b) => {
      let av: number | string | null = null;
      let bv: number | string | null = null;
      if (sortKey === "risk_label") {
        const order: Record<string, number> = { "Laag": 0, "Matig": 1, "Hoog": 2, "Zeer hoog": 3 };
        av = order[a.risk_label ?? ""] ?? 99;
        bv = order[b.risk_label ?? ""] ?? 99;
      } else if (sortKey === "tax_rate") {
        av = dividendTax(a.country)?.rate ?? -1;
        bv = dividendTax(b.country)?.rate ?? -1;
      } else if (sortKey === "net_yield_pct") {
        const aTax = dividendTax(a.country)?.rate ?? 0;
        const bTax = dividendTax(b.country)?.rate ?? 0;
        av = (a.dividend_yield_pct ?? 0) * (1 - aTax / 100);
        bv = (b.dividend_yield_pct ?? 0) * (1 - bTax / 100);
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
  }, [data, showFilter, sortKey, sortAsc, showSeen, hideFavorites, marks]);

  const currentYear = new Date().getFullYear();
  const yearLabels = [1, 2, 3, 4, 5].map((offset) => String(currentYear - offset));
  const yearKeys = ["div_yield_y1", "div_yield_y2", "div_yield_y3", "div_yield_y4", "div_yield_y5"] as const;
  const yearColKeys: ColKey[] = ["year1", "year2", "year3", "year4", "year5"];

  if (loading) return <Card className="p-10 text-center text-sm text-neutral-500">Laden…</Card>;
  if (error) return <Card className="p-4 text-sm text-fog-loss border-fog-loss/30">{error}</Card>;

  const SortHeader = ({ col, label, hidden }: { col: SortKey; label: string; hidden?: boolean }) => (
    hidden ? null : (
      <th
        className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide cursor-pointer hover:text-neutral-200 whitespace-nowrap select-none"
        onClick={() => toggleSort(col)}
      >
        {label}
        {sortKey === col ? (sortAsc ? " ▲" : " ▼") : " ·"}
      </th>
    )
  );

  // Per kolom-key de header + cel-render; visibleKeys (kolom-kiezer) bepaalt
  // welke kolommen in welke volgorde getoond worden.
  const colMap: Record<string, { th: ReactNode; td: (s: ZwitserlevenStock, idx: number) => ReactNode }> = {
    idx: {
      th: <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide w-8">#</th>,
      td: (s, idx) => <td className="px-3 py-2.5 text-neutral-600 tabular text-xs">{idx + 1}</td>,
    },
    ticker: {
      th: <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Ticker</th>,
      td: (s) => (
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold tab-accent-text hover:underline">
              {s.ticker}
            </a>
            {s.is_manual && (
              <span title="Handmatig toegevoegd" className="text-[9px] uppercase font-semibold text-amber-400 bg-amber-400/15 px-1 rounded">handm.</span>
            )}
          </div>
        </td>
      ),
    },
    company: {
      th: <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Naam</th>,
      td: (s) => (
        <td className="px-3 py-2.5">
          <div className="text-xs text-neutral-200 truncate max-w-[220px]" title={s.company ?? undefined}>
            {s.company ?? <span className="text-neutral-600">—</span>}
          </div>
        </td>
      ),
    },
    exchange: {
      th: <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Beurs / Land</th>,
      td: (s) => (
        <td className="px-3 py-2.5">
          <div className="text-xs text-neutral-300">{s.exchange ?? "—"}</div>
          <div className="text-[11px] text-neutral-500">{s.country ?? "—"}</div>
        </td>
      ),
    },
    sector: {
      th: <th className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Sector</th>,
      td: (s) => <td className="px-3 py-2.5">{s.sector ? <Pill>{s.sector}</Pill> : <span className="text-neutral-600 text-xs">—</span>}</td>,
    },
    price: {
      th: <th className="px-3 py-2 text-right text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Koers</th>,
      td: (s) => <td className="px-3 py-2.5 text-right tabular font-mono text-neutral-200 text-xs">{fmtCurrency(s.last_close, s.currency)}</td>,
    },
    sparkline: {
      th: <th className="px-3 py-2 text-center text-[11px] font-semibold text-neutral-400 uppercase tracking-wide w-20">Trend</th>,
      td: (s) => (
        <td className="px-3 py-2.5 text-center">
          <TickerSparkline ticker={s.ticker} width={64} height={18} />
        </td>
      ),
    },
    yield: {
      th: <SortHeader col="dividend_yield_pct" label="Div % bruto" />,
      td: (s) => {
        const highYield = (s.dividend_yield_pct ?? 0) >= 8;
        return (
          <td className="px-3 py-2.5 text-left tabular">
            <span className={`font-semibold text-xs ${highYield ? "text-emerald-400" : "text-neutral-200"}`}>{fmtPct(s.dividend_yield_pct)}</span>
          </td>
        );
      },
    },
    tax: {
      th: <SortHeader col="tax_rate" label="Bronbel %" />,
      td: (s) => {
        const tax = dividendTax(s.country);
        return (
          <td className="px-3 py-2.5 text-left tabular text-xs">
            {tax ? (
              <span
                title={tax.note}
                className={
                  tax.rate === 0 ? "text-emerald-400"
                  : tax.rate <= 15 ? "text-neutral-200"
                  : tax.rate <= 25 ? "text-yellow-400"
                  : "text-orange-400"
                }
              >
                {tax.rate}%
              </span>
            ) : (
              <span className="text-neutral-600" title="Land onbekend of geen schatting beschikbaar">—</span>
            )}
          </td>
        );
      },
    },
    net_yield: {
      th: <SortHeader col="net_yield_pct" label="Div % netto" />,
      td: (s) => {
        const tax = dividendTax(s.country);
        const netYield = s.dividend_yield_pct != null && tax != null
          ? s.dividend_yield_pct * (1 - tax.rate / 100)
          : s.dividend_yield_pct;
        return (
          <td className="px-3 py-2.5 text-left tabular">
            <span className={`text-xs ${netYield != null && netYield >= 6 ? "text-emerald-400 font-semibold" : "text-neutral-300"}`}>{fmtPct(netYield)}</span>
          </td>
        );
      },
    },
    under5y: {
      th: <SortHeader col="pct_under_5y_high" label="Val v 5j%" />,
      td: (s) => {
        const veryFallen = (s.pct_under_5y_high ?? 0) >= 60;
        return (
          <td className="px-3 py-2.5 text-left tabular">
            <span className={`text-xs ${veryFallen ? "text-orange-400" : "text-neutral-300"}`}>{fmtPct(s.pct_under_5y_high)}</span>
          </td>
        );
      },
    },
    max_gain: {
      th: <SortHeader col="max_annual_gain_5y" label="Max jaar +" />,
      td: (s) => <td className="px-3 py-2.5 text-left tabular text-xs text-neutral-300">{fmtPct(s.max_annual_gain_5y)}</td>,
    },
    growth_years: {
      th: <SortHeader col="years_5pct_growth_5y" label="Groeijr" />,
      td: (s) => (
        <td className="px-3 py-2.5 text-left tabular text-xs">
          <span className={s.years_5pct_growth_5y != null && s.years_5pct_growth_5y >= 2 ? "text-emerald-400" : "text-neutral-400"}>
            {s.years_5pct_growth_5y ?? "—"}
          </span>
        </td>
      ),
    },
    payout: {
      th: <SortHeader col="payout_ratio" label="Payout" />,
      td: (s) => (
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
      ),
    },
    cuts: {
      th: <SortHeader col="dividend_cuts_5y" label="Cuts" />,
      td: (s) => (
        <td className="px-3 py-2.5 text-left tabular text-xs">
          <span className={
            (s.dividend_cuts_5y ?? 0) === 0 ? "text-emerald-400"
            : (s.dividend_cuts_5y ?? 0) <= 1 ? "text-yellow-400"
            : "text-red-400"
          }>
            {s.dividend_cuts_5y ?? "—"}
          </span>
        </td>
      ),
    },
    risk: {
      th: <SortHeader col="risk_label" label="Risico" />,
      td: (s) => {
        const riskCls = RISK_COLORS[s.risk_label ?? ""] ?? "text-neutral-400";
        return (
          <td className="px-3 py-2.5 text-left">
            {s.risk_label ? (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${riskCls}`}>{s.risk_label}</span>
            ) : (
              <span className="text-neutral-600 text-xs">—</span>
            )}
          </td>
        );
      },
    },
    meets: {
      th: <th className="px-3 py-2 text-center text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">✓</th>,
      td: (s) => (
        <td className="px-3 py-2.5 text-center">
          {s.meets_criteria ? <span className="text-emerald-400 text-sm">✓</span> : <span className="text-neutral-700 text-xs">·</span>}
        </td>
      ),
    },
    actions: {
      th: <th className="px-3 py-2 text-center text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Acties</th>,
      td: (s) => (
        <td className="px-3 py-2.5 text-center">
          <button
            onClick={() => deleteRow(s.ticker, s.company)}
            disabled={deletingTicker === s.ticker}
            title="Verwijder uit Zwitserleven-tabel"
            className="text-neutral-500 hover:text-red-400 disabled:opacity-30 transition-colors px-1.5 py-0.5 rounded hover:bg-red-400/10"
          >
            {deletingTicker === s.ticker ? "…" : "🗑"}
          </button>
        </td>
      ),
    },
  };
  // Jaar-kolommen — labels lopen mee met het huidige jaar.
  yearColKeys.forEach((key, i) => {
    colMap[key] = {
      th: (
        <th
          className="px-3 py-2 text-left text-[11px] font-semibold text-neutral-400 uppercase tracking-wide whitespace-nowrap"
          title={`Dividendrendement berekend over jaar ${yearLabels[i]} (jaaruitkering ÷ slotkoers van dat jaar). '—' = geen dividend uitgekeerd in ${yearLabels[i]}.`}
        >
          Div {yearLabels[i]}
        </th>
      ),
      td: (s) => (
        <td className="px-3 py-2.5 text-left tabular text-xs text-neutral-300">
          {s[yearKeys[i]] != null
            ? `${(s[yearKeys[i]] as number).toFixed(1)}%`
            : <span className="text-neutral-600" title={`Geen dividend uitgekeerd in ${yearLabels[i]}`}>—</span>}
        </td>
      ),
    };
  });

  return (
    <div className="space-y-6">
      {/* Uitleg */}
      <Card className="p-4 tab-accent-panel">
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none shrink-0"><GradientTabIcon tab="zwitserleven" /></span>
          <div className="flex-1">
            <div className="font-semibold tab-accent-text mb-1">Zwitserleven</div>
            <p className="text-sm text-neutral-300 leading-relaxed">
              Fallen angels met dividendzekerheid — aandelen met een <strong>TTM-dividend ≥6,5%</strong>,
              die minstens <strong>50% onder hun 5-jaars-hoog</strong> noteren, én die in de afgelopen
              5 jaar minstens <strong>eenmalig ≥25%</strong> stegen en in <strong>≥2 jaren ≥5%</strong> groeiden.
              Geen dividend-traps: het gaat om echte kwaliteit die tijdelijk uit de gratie is.
            </p>
            <p className="text-xs text-neutral-500 mt-2">
              Universum: <strong>NASDAQ-100 + DJIA + AEX + FTSE 100 + CAC 40 + SMI</strong> (large-caps)
              + <strong>S&amp;P MidCap 400 + AMX + FTSE 250 + CAC Mid 60 + SMIM</strong> (midcaps)
              {data?.universe_size ? ` — ${data.universe_size} aandelen` : ""} · Herscan elke 90 dagen per ticker · Handmatige toevoegingen mogen elke beurs zijn.
            </p>
          </div>
        </div>
      </Card>

      {/* Stats + scan-knoppen */}
      <div className="flex flex-wrap items-center gap-4">
        <Stat label="Voldoen aan criteria" value={data?.meets_criteria_count ?? 0} icon={TAB_ICONS.zwitserleven} />
        <Stat label="Handmatig toegevoegd" value={data?.manual_count ?? 0} />
        <Stat
          label="Universum gescand"
          value={`${data?.universe_scanned ?? 0}/${data?.universe_size ?? "—"}`}
        />
        <Stat label="Nog te scannen" value={data?.unscanned_count ?? 0} />
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {scanMsg && <span className="text-xs text-neutral-400">{scanMsg}</span>}
          {!autoRun ? (
            <>
              <Button size="sm" variant="secondary" onClick={runOneScan} disabled={scanning || autoRun}>
                {scanning ? "…" : "🌴 Scan 1×"}
              </Button>
              <Button size="sm" onClick={runAutoScan} disabled={scanning || autoRun || (data?.unscanned_count ?? 0) === 0}>
                🌴 Auto-scan ({AUTO_SCAN_TOTAL}×)
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-emerald-400 font-semibold">
                Auto-scan: {autoStep}/{AUTO_SCAN_TOTAL} · +{autoFoundDelta} gevonden
              </span>
              <Button size="sm" variant="secondary" onClick={stopAutoScan}>Stop</Button>
            </>
          )}
        </div>
      </div>

      {/* Handmatig toevoegen */}
      <Card className="p-3 border-ink-5">
        <form onSubmit={submitManual} className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-neutral-400 font-semibold">Handmatig toevoegen:</span>
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="TICKER (bv. JEPI, KO, BMY)"
            className="bg-ink-2 border border-ink-5 rounded px-2 py-1 text-sm text-neutral-200 placeholder-neutral-600 font-mono w-48 focus:outline-none focus:border-emerald-500/50"
            disabled={manualBusy}
          />
          <Button size="sm" variant="secondary" disabled={manualBusy || !manualInput.trim()}>
            {manualBusy ? "Bezig…" : "+ Toevoegen & scannen"}
          </Button>
          {manualMsg && (
            <span className={`text-xs ${manualMsg.startsWith("Fout") ? "text-fog-loss" : "text-emerald-400"}`}>
              {manualMsg}
            </span>
          )}
          <span className="text-[11px] text-neutral-500 ml-auto">
            Wordt direct gescand en blijft zichtbaar ook als hij niet aan alle criteria voldoet.
          </span>
        </form>
      </Card>

      {/* Filter knoppen + kolompicker */}
      <div className="flex gap-2 flex-wrap items-center">
        {(["meets", "near", "all"] as ShowFilter[]).map((f) => {
          const labels: Record<ShowFilter, string> = { meets: "Voldoet aan criteria + handmatig", near: "Bijna (yield ≥4% + val ≥30%)", all: "Alle gescand (met dividend)" };
          return (
            <button
              key={f}
              onClick={() => setShowFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                showFilter === f
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : "border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {labels[f]}
            </button>
          );
        })}
        <ShowSeenToggle showSeen={showSeen} onChange={setShowSeen} />
        <HideFavoritesToggle hideFavorites={hideFavorites} onChange={setHideFavorites} />
        <NotYetReviewedTile
          tickers={(data?.stocks ?? []).map((s) => s.ticker)}
          onActivate={() => { setShowSeen(false); setHideFavorites(true); }}
        />
        <MarkAllSeenButton tickers={filtered.map((s) => s.ticker)} />
        <ColumnPicker tabKey="zwitserleven" columns={COLUMNS_BASE} lockedKey="ticker" className="ml-auto" />
        {filtered.length > 0 && (
          <span className="text-xs text-neutral-500 self-center">{filtered.length} aandelen getoond</span>
        )}
      </div>

      {/* Tabel */}
      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-neutral-500">
          <div className="text-3xl mb-3">🌴</div>
          {(data?.total_scanned ?? 0) === 0 ? (
            <>
              <div>Nog geen tickers gescand.</div>
              <div className="mt-1 text-neutral-600">
                {(data?.unscanned_count ?? 0) > 0
                  ? `${data?.unscanned_count} tickers wachten op scan — gebruik de scan-knop hierboven (admin).`
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
            <div className="font-semibold text-sm text-emerald-300">
              🌴 Zwitserleven ranking
            </div>
            <div className="text-xs text-neutral-500">klik kolomkop om te sorteren · gebruik 'Kolommen' om te verbergen en herordenen</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="border-b border-ink-5 bg-ink-2/40">
                <tr>
                  <SeenHeader />
                  <HeartHeader />
                  <StarHeader />
                  {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.th}</Fragment>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-5">
                {filtered.map((s, idx) => {
                  const seen = marks.isSeen(s.ticker);
                  return (
                    <tr
                      key={s.ticker}
                      className={`hover:bg-ink-3/30 transition-colors ${
                        s.is_manual ? "bg-amber-500/[0.05]" : s.meets_criteria ? "bg-emerald-500/[0.03]" : ""
                      } ${seen ? "opacity-50" : ""}`}
                    >
                      <SeenCell ticker={s.ticker} />
                      <HeartCell ticker={s.ticker} />
                      <StarCell ticker={s.ticker} />
                      {visibleKeys.map((k) => <Fragment key={k}>{colMap[k]?.td(s, idx)}</Fragment>)}
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
