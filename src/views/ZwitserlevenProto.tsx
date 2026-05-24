// ZwitserlevenProto — 5 mobiele layout-varianten om uit te kiezen.
// Dezelfde data als Zwitserleven.tsx, puur een UX-experiment.

import { useEffect, useState } from "react";
import { fetchZwitserlevenResults, type ZwitserlevenStock } from "../api";
import { useMarks } from "../hooks/useMarks";
import { HeartCell, SeenCell, StarCell } from "../components/MarkCells";
import { TickerSparkline } from "../components/TickerSparkline";
import { googleFinanceUrl } from "../tickerLinks";

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtPct(v: number | null, d = 1) { return v == null ? "—" : `${v.toFixed(d)}%`; }
function fmtPrice(v: number | null, cur: string | null) {
  if (v == null) return "—";
  const sym = cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "CHF" ? "CHF " : "$";
  return `${sym}${v < 10 ? v.toFixed(2) : v.toFixed(2)}`;
}

const RISK_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  "Laag":      { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-500/40" },
  "Matig":     { text: "text-yellow-400",  bg: "bg-yellow-400/10",  border: "border-yellow-500/40" },
  "Hoog":      { text: "text-orange-400",  bg: "bg-orange-400/10",  border: "border-orange-500/40" },
  "Zeer hoog": { text: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-500/40" },
};
const RISK_LEFT: Record<string, string> = {
  "Laag": "bg-emerald-500", "Matig": "bg-yellow-500", "Hoog": "bg-orange-500", "Zeer hoog": "bg-red-500",
};

const TAX_BY_COUNTRY: Record<string, number> = {
  "United States": 15, "Netherlands": 15, "United Kingdom": 0, "Germany": 26,
  "Switzerland": 35, "France": 25, "Canada": 15, "Australia": 30, "Japan": 15,
  "Belgium": 30, "Spain": 19, "Italy": 26, "Norway": 25, "Sweden": 30,
  "Denmark": 27, "Finland": 30, "Ireland": 25, "Hong Kong": 0, "Singapore": 0,
};
function tax(country: string | null) { return country ? (TAX_BY_COUNTRY[country] ?? null) : null; }
function netYield(s: ZwitserlevenStock) {
  const t = tax(s.country);
  return s.dividend_yield_pct != null && t != null
    ? s.dividend_yield_pct * (1 - t / 100)
    : s.dividend_yield_pct;
}

const CY = new Date().getFullYear();
// divHistory[0] = oudste jaar (CY-5), divHistory[4] = meest recent (CY-1)
function divHistory(s: ZwitserlevenStock): { year: number; yield: number | null }[] {
  return [
    { year: CY - 5, yield: s.div_yield_y5 },
    { year: CY - 4, yield: s.div_yield_y4 },
    { year: CY - 3, yield: s.div_yield_y3 },
    { year: CY - 2, yield: s.div_yield_y2 },
    { year: CY - 1, yield: s.div_yield_y1 },
  ];
}

// ── Variant 1: DIVIDEND HERO ──────────────────────────────────────────────────
// Yield als grote hero-getal. Jaar-history als gekleurde blokjes. Full-card.
function V1Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "bg-neutral-400/10", border: "border-neutral-600" };
  const t = tax(s.country);
  const ny = netYield(s);
  const hist = divHistory(s);
  return (
    <div className="bg-ink-2 border border-ink-5 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
               className="font-mono font-bold text-base tab-accent-text">
              {s.ticker}
            </a>
            {s.is_manual && <span className="text-[9px] uppercase font-bold text-amber-400 bg-amber-400/15 px-1.5 py-0.5 rounded">handm.</span>}
            {s.meets_criteria && <span className="text-emerald-400 text-sm">✓</span>}
          </div>
          <div className="text-xs text-neutral-400 truncate mt-0.5 max-w-[200px]">{s.company ?? "—"}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SeenCell ticker={s.ticker} />
          <HeartCell ticker={s.ticker} />
          <StarCell ticker={s.ticker} />
          {s.risk_label && (
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${rc.text} ${rc.bg}`}>{s.risk_label}</span>
          )}
        </div>
      </div>

      {/* Yield hero */}
      <div className="mx-4 mb-3 bg-ink-3/50 rounded-xl px-4 py-3 flex items-center justify-around gap-4">
        <div className="text-center">
          <div className="text-3xl font-black tabular-nums text-emerald-300">{fmtPct(s.dividend_yield_pct)}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">bruto</div>
        </div>
        <div className="text-neutral-600 text-xl">→</div>
        <div className="text-center">
          <div className="text-3xl font-black tabular-nums text-emerald-400/80">{fmtPct(ny)}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">netto{t != null ? ` (−${t}%)` : ""}</div>
        </div>
      </div>

      {/* Dividend jaar-history */}
      <div className="mx-4 mb-3 flex gap-1.5">
        {hist.map(({ year, yield: y }) => (
          <div key={year} className="flex-1 flex flex-col items-center gap-0.5">
            <div className={`w-full rounded py-1.5 text-center text-[10px] font-bold ${
              y != null && y > 0 ? "bg-emerald-500/25 text-emerald-300" : "bg-ink-4/60 text-neutral-700"
            }`}>
              {y != null && y > 0 ? `${y.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[9px] text-neutral-600">{year}</div>
          </div>
        ))}
      </div>

      {/* Footer stats */}
      <div className="border-t border-ink-5 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-3 text-xs text-neutral-400 flex-wrap">
          <span>{fmtPrice(s.last_close, s.currency)}</span>
          {s.pct_under_5y_high != null && <span className={(s.pct_under_5y_high ?? 0) >= 60 ? "text-orange-400" : ""}>{fmtPct(s.pct_under_5y_high)} v 5j</span>}
          {s.years_5pct_growth_5y != null && <span className={s.years_5pct_growth_5y >= 2 ? "text-emerald-400" : ""}>{s.years_5pct_growth_5y} groeijr</span>}
          {s.dividend_cuts_5y != null && <span className={s.dividend_cuts_5y === 0 ? "text-emerald-400" : "text-red-400"}>{s.dividend_cuts_5y} cuts</span>}
        </div>
        <TickerSparkline ticker={s.ticker} width={60} height={16} />
      </div>
    </div>
  );
}

// ── Variant 2: COMPACTE LIJST ─────────────────────────────────────────────────
// iOS Stocks-app-achtig: één regel, tap voor meer. Links gekleurde risico-balk.
function V2Row({ s }: { s: ZwitserlevenStock }) {
  const [open, setOpen] = useState(false);
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "", border: "" };
  const lb = RISK_LEFT[s.risk_label ?? ""] ?? "bg-neutral-700";
  const ny = netYield(s);
  const hist = divHistory(s);
  return (
    <div className="border-b border-ink-5 last:border-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-stretch gap-0 text-left active:bg-ink-3/40 transition-colors">
        {/* Risico-balk links */}
        <div className={`w-1 shrink-0 self-stretch rounded-l-sm ${lb}`} />
        {/* Content */}
        <div className="flex-1 flex items-center gap-3 px-3 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-sm text-neutral-100">{s.ticker}</span>
              {s.meets_criteria && <span className="text-emerald-400 text-xs">✓</span>}
            </div>
            <div className="text-xs text-neutral-500 truncate">{s.company ?? s.exchange ?? "—"}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-black tabular-nums text-lg text-emerald-300">{fmtPct(s.dividend_yield_pct)}</div>
            <div className="flex items-center gap-1.5 justify-end">
              {s.risk_label && <span className={`text-[10px] font-semibold ${rc.text}`}>{s.risk_label}</span>}
              {s.pct_under_5y_high != null && <span className="text-[10px] text-neutral-500">−{fmtPct(s.pct_under_5y_high)}</span>}
            </div>
          </div>
          <span className={`text-neutral-500 text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 bg-ink-3/30">
          {/* Yield detail */}
          <div className="flex gap-4 text-sm pt-1">
            <div><span className="text-neutral-500 text-xs">bruto </span><span className="font-semibold text-emerald-300">{fmtPct(s.dividend_yield_pct)}</span></div>
            <div><span className="text-neutral-500 text-xs">netto </span><span className="font-semibold text-emerald-400">{fmtPct(ny)}</span></div>
            <div><span className="text-neutral-500 text-xs">prijs </span><span className="text-neutral-200">{fmtPrice(s.last_close, s.currency)}</span></div>
          </div>
          {/* Jaar history */}
          <div className="flex gap-1.5">
            {hist.map(({ year, yield: y }) => (
              <div key={year} className="flex-1 text-center">
                <div className={`text-[10px] font-bold rounded py-0.5 ${y ? "text-emerald-300 bg-emerald-500/20" : "text-neutral-700 bg-ink-4/50"}`}>
                  {y ? `${y.toFixed(1)}%` : "—"}
                </div>
                <div className="text-[9px] text-neutral-600 mt-0.5">{year}</div>
              </div>
            ))}
          </div>
          {/* Extra */}
          <div className="flex gap-3 flex-wrap text-xs text-neutral-400">
            {s.pct_under_5y_high != null && <span>{fmtPct(s.pct_under_5y_high)} onder 5j-hoog</span>}
            {s.max_annual_gain_5y != null && <span>max {fmtPct(s.max_annual_gain_5y)} in 1 jaar</span>}
            {s.dividend_cuts_5y != null && <span className={s.dividend_cuts_5y === 0 ? "text-emerald-400" : "text-red-400"}>{s.dividend_cuts_5y} cuts/5j</span>}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /><StarCell ticker={s.ticker} /></div>
            <TickerSparkline ticker={s.ticker} width={80} height={20} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Variant 3: TIMELINE ───────────────────────────────────────────────────────
// Dividend-history is de hoofdvisualisatie. Welke jaren wel/niet?
function V3Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "bg-neutral-400/10", border: "" };
  const hist = divHistory(s);
  const maxYield = Math.max(...hist.map(h => h.yield ?? 0), 0.1);
  const ny = netYield(s);
  return (
    <div className="bg-ink-2 border border-ink-5 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
             className="font-mono font-bold text-sm tab-accent-text shrink-0">{s.ticker}</a>
          <span className="text-neutral-500 text-xs truncate">{s.company}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SeenCell ticker={s.ticker} />
          <HeartCell ticker={s.ticker} />
          {s.risk_label && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${rc.text} ${rc.bg}`}>{s.risk_label}</span>
          )}
        </div>
      </div>

      {/* Timeline bars */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex gap-1 items-end h-14">
          {hist.map(({ year, yield: y }) => {
            const h = y ? Math.max(12, (y / maxYield) * 44) : 6;
            return (
              <div key={year} className="flex-1 flex flex-col items-center justify-end gap-0.5">
                {y != null && y > 0 && (
                  <span className="text-[9px] text-emerald-400 font-bold">{y.toFixed(1)}%</span>
                )}
                <div
                  className={`w-full rounded-t transition-all ${y ? "bg-emerald-500/60" : "bg-ink-4/80"}`}
                  style={{ height: `${h}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {hist.map(({ year }) => (
            <div key={year} className="flex-1 text-center text-[9px] text-neutral-600">{year}</div>
          ))}
        </div>
      </div>

      {/* Bottom strip */}
      <div className="px-3 pb-3 pt-2 flex items-center justify-between border-t border-ink-5 mt-2">
        <div className="flex gap-3 text-xs">
          <span className="font-bold text-emerald-300">{fmtPct(s.dividend_yield_pct)}</span>
          <span className="text-neutral-500">→</span>
          <span className="text-emerald-400">{fmtPct(ny)} netto</span>
        </div>
        <div className="flex gap-2 text-xs text-neutral-500">
          {s.pct_under_5y_high != null && <span>−{fmtPct(s.pct_under_5y_high)}</span>}
          <TickerSparkline ticker={s.ticker} width={48} height={14} />
        </div>
      </div>
    </div>
  );
}

// ── Variant 4: METRICS GRID ───────────────────────────────────────────────────
// 4 grote cijfers in 2×2 grid. Structured, zoals Google Finance.
function V4Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "bg-neutral-400/10", border: "border-neutral-700" };
  const ny = netYield(s);
  const hist = divHistory(s);
  return (
    <div className={`bg-ink-2 border rounded-xl overflow-hidden ${rc.border}`}>
      {/* Header bar */}
      <div className={`px-3 py-2 flex items-center justify-between ${rc.bg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
             className="font-mono font-bold text-sm text-neutral-100">{s.ticker}</a>
          <span className="text-xs text-neutral-400 truncate">{s.company}</span>
          {s.meets_criteria && <span className="text-emerald-400 text-xs shrink-0">✓</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SeenCell ticker={s.ticker} />
          <HeartCell ticker={s.ticker} />
          {s.risk_label && <span className={`text-[10px] font-bold ${rc.text}`}>{s.risk_label}</span>}
        </div>
      </div>

      {/* Sparkline */}
      <div className="px-3 pt-2">
        <TickerSparkline ticker={s.ticker} width={280} height={28} />
      </div>

      {/* 2×2 metrics */}
      <div className="grid grid-cols-2 divide-x divide-y divide-ink-5 mx-3 mt-2 border border-ink-5 rounded-lg overflow-hidden">
        <div className="px-3 py-2.5 text-center">
          <div className="text-2xl font-black tabular-nums text-emerald-300">{fmtPct(s.dividend_yield_pct)}</div>
          <div className="text-[10px] text-neutral-500 mt-0.5">div bruto</div>
        </div>
        <div className="px-3 py-2.5 text-center">
          <div className="text-2xl font-black tabular-nums text-emerald-400/80">{fmtPct(ny)}</div>
          <div className="text-[10px] text-neutral-500 mt-0.5">div netto</div>
        </div>
        <div className="px-3 py-2.5 text-center">
          <div className={`text-2xl font-black tabular-nums ${(s.pct_under_5y_high ?? 0) >= 60 ? "text-orange-400" : "text-neutral-200"}`}>
            {fmtPct(s.pct_under_5y_high)}
          </div>
          <div className="text-[10px] text-neutral-500 mt-0.5">onder 5j hoog</div>
        </div>
        <div className="px-3 py-2.5 text-center">
          <div className={`text-2xl font-black tabular-nums ${(s.dividend_cuts_5y ?? 0) === 0 ? "text-emerald-400" : "text-red-400"}`}>
            {s.dividend_cuts_5y ?? "—"}
          </div>
          <div className="text-[10px] text-neutral-500 mt-0.5">cuts / 5j</div>
        </div>
      </div>

      {/* Jaar-blokjes */}
      <div className="flex gap-1 px-3 py-3">
        {hist.map(({ year, yield: y }) => (
          <div key={year} className="flex-1 flex flex-col items-center gap-0.5">
            <div className={`w-full rounded text-center text-[9px] font-bold py-1 ${y ? "bg-emerald-500/30 text-emerald-300" : "bg-ink-4/60 text-neutral-700"}`}>
              {y ? "●" : "○"}
            </div>
            <div className="text-[9px] text-neutral-700">{String(year).slice(2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Variant 5: GRID TILES ─────────────────────────────────────────────────────
// 2-koloms grid: max aandelen tegelijk scannen.
function V5Tile({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "bg-neutral-400/10", border: "border-neutral-700" };
  const hist = divHistory(s);
  const paidYears = hist.filter(h => h.yield != null && h.yield > 0).length;
  return (
    <div className={`bg-ink-2 border ${rc.border} rounded-xl p-3 flex flex-col gap-2`}>
      {/* Ticker + marks */}
      <div className="flex items-start justify-between gap-1">
        <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
           className="font-mono font-bold text-sm tab-accent-text leading-tight">{s.ticker}</a>
        <div className="flex gap-0.5"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /></div>
      </div>
      <div className="text-[10px] text-neutral-500 truncate -mt-1">{s.company}</div>

      {/* Big yield */}
      <div className="text-center py-1">
        <div className="text-3xl font-black tabular-nums text-emerald-300 leading-none">{fmtPct(s.dividend_yield_pct)}</div>
        <div className="text-[10px] text-neutral-600 mt-0.5">bruto / jaar</div>
      </div>

      {/* Sparkline */}
      <TickerSparkline ticker={s.ticker} width={120} height={20} />

      {/* Jaar-stippen */}
      <div className="flex gap-0.5 justify-center">
        {hist.map(({ year, yield: y }) => (
          <div key={year} title={String(year)} className={`w-4 h-1.5 rounded-sm ${y ? "bg-emerald-500/70" : "bg-neutral-700"}`} />
        ))}
      </div>

      {/* Bottom badges */}
      <div className="flex items-center justify-between pt-0.5">
        {s.risk_label && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${rc.text} ${rc.bg}`}>{s.risk_label}</span>
        )}
        <span className="text-[10px] text-neutral-500">
          {s.pct_under_5y_high != null ? `−${s.pct_under_5y_high.toFixed(0)}%` : ""}
        </span>
        <span className={`text-[10px] font-semibold ${paidYears >= 3 ? "text-emerald-400" : "text-yellow-400"}`}>
          {paidYears}/5 jr
        </span>
      </div>
    </div>
  );
}

// ── Labels en beschrijvingen ─────────────────────────────────────────────────
const VARIANT_INFO = [
  { n: 1, label: "Hero",     desc: "Grote yield-getallen, jaar-history blokjes, alles in één kaart" },
  { n: 2, label: "Lijst",    desc: "iOS-stijl compacte lijst, tik om uit te klappen" },
  { n: 3, label: "Timeline", desc: "Dividend-history als staafgrafiek is de hoofdvisualisatie" },
  { n: 4, label: "Metrics",  desc: "4 grote KPI's in 2×2 grid per aandeel" },
  { n: 5, label: "Grid",     desc: "2-koloms tegels, meest aandelen tegelijk" },
];

// ── Hoofdview ─────────────────────────────────────────────────────────────────
export function ZwitserlevenProtoView() {
  const [variant, setVariant] = useState(1);
  const [stocks, setStocks] = useState<ZwitserlevenStock[]>([]);
  const [loading, setLoading] = useState(true);
  const marks = useMarks();

  useEffect(() => {
    fetchZwitserlevenResults()
      .then(r => setStocks(r.stocks.filter(s => s.meets_criteria || s.is_manual)))
      .finally(() => setLoading(false));
  }, []);

  const visible = stocks.filter(s => !marks.isSeen(s.ticker));

  return (
    <div className="space-y-4 pb-10">
      {/* Variant-kiezer */}
      <div className="bg-ink-2 border border-ink-5 rounded-xl p-3 space-y-2">
        <div className="text-xs text-neutral-400 font-semibold uppercase tracking-wide">Kies variant</div>
        <div className="flex gap-2 flex-wrap">
          {VARIANT_INFO.map(v => (
            <button
              key={v.n}
              onClick={() => setVariant(v.n)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                variant === v.n
                  ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                  : "bg-ink-3/50 border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {v.n} · {v.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-neutral-500">
          {VARIANT_INFO.find(v => v.n === variant)?.desc}
        </div>
      </div>

      <div className="text-xs text-neutral-500">{visible.length} aandelen · alleen "voldoet aan criteria"</div>

      {loading && <div className="text-sm text-neutral-500 text-center py-10">Laden…</div>}

      {!loading && visible.length === 0 && (
        <div className="text-sm text-neutral-500 text-center py-10">Geen aandelen gevonden.</div>
      )}

      {/* Variant 1 — Hero */}
      {variant === 1 && !loading && (
        <div className="space-y-3">
          {visible.map(s => <V1Card key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 2 — Lijst */}
      {variant === 2 && !loading && (
        <div className="bg-ink-2 border border-ink-5 rounded-xl overflow-hidden divide-y divide-ink-5">
          {visible.map(s => <V2Row key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 3 — Timeline */}
      {variant === 3 && !loading && (
        <div className="space-y-3">
          {visible.map(s => <V3Card key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 4 — Metrics Grid */}
      {variant === 4 && !loading && (
        <div className="space-y-3">
          {visible.map(s => <V4Card key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 5 — Grid */}
      {variant === 5 && !loading && (
        <div className="grid grid-cols-2 gap-2">
          {visible.map(s => <V5Tile key={s.ticker} s={s} />)}
        </div>
      )}
    </div>
  );
}
