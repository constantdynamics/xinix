// ZwitserlevenProto5 — "Compact 2": twee tekstregels per aandeel.
// Regel 1: ticker + bedrijfsnaam (afgekapt) + risico-badge.
// Regel 2: netto% · ↓5j% · groei · div-blokjes.
// Tikken klapt volledige detail uit. ~48px per rij → ≥8 op mobiel portret.

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

function yieldColor(y: number | null): string {
  if (y == null || y <= 0) return "bg-neutral-700/50";
  if (y >= 4) return "bg-emerald-500";
  if (y >= 2) return "bg-emerald-600/70";
  if (y >= 1) return "bg-yellow-500/80";
  return "bg-orange-500/70";
}

const RISK_SHORT: Record<string, string> = {
  "Laag": "Laag", "Matig": "Matig", "Hoog": "Hoog", "Zeer hoog": "Zeer hoog",
};
const RISK_CL: Record<string, string> = {
  "Laag":      "text-emerald-300 bg-emerald-500/15 border-emerald-500/25",
  "Matig":     "text-yellow-300  bg-yellow-500/15  border-yellow-500/25",
  "Hoog":      "text-orange-300  bg-orange-500/15  border-orange-500/25",
  "Zeer hoog": "text-red-300     bg-red-500/15     border-red-500/25",
};

type SortKey = "net_yield" | "risk" | "under5y" | "ticker" | "growth_years";
type FilterKey = "meets" | "all";
const RISK_ORDER: Record<string, number> = { "Laag": 0, "Matig": 1, "Hoog": 2, "Zeer hoog": 3 };

export function ZwitserlevenProto5View() {
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
    if (sort === "net_yield")         v = (netYieldPct(a) ?? -999) - (netYieldPct(b) ?? -999);
    else if (sort === "risk")         v = (RISK_ORDER[a.risk_label ?? ""] ?? 9) - (RISK_ORDER[b.risk_label ?? ""] ?? 9);
    else if (sort === "under5y")      v = (a.pct_under_5y_high ?? 0) - (b.pct_under_5y_high ?? 0);
    else if (sort === "growth_years") v = (a.years_5pct_growth_5y ?? -1) - (b.years_5pct_growth_5y ?? -1);
    else v = (a.ticker ?? "").localeCompare(b.ticker ?? "");
    return asc ? v : -v;
  });

  if (loading) {
    return (
      <div className="space-y-1.5 mt-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-11 rounded-lg bg-ink-3 animate-pulse" style={{ opacity: 1 - i * 0.08 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg overflow-hidden border border-ink-5 text-[11px]">
          {(["meets", "all"] as FilterKey[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 transition-colors ${filter === f ? "bg-fog-lime/20 text-fog-lime font-semibold" : "text-neutral-400 hover:text-neutral-200"}`}
            >
              {f === "meets" ? "✓ Voldoet" : "Alles"}
            </button>
          ))}
        </div>

        <div className="flex gap-1 flex-wrap">
          {([
            ["net_yield", "Netto%"],
            ["risk", "Risico"],
            ["under5y", "↓5j%"],
            ["growth_years", "Groei"],
            ["ticker", "Ticker"],
          ] as [SortKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                sort === k
                  ? "bg-fog-lime/20 text-fog-lime border-fog-lime/40 font-semibold"
                  : "text-neutral-500 border-ink-5 hover:text-neutral-300"
              }`}
            >
              {label}{sort === k ? (asc ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[10px] text-neutral-600">{sorted.length} aandelen</span>
      </div>

      {/* ── Lijst ── */}
      <div className="rounded-xl border border-ink-5 overflow-hidden divide-y divide-ink-5/50">
        {sorted.map(s => {
          const isOpen = expanded === s.ticker;
          const rc = RISK_CL[s.risk_label ?? ""] ?? "text-neutral-400 bg-neutral-700/20 border-neutral-700/30";
          const rs = RISK_SHORT[s.risk_label ?? ""] ?? "?";
          const divYears = [s.div_yield_y5, s.div_yield_y4, s.div_yield_y3, s.div_yield_y2, s.div_yield_y1];
          const ny = netYieldPct(s);
          const under = s.pct_under_5y_high;
          const growth = s.years_5pct_growth_5y;

          return (
            <div key={s.ticker}>
              {/* ── Compacte 2-regelrij ── */}
              <div
                className={`px-3 py-2 cursor-pointer transition-colors select-none ${isOpen ? "bg-ink-3" : "hover:bg-ink-3/40"}`}
                onClick={() => setExpanded(isOpen ? null : s.ticker)}
              >
                {/* Regel 1: ticker · bedrijf · risico */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-[13px] text-fog-lime shrink-0">{s.ticker}</span>
                  {s.company && (
                    <span className="text-[11px] text-neutral-400 truncate min-w-0 flex-1">{s.company}</span>
                  )}
                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${rc}`}>
                    {rs}
                  </span>
                </div>

                {/* Regel 2: metrics + div-blokjes */}
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  {/* Netto yield */}
                  <span className={`text-[11px] tabular-nums font-medium ${
                    (ny ?? 0) >= 4 ? "text-emerald-300" :
                    (ny ?? 0) >= 2 ? "text-emerald-400/80" : "text-neutral-400"
                  }`}>
                    {fmtPct(ny)} netto
                  </span>

                  {/* Koersval */}
                  {under != null && (
                    <span className={`text-[11px] tabular-nums ${
                      under <= 10 ? "text-orange-400" : under <= 25 ? "text-yellow-400" : "text-emerald-400"
                    }`}>
                      ↓{under.toFixed(0)}%
                    </span>
                  )}

                  {/* Groeijaren */}
                  {growth != null && (
                    <span className="text-[11px] text-neutral-500 tabular-nums">
                      {growth}<span className="text-neutral-700">/5</span>
                    </span>
                  )}

                  {/* Div-blokjes */}
                  <div className="flex items-center gap-0.5 ml-auto">
                    {divYears.map((y, i) => (
                      <div
                        key={i}
                        className={`rounded-[2px] ${yieldColor(y)}`}
                        style={{ width: 16, height: 12 }}
                        title={`${CY - 5 + i}: ${y != null ? fmtPct(y) : "geen data"}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Uitklap-detail ── */}
              {isOpen && (
                <div className="bg-ink-2/60 border-t border-ink-5/40 px-3 py-2.5 space-y-2.5">
                  {/* Link */}
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-neutral-300 font-medium">{s.company ?? s.ticker}</div>
                    <a
                      href={googleFinanceUrl(s.ticker, s.exchange)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] text-fog-lime/70 hover:text-fog-lime"
                    >
                      Google Finance ↗
                    </a>
                  </div>

                  {s.sector && (
                    <div className="text-[10px] text-neutral-500">{s.sector} · {s.country ?? "—"} · {s.exchange ?? "—"}</div>
                  )}

                  {/* Metrics 4-koloms grid */}
                  <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                    {[
                      { label: "Koers",    val: fmtPrice(s.last_close, s.currency) },
                      { label: "Bruto%",   val: fmtPct(s.dividend_yield_pct), cl: "text-emerald-300" },
                      { label: "Netto%",   val: fmtPct(ny), cl: "text-emerald-300" },
                      { label: "↓5j-hoog", val: under != null ? `-${under.toFixed(0)}%` : "—" },
                      { label: "Max+",     val: fmtPct(s.max_annual_gain_5y, 0), cl: "text-emerald-300" },
                      { label: "Groei",    val: growth != null ? `${growth}/5` : "—" },
                      { label: "Cuts",     val: String(s.dividend_cuts_5y ?? "—"), cl: (s.dividend_cuts_5y ?? 0) > 0 ? "text-orange-400" : "text-emerald-400" },
                      { label: "Payout",   val: s.payout_ratio != null ? `${Math.round(s.payout_ratio * 100)}%` : "—" },
                    ].map(({ label, val, cl }) => (
                      <div key={label}>
                        <div className="text-[9px] text-neutral-600 uppercase tracking-wide">{label}</div>
                        <div className={`text-[11px] tabular-nums ${cl ?? "text-neutral-200"}`}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Div per jaar uitgeschreven */}
                  <div className="border-t border-ink-5/30 pt-2">
                    <div className="text-[9px] text-neutral-500 uppercase tracking-wide mb-1.5">Dividend per jaar</div>
                    <div className="flex gap-3">
                      {divYears.map((y, i) => (
                        <div key={i} className="text-center">
                          <div
                            className={`w-8 h-1.5 rounded-full mb-1 mx-auto ${yieldColor(y)}`}
                          />
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
          <div className="py-10 text-center text-neutral-500 text-xs">
            Geen aandelen voor dit filter.
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
          { cl: "bg-neutral-700/50", l: "geen" },
        ].map(({ cl, l }) => (
          <span key={l} className="flex items-center gap-1">
            <span className={`inline-block w-3 h-2 rounded-[2px] ${cl}`} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
