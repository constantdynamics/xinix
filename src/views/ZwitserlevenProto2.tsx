// ZwitserlevenProto2 — 5 radicaal andere mobiele layout-varianten (6–10).

import { useEffect, useRef, useState } from "react";
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
  return `${sym}${v.toFixed(2)}`;
}

const RISK_COLORS: Record<string, { text: string; bg: string; border: string; dot: string }> = {
  "Laag":      { text: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  "Matig":     { text: "text-yellow-400",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40",  dot: "bg-yellow-400"  },
  "Hoog":      { text: "text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/40",  dot: "bg-orange-400"  },
  "Zeer hoog": { text: "text-red-400",     bg: "bg-red-500/15",     border: "border-red-500/40",     dot: "bg-red-400"     },
};
const RISK_ORDER = ["Laag", "Matig", "Hoog", "Zeer hoog"];

const TAX: Record<string, number> = {
  "United States": 15, "Netherlands": 15, "United Kingdom": 0, "Germany": 26,
  "Switzerland": 35, "France": 25, "Canada": 15, "Australia": 30, "Japan": 15,
  "Belgium": 30, "Spain": 19, "Italy": 26, "Norway": 25, "Sweden": 30,
  "Denmark": 27, "Finland": 30, "Ireland": 25, "Hong Kong": 0, "Singapore": 0,
};
function taxRate(country: string | null) { return country ? (TAX[country] ?? null) : null; }
function netYield(s: ZwitserlevenStock) {
  const t = taxRate(s.country);
  return s.dividend_yield_pct != null && t != null ? s.dividend_yield_pct * (1 - t / 100) : s.dividend_yield_pct;
}

const CY = new Date().getFullYear();
function divHist(s: ZwitserlevenStock) {
  return [
    { year: CY - 5, y: s.div_yield_y5 },
    { year: CY - 4, y: s.div_yield_y4 },
    { year: CY - 3, y: s.div_yield_y3 },
    { year: CY - 2, y: s.div_yield_y2 },
    { year: CY - 1, y: s.div_yield_y1 },
  ];
}

// ── Variant 6: TERMINAL ────────────────────────────────────────────────────────
// Bloomberg / stock-terminal stijl. Monospace, neon-groen op bijna-zwart.
function termBar(pct: number, max = 15, width = 10): string {
  const filled = Math.round((Math.min(pct, max) / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function V6Row({ s, idx }: { s: ZwitserlevenStock; idx: number }) {
  const ny = netYield(s);
  const t = taxRate(s.country);
  const hist = divHist(s);
  const risk = s.risk_label ?? "?";
  const riskCode = risk === "Laag" ? "▲LOW" : risk === "Matig" ? "▲MED" : risk === "Hoog" ? "▼HGH" : "▼MAX";
  const riskCol = risk === "Laag" ? "text-emerald-400" : risk === "Matig" ? "text-yellow-400" : "text-red-400";
  return (
    <a
      href={googleFinanceUrl(s.ticker, s.exchange)}
      target="_blank"
      rel="noopener noreferrer"
      className="block border border-emerald-900/60 bg-black/60 rounded p-3 font-mono text-[11px] leading-5 hover:border-emerald-500/60 hover:bg-emerald-950/30 transition-colors"
    >
      {/* Line 1: index, ticker, yield */}
      <div className="flex items-baseline justify-between">
        <span className="text-emerald-700 mr-2">[{String(idx + 1).padStart(2, "0")}]</span>
        <span className="text-emerald-300 font-bold tracking-widest flex-1">{s.ticker.padEnd(10)}</span>
        <span className="text-emerald-200 font-black text-base tabular-nums">{fmtPct(s.dividend_yield_pct)}</span>
      </div>
      {/* Line 2: company */}
      <div className="text-emerald-700 truncate">{(s.company ?? s.exchange ?? "UNKNOWN").toUpperCase()}</div>
      {/* Line 3: meta */}
      <div className="flex gap-2 text-emerald-600 flex-wrap">
        <span>{s.country?.slice(0, 3).toUpperCase() ?? "???"}</span>
        <span>TAX:{t != null ? `${t}%` : "??"}</span>
        <span>NET:{fmtPct(ny)}</span>
        <span>VAL:{fmtPct(s.pct_under_5y_high)}</span>
        <span>CUT:{s.dividend_cuts_5y ?? "?"}</span>
        <span className={riskCol}>{riskCode}</span>
      </div>
      {/* Line 4: bars */}
      <div className="mt-1 flex gap-2 overflow-x-auto scrollbar-none">
        {hist.map(({ year, y }) => (
          <div key={year} className="flex flex-col items-center shrink-0">
            <span className={y ? "text-emerald-400" : "text-emerald-900"}>{y ? termBar(y) : "░".repeat(10)}</span>
            <span className="text-emerald-800">{String(year).slice(2)}{y ? ` ${y.toFixed(1)}` : "  ——"}</span>
          </div>
        ))}
      </div>
    </a>
  );
}

// ── Variant 7: GAUGE RING ──────────────────────────────────────────────────────
// SVG cirkelvormige voortgangsmeter voor dividend-yield. Smartwatch-complicatie stijl.
const GAUGE_MAX = 18;
function GaugeRing({ value, size = 88 }: { value: number | null; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = value != null ? Math.min(value / GAUGE_MAX, 1) : 0;
  const offset = circ * (1 - pct);
  const color = value == null ? "#374151" : value >= 10 ? "#34d399" : value >= 7 ? "#6ee7b7" : "#a7f3d0";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1f2937" strokeWidth={8} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={8}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-black tabular-nums" style={{ color }}>{fmtPct(value, 1)}</span>
        <span className="text-[9px] text-neutral-600">bruto</span>
      </div>
    </div>
  );
}

function V7Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "", border: "border-neutral-700", dot: "bg-neutral-600" };
  const ny = netYield(s);
  const hist = divHist(s);
  const paid = hist.filter(h => h.y != null && h.y > 0).length;
  return (
    <div className={`bg-ink-2 border ${rc.border} rounded-2xl p-4`}>
      <div className="flex items-center gap-4">
        <GaugeRing value={s.dividend_yield_pct} size={88} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-start justify-between gap-1">
            <div>
              <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                 className="font-mono font-black text-base tab-accent-text">{s.ticker}</a>
              <div className="text-[11px] text-neutral-500 truncate">{s.company}</div>
            </div>
            <div className="flex gap-1"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {s.risk_label && (
              <span className={`flex items-center gap-1 text-[10px] font-bold ${rc.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${rc.dot}`} />{s.risk_label}
              </span>
            )}
            <span className="text-[11px] text-neutral-400">{fmtPct(ny)} netto</span>
            {s.pct_under_5y_high != null && (
              <span className={`text-[11px] ${(s.pct_under_5y_high ?? 0) >= 60 ? "text-orange-400" : "text-neutral-500"}`}>
                −{fmtPct(s.pct_under_5y_high)}
              </span>
            )}
          </div>
          {/* Jaar-puntjes */}
          <div className="flex gap-1.5 items-center">
            {hist.map(({ year, y }) => (
              <div key={year} className="flex flex-col items-center gap-0.5">
                <div className={`w-2 h-2 rounded-full ${y ? rc.dot : "bg-neutral-800"}`} title={`${year}: ${fmtPct(y)}`} />
                <span className="text-[8px] text-neutral-700">{String(year).slice(2)}</span>
              </div>
            ))}
            <span className="text-[10px] text-neutral-600 ml-1">{paid}/5 jr</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant 8: KRANTENSTIJL ───────────────────────────────────────────────────
// Redactionele typografie: bedrijfsnaam als headline, data als lopende tekst.
function V8Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "", border: "border-neutral-700", dot: "" };
  const ny = netYield(s);
  const t = taxRate(s.country);
  const hist = divHist(s);
  return (
    <div className="border-b border-ink-5 pb-4 last:border-0 space-y-2">
      {/* Kop */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold">
            {s.exchange} · {s.country} {s.meets_criteria && "· ✓ voldoet"}
          </div>
          <h3 className="text-base font-black text-neutral-100 leading-tight mt-0.5 truncate">
            {s.company ?? s.ticker}
          </h3>
          <div className="font-mono text-xs text-neutral-500 mt-0.5">{s.ticker}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-black tabular-nums text-emerald-300 leading-none">{fmtPct(s.dividend_yield_pct)}</div>
          <div className={`text-[10px] font-bold mt-0.5 ${rc.text}`}>{s.risk_label ?? "—"}</div>
        </div>
      </div>

      {/* Body-tekst stijl */}
      <p className="text-[11px] text-neutral-400 leading-relaxed">
        Noteert <strong className="text-neutral-200">{fmtPrice(s.last_close, s.currency)}</strong>
        {s.pct_under_5y_high != null && <>, <strong className={`${(s.pct_under_5y_high ?? 0) >= 60 ? "text-orange-400" : "text-neutral-200"}`}>{fmtPct(s.pct_under_5y_high)}</strong> onder het 5-jaars hoog</>}.
        {" "}Dividendrendement <strong className="text-emerald-300">{fmtPct(s.dividend_yield_pct)} bruto</strong>
        {t != null && <>, na {t}% bronheffing <strong className="text-emerald-400">{fmtPct(ny)} netto</strong></>}.
        {s.max_annual_gain_5y != null && <> Beste jaar: <strong className="text-neutral-200">+{fmtPct(s.max_annual_gain_5y)}</strong>.</>}
        {s.dividend_cuts_5y === 0
          ? " Geen dividendkortingen in 5 jaar."
          : ` ${s.dividend_cuts_5y} korting(en) in 5 jaar.`}
      </p>

      {/* Voetnoot: jaar-history als tekst-tags */}
      <div className="flex gap-1.5 flex-wrap">
        {hist.map(({ year, y }) => (
          <span key={year} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            y ? "bg-emerald-500/20 text-emerald-300" : "bg-ink-4/60 text-neutral-700"
          }`}>{year} {y ? fmtPct(y) : "—"}</span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /><StarCell ticker={s.ticker} /></div>
        <TickerSparkline ticker={s.ticker} width={72} height={18} />
      </div>
    </div>
  );
}

// ── Variant 9: RISICO-LANES ───────────────────────────────────────────────────
// Trello-achtig: verticale swimlanes per risiconiveau, horizontaal scrollbaar.
function V9Lane({ label, stocks }: { label: string; stocks: ZwitserlevenStock[] }) {
  const rc = RISK_COLORS[label] ?? { text: "text-neutral-400", bg: "bg-neutral-800/40", border: "border-neutral-700", dot: "" };
  return (
    <div className={`shrink-0 w-52 rounded-xl border ${rc.border} overflow-hidden`}>
      {/* Lane header */}
      <div className={`px-3 py-2 ${rc.bg} flex items-center justify-between`}>
        <span className={`text-xs font-black uppercase tracking-wide ${rc.text}`}>{label}</span>
        <span className={`text-xs font-bold ${rc.text}`}>{stocks.length}</span>
      </div>
      {/* Cards */}
      <div className="space-y-1.5 p-1.5 max-h-[70vh] overflow-y-auto scrollbar-thin">
        {stocks.length === 0 && (
          <div className="text-center text-xs text-neutral-700 py-4">—</div>
        )}
        {stocks.map(s => (
          <div key={s.ticker} className="bg-ink-2 rounded-lg p-2.5 border border-ink-5">
            <div className="flex items-start justify-between gap-1">
              <div>
                <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                   className={`font-mono font-bold text-xs ${rc.text}`}>{s.ticker}</a>
                <div className="text-[10px] text-neutral-600 truncate max-w-[120px]">{s.company}</div>
              </div>
              <div className="text-right">
                <div className="text-base font-black tabular-nums text-neutral-100">{fmtPct(s.dividend_yield_pct)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] text-neutral-500">{fmtPct(s.pct_under_5y_high)} v5j</span>
              <TickerSparkline ticker={s.ticker} width={56} height={14} />
            </div>
            <div className="mt-1 flex gap-0.5">
              {[s.div_yield_y5, s.div_yield_y4, s.div_yield_y3, s.div_yield_y2, s.div_yield_y1].map((y, i) => (
                <div key={i} className={`flex-1 h-1 rounded-sm ${y ? "bg-emerald-500/60" : "bg-neutral-800"}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Variant 10: SPOTLIGHT / PAGER ─────────────────────────────────────────────
// Één aandeel tegelijk, volledig in focus. Swipe-gevoel met prev/next.
function V10Spotlight({ stocks }: { stocks: ZwitserlevenStock[] }) {
  const [idx, setIdx] = useState(0);
  const s = stocks[idx];
  if (!s) return <div className="text-neutral-500 text-sm text-center py-10">Geen data.</div>;

  const rc = RISK_COLORS[s.risk_label ?? ""] ?? { text: "text-neutral-400", bg: "bg-neutral-800/40", border: "border-neutral-700", dot: "bg-neutral-600" };
  const ny = netYield(s);
  const t = taxRate(s.country);
  const hist = divHist(s);
  const maxY = Math.max(...hist.map(h => h.y ?? 0), 0.1);

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex gap-0.5">
        {stocks.map((_, i) => (
          <button key={i} onClick={() => setIdx(i)} className={`h-1 flex-1 rounded-full transition-colors ${i === idx ? "bg-emerald-400" : "bg-ink-5"}`} />
        ))}
      </div>

      {/* Spotlight kaart */}
      <div className={`bg-ink-2 border-2 ${rc.border} rounded-2xl overflow-hidden`}>
        {/* Kleur-header */}
        <div className={`${rc.bg} px-5 py-5`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {s.risk_label && (
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${rc.text} mb-2`}>
                  <span className={`w-2 h-2 rounded-full ${rc.dot}`} />{s.risk_label}
                </span>
              )}
              <div className="text-xl font-black text-neutral-100 leading-tight truncate">{s.company ?? s.ticker}</div>
              <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                 className={`font-mono text-sm font-bold ${rc.text}`}>{s.ticker}</a>
            </div>
            <div className="text-right shrink-0">
              <div className="text-4xl font-black tabular-nums text-emerald-300 leading-none">{fmtPct(s.dividend_yield_pct)}</div>
              <div className="text-sm text-emerald-400/70 mt-0.5">{fmtPct(ny)} netto</div>
            </div>
          </div>
        </div>

        {/* Sparkline */}
        <div className="px-5 pt-3">
          <TickerSparkline ticker={s.ticker} width={320} height={48} />
        </div>

        {/* Dividend bars */}
        <div className="px-5 pt-3 pb-1">
          <div className="text-[10px] uppercase tracking-wider text-neutral-600 mb-2">Dividend per jaar</div>
          <div className="flex gap-2 items-end h-16">
            {hist.map(({ year, y }) => {
              const h = y ? Math.max(10, (y / maxY) * 52) : 6;
              return (
                <div key={year} className="flex-1 flex flex-col items-center justify-end gap-1">
                  {y != null && y > 0 && (
                    <span className="text-[9px] text-emerald-400 font-bold">{y.toFixed(1)}%</span>
                  )}
                  <div className={`w-full rounded-t ${y ? "bg-emerald-500/50" : "bg-ink-4/60"}`} style={{ height: h }} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-1">
            {hist.map(({ year }) => (
              <div key={year} className="flex-1 text-center text-[9px] text-neutral-600">{year}</div>
            ))}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-px m-4 bg-ink-5 rounded-xl overflow-hidden text-center">
          {[
            { label: "Koers",  value: fmtPrice(s.last_close, s.currency) },
            { label: "−5j hoog", value: fmtPct(s.pct_under_5y_high) },
            { label: "Max jaar", value: `+${fmtPct(s.max_annual_gain_5y)}` },
            { label: "Bronbel",  value: t != null ? `${t}%` : "—" },
            { label: "Groeijr", value: s.years_5pct_growth_5y ?? "—" },
            { label: "Cuts",    value: s.dividend_cuts_5y ?? "—" },
          ].map(m => (
            <div key={m.label} className="bg-ink-2 px-2 py-2.5">
              <div className="text-[10px] text-neutral-500 mb-0.5">{m.label}</div>
              <div className="text-sm font-bold text-neutral-200 tabular-nums">{m.value}</div>
            </div>
          ))}
        </div>

        {/* Marks */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <SeenCell ticker={s.ticker} />
          <HeartCell ticker={s.ticker} />
          <StarCell ticker={s.ticker} />
          {s.is_manual && <span className="text-[9px] uppercase font-bold text-amber-400 bg-amber-400/15 px-1.5 py-0.5 rounded">handm.</span>}
        </div>
      </div>

      {/* Prev / Next */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setIdx(i => Math.max(0, i - 1))}
          disabled={idx === 0}
          className="flex-1 py-3 rounded-xl bg-ink-3 border border-ink-5 text-sm font-bold text-neutral-300 disabled:opacity-30 active:bg-ink-4 transition-colors"
        >
          ← Vorige
        </button>
        <span className="text-xs text-neutral-500 shrink-0">{idx + 1} / {stocks.length}</span>
        <button
          onClick={() => setIdx(i => Math.min(stocks.length - 1, i + 1))}
          disabled={idx === stocks.length - 1}
          className="flex-1 py-3 rounded-xl bg-ink-3 border border-ink-5 text-sm font-bold text-neutral-300 disabled:opacity-30 active:bg-ink-4 transition-colors"
        >
          Volgende →
        </button>
      </div>
    </div>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
const VARIANT_INFO = [
  { n: 6,  label: "Terminal",   desc: "Bloomberg-stijl: monospace, ASCII-bars, neon-groen op zwart" },
  { n: 7,  label: "Gauge",      desc: "SVG cirkelmeter voor yield, smartwatch/ring-UI stijl" },
  { n: 8,  label: "Krant",      desc: "Redactionele typografie — bedrijfsnaam als headline" },
  { n: 9,  label: "Lanes",      desc: "Trello-achtig: swimlanes per risiconiveau, horizontaal scrollbaar" },
  { n: 10, label: "Spotlight",  desc: "Één aandeel per keer, volledig in focus, prev/next pager" },
];

// ── Hoofdview ─────────────────────────────────────────────────────────────────
export function ZwitserlevenProto2View() {
  const [variant, setVariant] = useState(6);
  const [stocks, setStocks] = useState<ZwitserlevenStock[]>([]);
  const [loading, setLoading] = useState(true);
  const marks = useMarks();

  useEffect(() => {
    fetchZwitserlevenResults()
      .then(r => setStocks(r.stocks.filter(s => s.meets_criteria || s.is_manual)))
      .finally(() => setLoading(false));
  }, []);

  const visible = stocks.filter(s => !marks.isSeen(s.ticker));

  // Groepeer voor lanes
  const byRisk: Record<string, ZwitserlevenStock[]> = {};
  for (const r of RISK_ORDER) byRisk[r] = [];
  for (const s of visible) byRisk[s.risk_label ?? ""]?.push(s) ?? (byRisk["?"] = [...(byRisk["?"] ?? []), s]);

  return (
    <div className="space-y-4 pb-10">
      {/* Variant-kiezer */}
      <div className="bg-ink-2 border border-ink-5 rounded-xl p-3 space-y-2">
        <div className="text-xs text-neutral-400 font-semibold uppercase tracking-wide">Kies variant (set 2)</div>
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
        <div className="text-xs text-neutral-500">{VARIANT_INFO.find(v => v.n === variant)?.desc}</div>
      </div>

      <div className="text-xs text-neutral-500">{visible.length} aandelen · alleen "voldoet aan criteria"</div>

      {loading && <div className="text-sm text-neutral-500 text-center py-10">Laden…</div>}
      {!loading && visible.length === 0 && <div className="text-sm text-neutral-500 text-center py-10">Geen aandelen gevonden.</div>}

      {/* Variant 6 — Terminal */}
      {variant === 6 && !loading && (
        <div className="space-y-1.5 rounded-xl overflow-hidden border border-emerald-900/40 bg-black/80 p-2">
          <div className="font-mono text-[10px] text-emerald-700 px-3 pb-1 border-b border-emerald-900/40">
            ZWITSERLEVEN SCREENER v2.0 · {new Date().toISOString().slice(0, 10)} · {visible.length} RESULTS
          </div>
          {visible.map((s, i) => <V6Row key={s.ticker} s={s} idx={i} />)}
        </div>
      )}

      {/* Variant 7 — Gauge */}
      {variant === 7 && !loading && (
        <div className="space-y-3">
          {visible.map(s => <V7Card key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 8 — Krant */}
      {variant === 8 && !loading && (
        <div className="bg-ink-2 border border-ink-5 rounded-xl px-4 py-3 space-y-4">
          <div className="text-[10px] uppercase tracking-widest text-neutral-600 pb-2 border-b border-ink-5">
            Zwitserleven · Dividend Screener · {visible.length} fondsen
          </div>
          {visible.map(s => <V8Card key={s.ticker} s={s} />)}
        </div>
      )}

      {/* Variant 9 — Lanes */}
      {variant === 9 && !loading && (
        <div>
          <div className="text-xs text-neutral-500 mb-2">Scroll horizontaal →</div>
          <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin snap-x snap-mandatory">
            {RISK_ORDER.map(r => (
              <div key={r} className="snap-start">
                <V9Lane label={r} stocks={byRisk[r] ?? []} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variant 10 — Spotlight */}
      {variant === 10 && !loading && (
        <V10Spotlight stocks={visible} />
      )}
    </div>
  );
}
