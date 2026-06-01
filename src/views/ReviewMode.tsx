// ReviewMode — swipe-door-beoordeling van aandelen per lijst.
// Knop rechtsboven in de header → stap 1: lijstkeuze → stap 2: één voor één beoordelen.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  fetchPriceHistory,
  type ScanResults,
  type ZwitserlevenResults,
} from "../api";
import type { Dashboard } from "../types";
import { computeTop3Swings } from "../chartUtils";
import { googleFinanceUrl } from "../tickerLinks";
import { useMarks } from "../hooks/useMarks";
import { GradientTabIcon } from "../tabIcons";

// ── Chart helper ──────────────────────────────────────────────────────────────

type ChartRange = "1d" | "5d" | "1mo" | "6mo" | "1y" | "3y" | "5y" | "max";

const RANGE_OPTS: { key: ChartRange; label: string }[] = [
  { key: "1d",  label: "1D" },
  { key: "5d",  label: "1W" },
  { key: "1mo", label: "1M" },
  { key: "6mo", label: "6M" },
  { key: "1y",  label: "1J" },
  { key: "3y",  label: "3J" },
  { key: "5y",  label: "5J" },
  { key: "max", label: "Max" },
];

const RANGE_LABELS: Record<ChartRange, string> = {
  "1d": "1 dag", "5d": "1 week", "1mo": "1 mnd", "6mo": "6 mnd",
  "1y": "1 jaar", "3y": "3 jaar", "5y": "5 jaar", "max": "max",
};

function fmtYLabel(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100)  return v.toFixed(0);
  if (v >= 10)   return v.toFixed(1);
  return v.toFixed(2);
}

function fmtXLabel(ts: number, range: ChartRange): string {
  const d = new Date(ts * 1000);
  if (range === "1d") {
    return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "5d") {
    return d.toLocaleDateString("nl-NL", { weekday: "short" });
  }
  if (range === "1mo" || range === "6mo") {
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  }
  if (range === "1y") {
    return d.toLocaleDateString("nl-NL", { month: "short" });
  }
  return d.toLocaleDateString("nl-NL", { month: "short", year: "2-digit" });
}


function ReviewChart({ ticker, exchange }: { ticker: string; exchange: string | null }) {
  const [range, setRange] = useState<ChartRange>("1y");
  const [pts, setPts] = useState<{ t: number; c: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [shownSwings, setShownSwings] = useState<Set<number>>(new Set([0]));
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { setShownSwings(new Set([0])); }, [ticker, range]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPts([]);
    setHoverIdx(null);
    fetchPriceHistory(ticker, range)
      .then((h) => { if (!cancelled) setPts(h.points ?? []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, range]);

  // SVG layout constants
  const W = 560;
  const H = 232;
  const PAD = { l: 50, r: 6, t: 64, b: 30 };
  const ROW1 = 17;  // piek (high, groen)
  const ROW2 = 37;  // verschil (groei %, wit)
  const ROW3 = 57;  // low (rood)
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;

  const periodLabel = RANGE_LABELS[range];

  function idxFromClientX(clientX: number): number {
    if (!svgRef.current || pts.length < 2) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const fraction = Math.max(0, Math.min(1, (svgX - PAD.l) / PW));
    return Math.round(fraction * (pts.length - 1));
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    setHoverIdx(idxFromClientX(e.clientX));
  }

  function handleTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    e.preventDefault(); // voorkom scrollen terwijl je over de grafiek sleept
    if (e.touches.length > 0) setHoverIdx(idxFromClientX(e.touches[0].clientX));
  }

  function handleTouchStart(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length > 0) setHoverIdx(idxFromClientX(e.touches[0].clientX));
  }

  function chartBody() {
    if (loading) {
      return (
        <div className="w-full flex items-center justify-center text-[11px] text-neutral-600 animate-pulse" style={{ height: "15rem" }}>
          grafiek laden…
        </div>
      );
    }
    if (pts.length < 2) {
      return (
        <div className="w-full flex items-center justify-center text-[11px] text-neutral-600" style={{ height: "15rem" }}>
          geen koersdata
        </div>
      );
    }

    const closes = pts.map((p) => p.c);
    const lo = Math.min(...closes);
    const hi = Math.max(...closes);
    const span = hi - lo || lo * 0.01 || 1;
    const up = closes[closes.length - 1] >= closes[0];
    const color = up ? "#1ae85a" : "#ff1a1a";

    // Bij hover: change t.o.v. begin van periode; anders: totale periode-change
    const baseClose = closes[0];
    const displayClose = hoverIdx !== null ? closes[hoverIdx] : closes[closes.length - 1];
    const changePct = baseClose !== 0 ? ((displayClose - baseClose) / baseClose) * 100 : 0;
    const changeUp = displayClose >= baseClose;
    const changeColor = changeUp ? "#1ae85a" : "#ff1a1a";

    const cx = (i: number) => PAD.l + (i / (pts.length - 1)) * PW;
    const cy = (c: number) => PAD.t + (1 - (c - lo) / span) * PH;

    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${cy(p.c).toFixed(1)}`).join(" ");
    const area = `${line} L${cx(pts.length - 1).toFixed(1)},${(PAD.t + PH).toFixed(1)} L${cx(0).toFixed(1)},${(PAD.t + PH).toFixed(1)} Z`;

    // Y-as: 4 niveaus
    const yTicks = Array.from({ length: 4 }, (_, i) => lo + (span * i) / 3);
    // X-as: 5 labels
    const xTicks = Array.from({ length: 5 }, (_, i) => Math.round(i * (pts.length - 1) / 4));

    // Top-3 stijgingen (low→high, gesorteerd op %)
    const top3 = computeTop3Swings(closes, pts, range);

    // Hover punt
    const hPt = hoverIdx !== null ? pts[hoverIdx] : null;
    const hx = hPt ? cx(hoverIdx!) : null;
    const hy = hPt ? cy(hPt.c) : null;

    // Tooltip positie: links of rechts van het bolletje
    const tooltipLeft = hoverIdx !== null && hoverIdx > pts.length * 0.65;

    const gfUrl = googleFinanceUrl(ticker, exchange);

    return (
      <>
        {/* Schakelknoppen voor top-3 stijgingen */}
        {top3.length > 0 && (
          <div className="flex gap-1 justify-center mb-1">
            {top3.map((sw, si) => (
              <button
                key={si}
                onClick={() => setShownSwings((prev) => {
                  const next = new Set(prev);
                  next.has(si) ? next.delete(si) : next.add(si);
                  return next;
                })}
                className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors border ${
                  shownSwings.has(si)
                    ? "bg-neutral-200/10 text-fog-lime border-fog-lime/40"
                    : "text-neutral-500 border-ink-5 hover:text-neutral-300"
                }`}
              >
                #{si + 1} +{sw.pct.toFixed(0)}%
              </button>
            ))}
          </div>
        )}
        <div className="relative w-full">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full block cursor-crosshair touch-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={`cg-${ticker}-${range}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Horizontale gridlines + Y-labels */}
            {yTicks.map((v, i) => {
              const yy = cy(v).toFixed(1);
              return (
                <g key={i}>
                  <line x1={PAD.l} y1={yy} x2={W - PAD.r} y2={yy} stroke="#ffffff" strokeOpacity="0.07" strokeWidth="1" strokeDasharray="3,4" />
                  <text x={PAD.l - 4} y={yy} textAnchor="end" dominantBaseline="middle" fill="#ccc" fontSize="13" fontFamily="monospace">
                    {fmtYLabel(v)}
                  </text>
                </g>
              );
            })}

            {/* Koerslijn + area */}
            <path d={area} fill={`url(#cg-${ticker}-${range})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

            {/* X-as lijn */}
            <line x1={PAD.l} y1={PAD.t + PH} x2={W - PAD.r} y2={PAD.t + PH} stroke="#ffffff" strokeOpacity="0.1" strokeWidth="1" />

            {/* X-as labels */}
            {xTicks.map((idx) => (
              <text key={idx} x={cx(idx).toFixed(1)} y={H - 5} textAnchor="middle" fill="#ccc" fontSize="13" fontFamily="sans-serif">
                {fmtXLabel(pts[idx].t, range)}
              </text>
            ))}

            {/* Top-3 stijgingen: elk met low-dot, high-dot, stippellijnen en labels */}
            {top3.map((sw, si) => {
              if (!shownSwings.has(si)) return null;
              const lxn = Math.min(Math.max(cx(sw.lowIdx), PAD.l + 20), W - PAD.r - 20);
              const hxn = Math.min(Math.max(cx(sw.highIdx), PAD.l + 20), W - PAD.r - 20);
              const lyn = cy(closes[sw.lowIdx]);
              const hyn = cy(closes[sw.highIdx]);
              const midX = Math.min(Math.max((lxn + hxn) / 2, PAD.l + 36), W - PAD.r - 36);
              return (
                <g key={si}>
                  {/* ROW1: piek (high, groen) */}
                  <line x1={hxn} y1={hyn} x2={hxn} y2={PAD.t} stroke="#44dd88" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="2,4" />
                  <circle cx={hxn} cy={hyn} r="4" fill="#44dd88" stroke="#111" strokeWidth="1.5" />
                  <text x={hxn} y={ROW1} textAnchor="middle" fill="#44dd88" fontSize="16" fontFamily="monospace" fontWeight="bold">
                    {"$" + fmtYLabel(closes[sw.highIdx])}
                  </text>
                  {/* ROW2: verschil (groei %, gecentreerd) */}
                  <text x={midX} y={ROW2} textAnchor="middle" fill="#ffffff" fontSize="14" fontFamily="monospace">
                    {"+" + sw.pct.toFixed(0) + "% in " + sw.dur}
                  </text>
                  {/* ROW3: low (rood) */}
                  <line x1={lxn} y1={lyn} x2={lxn} y2={PAD.t} stroke="#ff5555" strokeWidth="1" strokeOpacity="0.45" strokeDasharray="2,4" />
                  <circle cx={lxn} cy={lyn} r="4" fill="#ff5555" stroke="#111" strokeWidth="1.5" />
                  <text x={lxn} y={ROW3} textAnchor="middle" fill="#ff5555" fontSize="16" fontFamily="monospace" fontWeight="bold">
                    {"$" + fmtYLabel(closes[sw.lowIdx])}
                  </text>
                </g>
              );
            })}

            {/* Hover: verticale lijn + bolletje + tooltip */}
            {hPt && hx !== null && hy !== null && (
              <g>
                <line x1={hx} y1={PAD.t} x2={hx} y2={PAD.t + PH} stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="2,3" />
                <circle cx={hx} cy={hy} r="4" fill={color} stroke="#1a1a1a" strokeWidth="1.5" />
                {/* Tooltip box */}
                <g transform={`translate(${tooltipLeft ? hx - 8 : hx + 8},${Math.min(hy - 18, PAD.t + PH - 38)})`}>
                  <rect
                    x={tooltipLeft ? -86 : 0}
                    y="0"
                    width="86"
                    height="36"
                    rx="4"
                    fill="#111"
                    stroke="#444"
                    strokeWidth="1"
                  />
                  <text
                    x={tooltipLeft ? -43 : 43}
                    y="14"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="12"
                    fontFamily="sans-serif"
                  >
                    {fmtXLabel(hPt.t, range)}
                  </text>
                  <text
                    x={tooltipLeft ? -43 : 43}
                    y="30"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="15"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    {fmtYLabel(hPt.c)}
                  </text>
                </g>
              </g>
            )}
          </svg>

          {/* Google Finance link — apart van de SVG zodat hover niet interfereert */}
          <a
            href={gfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-1 right-1 text-[9px] text-neutral-600 hover:text-fog-lime transition-colors"
            title={`Open ${ticker} op Google Finance`}
          >
            ↗
          </a>
        </div>

        {/* Change % — update live bij hover */}
        <div className="text-center text-[13px] font-semibold tabular-nums mt-0.5" style={{ color: changeColor }}>
          {changeUp ? "+" : ""}{changePct.toFixed(1)}%
          {hPt
            ? <span className="text-neutral-500 font-normal"> op {fmtXLabel(hPt.t, range)}</span>
            : <span className="text-neutral-500 font-normal"> ({periodLabel})</span>
          }
        </div>
      </>
    );
  }

  return (
    <div className="w-full space-y-1.5">
      {/* Periode-knoppen */}
      <div className="flex gap-0.5 justify-center">
        {RANGE_OPTS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              range === key
                ? "bg-neutral-200/15 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {chartBody()}
    </div>
  );
}

// ── Typen ─────────────────────────────────────────────────────────────────────

export type ReviewList = "favorieten" | "feniks" | "hikkertjes" | "zwitserleven" | "medailles" | "watchlist";

interface ReviewItem {
  ticker: string;
  company: string | null;
  exchange: string | null;
  sector: string | null;
  medal_gold?: number | null;
  medal_silver?: number | null;
  medal_bronze?: number | null;
  buy_limit?: number | null;
  last_close?: number | null;
  dividend_yield_pct?: number | null;
  hikkertje_spikes?: number | null;
}

// ── List picker (stap 1) ──────────────────────────────────────────────────────

const LIST_OPTIONS: { key: ReviewList; icon: ReactNode; label: string; desc: string }[] = [
  { key: "favorieten", icon: <GradientTabIcon tab="favorieten" />, label: "Favorieten", desc: "Favorieten zonder sterren-beoordeling" },
  { key: "feniks", icon: <GradientTabIcon tab="feniks" />, label: "Feniks", desc: "Feniks-aandelen nog niet bekeken of favoriet" },
  { key: "hikkertjes", icon: <GradientTabIcon tab="hikkertjes" />, label: "Hikkertjes", desc: "Hikkertjes nog niet bekeken of favoriet" },
  { key: "zwitserleven", icon: <GradientTabIcon tab="zwitserleven" />, label: "Zwitserleven", desc: "Dividend-aandelen nog niet bekeken of favoriet" },
  { key: "medailles", icon: <span>🏅</span>, label: "Medailles", desc: "≥2 goud/zilver-medailles (5j koers-runs), nog niet bekeken of favoriet" },
  { key: "watchlist", icon: <span>📋</span>, label: "Watchlist", desc: "Alle watchlist-aandelen nog niet bekeken of favoriet" },
];

function buildQueue(
  list: ReviewList,
  data: Dashboard | null,
  scans: ScanResults | null,
  zwit: ZwitserlevenResults | null,
  marks: ReturnType<typeof useMarks>,
): ReviewItem[] {
  const notReviewed = (ticker: string) => {
    const T = ticker.toUpperCase();
    if (list === "favorieten") {
      // Hart aanwezig maar geen sterren
      return marks.favorites.has(T) && marks.getRating(T) === null;
    }
    return !marks.favorites.has(T) && !marks.seen.has(T);
  };

  switch (list) {
    case "favorieten": {
      const items: ReviewItem[] = [];
      for (const t of marks.favorites) {
        if (notReviewed(t)) {
          // Zoek extra info in data.cards
          const card = data?.cards?.find((c) => c.ticker.toUpperCase() === t);
          items.push({
            ticker: t,
            company: card?.company ?? null,
            exchange: card?.exchange ?? null,
            sector: card?.sector ?? null,
            medal_gold: card?.medal_gold ?? null,
            medal_silver: card?.medal_silver ?? null,
            medal_bronze: card?.medal_bronze ?? null,
            buy_limit: card?.buy_limit ?? null,
            last_close: null,
            dividend_yield_pct: card?.dividend_yield ?? null,
          });
        }
      }
      return items;
    }
    case "feniks":
      return (scans?.phoenix_ranking ?? [])
        .filter((p) => notReviewed(p.ticker))
        .map((p) => ({
          ticker: p.ticker,
          company: p.company,
          exchange: p.exchange,
          sector: p.sector,
          medal_gold: p.medal_gold,
          medal_silver: p.medal_silver,
          medal_bronze: p.medal_bronze,
          buy_limit: p.buy_limit,
          last_close: p.last_close,
        }));
    case "hikkertjes":
      return (scans?.hikkertje_ranking ?? [])
        .filter((h) => notReviewed(h.ticker))
        .map((h) => ({
          ticker: h.ticker,
          company: h.company,
          exchange: h.exchange,
          sector: h.sector,
          medal_gold: h.medal_gold,
          medal_silver: h.medal_silver,
          medal_bronze: h.medal_bronze,
          buy_limit: h.buy_limit,
          last_close: h.last_close,
          hikkertje_spikes: h.hikkertje_spikes,
        }));
    case "zwitserleven":
      return (zwit?.stocks ?? [])
        .filter((s) => (s.meets_criteria || s.is_manual) && notReviewed(s.ticker))
        .map((s) => ({
          ticker: s.ticker,
          company: s.company,
          exchange: s.exchange,
          sector: s.sector,
          last_close: s.last_close,
          dividend_yield_pct: s.dividend_yield_pct,
        }));
    case "medailles": {
      // Aandelen met ≥2 medailles die goud en/of zilver zijn (gold+silver ≥ 2),
      // ongeacht limiet-nabijheid. Sterkste eerst (goud telt dubbel).
      return (data?.cards ?? [])
        .filter((c) => notReviewed(c.ticker))
        .filter((c) => ((c.medal_gold ?? 0) + (c.medal_silver ?? 0)) >= 2)
        .sort((a, b) => ((b.medal_gold ?? 0) * 2 + (b.medal_silver ?? 0)) - ((a.medal_gold ?? 0) * 2 + (a.medal_silver ?? 0)))
        .map((c) => ({
          ticker: c.ticker,
          company: c.company,
          exchange: c.exchange ?? null,
          sector: c.sector,
          medal_gold: c.medal_gold,
          medal_silver: c.medal_silver,
          medal_bronze: c.medal_bronze,
          buy_limit: c.buy_limit ?? null,
          last_close: c.summary?.last_close ?? null,
          dividend_yield_pct: c.dividend_yield ?? null,
        }));
    }
    case "watchlist": {
      return (data?.cards ?? [])
        .filter((c) => notReviewed(c.ticker))
        .filter((c) => {
          // Medaille-filter: ≥1 goud OF ≥2 zilver (5j) OF ≥3 brons (5j als proxy voor 1j)
          const medalOK = (c.medal_gold ?? 0) >= 1 || (c.medal_silver ?? 0) >= 2 || (c.medal_bronze ?? 0) >= 3;
          if (!medalOK) return false;
          // Limiet-filter: moet buy_limit hebben; prijs op/onder/binnen 20% boven limiet
          const limit = c.buy_limit ?? null;
          if (!limit) return false;
          const price = c.summary?.last_close ?? null;
          if (price === null) return true; // limiet gezet maar nog geen prijs → toon
          return price <= limit * 1.20;
        })
        .map((c) => ({
          ticker: c.ticker,
          company: c.company,
          exchange: c.exchange ?? null,
          sector: c.sector,
          medal_gold: c.medal_gold,
          medal_silver: c.medal_silver,
          medal_bronze: c.medal_bronze,
          buy_limit: c.buy_limit ?? null,
          last_close: c.summary?.last_close ?? null,
          dividend_yield_pct: c.dividend_yield ?? null,
        }));
    }
  }
}

// ── Review card (stap 2) ──────────────────────────────────────────────────────

function HeartSvg({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className="w-6 h-6" aria-hidden>
      <path
        d="M16 27.5 C5 19.5,1 13,1 9 C1 4.5,4.5 2,8.5 2 C11.5 2,14 4,16 7.5 C18 4,20.5 2,23.5 2 C27.5 2,31 4.5,31 9 C31 13,27 19.5,16 27.5 Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 2}
      />
    </svg>
  );
}

function StarSvg({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className="w-5 h-5" aria-hidden>
      <polygon
        points="16,2 19.5,12 30,12 21.5,18.5 24.5,29 16,23 7.5,29 10.5,18.5 2,12 12.5,12"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.5}
      />
    </svg>
  );
}

function ReviewCard({
  item,
  idx,
  total,
  onAction,
  onSkip,
  onPrev,
}: {
  item: ReviewItem;
  idx: number;
  total: number;
  onAction: (kind: "heart" | "star" | "seen", stars?: number) => void;
  onSkip: () => void;
  onPrev: () => void;
}) {
  const marks = useMarks();
  const isFav = marks.isFavorite(item.ticker);
  const currentStars = marks.getRating(item.ticker) ?? 0;
  const isSeen = marks.isSeen(item.ticker);

  function fmtPrice(v: number | null | undefined): string {
    if (v == null) return "—";
    if (v < 1) return `$${v.toFixed(4)}`;
    if (v < 10) return `$${v.toFixed(3)}`;
    return `$${v.toFixed(2)}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Voortgang + sluiten */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onPrev}
          disabled={idx === 0}
          className="text-neutral-500 hover:text-neutral-200 disabled:opacity-30 text-lg leading-none px-1"
          title="Vorige"
        >
          ←
        </button>
        <div className="flex-1 text-center text-xs text-neutral-500 font-mono">
          {idx + 1} / {total}
        </div>
        <button
          onClick={onSkip}
          className="text-neutral-500 hover:text-neutral-200 text-xs px-2 py-1 rounded border border-ink-5 hover:border-neutral-500"
          title="Sla over — ga naar volgende zonder beoordelen"
        >
          sla over
        </button>
      </div>

      {/* Ticker info */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xl font-bold text-neutral-50 leading-tight truncate">
              {item.company ?? item.ticker}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <a
                href={googleFinanceUrl(item.ticker, item.exchange)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm font-semibold text-[#ff1f8f] hover:underline"
              >
                {item.ticker}
              </a>
              {item.exchange && <span className="text-[11px] text-neutral-500">{item.exchange}</span>}
              {item.sector && (
                <span className="text-[10px] uppercase font-semibold text-neutral-400 bg-ink-3 px-1.5 py-0.5 rounded">
                  {item.sector}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {item.last_close != null && (
              <div className="font-mono font-bold text-neutral-100">{fmtPrice(item.last_close)}</div>
            )}
            {item.buy_limit != null && (
              <div className="text-[11px] text-neutral-100 font-mono">limit {fmtPrice(item.buy_limit)}</div>
            )}
          </div>
        </div>

        {/* Medailles + extra data */}
        <div className="flex items-center gap-3 mt-2 flex-wrap text-sm">
          {(item.medal_gold ?? 0) > 0 && <span>🏆{item.medal_gold}</span>}
          {(item.medal_silver ?? 0) > 0 && <span>🥈{item.medal_silver}</span>}
          {(item.medal_bronze ?? 0) > 0 && <span>🥉{item.medal_bronze}</span>}
          {item.dividend_yield_pct != null && item.dividend_yield_pct > 0 && (
            <span className="text-emerald-400 font-semibold">💰 {item.dividend_yield_pct.toFixed(1)}%</span>
          )}
          {item.hikkertje_spikes != null && (
            <span className="text-yellow-400 font-semibold">⚡ {item.hikkertje_spikes}× spike</span>
          )}
        </div>
      </div>

      {/* Koersgrafiek */}
      <div className="flex-1 min-h-0 mb-3">
        <ReviewChart ticker={item.ticker} exchange={item.exchange} />
      </div>

      {/* Actieknoppen onderin — altijd zichtbaar, geen scrollen nodig */}
      <div className="space-y-2 pt-2 border-t border-ink-5">
        {/* Favoriet + Gezien op één rij */}
        <div className="flex gap-2">
          <button
            onClick={() => onAction("heart")}
            className={
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-all " +
              (isFav
                ? "border-[#ff1a1a] text-[#ff1a1a] bg-[#ff1a1a]/10 hover:bg-[#ff1a1a]/20"
                : "border-ink-5 text-neutral-400 hover:border-[#ff1a1a] hover:text-[#ff1a1a] hover:bg-[#ff1a1a]/5")
            }
            style={isFav ? { textShadow: "0 0 4px rgba(255,26,26,0.5)" } : undefined}
          >
            <HeartSvg filled={isFav} />
            Favoriet
          </button>
          <button
            onClick={() => onAction("seen")}
            className={
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold border-2 transition-all " +
              (isSeen
                ? "border-fog-lime text-fog-lime bg-fog-lime/10 hover:bg-fog-lime/20"
                : "border-ink-5 text-neutral-400 hover:border-fog-lime hover:text-fog-lime hover:bg-fog-lime/5")
            }
          >
            <span className="text-base">🔭</span>
            {isSeen ? "Gezien" : "Markeer gezien"}
          </button>
        </div>

        {/* Sterren */}
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => onAction("star", n === currentStars ? undefined : n)}
              className={
                "flex-1 flex flex-col items-center justify-center py-2.5 rounded-xl border-2 font-bold text-sm transition-all " +
                (n <= currentStars
                  ? "border-[#ff00cc] text-[#ff00cc] bg-[#ff00cc]/10 hover:bg-[#ff00cc]/20"
                  : "border-ink-5 text-neutral-400 hover:border-[#ff00cc]/60 hover:text-[#ff00cc]/80")
              }
              title={n === currentStars ? `${n} sterren — klik om te wissen` : `${n} sterren`}
            >
              <StarSvg filled={n <= currentStars} />
              <span className="text-[10px] mt-0.5">{n}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── ReviewModeModal ───────────────────────────────────────────────────────────

function ReviewModeModal({
  onClose,
  data,
  scans,
  zwit,
}: {
  onClose: () => void;
  data: Dashboard | null;
  scans: ScanResults | null;
  zwit: ZwitserlevenResults | null;
}) {
  const marks = useMarks();
  const [selectedList, setSelectedList] = useState<ReviewList | null>(null);
  const [queueIdx, setQueueIdx] = useState(0);
  // Queue wordt eenmalig vastgelegd bij lijstkeuze — wijzigt niet mee als
  // marks tussentijds veranderen, zodat de index stabiel blijft.
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  // Sluit bij Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleAction(kind: "heart" | "star" | "seen", stars?: number) {
    const item = queue[queueIdx];
    if (!item) return;
    if (kind === "heart") void marks.toggle("favorite", item.ticker);
    else if (kind === "star") void marks.setRating(item.ticker, stars ?? null);
    else if (kind === "seen") void marks.toggle("seen", item.ticker);
    // Ga naar volgende na actie
    setTimeout(() => goNext(), 200);
  }

  function goNext() {
    if (queueIdx < queue.length - 1) setQueueIdx((i) => i + 1);
    else onClose();
  }

  function goPrev() {
    if (queueIdx > 0) setQueueIdx((i) => i - 1);
  }

  function handleSkip() {
    setSkipped((s) => new Set(s).add(queueIdx));
    goNext();
  }

  const currentItem = queue[queueIdx] ?? null;
  const isDone = selectedList && queue.length > 0 && queueIdx >= queue.length;
  const isEmpty = selectedList && queue.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-4 px-3 pb-3 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-ink-2 border border-ink-5 rounded-2xl shadow-2xl flex flex-col"
        style={{
          maxHeight: "min(calc(100vh - 1rem), 820px)",
          borderColor: "color-mix(in srgb, #cc00ff 30%, #262626)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-ink-5 shrink-0">
          <div className="font-bold text-neutral-100 flex items-center gap-2">
            <span
              className="text-base font-black"
              style={{ color: "#ff1a1a", textShadow: "0 0 4px rgba(255,26,26,0.7)" }}
            >
              ♥
            </span>
            <span className="opacity-60">/</span>
            <span className="text-base">👎</span>
            <span>Beoordelen</span>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-100 text-lg leading-none px-2"
            title="Sluit"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 min-h-0">
          {/* Stap 1: Lijstkeuze */}
          {!selectedList && (
            <div className="space-y-1.5">
              <div className="text-xs text-neutral-400 mb-2">
                Kies welke aandelen je wilt beoordelen:
              </div>
              {LIST_OPTIONS.map((opt) => {
                const q = buildQueue(opt.key, data, scans, zwit, marks);
                const cnt = q.length;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setSelectedList(opt.key);
                      setQueue(buildQueue(opt.key, data, scans, zwit, marks));
                      setQueueIdx(0);
                    }}
                    disabled={cnt === 0}
                    className={
                      "w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all " +
                      (cnt > 0
                        ? "border-ink-5 hover:border-[#cc00ff]/50 hover:bg-[#cc00ff]/5 cursor-pointer"
                        : "border-ink-5/40 opacity-40 cursor-not-allowed")
                    }
                  >
                    <span className="text-xl leading-none shrink-0 w-6 h-6 flex items-center justify-center">{opt.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-neutral-100">{opt.label}</div>
                      <div className="text-[11px] text-neutral-500 mt-0.5 leading-tight">{opt.desc}</div>
                    </div>
                    <span
                      className={
                        "text-sm font-bold tabular-nums shrink-0 " +
                        (cnt > 0 ? "text-[#cc00ff]" : "text-neutral-600")
                      }
                    >
                      {cnt}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Stap 2: Leeg */}
          {isEmpty && (
            <div className="text-center py-8 space-y-3">
              <div className="text-4xl">✅</div>
              <div className="text-neutral-300 font-semibold">Alles al beoordeeld!</div>
              <div className="text-xs text-neutral-500">
                Alle aandelen in deze lijst hebben al een hartje, sterren of gezien-markering.
              </div>
              <button
                onClick={() => { setSelectedList(null); setQueue([]); }}
                className="mt-3 px-4 py-2 rounded-lg border border-ink-5 text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-500"
              >
                ← Andere lijst kiezen
              </button>
            </div>
          )}

          {/* Stap 2: Klaar */}
          {isDone && (
            <div className="text-center py-8 space-y-3">
              <div className="text-4xl">🎉</div>
              <div className="text-neutral-300 font-semibold">Klaar met beoordelen!</div>
              <div className="text-xs text-neutral-500">
                Je hebt alle {queue.length} aandelen doorlopen.
              </div>
              <button
                onClick={() => { setSelectedList(null); setQueue([]); }}
                className="mt-3 px-4 py-2 rounded-lg border border-ink-5 text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-500"
              >
                ← Andere lijst kiezen
              </button>
            </div>
          )}

          {/* Stap 2: Review card */}
          {selectedList && currentItem && !isDone && (
            <ReviewCard
              key={queueIdx}
              item={currentItem}
              idx={queueIdx}
              total={queue.length}
              onAction={handleAction}
              onSkip={handleSkip}
              onPrev={goPrev}
            />
          )}
        </div>

        {/* Footer: terug naar lijstkeuze */}
        {selectedList && (
          <div className="px-4 py-2 border-t border-ink-5 shrink-0">
            <button
              onClick={() => { setSelectedList(null); setQueue([]); }}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              ← Andere lijst kiezen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ReviewModeButton ──────────────────────────────────────────────────────────
// Kleine knop voor in de header (rechtsboven). Opent het review-modal.

export function ReviewModeButton({
  data,
  scans,
  zwit,
}: {
  data: Dashboard | null;
  scans: ScanResults | null;
  zwit: ZwitserlevenResults | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Beoordeel aandelen: hartje, sterren of gezien"
        className="inline-flex items-center justify-center h-7 px-2.5 text-xs rounded-lg font-bold transition active:scale-95 select-none"
        style={{
          background: "linear-gradient(135deg, #ff00aa 0%, #cc00ff 100%)",
          color: "#fff",
          boxShadow: "0 0 10px -2px #cc00ff80",
        }}
      >
        <span
          className="text-sm leading-none"
          style={{ color: "#ff1a1a", textShadow: "0 0 4px rgba(255,26,26,0.7)" }}
        >
          ♥
        </span>
        <span className="mx-1 opacity-60">/</span>
        <span className="text-sm leading-none">👎</span>
        <span className="hidden sm:inline ml-1.5">beoordeel</span>
      </button>

      {open && (
        <ReviewModeModal
          onClose={() => setOpen(false)}
          data={data}
          scans={scans}
          zwit={zwit}
        />
      )}
    </>
  );
}
