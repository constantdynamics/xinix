// Twee kleine cellen die in elke ticker-tabel helemaal links staan:
// - SeenCell: verrekijker-checkbox (gezien-markering)
// - HeartCell: hartje (favoriet-markering)
//
// Plus de bijbehorende headers en een herbruikbare "Toon gezien" knop.

import { useState } from "react";
import { useMarks } from "../hooks/useMarks";

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
      <span aria-hidden>♡</span>
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
          (on ? "text-red-500 hover:text-red-400" : "text-neutral-600 hover:text-neutral-400")
        }
        title={on ? "Favoriet — klik om te verwijderen" : "Markeer als favoriet"}
        aria-label={`Markeer ${ticker} als favoriet`}
        aria-pressed={on}
      >
        {on ? "♥" : "♡"}
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
        (on ? "text-red-500 hover:text-red-400" : "text-neutral-600 hover:text-neutral-400")
      }
      title={on ? "Favoriet — klik om te verwijderen" : "Markeer als favoriet"}
      aria-label={`Markeer ${ticker} als favoriet`}
      aria-pressed={on}
    >
      {on ? "♥" : "♡"}
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
  label = "Alles aanvinken",
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
