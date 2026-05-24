// ZwitserlevenProto4 — Ultra-compacte tabelweergave, geoptimaliseerd voor
// mobiel portret (≥8 rijen zichtbaar op 390px breed scherm).
// Kolomset gebaseerd op de opgeslagen voorkeur van de gebruiker.
// Tikken op een rij klapt een detailpaneel uit zonder navigatie te verlaten.

import { useEffect, useState } from "react";
import { fetchZwitserlevenResults, type ZwitserlevenStock } from "../api";
import { googleFinanceUrl } from "../tickerLinks";

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtPct(v: number | null, d = 1) { return v == null ? "—" : `${v.toFixed(d)}%`; }
function fmtPrice(v: number | null, cur: string | null) {
  if (v == null) return "—";
  const sym = cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "CHF" ? "Fr" : "$";
  return `${sym}${v < 10 ? v.toFixed(2) : v.toFixed(0)}`;
}

const TAX_RATES: Record<string, number> = {
  "United States": 15, "Netherlands": 15, "United Kingdom": 0, "Germany": 26,
  "Switzerland": 35, "France": 25, "Canada": 15, "Australia": 30, "Japan": 15,
  "Belgium": 30, "Spain": 19, "Italy": 26, "Norway": 25, "Sweden": 30,
  "Denmark": 27, "Finland": 30, "Ireland": 25, "Hong Kong": 0, "Singapore": 0,
};
function netYieldPct(s: ZwitserlevenStock): number | null {
  if (s.dividend_yield_pct == null) return null;
  const rate = s.country ? (TAX_RATES[s.country] ?? null) : null;
  if (rate == null) return s.dividend_yield_pct;
  return s.dividend_yield_pct * (1 - rate / 100);
}

const CY = new Date().getFullYear();

// Div-kleur op basis van jaarlijkse yield
function yieldColor(y: number | null): string {
  if (y == null || y <= 0) return "bg-neutral-700/60";
  if (y >= 4) return "bg-emerald-500";
  if (y >= 2) return "bg-emerald-600/70";
  if (y >= 1) return "bg-yellow-500/80";
  return "bg-orange-500/70";
}

const RISK_SHORT: Record<string, string> = {
  "Laag": "L", "Matig": "M", "Hoog": "H", "Zeer hoog": "ZH",
};
const RISK_CL: Record<string, string> = {
  "Laag":      "text-emerald-300 bg-emerald-500/20 border-emerald-500/30",
  "Matig":     "text-yellow-300  bg-yellow-500/20  border-yellow-500/30",
  "Hoog":      "text-orange-300  bg-orange-500/20  border-orange-500/30",
  "Zeer hoog": "text-red-300     bg-red-500/20     border-red-500/30",
};

type SortKey = "net_yield" | "risk" | "under5y" | "ticker" | "growth_years";
type FilterKey = "meets" | "all";

const SORT_LABELS: Record<SortKey, string> = {
  net_yield: "Netto%",
  risk: "Risico",
  under5y: "↓5j%",
  ticker: "Ticker",
  growth_years: "Groei",
};

const RISK_ORDER: Record<string, number> = { "Laag": 0, "Matig": 1, "Hoog": 2, "Zeer hoog": 3 };

export function ZwitserlevenProto4View() {
  const [stocks, setStocks] = useState<ZwitserlevenStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("net_yield");
  const [asc, setAsc] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("meets");

  useEffect(() => {
    fetchZwitserlevenResults()
      .then(r => setStocks(r.stocks ?? []))
      .finally(() => setLoading(false));
  }, []);

  function toggleSort(k: SortKey) {
    if (sort === k) setAsc(a => !a);
    else { setSort(k); setAsc(false); }
  }

  const visible = stocks.filter(s => filter === "all" || s.meets_criteria || s.is_manual);

  const sorted = [...visible].sort((a, b) => {
    let v = 0;
    if (sort === "net_yield")     v = (netYieldPct(a) ?? -999) - (netYieldPct(b) ?? -999);
    else if (sort === "risk")     v = (RISK_ORDER[a.risk_label ?? ""] ?? 9) - (RISK_ORDER[b.risk_label ?? ""] ?? 9);
    else if (sort === "under5y")  v = (a.pct_under_5y_high ?? 0) - (b.pct_under_5y_high ?? 0);
    else if (sort === "growth_years") v = (a.years_5pct_growth_5y ?? -1) - (b.years_5pct_growth_5y ?? -1);
    else v = (a.ticker ?? "").localeCompare(b.ticker ?? "");
    return asc ? v : -v;
  });

  if (loading) {
    return (
      <div className="space-y-1 mt-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-7 rounded bg-ink-3 animate-pulse opacity-60" style={{ opacity: 1 - i * 0.06 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Filter */}
        <div className="flex rounded-lg overflow-hidden border border-ink-5 text-[11px]">
          {(["meets", "all"] as FilterKey[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 transition-colors ${filter === f ? "bg-fog-lime/20 text-fog-lime font-semibold" : "text-neutral-400 hover:text-neutral-200"}`}
            >
              {f === "meets" ? "✓ Voldoet" : "Alles"}
            </button>
          ))}
        </div>

        {/* Sorteer chips */}
        <div className="flex gap-1 flex-wrap">
          {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                sort === k
                  ? "bg-fog-lime/20 text-fog-lime border-fog-lime/40 font-semibold"
                  : "text-neutral-500 border-ink-5 hover:text-neutral-300"
              }`}
            >
              {SORT_LABELS[k]}{sort === k ? (asc ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[10px] text-neutral-600">{sorted.length} aandelen</span>
      </div>

      {/* ── Tabel ── */}
      <div className="rounded-xl border border-ink-5 overflow-hidden text-xs">
        {/* Header */}
        <div
          className="grid bg-ink-2/80 border-b border-ink-5 text-[9px] uppercase tracking-wider text-neutral-600 font-bold select-none"
          style={{ gridTemplateColumns: "minmax(52px,2fr) minmax(38px,1fr) minmax(26px,0.8fr) minmax(36px,1fr) minmax(120px,4fr)" }}
        >
          <div className="px-2 py-1.5 cursor-pointer hover:text-neutral-400 transition-colors" onClick={() => toggleSort("ticker")}>Ticker</div>
          <div className="px-1 py-1.5 text-right cursor-pointer hover:text-neutral-400 transition-colors" onClick={() => toggleSort("net_yield")}>Net%</div>
          <div className="px-1 py-1.5 text-center cursor-pointer hover:text-neutral-400 transition-colors" onClick={() => toggleSort("risk")}>R</div>
          <div className="px-1 py-1.5 text-right cursor-pointer hover:text-neutral-400 transition-colors" onClick={() => toggleSort("under5y")}>↓5j%</div>
          <div className="px-2 py-1.5 text-center">{CY-5}–{CY-1}</div>
        </div>

        {/* Rijen */}
        {sorted.map(s => {
          const isOpen = expanded === s.ticker;
          const rc = RISK_CL[s.risk_label ?? ""] ?? "text-neutral-400 bg-neutral-700/30 border-neutral-700/50";
          const rs = RISK_SHORT[s.risk_label ?? ""] ?? "?";
          const divYears = [s.div_yield_y5, s.div_yield_y4, s.div_yield_y3, s.div_yield_y2, s.div_yield_y1];
          const under = s.pct_under_5y_high;
          const netYield = netYieldPct(s);

          return (
            <div key={s.ticker} className="border-b border-ink-5/50 last:border-0">
              {/* Hoofdrij — tikken klapt detail uit */}
              <div
                className={`grid items-center cursor-pointer transition-colors select-none ${isOpen ? "bg-ink-3" : "hover:bg-ink-3/50"}`}
                style={{ gridTemplateColumns: "minmax(52px,2fr) minmax(38px,1fr) minmax(26px,0.8fr) minmax(36px,1fr) minmax(120px,4fr)" }}
                onClick={() => setExpanded(isOpen ? null : s.ticker)}
              >
                {/* Ticker */}
                <div className="px-2 py-1.5 font-mono font-bold text-fog-lime leading-none">
                  {s.ticker}
                </div>

                {/* Netto yield */}
                <div className={`px-1 py-1.5 text-right tabular-nums leading-none ${
                  (netYield ?? 0) >= 4 ? "text-emerald-300" :
                  (netYield ?? 0) >= 2 ? "text-emerald-400/80" : "text-neutral-400"
                }`}>
                  {fmtPct(netYield)}
                </div>

                {/* Risico badge */}
                <div className="px-1 py-1.5 flex justify-center">
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded border leading-none ${rc}`}>{rs}</span>
                </div>

                {/* Koersval van 5j-hoog */}
                <div className={`px-1 py-1.5 text-right tabular-nums leading-none ${
                  under == null ? "text-neutral-600" :
                  under <= 10 ? "text-orange-400" :
                  under <= 25 ? "text-yellow-400" : "text-emerald-400"
                }`}>
                  {under != null ? `-${under.toFixed(0)}%` : "—"}
                </div>

                {/* Div-jaar blokjes */}
                <div className="px-2 py-1.5 flex items-center gap-0.5 justify-center">
                  {divYears.map((y, i) => (
                    <div
                      key={i}
                      className={`rounded-[2px] ${yieldColor(y)}`}
                      style={{ width: 18, height: 14 }}
                      title={`${CY - 5 + i}: ${y != null ? fmtPct(y) : "geen data"}`}
                    >
                      {y != null && y > 0 && (
                        <span className="flex items-center justify-center h-full text-[7px] font-bold text-white/75 leading-none tabular-nums">
                          {y >= 10 ? Math.round(y) : y.toFixed(0)}
                        </span>
                      )}
                    </div>
                  ))}
                  <span className="text-[9px] text-neutral-600 ml-1">{isOpen ? "▲" : "▼"}</span>
                </div>
              </div>

              {/* Uitklap-detail */}
              {isOpen && (
                <div className="bg-ink-2/60 border-t border-ink-5/40 px-3 py-2 space-y-2">
                  {/* Bedrijfsnaam + link */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-neutral-500">Bedrijf</div>
                      <div className="text-neutral-200 text-[11px] font-medium">{s.company ?? s.ticker}</div>
                      {s.sector && <div className="text-[10px] text-neutral-500 mt-0.5">{s.sector}</div>}
                    </div>
                    <a
                      href={googleFinanceUrl(s.ticker, s.exchange)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] text-fog-lime/70 hover:text-fog-lime underline whitespace-nowrap"
                    >
                      Google Finance ↗
                    </a>
                  </div>

                  {/* Key metrics grid */}
                  <div className="grid grid-cols-4 gap-x-3 gap-y-1.5">
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Koers</div>
                      <div className="text-[11px] tabular-nums text-neutral-200">{fmtPrice(s.last_close, s.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Bruto%</div>
                      <div className="text-[11px] tabular-nums text-emerald-300">{fmtPct(s.dividend_yield_pct)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Max+</div>
                      <div className="text-[11px] tabular-nums text-emerald-300">{fmtPct(s.max_annual_gain_5y, 0)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Groei</div>
                      <div className="text-[11px] tabular-nums">{s.years_5pct_growth_5y ?? "—"}<span className="text-neutral-600">/5</span></div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Cuts</div>
                      <div className={`text-[11px] tabular-nums ${(s.dividend_cuts_5y ?? 0) > 0 ? "text-orange-400" : "text-emerald-400"}`}>
                        {s.dividend_cuts_5y ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Payout</div>
                      <div className="text-[11px] tabular-nums">
                        {s.payout_ratio != null ? `${Math.round(s.payout_ratio * 100)}%` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Land</div>
                      <div className="text-[11px] text-neutral-300">{s.country ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wide">Beurs</div>
                      <div className="text-[11px] text-neutral-300">{s.exchange ?? "—"}</div>
                    </div>
                  </div>

                  {/* Div per jaar — uitgeschreven */}
                  <div className="pt-1 border-t border-ink-5/30">
                    <div className="text-[9px] text-neutral-500 uppercase tracking-wide mb-1">Dividend per jaar</div>
                    <div className="flex gap-3">
                      {divYears.map((y, i) => (
                        <div key={i} className="text-center">
                          <div className="text-[9px] text-neutral-600">{CY - 5 + i}</div>
                          <div className={`text-[11px] tabular-nums font-medium ${y != null && y > 0 ? "text-emerald-300" : "text-neutral-600"}`}>
                            {y != null ? fmtPct(y) : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div className="py-8 text-center text-neutral-500 text-xs">
            Geen aandelen gevonden voor dit filter.
          </div>
        )}
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-3 text-[9px] text-neutral-600 flex-wrap px-1">
        <span className="font-semibold text-neutral-500">Div-blokjes:</span>
        {[
          { cl: "bg-emerald-500", l: "≥4%" },
          { cl: "bg-emerald-600/70", l: "2–4%" },
          { cl: "bg-yellow-500/80", l: "1–2%" },
          { cl: "bg-orange-500/70", l: "<1%" },
          { cl: "bg-neutral-700/60", l: "geen" },
        ].map(({ cl, l }) => (
          <span key={l} className="flex items-center gap-1">
            <span className={`inline-block w-3 h-2.5 rounded-[2px] ${cl}`} />
            {l}
          </span>
        ))}
        <span className="ml-auto">R = risico: L/M/H/ZH</span>
      </div>
    </div>
  );
}
