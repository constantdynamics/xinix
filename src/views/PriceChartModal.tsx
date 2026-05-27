import { useEffect, useMemo, useState } from "react";
import { fetchPriceHistory, type PriceHistory, type PriceRange } from "../api";
import { googleFinanceUrl } from "../tickerLinks";
import { computeTop3Swings } from "../chartUtils";

interface Props {
  ticker: string;
  company: string;
  exchange: string | null;
  onClose: () => void;
}

const RANGES: { key: PriceRange; label: string; full: string }[] = [
  { key: "1d", label: "1D", full: "1 dag" },
  { key: "5d", label: "1W", full: "1 week" },
  { key: "1mo", label: "1M", full: "1 maand" },
  { key: "1y", label: "1J", full: "1 jaar" },
  { key: "5y", label: "5J", full: "5 jaar" },
  { key: "max", label: "Max", full: "maximaal" },
];

// Grafiek-geometrie (SVG viewBox-coördinaten — schaalt mee met de container).
const W = 760;
const H = 406;
const PAD = { l: 68, r: 16, t: 96, b: 36 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;
// Label-rijen boven de grafiek (in SVG-coördinaten)
const ROW1 = 22;  // piek (groen)
const ROW2 = 56;  // verschil (wit)
const ROW3 = 88;  // low (rood)

const GAIN = "#1ae85a";
const LOSS = "#ff1a1a";

function fmtPrice(v: number): string {
  if (v < 1) return v.toFixed(4);
  if (v < 10) return v.toFixed(3);
  return v.toFixed(2);
}

function fmtAxisDate(unixSec: number, range: PriceRange): string {
  const d = new Date(unixSec * 1000);
  if (range === "1d") return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (range === "5d") return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" });
  if (range === "1mo") return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  if (range === "1y") return d.toLocaleDateString("nl-NL", { month: "short" });
  return String(d.getFullYear());
}

function fmtTipDate(unixSec: number, range: PriceRange): string {
  const d = new Date(unixSec * 1000);
  if (range === "1d" || range === "5d")
    return d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export function PriceChartModal({ ticker, company, exchange, onClose }: Props) {
  const [range, setRange] = useState<PriceRange>("1y");
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [shownSwings, setShownSwings] = useState<Set<number>>(new Set([0]));

  useEffect(() => { setShownSwings(new Set([0])); }, [ticker, range]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHoverIdx(null);
    fetchPriceHistory(ticker, range)
      .then((h) => { if (!cancelled) setHistory(h); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, range]);

  // Afgeleide grafiekdata: schalen, paden, referentie en verandering.
  const chart = useMemo(() => {
    const pts = history?.points ?? [];
    if (pts.length < 2) return null;
    const n = pts.length;
    const closes = pts.map((p) => p.c);
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (min === max) { const d = Math.abs(min) * 0.05 || 1; min -= d; max += d; }
    const span = max - min;
    const pad = span * 0.08;
    // Een koers kan nooit negatief zijn — de y-as mag dus niet onder 0 zakken.
    const lo = Math.max(0, min - pad);
    const hi = max + pad;
    const x = (i: number) => PAD.l + (i / (n - 1)) * PLOT_W;
    const y = (c: number) => PAD.t + (1 - (c - lo) / (hi - lo)) * PLOT_H;
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
    const area = `${line} L${x(n - 1).toFixed(1)},${(PAD.t + PLOT_H).toFixed(1)} L${x(0).toFixed(1)},${(PAD.t + PLOT_H).toFixed(1)} Z`;
    const first = pts[0].c;
    const last = pts[n - 1].c;
    const change = last - first;
    const changePct = first !== 0 ? (change / first) * 100 : 0;
    const up = change >= 0;
    // Y-as gridlijnen op 4 niveaus.
    const ticks = [0, 1, 2, 3].map((k) => {
      const c = lo + (hi - lo) * (k / 3);
      return { c, y: y(c) };
    });
    // X-as labels — ~5 gelijkmatig verdeelde punten.
    const labelCount = Math.min(5, n);
    const xLabels = Array.from({ length: labelCount }, (_, k) => {
      const i = Math.round((k / (labelCount - 1)) * (n - 1));
      return { i, x: x(i), text: fmtAxisDate(pts[i].t, range) };
    });
    return { pts, n, x, y, line, area, first, last, change, changePct, up, ticks, xLabels, refY: y(first), closes };
  }, [history, range]);

  const top3 = useMemo(() => {
    if (!chart) return [];
    return computeTop3Swings(chart.closes, chart.pts, range);
  }, [chart, range]);

  const lineColor = chart ? (chart.up ? GAIN : LOSS) : GAIN;
  const gradId = `chart-grad-${ticker.replace(/[^A-Za-z0-9]/g, "")}`;
  const priceNow = chart ? chart.last : history?.market_price ?? null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!chart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (vbX - PAD.l) / PLOT_W;
    const idx = Math.round(frac * (chart.n - 1));
    setHoverIdx(Math.max(0, Math.min(chart.n - 1, idx)));
  }

  const hover = chart && hoverIdx != null ? chart.pts[hoverIdx] : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-up"
      onClick={onClose}
    >
      <div
        className="bg-ink-2 border border-ink-5 rounded-2xl max-w-3xl w-full shadow-glow"
        style={{ borderColor: "color-mix(in srgb, var(--tab-accent, #ff1f8f) 35%, #262626)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kop: bedrijfsnaam + ticker-link + actuele koers/verandering */}
        <div className="p-5 border-b border-ink-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-100 truncate" title={company}>{company}</h2>
            <p className="text-xs text-neutral-500 mt-1 flex items-center gap-2 flex-wrap">
              <a
                href={googleFinanceUrl(ticker, exchange)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono font-semibold tab-accent-text hover:underline"
                title={`Open ${ticker} op Google Finance`}
              >
                {ticker}
              </a>
              {history?.exchange && <span className="text-neutral-600">{history.exchange}</span>}
            </p>
          </div>
          <div className="flex items-start gap-3">
            {priceNow != null && (
              <div className="text-right">
                <div className="font-mono text-xl font-bold text-neutral-100 tabular-nums leading-none">
                  {history?.currency && history.currency !== "USD" ? "" : "$"}{fmtPrice(priceNow)}
                </div>
                {chart && (
                  <div
                    className="font-mono text-xs font-semibold tabular-nums mt-1"
                    style={{ color: lineColor }}
                  >
                    {chart.up ? "+" : ""}{fmtPrice(chart.change)} ({chart.up ? "+" : ""}{chart.changePct.toFixed(2)}%)
                  </div>
                )}
              </div>
            )}
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-lg hover:bg-ink-3 text-neutral-400 hover:text-fog-pink transition flex items-center justify-center shrink-0"
              title="Sluiten"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Venster-kiezer */}
        <div className="px-5 pt-4 flex items-center gap-2 flex-wrap">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              title={r.full}
              className={
                "px-4 py-1.5 rounded-full text-sm font-bold border transition-colors " +
                (range === r.key
                  ? "text-white"
                  : "border-ink-5 text-white hover:text-neutral-200")
              }
              style={range === r.key
                ? { borderColor: "var(--tab-accent, #ff1f8f)", background: "color-mix(in srgb, var(--tab-accent, #ff1f8f) 22%, transparent)" }
                : undefined}
            >
              {r.label}
            </button>
          ))}
          {loading && <span className="text-xs text-neutral-500 ml-1 animate-pulse">laden…</span>}
        </div>

        {/* Schakelknoppen voor top-3 stijgingen */}
        {top3.length > 0 && (
          <div className="px-5 pt-2 flex gap-2 flex-wrap">
            {top3.map((sw, si) => (
              <button
                key={si}
                onClick={() => setShownSwings((prev) => {
                  const next = new Set(prev);
                  next.has(si) ? next.delete(si) : next.add(si);
                  return next;
                })}
                className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                  shownSwings.has(si)
                    ? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10"
                    : "border-ink-5 text-neutral-500 hover:text-neutral-300"
                }`}
              >
                #{si + 1} +{sw.pct.toFixed(0)}%
              </button>
            ))}
          </div>
        )}

        {/* Grafiek */}
        <div className="p-5 pt-3">
          <div className="relative">
            {error ? (
              <div className="h-[406px] flex items-center justify-center text-sm text-fog-loss text-center px-6">
                Koersdata niet beschikbaar.<br />
                <span className="text-neutral-500 text-xs">{error}</span>
              </div>
            ) : !chart ? (
              <div className="h-[406px] flex items-center justify-center text-sm text-neutral-500">
                {loading ? "Koersgrafiek laden…" : "Te weinig koersdata voor dit venster."}
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className={"w-full block transition-opacity " + (loading ? "opacity-50" : "opacity-100")}
                onMouseMove={handleMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity="0.32" />
                    <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Y-gridlijnen + prijslabels */}
                {chart.ticks.map((t, k) => (
                  <g key={k}>
                    <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="#262626" strokeWidth="1" />
                    <text x={PAD.l - 8} y={t.y + 5} textAnchor="end" fontSize="14" fontWeight="700" fill="#ffffff" fontFamily="JetBrains Mono, monospace">
                      {fmtPrice(t.c)}
                    </text>
                  </g>
                ))}

                {/* X-as datumlabels */}
                {chart.xLabels.map((l, k) => (
                  <text key={k} x={l.x} y={H - 6} textAnchor={k === 0 ? "start" : k === chart.xLabels.length - 1 ? "end" : "middle"} fontSize="14" fontWeight="700" fill="#ffffff">
                    {l.text}
                  </text>
                ))}

                {/* Referentielijn (begin van het venster) */}
                <line x1={PAD.l} y1={chart.refY} x2={W - PAD.r} y2={chart.refY} stroke="#404040" strokeWidth="1" strokeDasharray="3 3" />

                {/* Vlak + lijn */}
                <path d={chart.area} fill={`url(#${gradId})`} />
                <path d={chart.line} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

                {/* Top-3 stijgingen: ROW1=piek, ROW2=verschil, ROW3=low */}
                {top3.map((sw, si) => {
                  if (!shownSwings.has(si)) return null;
                  const lxn = Math.min(Math.max(chart.x(sw.lowIdx), PAD.l + 28), W - PAD.r - 28);
                  const hxn = Math.min(Math.max(chart.x(sw.highIdx), PAD.l + 28), W - PAD.r - 28);
                  const lyn = chart.y(chart.closes[sw.lowIdx]);
                  const hyn = chart.y(chart.closes[sw.highIdx]);
                  const midX = Math.min(Math.max((lxn + hxn) / 2, PAD.l + 50), W - PAD.r - 50);
                  return (
                    <g key={si}>
                      <line x1={hxn} y1={hyn} x2={hxn} y2={PAD.t} stroke="#44dd88" strokeWidth="1.2" strokeOpacity="0.45" strokeDasharray="3,5" />
                      <circle cx={hxn} cy={hyn} r="5" fill="#44dd88" stroke="#111" strokeWidth="2" />
                      <text x={hxn} y={ROW1} textAnchor="middle" fill="#44dd88" fontSize="18" fontFamily="monospace" fontWeight="bold">
                        {"$" + fmtPrice(chart.closes[sw.highIdx])}
                      </text>
                      <text x={midX} y={ROW2} textAnchor="middle" fill="#ffffff" fontSize="16" fontFamily="monospace">
                        {"+" + sw.pct.toFixed(0) + "% in " + sw.dur}
                      </text>
                      <line x1={lxn} y1={lyn} x2={lxn} y2={PAD.t} stroke="#ff5555" strokeWidth="1.2" strokeOpacity="0.45" strokeDasharray="3,5" />
                      <circle cx={lxn} cy={lyn} r="5" fill="#ff5555" stroke="#111" strokeWidth="2" />
                      <text x={lxn} y={ROW3} textAnchor="middle" fill="#ff5555" fontSize="18" fontFamily="monospace" fontWeight="bold">
                        {"$" + fmtPrice(chart.closes[sw.lowIdx])}
                      </text>
                    </g>
                  );
                })}

                {/* Hover-crosshair */}
                {hover && hoverIdx != null && (
                  <g>
                    <line x1={chart.x(hoverIdx)} y1={PAD.t} x2={chart.x(hoverIdx)} y2={PAD.t + PLOT_H} stroke="var(--tab-accent, #ff1f8f)" strokeWidth="1" strokeDasharray="2 2" />
                    <circle cx={chart.x(hoverIdx)} cy={chart.y(hover.c)} r="3.5" fill={lineColor} stroke="#101010" strokeWidth="1.5" />
                    {(() => {
                      const lw = 170;
                      const lx = Math.max(PAD.l, Math.min(W - PAD.r - lw, chart.x(hoverIdx) - lw / 2));
                      return (
                        <g transform={`translate(${lx.toFixed(1)}, ${PAD.t})`}>
                          <rect width={lw} height="42" rx="6" fill="#1c1c1c" stroke="#404040" strokeWidth="1" />
                          <text x="10" y="17" fontSize="12" fontWeight="700" fill="#ffffff">{fmtTipDate(hover.t, range)}</text>
                          <text x="10" y="34" fontSize="15" fontWeight="bold" fill="#ffffff" fontFamily="JetBrains Mono, monospace">
                            {fmtPrice(hover.c)}
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                )}
              </svg>
            )}
          </div>
          <p className="text-[10px] text-neutral-600 mt-2 text-center">
            Koersdata via Yahoo Finance · klik op de ticker voor Google Finance
          </p>
        </div>
      </div>
    </div>
  );
}
