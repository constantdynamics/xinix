// Defog-geinspireerde primitives. Pikzwart canvas, hot pink + lime
// accenten, kleur-bordered pills voor categorie-filters, en de iconische
// dot-progress bar voor distance/proximity.
//
// Eén bestand voor alle primitives: scheelt imports en de UI is niet
// dieper dan een handvol componenten dus splitsen geeft alleen maar
// extra ruis.

import { useEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  ReactNode,
} from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ─── useTickingNow — Date.now() dat elke `interval`ms re-rendert ──────
// Voor componenten die "X min geleden" tonen zonder dat ze data hoeven
// te refetchen. Default 60s = goed voor minuut-resolutie.
export function useTickingNow(interval = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}

// Gedeelde relatieve-tijd helper. Compact, NL.
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min geleden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.floor(h / 24);
  return `${d} dag${d > 1 ? "en" : ""} geleden`;
}

// ─── EmptyState — uniforme lege-staat ─────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="p-8 text-center rounded-2xl bg-ink-2 border border-ink-6 ring-1 ring-inset ring-white/[0.03]">
      {icon && <div className="text-3xl mb-2 opacity-50">{icon}</div>}
      <div className="text-sm font-semibold text-neutral-300">{title}</div>
      {description && (
        <div className="text-xs text-neutral-500 mt-1.5 max-w-md mx-auto leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ─── InlineConfirm — twee-staps verwijderknop zonder browser-dialog ──
export function InlineConfirm({
  onConfirm,
  label = "✕",
  confirmLabel = "Zeker?",
  title,
  className,
}: {
  onConfirm: () => void;
  label?: ReactNode;
  confirmLabel?: ReactNode;
  title?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
      className={cx(
        "inline-flex items-center justify-center rounded-md text-xs font-bold transition px-2 h-7",
        armed
          ? "bg-fog-loss text-white"
          : "text-neutral-500 hover:text-fog-loss hover:bg-fog-loss/10",
        className
      )}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────
// Default border bump naar ink-6 + subtiele inner ring zodat kaarten op de
// donkere achtergrond beter van elkaar te onderscheiden zijn.
export function Card({
  className,
  hover,
  glow,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { hover?: boolean; glow?: "pink" | "lime" }) {
  return (
    <div
      {...rest}
      className={cx(
        "rounded-2xl bg-ink-2 border border-ink-6 ring-1 ring-inset ring-white/[0.03] shadow-sink",
        hover && "transition hover:bg-ink-3 hover:border-fog-pink/30",
        glow === "pink" && "shadow-glow",
        glow === "lime" && "shadow-glow-lime",
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── NavTab — tabbalk met fog-pink underline ──────────────────────────
// Gebruikt voor de hoofdnavigatie. Onderscheidend van Pill (filter): hier
// is alleen één tegelijk actief, en de actieve heeft een onderbalk i.p.v.
// een fill. Optionele urgent-indicator (rode dot) en count-chip.
export function NavTab({
  active,
  onClick,
  children,
  count,
  urgent,
  title,
  color,
  icon,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
  urgent?: boolean;
  title?: string;
  color?: string;
  icon?: ReactNode;
}) {
  const btnStyle = color
    ? active
      ? { color, borderBottomColor: color }
      : { color, opacity: 0.45 }
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={btnStyle}
      className={cx(
        "relative inline-flex items-center gap-1.5 px-3 sm:px-3.5 h-10 text-sm font-semibold whitespace-nowrap select-none transition-colors",
        // Bottom-border alleen op active, anders transparent zodat de
        // hoogte gelijk blijft (geen layout-jitter bij toggle).
        active
          ? color ? "border-b-2" : "text-neutral-50 border-b-2 border-fog-pink"
          : color ? "border-b-2 border-transparent" : "text-neutral-400 hover:text-neutral-100 border-b-2 border-transparent"
      )}
    >
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      <span>{children}</span>
      {count != null && count > 0 && (
        <span
          className={cx(
            "tabular text-[10px] px-1.5 py-0.5 rounded-md",
            active ? "bg-fog-pink/15 text-fog-pink" : "bg-ink-3 text-neutral-500"
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
      {urgent && (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-fog-loss animate-pulse-soft"
          title="Iets vraagt aandacht"
        />
      )}
    </button>
  );
}

// ─── Skeleton — grijze placeholder voor initial loading ───────────────
export function Skeleton({
  className,
  rounded = "md",
}: {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
}) {
  const r = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-2xl",
    full: "rounded-full",
  }[rounded];
  return (
    <div
      className={cx(
        "bg-ink-3/60 animate-pulse-soft",
        r,
        className
      )}
    />
  );
}

// ─── Sparkline — kleine SVG-trend voor recente runs ───────────────────
// values 0..1 (bv. ok-rate per dag). Toont een lijn + subtiele fill.
// Geen assen, geen labels: het gaat om de vorm op de eerste indruk.
export function Sparkline({
  values,
  width = 60,
  height = 16,
  tone = "lime",
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "lime" | "loss" | "watch" | "pink";
  className?: string;
}) {
  if (values.length < 2) return null;
  const colorMap = {
    lime: "#a7ff1f",
    loss: "#ff1a1a",
    watch: "#ffd400",
    pink: "#ff1f8f",
  };
  const stroke = colorMap[tone];
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(" L ")}`;
  const fillPath = `M 0,${height} L ${pts.join(" L ")} L ${width},${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      className={cx("overflow-visible block", className)}
      role="img"
      aria-label="Trend"
    >
      <path d={fillPath} fill={stroke} fillOpacity={0.12} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── MedalPills — goud/zilver/brons indicatoren (emoji-strip) ─────────
// Zelfde stijl als de Limits-pagina: 🏆3 🥈1 🥉5 — emoji + count,
// zonder pill-omkadering. Op 11-12px zijn 🥈/🥉 slecht te
// onderscheiden, dus standaard text-lg.
export function MedalPills({
  gold,
  silver,
  bronze,
  size = "sm",
}: {
  gold?: number | null;
  silver?: number | null;
  bronze?: number | null;
  size?: "xs" | "sm";
}) {
  const g = gold ?? 0;
  const s = silver ?? 0;
  const b = bronze ?? 0;
  if (g + s + b === 0) return null;
  const cls = size === "xs" ? "text-sm" : "text-lg";
  return (
    <span
      className={cx(cls, "tabular whitespace-nowrap leading-none")}
      title="Medailleklassement (5y koers-runs)"
    >
      {g > 0 && <span className="text-fog-watch">🏆{g} </span>}
      {s > 0 && <span className="text-neutral-300">🥈{s} </span>}
      {b > 0 && <span className="text-[#cd7f32]">🥉{b}</span>}
    </span>
  );
}

// ─── Modal — gedeelde popup-shell ─────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  if (!open) return null;
  const sizeCls = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl" }[size];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className={cx("w-full bg-ink-2 border border-ink-6 ring-1 ring-inset ring-white/[0.04] rounded-2xl shadow-2xl", sizeCls)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-5">
          <div className="font-bold text-neutral-100 truncate">{title}</div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-100 text-lg leading-none px-2"
            title="Sluit"
          >
            ✕
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── Button ────────────────────────────────────────────────────────────
type Variant = "primary" | "buy" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-fog-pink hover:bg-fog-pink-soft text-black font-semibold shadow-glow",
  buy:
    "bg-fog-lime hover:bg-fog-lime-soft text-black font-bold shadow-glow-lime",
  secondary:
    "bg-ink-3 hover:bg-ink-4 text-neutral-100 border border-ink-5 hover:border-ink-6",
  ghost:
    "bg-transparent hover:bg-ink-3 text-neutral-300 hover:text-neutral-100",
  danger:
    "bg-red-600 hover:bg-red-500 text-white",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed select-none",
        VARIANT[variant],
        SIZE[size],
        className
      )}
    >
      {children}
    </button>
  );
}

// ─── Filter Pill (Defog signature) ─────────────────────────────────────
// Rounded pill met gekleurde border + count. Klik = aan/uit.
type PillTone = "pink" | "lime" | "orange" | "cyan" | "neutral" | "loss" | "watch";

const PILL_TONE: Record<
  PillTone,
  { border: string; text: string; activeBg: string; activeText: string }
> = {
  pink: {
    border: "border-fog-pink/60",
    text: "text-fog-pink",
    activeBg: "bg-fog-pink",
    activeText: "text-black",
  },
  lime: {
    border: "border-fog-lime/60",
    text: "text-fog-lime",
    activeBg: "bg-fog-lime",
    activeText: "text-black",
  },
  orange: {
    border: "border-fog-warn/60",
    text: "text-fog-warn",
    activeBg: "bg-fog-warn",
    activeText: "text-black",
  },
  cyan: {
    border: "border-fog-info/60",
    text: "text-fog-info",
    activeBg: "bg-fog-info",
    activeText: "text-black",
  },
  watch: {
    border: "border-fog-watch/60",
    text: "text-fog-watch",
    activeBg: "bg-fog-watch",
    activeText: "text-black",
  },
  loss: {
    border: "border-fog-loss/60",
    text: "text-fog-loss",
    activeBg: "bg-fog-loss",
    activeText: "text-white",
  },
  neutral: {
    border: "border-ink-6",
    text: "text-neutral-300",
    activeBg: "bg-neutral-100",
    activeText: "text-black",
  },
};

export function Pill({
  tone = "neutral",
  active,
  count,
  icon,
  children,
  onClick,
  className,
  size = "md",
  title,
}: {
  tone?: PillTone;
  active?: boolean;
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  size?: "sm" | "md";
  title?: string;
}) {
  const t = PILL_TONE[tone];
  const sizeClass =
    size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-8 px-3.5 text-xs";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-pill border font-semibold transition whitespace-nowrap",
        sizeClass,
        active
          ? cx(t.activeBg, t.activeText, "border-transparent")
          : cx("bg-transparent", t.border, t.text, "hover:bg-ink-3"),
        className
      )}
    >
      {icon && <span className="opacity-80">{icon}</span>}
      <span>{children}</span>
      {count != null && (
        <span
          className={cx(
            "ml-0.5 tabular",
            active ? "opacity-80" : "opacity-60"
          )}
        >
          ({count})
        </span>
      )}
    </button>
  );
}

// ─── Badge — kleine status label ───────────────────────────────────────
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
}) {
  const t = PILL_TONE[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        t.border,
        t.text,
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Status dot ────────────────────────────────────────────────────────
export function Dot({
  tone = "neutral",
  pulse,
  className,
  title,
}: {
  tone?: PillTone;
  pulse?: boolean;
  className?: string;
  title?: string;
}) {
  const bg = {
    pink: "bg-fog-pink",
    lime: "bg-fog-lime",
    orange: "bg-fog-warn",
    cyan: "bg-fog-info",
    watch: "bg-fog-watch",
    loss: "bg-fog-loss",
    neutral: "bg-neutral-500",
  }[tone];
  return (
    <span
      title={title}
      className={cx(
        "inline-block w-2 h-2 rounded-full",
        bg,
        pulse && "animate-pulse-soft",
        className
      )}
    />
  );
}

// ─── DotBar — Defog signature distance indicator ───────────────────────
// Rij van bolletjes die "distance to limit/target" visualiseren.
// 0..1 progress, eerste deel rood, midden amber, eind groen.
export function DotBar({
  progress,
  count = 10,
  invert,
  className,
}: {
  progress: number; // 0..1
  count?: number;
  invert?: boolean; // omkeren als hoge waarde slecht is
  className?: string;
}) {
  const filled = Math.max(0, Math.min(count, Math.round(progress * count)));
  return (
    <span className={cx("inline-flex gap-0.5", className)}>
      {Array.from({ length: count }, (_, i) => {
        const pos = i / (count - 1);
        const active = i < filled;
        let color = "bg-neutral-700";
        if (active) {
          const stage = invert ? 1 - pos : pos;
          if (stage < 0.34) color = "bg-fog-loss";
          else if (stage < 0.67) color = "bg-fog-warn";
          else color = "bg-fog-lime";
        }
        return (
          <span
            key={i}
            className={cx("w-1.5 h-1.5 rounded-full", color)}
          />
        );
      })}
    </span>
  );
}

// ─── RangeBar — horizontale low/high track met marker voor current ─────
// Toont positie in de range. Kleur van marker = hoe goedkoop (dichtbij
// low = lime; midden = warn; dichtbij high = loss/orange wat ook waarschuwt
// voor mean-reversion risico).
export function RangeBar({
  low,
  high,
  current,
  label,
  className,
}: {
  low: number;
  high: number;
  current: number;
  label?: string;
  className?: string;
}) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return null;
  }
  const clamped = Math.max(low, Math.min(high, current));
  const pos = (clamped - low) / (high - low); // 0..1
  // 0..1: 0 = at low (cheap, lime), 1 = at high (expensive, loss)
  const tone =
    pos < 0.2
      ? "bg-fog-lime"
      : pos < 0.5
      ? "bg-fog-info"
      : pos < 0.8
      ? "bg-fog-warn"
      : "bg-fog-loss";
  const textTone =
    pos < 0.2
      ? "text-fog-lime"
      : pos < 0.5
      ? "text-fog-info"
      : pos < 0.8
      ? "text-fog-warn"
      : "text-fog-loss";
  const pctAboveLow = low > 0 ? ((current - low) / low) * 100 : 0;
  function fmt(v: number) {
    if (v < 1) return `$${v.toFixed(3)}`;
    if (v < 100) return `$${v.toFixed(2)}`;
    return `$${v.toFixed(0)}`;
  }
  return (
    <div className={cx("space-y-0.5", className)}>
      <div className="flex items-center justify-between text-[10px]">
        {label ? (
          <span className="uppercase tracking-wider text-neutral-300 font-bold">
            {label}
          </span>
        ) : (
          <span />
        )}
        <span className={cx("tabular font-bold", textTone)}>
          +{pctAboveLow.toFixed(0)}% boven low
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-ink-5">
        <span
          className={cx(
            "absolute -top-0.5 w-3 h-3 rounded-full ring-2 ring-ink-1 shadow-sm",
            tone
          )}
          style={{ left: `calc(${pos * 100}% - 6px)` }}
          title={`Current ${fmt(current)} | low ${fmt(low)} | high ${fmt(high)}`}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular text-neutral-400">
        <span>{fmt(low)}</span>
        <span>{fmt(high)}</span>
      </div>
    </div>
  );
}

// ─── BlockBar — discretized rainbow fill in 10 blokjes ─────────────────
// Gebruikt voor zowel de verticale Thermometer (cheapness op dashboard)
// als de horizontale Distance-bar in de Limieten tab. fill = 0..1, rond
// af op het aantal lit blokjes. Kleuren-array bottom-to-top (vertical)
// of left-to-right (horizontal): lime -> yellow -> orange -> red -> pink.
const RAINBOW_10 = [
  "#a7ff1f", // lime
  "#caf300",
  "#e8e500",
  "#ffd400", // yellow
  "#ffa800",
  "#ff8c00", // orange
  "#ff5a3a", // red-orange
  "#ff3a6a",
  "#ff2880",
  "#ff1f8f", // hot pink
];

export function BlockBar({
  fill,
  orientation = "vertical",
  count = 10,
  className,
}: {
  fill: number; // 0..1
  orientation?: "vertical" | "horizontal";
  count?: number;
  className?: string;
}) {
  const safeFill = Math.max(0, Math.min(1, Number.isFinite(fill) ? fill : 0));
  const lit = Math.round(safeFill * count);
  const blocks = Array.from({ length: count }, (_, i) => {
    const isLit = i < lit;
    // Sample uit RAINBOW_10 — als count == 10 één-op-één, anders linear
    // interpolatie via positie.
    const pos = count === 10 ? i : Math.round((i / (count - 1)) * 9);
    const color = RAINBOW_10[pos] ?? RAINBOW_10[RAINBOW_10.length - 1];
    return { isLit, color };
  });

  if (orientation === "vertical") {
    // Bottom-up: eerste block (lime) onderaan, laatste (pink) bovenaan.
    return (
      <div
        className={cx(
          "flex flex-col-reverse w-full h-full gap-px rounded-md overflow-hidden bg-ink-1",
          className
        )}
      >
        {blocks.map((b, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              background: b.isLit ? b.color : "#1a1a1a",
              opacity: b.isLit ? 1 : 1,
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      className={cx(
        "flex w-full h-full gap-px rounded-md overflow-hidden bg-ink-1",
        className
      )}
    >
      {blocks.map((b, i) => (
        <div
          key={i}
          className="flex-1"
          style={{
            background: b.isLit ? b.color : "#1a1a1a",
          }}
        />
      ))}
    </div>
  );
}

// ─── Thermometer — verticale BlockBar; voller = goedkoper ──────────────
// Vulling = 1 - clamp(pctAboveLow / 200, 0, 1). Bij koers op de low =
// vol (200% rijk = leeg). Regenboog bottom-up. Een vol gevulde bar
// laat alle 10 blokjes oplichten van lime onderaan tot pink bovenaan.
export function Thermometer({
  low,
  high,
  current,
  label,
  className,
}: {
  low: number;
  high: number;
  current: number;
  label?: string;
  className?: string;
}) {
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    !Number.isFinite(current) ||
    low <= 0
  ) {
    return null;
  }
  const pctAboveLow = ((current - low) / low) * 100;
  const cheapness = Math.max(0, 1 - Math.min(pctAboveLow / 200, 1));
  const textTone =
    pctAboveLow < 30
      ? "text-fog-lime"
      : pctAboveLow < 100
      ? "text-fog-info"
      : pctAboveLow < 200
      ? "text-fog-warn"
      : "text-fog-pink";
  function fmt(v: number) {
    if (v < 1) return `$${v.toFixed(3)}`;
    if (v < 100) return `$${v.toFixed(2)}`;
    return `$${v.toFixed(0)}`;
  }
  return (
    <div
      className={cx("flex flex-col items-center gap-1", className)}
      title={`current ${fmt(current)} = +${pctAboveLow.toFixed(0)}% boven low`}
    >
      {label && (
        <div className="text-[10px] uppercase tracking-wider font-bold text-neutral-300">
          {label}
        </div>
      )}
      <div className="w-7 h-24">
        <BlockBar fill={cheapness} orientation="vertical" />
      </div>
      <div className={cx("text-[10px] tabular font-bold", textTone)}>
        {pctAboveLow >= 0 ? "+" : ""}
        {pctAboveLow.toFixed(0)}%
      </div>
      <div className="text-[9px] tabular text-neutral-400 leading-tight text-center">
        <div>hi {fmt(high)}</div>
        <div>lo {fmt(low)}</div>
      </div>
    </div>
  );
}

// ─── Input / Select ────────────────────────────────────────────────────
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        "h-9 px-3 text-sm rounded-lg bg-ink-2 border border-ink-5 placeholder:text-neutral-400",
        className
      )}
    />
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        "h-9 px-2.5 pr-7 text-sm rounded-lg bg-ink-2 border border-ink-5 appearance-none cursor-pointer",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a3a3a3%22 stroke-width=%222%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-no-repeat bg-[right_0.5rem_center]",
        className
      )}
    >
      {children}
    </select>
  );
}

// ─── Stat — KPI tile ───────────────────────────────────────────────────
export function Stat({
  label,
  value,
  delta,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  delta?: { value: number; suffix?: string };
  hint?: ReactNode;
  tone?: "pink" | "lime";
}) {
  const deltaColor =
    delta && delta.value > 0
      ? "text-fog-gain"
      : delta && delta.value < 0
      ? "text-fog-loss"
      : "text-neutral-500";
  return (
    <Card className="p-4" glow={tone}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-2xl font-bold tabular text-neutral-50">{value}</div>
        {delta && (
          <div className={cx("text-xs font-semibold tabular", deltaColor)}>
            {delta.value >= 0 ? "+" : ""}
            {delta.value}
            {delta.suffix ?? ""}
          </div>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-neutral-500">{hint}</div>}
    </Card>
  );
}

// ─── Section header met optionele aside ───────────────────────────────
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  aside,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog-pink mb-1">
            {eyebrow}
          </div>
        )}
        <h2 className="text-xl font-bold tracking-tight text-neutral-50">
          {title}
        </h2>
        {subtitle && (
          <div className="mt-0.5 text-xs text-neutral-500">{subtitle}</div>
        )}
      </div>
      {aside && <div className="flex items-center gap-2">{aside}</div>}
    </div>
  );
}

// ─── Floating Action Button (defog: pink + bottom-right) ──────────────
export function FAB({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full bg-fog-pink text-black hover:bg-fog-pink-soft shadow-glow flex items-center justify-center text-xl font-bold transition active:scale-95"
    >
      {children}
    </button>
  );
}

// ─── Tabular utility wrapper ───────────────────────────────────────────
export function MiniDelta({ value }: { value: number }) {
  const pos = value > 0;
  const neg = value < 0;
  return (
    <span
      className={cx(
        "tabular text-xs font-semibold",
        pos ? "text-fog-gain" : neg ? "text-fog-loss" : "text-neutral-500"
      )}
    >
      {pos ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}
