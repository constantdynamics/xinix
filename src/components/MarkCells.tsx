// Twee kleine cellen die in elke ticker-tabel helemaal links staan:
// - SeenCell: verrekijker-checkbox (gezien-markering)
// - HeartCell: hartje (favoriet-markering)
//
// Plus de bijbehorende headers en een herbruikbare "Toon gezien" knop.

import { useState } from "react";
import { useMarks } from "../hooks/useMarks";

// Variant 4: gevuld hart, currentColor zodat Tailwind hover-classes werken.
function HeartIcon() {
  return (
    <svg viewBox="0 0 32 32" className="w-[1em] h-[1em]" aria-hidden="true">
      <path d="M16 27.5 C5 19.5,1 13,1 9 C1 4.5,4.5 2,8.5 2 C11.5 2,14 4,16 7.5 C18 4,20.5 2,23.5 2 C27.5 2,31 4.5,31 9 C31 13,27 19.5,16 27.5 Z" fill="currentColor"/>
    </svg>
  );
}

// Variant 3: gevulde 5-punts ster, currentColor.
function StarIcon() {
  return (
    <svg viewBox="0 0 32 32" className="w-[1em] h-[1em]" aria-hidden="true">
      <polygon points="16,2 19.5,12 30,12 21.5,18.5 24.5,29 16,23 7.5,29 10.5,18.5 2,12 12.5,12" fill="currentColor"/>
    </svg>
  );
}

export function SeenHeader() {
  return (
    <th
      className="px-2 py-2 text-center w-8"
      title="Gezien — vink aan om te onthouden dat je dit aandeel hebt bekeken"
    >
      <span aria-hidden>🔭</span>
    </th>
  );
}

export function HeartHeader() {
  return (
    <th
      className="px-2 py-2 text-center w-8"
      title="Favoriet — klik op het hartje om dit aandeel in de gaten te houden"
    >
      <span aria-hidden className="text-[#2a1a4a]"><HeartIcon /></span>
    </th>
  );
}

export function SeenCell({ ticker }: { ticker: string }) {
  const { isSeen, toggle } = useMarks();
  const on = isSeen(ticker);
  return (
    <td className="px-2 py-2 text-center align-middle">
      <input
        type="checkbox"
        checked={on}
        onChange={() => void toggle("seen", ticker)}
        className="accent-fog-lime cursor-pointer"
        title={on ? "Gezien — klik om te wissen" : "Markeer als gezien"}
        aria-label={`Markeer ${ticker} als gezien`}
      />
    </td>
  );
}

export function HeartCell({ ticker }: { ticker: string }) {
  const { isFavorite, toggle } = useMarks();
  const on = isFavorite(ticker);
  return (
    <td className="px-2 py-2 text-center align-middle">
      <button
        type="button"
        onClick={() => void toggle("favorite", ticker)}
        className={
          "text-base leading-none cursor-pointer transition-colors " +
          (on ? "text-[#8855ff] hover:text-[#aa77ff]" : "text-[#2a1a4a] hover:text-[#4a2a7a]")
        }
        title={on ? "Favoriet — klik om te verwijderen" : "Markeer als favoriet"}
        aria-label={`Markeer ${ticker} als favoriet`}
        aria-pressed={on}
      >
        <HeartIcon />
      </button>
    </td>
  );
}

// Inline varianten (zonder <td>-wrapper) voor div-based row layouts.
export function SeenInline({ ticker }: { ticker: string }) {
  const { isSeen, toggle } = useMarks();
  const on = isSeen(ticker);
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={() => void toggle("seen", ticker)}
      className="accent-fog-lime cursor-pointer shrink-0"
      title={on ? "Gezien — klik om te wissen" : "Markeer als gezien"}
      aria-label={`Markeer ${ticker} als gezien`}
    />
  );
}

export function HeartInline({ ticker }: { ticker: string }) {
  const { isFavorite, toggle } = useMarks();
  const on = isFavorite(ticker);
  return (
    <button
      type="button"
      onClick={() => void toggle("favorite", ticker)}
      className={
        "text-base leading-none cursor-pointer transition-colors shrink-0 " +
        (on ? "text-[#8855ff] hover:text-[#aa77ff]" : "text-[#2a1a4a] hover:text-[#4a2a7a]")
      }
      title={on ? "Favoriet — klik om te verwijderen" : "Markeer als favoriet"}
      aria-label={`Markeer ${ticker} als favoriet`}
      aria-pressed={on}
    >
      <HeartIcon />
    </button>
  );
}

export function ShowSeenToggle({
  showSeen,
  onChange,
}: {
  showSeen: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!showSeen)}
      className={
        "px-2 py-1 rounded text-[11px] border transition-colors " +
        (showSeen
          ? "border-fog-lime text-fog-lime bg-fog-lime/10"
          : "border-ink-5 text-neutral-400 hover:text-neutral-200")
      }
      title={showSeen ? "Verberg gezien rijen" : "Toon ook gezien rijen"}
    >
      🔭 {showSeen ? "Verberg gezien" : "Toon gezien"}
    </button>
  );
}

// Markeert alle zichtbare rijen als gezien — behalve favorieten. Wordt naast
// het verrekijker-icoon getoond zodat je in één klik de hele tabel kunt
// "afstrepen". Vraagt om bevestiging als er meer dan 10 rijen aangevinkt
// zouden worden, om ongelukken te voorkomen.
export function MarkAllSeenButton({
  tickers,
  label = "Markeer alle niet-hartjes als gezien",
}: {
  tickers: string[];
  label?: string;
}) {
  const { markManySeen, favorites, seen } = useMarks();
  const [busy, setBusy] = useState(false);

  // Hoeveel rijen zouden er daadwerkelijk gemarkeerd worden? (alleen niet-favoriet, niet-al-gezien)
  const candidates = tickers.filter((t) => {
    const T = t.toUpperCase();
    return !favorites.has(T) && !seen.has(T);
  });

  async function onClick() {
    if (candidates.length === 0) return;
    if (candidates.length > 10) {
      const ok = window.confirm(
        `${candidates.length} aandelen aanvinken als gezien? Favorieten worden overgeslagen.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      await markManySeen(candidates);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || candidates.length === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-2 py-1 rounded text-[11px] border transition-colors " +
        (disabled
          ? "border-ink-5 text-neutral-600 cursor-not-allowed"
          : "border-ink-5 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500")
      }
      title={
        candidates.length === 0
          ? "Niets om aan te vinken — alles is al gezien of favoriet"
          : `Vink ${candidates.length} aandelen aan als gezien (favorieten overgeslagen)`
      }
    >
      ✓ {label} ({candidates.length})
    </button>
  );
}

// Toggle voor "verberg favoriete rijen" — toont alleen aandelen zonder hartje.
// Handig wanneer je een nieuwe scan-batch wil reviewen en de al-bekende favorieten
// niet opnieuw wil zien.
export function HideFavoritesToggle({
  hideFavorites,
  onChange,
}: {
  hideFavorites: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!hideFavorites)}
      className={
        "px-2 py-1 rounded text-[11px] border transition-colors " +
        (hideFavorites
          ? "border-fog-pink text-fog-pink bg-fog-pink/10"
          : "border-ink-5 text-neutral-400 hover:text-neutral-200")
      }
      title={hideFavorites ? "Toon ook favorieten" : "Toon alleen aandelen zonder hartje"}
    >
      {hideFavorites ? "♡ Alleen niet-favoriet" : "♡ Verberg favorieten"}
    </button>
  );
}

export function StarHeader() {
  return (
    <th
      className="px-2 py-2 text-center w-24"
      title="Sterren — geef 1–5 sterren (geeft ook automatisch een hartje)"
    >
      <span aria-hidden className="text-[#2a0a2a]"><StarIcon /></span>
    </th>
  );
}

export function StarCell({ ticker }: { ticker: string }) {
  return (
    <td className="px-2 py-1.5 text-center align-middle">
      <StarRating ticker={ticker} />
    </td>
  );
}

// Sterren-rating 1..5 voor favorieten. Klik op ster N = rating N. Klik
// op de huidige rating = wissen. Werkt optimistisch via useMarks.
export function StarRating({ ticker, size = "sm" }: { ticker: string; size?: "sm" | "md" }) {
  const { getRating, setRating } = useMarks();
  const current = getRating(ticker) ?? 0;
  const cls = size === "md" ? "text-lg" : "text-sm";
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= current;
        return (
          <button
            key={n}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void setRating(ticker, n === current ? null : n);
            }}
            className={
              cls + " leading-none cursor-pointer transition-colors " +
              (filled ? "text-[#ff00cc] hover:text-[#ff44dd]" : "text-[#2a0a2a] hover:text-[#5a1a5a]")
            }
            title={n === current ? `Klik om ${n}-sterren te wissen` : `Geef ${n} sterren`}
            aria-label={`Geef ${ticker} ${n} sterren`}
          >
            <StarIcon />
          </button>
        );
      })}
    </div>
  );
}

// Tegel die laat zien hoeveel aandelen in deze tabel nog "te beoordelen" zijn:
// geen hartje (favoriet) ÉN geen verrekijker (gezien). Klikbaar — bij klik
// worden beide filters geactiveerd zodat je direct alleen die rijen ziet.
export function NotYetReviewedTile({
  tickers,
  onActivate,
}: {
  tickers: string[];
  onActivate?: () => void;
}) {
  const { favorites, seen } = useMarks();
  const count = tickers.reduce((n, t) => {
    const T = t.toUpperCase();
    return !favorites.has(T) && !seen.has(T) ? n + 1 : n;
  }, 0);
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onActivate?.(); }}
      disabled={disabled}
      className={
        "flex items-center gap-2 px-3 py-2 rounded border text-left transition-colors " +
        (disabled
          ? "border-ink-5 text-neutral-600 cursor-default"
          : "border-fog-lime/40 hover:border-fog-lime hover:bg-fog-lime/5 cursor-pointer")
      }
      title={disabled ? "Alles is al gezien of favoriet" : "Klik om alleen niet-bekeken aandelen te tonen"}
    >
      <span className="text-xl leading-none" aria-hidden>🆕</span>
      <span className="flex flex-col leading-tight">
        <span className={"text-lg font-mono tabular-nums font-bold " + (disabled ? "text-neutral-600" : "text-fog-lime")}>{count}</span>
        <span className="text-[10px] text-neutral-500 uppercase tracking-wider">nog niet bekeken</span>
      </span>
    </button>
  );
}
