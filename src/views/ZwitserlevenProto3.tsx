// ZwitserlevenProto3 — varianten 11–20. Elk een compleet ander UI-paradigma.

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
  return `${sym}${v.toFixed(2)}`;
}
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
    { year: CY - 5, y: s.div_yield_y5 }, { year: CY - 4, y: s.div_yield_y4 },
    { year: CY - 3, y: s.div_yield_y3 }, { year: CY - 2, y: s.div_yield_y2 },
    { year: CY - 1, y: s.div_yield_y1 },
  ];
}
const RC: Record<string, { t: string; b: string; br: string; glow: string; letter: string }> = {
  "Laag":      { t: "text-emerald-400", b: "bg-emerald-500/15", br: "border-emerald-500/50", glow: "shadow-emerald-500/40", letter: "A" },
  "Matig":     { t: "text-yellow-400",  b: "bg-yellow-500/15",  br: "border-yellow-500/50",  glow: "shadow-yellow-500/40",  letter: "B" },
  "Hoog":      { t: "text-orange-400",  b: "bg-orange-500/15",  br: "border-orange-500/50",  glow: "shadow-orange-500/40",  letter: "C" },
  "Zeer hoog": { t: "text-red-400",     b: "bg-red-500/15",     br: "border-red-500/50",     glow: "shadow-red-500/40",     letter: "D" },
};

// ── Variant 11: SWIPE-DECK ────────────────────────────────────────────────────
// Gestapelde kaarten à la Tinder — één tegelijk, volledige focus + stack-effect.
function V11({ stocks }: { stocks: ZwitserlevenStock[] }) {
  const [idx, setIdx] = useState(0);
  if (!stocks.length) return null;
  const s = stocks[idx];
  const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800", br: "border-neutral-700", glow: "", letter: "?" };
  const ny = netYield(s);
  const hist = divHist(s);
  return (
    <div className="space-y-4">
      {/* Stack effect */}
      <div className="relative h-[420px]">
        {/* Back cards */}
        {[2, 1].map(offset => {
          const si = stocks[idx + offset];
          if (!si) return null;
          return (
            <div key={offset} className="absolute inset-x-0 top-0 h-full rounded-2xl border border-ink-5 bg-ink-3/60"
              style={{ transform: `scale(${1 - offset * 0.04}) translateY(${offset * 10}px)`, zIndex: 10 - offset, opacity: 1 - offset * 0.3 }} />
          );
        })}
        {/* Front card */}
        <div className={`absolute inset-0 rounded-2xl border-2 ${rc.br} bg-ink-2 z-20 overflow-hidden flex flex-col`}>
          {/* Top half: kleur + yields */}
          <div className={`${rc.b} px-5 pt-5 pb-4 flex-1 flex flex-col justify-between`}>
            <div className="flex items-start justify-between">
              <div>
                <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                   className="font-mono font-black text-xl tab-accent-text">{s.ticker}</a>
                <div className="text-sm text-neutral-400 mt-0.5 truncate max-w-[220px]">{s.company}</div>
                <div className="text-xs text-neutral-600 mt-0.5">{s.exchange} · {s.country}</div>
              </div>
              {s.risk_label && (
                <span className={`text-xs font-black px-2 py-1 rounded-full ${rc.t} ${rc.b} border ${rc.br}`}>{s.risk_label}</span>
              )}
            </div>
            <div className="flex gap-6 mt-4">
              <div>
                <div className="text-4xl font-black tabular-nums text-emerald-300">{fmtPct(s.dividend_yield_pct)}</div>
                <div className="text-xs text-neutral-500 mt-0.5">bruto</div>
              </div>
              <div>
                <div className="text-4xl font-black tabular-nums text-emerald-400/70">{fmtPct(ny)}</div>
                <div className="text-xs text-neutral-500 mt-0.5">netto</div>
              </div>
            </div>
          </div>
          {/* Bottom half: details */}
          <div className="px-5 py-4 space-y-3">
            <TickerSparkline ticker={s.ticker} width={300} height={40} />
            <div className="flex gap-1">
              {hist.map(({ year, y }) => (
                <div key={year} className="flex-1 text-center">
                  <div className={`text-[9px] font-bold py-1 rounded ${y ? "bg-emerald-500/25 text-emerald-300" : "bg-ink-4 text-neutral-700"}`}>
                    {y ? `${y.toFixed(1)}` : "—"}
                  </div>
                  <div className="text-[8px] text-neutral-700 mt-0.5">{year}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 text-xs text-neutral-500 flex-wrap">
              <span>{fmtPrice(s.last_close, s.currency)}</span>
              {s.pct_under_5y_high != null && <span>−{fmtPct(s.pct_under_5y_high)} v5j</span>}
              {s.dividend_cuts_5y === 0 && <span className="text-emerald-400">0 cuts</span>}
            </div>
            <div className="flex gap-1.5"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /><StarCell ticker={s.ticker} /></div>
          </div>
        </div>
      </div>
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
          className="flex-1 py-4 rounded-2xl bg-ink-3 border border-ink-5 text-2xl disabled:opacity-20 active:scale-95 transition-transform">←</button>
        <span className="text-xs text-neutral-500 w-16 text-center">{idx + 1} / {stocks.length}</span>
        <button onClick={() => setIdx(i => Math.min(stocks.length - 1, i + 1))} disabled={idx === stocks.length - 1}
          className="flex-1 py-4 rounded-2xl bg-ink-3 border border-ink-5 text-2xl disabled:opacity-20 active:scale-95 transition-transform">→</button>
      </div>
    </div>
  );
}

// ── Variant 12: HEATMAP ───────────────────────────────────────────────────────
// Kleur-intensiteit = yield. Tik op cel voor detail-overlay.
function yieldColor(y: number | null): string {
  if (y == null) return "bg-neutral-800 text-neutral-600";
  if (y >= 12) return "bg-emerald-400 text-black";
  if (y >= 10) return "bg-emerald-500 text-black";
  if (y >= 8)  return "bg-emerald-600 text-white";
  if (y >= 6)  return "bg-emerald-700 text-white";
  return "bg-emerald-900 text-emerald-400";
}
function V12({ stocks }: { stocks: ZwitserlevenStock[] }) {
  const [sel, setSel] = useState<ZwitserlevenStock | null>(null);
  return (
    <div className="space-y-3">
      <div className="text-xs text-neutral-500">Kleurintensiteit = bruto yield. Tik voor details.</div>
      <div className="grid grid-cols-4 gap-1">
        {stocks.map(s => (
          <button key={s.ticker} onClick={() => setSel(s === sel ? null : s)}
            className={`${yieldColor(s.dividend_yield_pct)} rounded-lg p-2 text-center aspect-square flex flex-col items-center justify-center gap-0.5 border-2 transition-all ${sel?.ticker === s.ticker ? "border-white scale-105" : "border-transparent"}`}>
            <div className="font-mono font-black text-[11px] leading-tight">{s.ticker.replace(/\..+/, "")}</div>
            <div className="text-[10px] font-semibold tabular-nums">{fmtPct(s.dividend_yield_pct, 0)}</div>
          </button>
        ))}
      </div>
      {/* Detail overlay */}
      {sel && (
        <div className="bg-ink-2 border border-emerald-500/40 rounded-xl p-4 space-y-3 animate-pulse-once">
          <div className="flex items-start justify-between">
            <div>
              <a href={googleFinanceUrl(sel.ticker, sel.exchange)} target="_blank" rel="noopener noreferrer"
                 className="font-mono font-bold text-sm tab-accent-text">{sel.ticker}</a>
              <div className="text-xs text-neutral-400">{sel.company}</div>
            </div>
            <button onClick={() => setSel(null)} className="text-neutral-500 hover:text-neutral-200 text-lg">✕</button>
          </div>
          <div className="flex gap-4 text-sm">
            <div><span className="text-neutral-500">Bruto </span><span className="font-black text-emerald-300">{fmtPct(sel.dividend_yield_pct)}</span></div>
            <div><span className="text-neutral-500">Netto </span><span className="font-bold text-emerald-400">{fmtPct(netYield(sel))}</span></div>
            {sel.risk_label && <div className={`font-bold text-xs self-end ${(RC[sel.risk_label] ?? RC["Matig"]).t}`}>{sel.risk_label}</div>}
          </div>
          <div className="flex gap-1">
            {divHist(sel).map(({ year, y }) => (
              <div key={year} className="flex-1 text-center">
                <div className={`text-[9px] py-1 rounded font-bold ${y ? "bg-emerald-500/20 text-emerald-300" : "bg-ink-4 text-neutral-700"}`}>{y ? `${y.toFixed(1)}%` : "—"}</div>
                <div className="text-[8px] text-neutral-700 mt-0.5">{year}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs text-neutral-500 flex-wrap">
            <span>{fmtPrice(sel.last_close, sel.currency)}</span>
            {sel.pct_under_5y_high != null && <span>−{fmtPct(sel.pct_under_5y_high)} v5j</span>}
            {sel.dividend_cuts_5y != null && <span>{sel.dividend_cuts_5y} cuts</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Variant 13: PODIUM ────────────────────────────────────────────────────────
// Top-3 op podium (goud/zilver/brons), rest in compacte lijst.
function V13({ stocks }: { stocks: ZwitserlevenStock[] }) {
  const sorted = [...stocks].sort((a, b) => (b.dividend_yield_pct ?? 0) - (a.dividend_yield_pct ?? 0));
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const medals = ["🥇", "🥈", "🥉"];
  const podiumH = ["h-32", "h-24", "h-20"];
  const podiumOrder = [1, 0, 2]; // 2e, 1e, 3e op podium
  return (
    <div className="space-y-4">
      {/* Podium */}
      <div className="bg-ink-2 border border-ink-5 rounded-2xl p-4">
        <div className="flex items-end justify-center gap-2 mb-4">
          {podiumOrder.map((rank) => {
            const s = top3[rank];
            if (!s) return <div key={rank} className="w-24" />;
            return (
              <div key={rank} className="flex flex-col items-center gap-1 w-24">
                <span className="text-xl">{medals[rank]}</span>
                <div className="text-center">
                  <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                     className="font-mono font-black text-xs tab-accent-text block">{s.ticker}</a>
                  <div className={`text-xl font-black tabular-nums ${rank === 0 ? "text-yellow-300" : rank === 1 ? "text-neutral-300" : "text-amber-600"}`}>
                    {fmtPct(s.dividend_yield_pct)}
                  </div>
                  <div className="text-[9px] text-neutral-600 truncate">{s.company?.split(" ")[0]}</div>
                </div>
                <div className={`w-full rounded-t-lg ${rank === 0 ? "bg-yellow-500/30" : rank === 1 ? "bg-neutral-500/20" : "bg-amber-700/20"} ${podiumH[rank]}`} />
              </div>
            );
          })}
        </div>
        <div className="text-center text-xs text-neutral-600">gesorteerd op bruto yield</div>
      </div>
      {/* Rest */}
      {rest.length > 0 && (
        <div className="bg-ink-2 border border-ink-5 rounded-xl overflow-hidden divide-y divide-ink-5">
          {rest.map((s, i) => {
            const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "", br: "", glow: "", letter: "?" };
            return (
              <div key={s.ticker} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs text-neutral-600 w-5 text-right tabular-nums">{i + 4}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-mono font-bold text-xs text-neutral-200">{s.ticker}</span>
                  <span className="text-neutral-600 text-xs ml-2 truncate">{s.company?.split(" ").slice(0, 2).join(" ")}</span>
                </div>
                {s.risk_label && <span className={`text-[10px] font-bold ${rc.t}`}>{s.risk_label}</span>}
                <span className="font-black tabular-nums text-emerald-300 text-sm">{fmtPct(s.dividend_yield_pct)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Variant 14: SOCIAL FEED ───────────────────────────────────────────────────
// Elk aandeel als een social-media post/bericht in een feed.
function V14Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800/40", br: "border-neutral-700", glow: "", letter: "?" };
  const ny = netYield(s);
  const initials = s.ticker.replace(/\..+/, "").slice(0, 2);
  const hist = divHist(s);
  const paid = hist.filter(h => h.y).length;
  return (
    <div className="bg-ink-2 border border-ink-5 rounded-2xl p-3 space-y-2.5">
      {/* Post header */}
      <div className="flex items-center gap-2.5">
        <div className={`w-9 h-9 rounded-full ${rc.b} border ${rc.br} flex items-center justify-center font-mono font-black text-sm ${rc.t} shrink-0`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
               className="font-mono font-bold text-sm text-neutral-100">{s.ticker}</a>
            {s.meets_criteria && <span className="text-emerald-400 text-xs">✓</span>}
          </div>
          <div className="text-[10px] text-neutral-500 truncate">{s.company} · {s.exchange}</div>
        </div>
        <div className="flex gap-1 shrink-0"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /></div>
      </div>
      {/* Post body */}
      <p className="text-sm text-neutral-300 leading-relaxed">
        Bied dit kwartaal <strong className="text-emerald-300">{fmtPct(s.dividend_yield_pct)} dividend</strong> bruto
        {ny != null && <> (<strong className="text-emerald-400">{fmtPct(ny)}</strong> na bronheffing)</>}.
        {" "}Koers ligt <strong className={`${(s.pct_under_5y_high ?? 0) >= 60 ? "text-orange-400" : "text-neutral-200"}`}>{fmtPct(s.pct_under_5y_high)}</strong> onder het 5-jaars hoog.
        {s.dividend_cuts_5y === 0 ? <> <strong className="text-emerald-400">Geen cuts</strong> in 5 jaar.</> : null}
      </p>
      {/* "Engagement" row */}
      <div className="flex items-center gap-3 pt-0.5 border-t border-ink-5">
        <TickerSparkline ticker={s.ticker} width={80} height={20} />
        <div className="flex gap-1.5 flex-wrap flex-1 justify-end">
          {hist.map(({ year, y }) => (
            <span key={year} className={`text-[9px] px-1 py-0.5 rounded font-mono ${y ? "text-emerald-400 bg-emerald-500/15" : "text-neutral-700 bg-ink-4/60"}`}>
              {String(year).slice(2)}{y ? ` ${y.toFixed(1)}%` : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Variant 15: METRO TILES ───────────────────────────────────────────────────
// Windows 11-stijl: mix van brede en normale tegels.
function V15({ stocks }: { stocks: ZwitserlevenStock[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {stocks.map((s, i) => {
        const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800/40", br: "border-neutral-700", glow: "", letter: "?" };
        const isWide = i % 5 === 0;
        const isTall = i % 7 === 2;
        const ny = netYield(s);
        return (
          <div key={s.ticker}
            className={`${rc.b} border ${rc.br} rounded-xl overflow-hidden p-3 flex flex-col justify-between min-h-[100px] ${isWide ? "col-span-2" : ""} ${isTall ? "row-span-2" : ""}`}
          >
            <div className="flex items-start justify-between gap-1">
              <div>
                <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                   className={`font-mono font-black text-sm ${rc.t}`}>{s.ticker}</a>
                {isWide && <div className="text-[10px] text-neutral-500 truncate mt-0.5">{s.company}</div>}
              </div>
              {s.risk_label && <span className={`text-[9px] font-black ${rc.t}`}>{RC[s.risk_label]?.letter ?? "?"}</span>}
            </div>
            <div>
              <div className={`font-black tabular-nums ${isTall || isWide ? "text-3xl" : "text-xl"} text-neutral-100`}>
                {fmtPct(s.dividend_yield_pct)}
              </div>
              {(isTall || isWide) && (
                <div className="text-xs text-neutral-500 mt-1">
                  {fmtPct(ny)} netto · {fmtPct(s.pct_under_5y_high)} v5j
                </div>
              )}
            </div>
            {isWide && <TickerSparkline ticker={s.ticker} width={200} height={20} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Variant 16: NEON / GLOW ───────────────────────────────────────────────────
// Cyberpunk: gloeiende randen per risiconiveau, zwarte achtergrond.
const NEON: Record<string, { border: string; text: string; shadow: string }> = {
  "Laag":      { border: "border-emerald-400", text: "text-emerald-400", shadow: "0 0 12px rgba(52,211,153,0.6), inset 0 0 8px rgba(52,211,153,0.1)" },
  "Matig":     { border: "border-yellow-400",  text: "text-yellow-400",  shadow: "0 0 12px rgba(250,204,21,0.6), inset 0 0 8px rgba(250,204,21,0.1)" },
  "Hoog":      { border: "border-orange-400",  text: "text-orange-400",  shadow: "0 0 12px rgba(251,146,60,0.6), inset 0 0 8px rgba(251,146,60,0.1)" },
  "Zeer hoog": { border: "border-red-400",     text: "text-red-400",     shadow: "0 0 12px rgba(248,113,113,0.6), inset 0 0 8px rgba(248,113,113,0.1)" },
};
function V16Card({ s }: { s: ZwitserlevenStock }) {
  const n = NEON[s.risk_label ?? ""] ?? { border: "border-neutral-600", text: "text-neutral-400", shadow: "" };
  const ny = netYield(s);
  const hist = divHist(s);
  return (
    <div className={`bg-black border ${n.border} rounded-xl p-3`} style={{ boxShadow: n.shadow }}>
      <div className="flex items-center justify-between mb-2">
        <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
           className={`font-mono font-black text-base tracking-widest ${n.text}`}>{s.ticker}</a>
        <div className="flex gap-1.5 items-center">
          {s.risk_label && <span className={`font-mono text-[10px] font-bold ${n.text}`}>[{s.risk_label.toUpperCase()}]</span>}
        </div>
      </div>
      <div className="flex gap-4 mb-2">
        <div className={`text-3xl font-black tabular-nums ${n.text}`}>{fmtPct(s.dividend_yield_pct)}</div>
        <div className="flex flex-col justify-center">
          <div className="text-xs text-neutral-600">netto</div>
          <div className={`text-lg font-black tabular-nums text-neutral-300`}>{fmtPct(ny)}</div>
        </div>
      </div>
      <div className="font-mono text-[10px] text-neutral-700 truncate mb-2">{s.company?.toUpperCase()}</div>
      {/* Neon jaar-blokjes */}
      <div className="flex gap-1">
        {hist.map(({ year, y }) => (
          <div key={year} className="flex-1 text-center">
            <div className={`py-1 rounded text-[9px] font-mono font-bold border ${y ? `${n.border} ${n.text}` : "border-neutral-800 text-neutral-800"}`}
              style={y ? { boxShadow: n.shadow } : {}}>
              {y ? `${y.toFixed(1)}` : "—"}
            </div>
            <div className="text-[8px] text-neutral-800 mt-0.5">{String(year).slice(2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Variant 17: GLASSMORPHISM ─────────────────────────────────────────────────
// Frosted-glass kaarten op gradient achtergrond.
function V17Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "", br: "border-neutral-700/40", glow: "", letter: "?" };
  const ny = netYield(s);
  const hist = divHist(s);
  return (
    <div className="rounded-2xl overflow-hidden border border-white/10"
      style={{ background: "rgba(255,255,255,0.04)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
               className="font-mono font-bold text-sm text-white/90">{s.ticker}</a>
            <div className="text-[11px] text-white/40 truncate max-w-[180px]">{s.company}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <SeenCell ticker={s.ticker} />
            <HeartCell ticker={s.ticker} />
            {s.risk_label && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border border-white/10 ${rc.t}`}
                style={{ background: "rgba(255,255,255,0.06)" }}>{s.risk_label}</span>
            )}
          </div>
        </div>
        <div className="flex gap-4">
          <div>
            <div className="text-3xl font-black tabular-nums text-white">{fmtPct(s.dividend_yield_pct)}</div>
            <div className="text-[10px] text-white/30 mt-0.5">bruto</div>
          </div>
          <div className="border-l border-white/10 pl-4">
            <div className="text-3xl font-black tabular-nums text-white/60">{fmtPct(ny)}</div>
            <div className="text-[10px] text-white/30 mt-0.5">netto</div>
          </div>
        </div>
      </div>
      <div className="border-t border-white/8 px-4 py-3 flex gap-1">
        {hist.map(({ year, y }) => (
          <div key={year} className="flex-1 flex flex-col items-center gap-0.5">
            <div className="w-full rounded py-1 text-center text-[9px] font-bold"
              style={{ background: y ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.04)", color: y ? "rgb(110,231,183)" : "rgba(255,255,255,0.15)" }}>
              {y ? `${y.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[8px] text-white/20">{year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Variant 18: CHIP + DETAIL PANEL ──────────────────────────────────────────
// Compacte chips bovenaan. Tik op chip → detail-paneel opent eronder.
function V18({ stocks }: { stocks: ZwitserlevenStock[] }) {
  const [sel, setSel] = useState<string | null>(stocks[0]?.ticker ?? null);
  const s = stocks.find(x => x.ticker === sel);
  const rc = s ? (RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800", br: "border-neutral-700", glow: "", letter: "?" }) : null;
  return (
    <div className="space-y-3">
      {/* Chip-rij */}
      <div className="flex flex-wrap gap-1.5">
        {stocks.map(x => {
          const r = RC[x.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800/40", br: "border-neutral-600", glow: "", letter: "?" };
          const active = sel === x.ticker;
          return (
            <button key={x.ticker} onClick={() => setSel(x.ticker)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all ${active ? `${r.b} ${r.br} ${r.t} scale-105` : "bg-ink-3/50 border-ink-5 text-neutral-500"}`}>
              {x.ticker.replace(/\..+/, "")}
              <span className="ml-1 tabular-nums font-black">{fmtPct(x.dividend_yield_pct, 0)}</span>
            </button>
          );
        })}
      </div>
      {/* Detail panel */}
      {s && rc && (
        <div className={`bg-ink-2 border ${rc.br} rounded-2xl overflow-hidden`}>
          <div className={`${rc.b} px-4 py-3 flex items-center justify-between`}>
            <div>
              <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
                 className="font-mono font-black text-lg tab-accent-text">{s.ticker}</a>
              <div className="text-xs text-neutral-400">{s.company} · {s.exchange}</div>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-black tabular-nums text-emerald-300`}>{fmtPct(s.dividend_yield_pct)}</div>
              {s.risk_label && <div className={`text-xs font-bold ${rc.t}`}>{s.risk_label}</div>}
            </div>
          </div>
          <div className="px-4 py-3 space-y-3">
            <TickerSparkline ticker={s.ticker} width={300} height={44} />
            <div className="flex gap-1">
              {divHist(s).map(({ year, y }) => (
                <div key={year} className="flex-1 text-center">
                  <div className={`py-1 rounded text-[9px] font-bold ${y ? "bg-emerald-500/20 text-emerald-300" : "bg-ink-4 text-neutral-700"}`}>{y ? `${y.toFixed(1)}%` : "—"}</div>
                  <div className="text-[8px] text-neutral-700 mt-0.5">{year}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["Netto yield", fmtPct(netYield(s))],
                ["−5j hoog", fmtPct(s.pct_under_5y_high)],
                ["Cuts/5j", String(s.dividend_cuts_5y ?? "—")],
              ].map(([label, val]) => (
                <div key={label} className="bg-ink-3/60 rounded-lg py-2">
                  <div className="text-[9px] text-neutral-600">{label}</div>
                  <div className="text-sm font-bold text-neutral-200 tabular-nums">{val}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /><StarCell ticker={s.ticker} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Variant 19: PRIJSLABEL / STICKER ─────────────────────────────────────────
// Elk aandeel als een uitverkoop-prijslabel. Grote yield in label-vorm.
function V19Card({ s }: { s: ZwitserlevenStock }) {
  const rc = RC[s.risk_label ?? ""] ?? { t: "text-neutral-400", b: "bg-neutral-800/40", br: "border-neutral-700", glow: "", letter: "?" };
  const hist = divHist(s);
  const paid = hist.filter(h => h.y).length;
  return (
    <div className={`relative bg-ink-2 border-2 ${rc.br} rounded-2xl rounded-tl-none overflow-hidden`}>
      {/* Lipje linksboven */}
      <div className={`absolute -top-0 -left-0 w-14 h-14 ${rc.b} border-r-2 border-b-2 ${rc.br} rounded-br-2xl flex items-center justify-center`}>
        <div className="w-3 h-3 rounded-full border-2 border-neutral-600 bg-ink-2" />
      </div>
      <div className="pl-16 pr-3 pt-2 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
               className="font-mono font-bold text-xs text-neutral-400">{s.ticker}</a>
            <div className="text-xs text-neutral-500 truncate max-w-[140px]">{s.company}</div>
          </div>
          <div className="flex gap-1 shrink-0"><HeartCell ticker={s.ticker} /></div>
        </div>
      </div>
      {/* Yield groot */}
      <div className={`mx-3 mb-2 ${rc.b} rounded-xl px-3 py-2 text-center`}>
        <div className={`text-4xl font-black tabular-nums ${rc.t} leading-none`}>{fmtPct(s.dividend_yield_pct)}</div>
        <div className="text-[10px] text-neutral-500 mt-0.5">bruto dividend / jaar</div>
      </div>
      {/* Barcode-achtig: jaar-streepjes */}
      <div className="mx-3 mb-2 flex gap-0.5 items-end h-8">
        {hist.map(({ year, y }) => (
          <div key={year} className={`flex-1 rounded-sm ${y ? rc.br.replace("border-", "bg-").replace("/50", "/60") : "bg-neutral-800"}`}
            style={{ height: y ? `${Math.max(40, (y / 12) * 100)}%` : "20%" }} />
        ))}
      </div>
      <div className="mx-3 mb-2 flex justify-between text-[8px] text-neutral-700 font-mono">
        {hist.map(({ year }) => <span key={year}>{year}</span>)}
        <span className={`font-bold ${rc.t}`}>{paid}/5 jr</span>
      </div>
    </div>
  );
}

// ── Variant 20: RAPPORT ───────────────────────────────────────────────────────
// Schoolrapport: letter-cijfer (A/B/C/D), vakken als kolommen, rood/groen.
function grade(s: ZwitserlevenStock): { letter: string; color: string; sub: string } {
  const y = s.dividend_yield_pct ?? 0;
  const risk = s.risk_label ?? "";
  if (y >= 10 && risk === "Laag") return { letter: "A+", color: "text-emerald-300 bg-emerald-500/20", sub: "Uitstekend" };
  if (y >= 8  && (risk === "Laag" || risk === "Matig")) return { letter: "A", color: "text-emerald-400 bg-emerald-500/15", sub: "Zeer goed" };
  if (y >= 6.5 && risk !== "Zeer hoog") return { letter: "B", color: "text-yellow-400 bg-yellow-500/15", sub: "Goed" };
  if (risk === "Hoog") return { letter: "C", color: "text-orange-400 bg-orange-500/15", sub: "Voldoende" };
  return { letter: "D", color: "text-red-400 bg-red-500/15", sub: "Onvoldoende" };
}
function V20Card({ s }: { s: ZwitserlevenStock }) {
  const g = grade(s);
  const hist = divHist(s);
  const ny = netYield(s);
  const cols: { label: string; val: string | number; good: boolean | null }[] = [
    { label: "Div. bruto",   val: fmtPct(s.dividend_yield_pct),  good: (s.dividend_yield_pct ?? 0) >= 8 },
    { label: "Div. netto",   val: fmtPct(ny),                    good: (ny ?? 0) >= 5 },
    { label: "Val v 5j-hoog",val: fmtPct(s.pct_under_5y_high),   good: (s.pct_under_5y_high ?? 0) >= 50 },
    { label: "Div. cuts/5j", val: s.dividend_cuts_5y ?? "—",     good: s.dividend_cuts_5y === 0 },
    { label: "Groeijaren",   val: s.years_5pct_growth_5y ?? "—", good: (s.years_5pct_growth_5y ?? 0) >= 2 },
    { label: "Payout ratio", val: s.payout_ratio != null ? `${Math.round(s.payout_ratio * 100)}%` : "—", good: s.payout_ratio != null ? s.payout_ratio < 0.85 : null },
  ];
  return (
    <div className="bg-ink-2 border border-ink-5 rounded-xl overflow-hidden">
      {/* Rapport-header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-5 bg-ink-3/40">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-black shrink-0 ${g.color}`}>{g.letter}</div>
        <div className="flex-1 min-w-0">
          <a href={googleFinanceUrl(s.ticker, s.exchange)} target="_blank" rel="noopener noreferrer"
             className="font-mono font-bold text-sm text-neutral-200">{s.ticker}</a>
          <div className="text-xs text-neutral-500 truncate">{s.company}</div>
          <div className={`text-[10px] font-semibold mt-0.5 ${g.color.split(" ")[0]}`}>{g.sub} · {s.risk_label ?? "?"}</div>
        </div>
        <div className="flex gap-1 shrink-0"><SeenCell ticker={s.ticker} /><HeartCell ticker={s.ticker} /></div>
      </div>
      {/* Rapporttabel */}
      <div className="divide-y divide-ink-5/50">
        {cols.map(c => (
          <div key={c.label} className="flex items-center px-4 py-1.5">
            <span className="flex-1 text-xs text-neutral-500">{c.label}</span>
            <span className={`text-xs font-bold tabular-nums ${c.good === true ? "text-emerald-400" : c.good === false ? "text-red-400" : "text-neutral-400"}`}>
              {c.good === true ? "✓ " : c.good === false ? "✗ " : ""}{c.val}
            </span>
          </div>
        ))}
      </div>
      {/* Jaar history footer */}
      <div className="flex gap-1 px-4 py-2.5 bg-ink-3/30">
        {hist.map(({ year, y }) => (
          <div key={year} className="flex-1 text-center">
            <div className={`text-[9px] py-0.5 rounded ${y ? "text-emerald-400 bg-emerald-500/15" : "text-neutral-700"}`}>
              {y ? `${y.toFixed(1)}%` : "—"}
            </div>
            <div className="text-[8px] text-neutral-700">{year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Labels ───────────────────────────────────────────────────────────────────
const VARIANT_INFO = [
  { n: 11, label: "Swipe-deck",  desc: "Gestapelde kaarten met stack-effect, één tegelijk — Tinder-stijl" },
  { n: 12, label: "Heatmap",    desc: "Kleur-intensiteit = yield, tik op cel voor detail-overlay" },
  { n: 13, label: "Podium",     desc: "Top-3 op goud/zilver/brons podium, rest in lijst" },
  { n: 14, label: "Social feed", desc: "Elk aandeel als een social-media bericht in een feed" },
  { n: 15, label: "Metro tiles", desc: "Windows-stijl tegels van wisselende breedte" },
  { n: 16, label: "Neon/glow",  desc: "Cyberpunk: gloeiende randen per risico-kleur op zwarte achtergrond" },
  { n: 17, label: "Glass",      desc: "Frosted-glass kaarten met backdrop-blur" },
  { n: 18, label: "Chip+panel", desc: "Compacte chips bovenaan, tik → volledig detail-paneel" },
  { n: 19, label: "Prijslabel", desc: "Elk aandeel als een uitverkoop-sticker / prijslabel" },
  { n: 20, label: "Rapport",    desc: "Schoolrapport-stijl met lettercijifers A+/A/B/C/D" },
];

// ── Hoofdview ─────────────────────────────────────────────────────────────────
export function ZwitserlevenProto3View() {
  const [variant, setVariant] = useState(11);
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
        <div className="text-xs text-neutral-400 font-semibold uppercase tracking-wide">Kies variant (set 3 · 11–20)</div>
        <div className="flex gap-1.5 flex-wrap">
          {VARIANT_INFO.map(v => (
            <button key={v.n} onClick={() => setVariant(v.n)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                variant === v.n ? "bg-emerald-500/20 border-emerald-500 text-emerald-300" : "bg-ink-3/50 border-ink-5 text-neutral-400 hover:text-neutral-200"
              }`}>
              {v.n}·{v.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-neutral-500">{VARIANT_INFO.find(v => v.n === variant)?.desc}</div>
      </div>
      <div className="text-xs text-neutral-500">{visible.length} aandelen · alleen "voldoet aan criteria"</div>
      {loading && <div className="text-sm text-neutral-500 text-center py-10">Laden…</div>}
      {!loading && visible.length === 0 && <div className="text-sm text-neutral-500 text-center py-10">Geen aandelen gevonden.</div>}

      {variant === 11 && !loading && <V11 stocks={visible} />}
      {variant === 12 && !loading && <V12 stocks={visible} />}
      {variant === 13 && !loading && <V13 stocks={visible} />}
      {variant === 14 && !loading && <div className="space-y-3">{visible.map(s => <V14Card key={s.ticker} s={s} />)}</div>}
      {variant === 15 && !loading && <V15 stocks={visible} />}
      {variant === 16 && !loading && (
        <div className="space-y-2 bg-black/60 rounded-xl p-2">
          {visible.map(s => <V16Card key={s.ticker} s={s} />)}
        </div>
      )}
      {variant === 17 && !loading && (
        <div className="space-y-2 rounded-xl p-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)" }}>
          {visible.map(s => <V17Card key={s.ticker} s={s} />)}
        </div>
      )}
      {variant === 18 && !loading && <V18 stocks={visible} />}
      {variant === 19 && !loading && <div className="space-y-3">{visible.map(s => <V19Card key={s.ticker} s={s} />)}</div>}
      {variant === 20 && !loading && <div className="space-y-3">{visible.map(s => <V20Card key={s.ticker} s={s} />)}</div>}
    </div>
  );
}
