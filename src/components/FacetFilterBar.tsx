// Gedeelde horizontale filter-balk voor Feniks en Poefies — vervangt de
// vroegere 260px-brede sidebar zodat de tabel volle breedte krijgt en de
// ticker-rijen niet meer hoeven te wrappen.

import type { ReactNode } from "react";
import { Card } from "./ui";
import { ShowSeenToggle, HideFavoritesToggle, NotYetReviewedTile, MarkAllSeenButton } from "./MarkCells";

interface FacetBucket<P> {
  id: string;
  label: string;
  match: (p: P) => boolean;
}

export interface FacetGroup<P, K extends string> {
  key: K;
  label: string;
  buckets: FacetBucket<P>[];
}

interface Props<P, K extends string> {
  facetGroups: FacetGroup<P, K>[];
  selectedBuckets: Record<K, Set<string>>;
  bucketCounts: Record<string, number>;
  onToggleBucket: (groupKey: K, bucketId: string) => void;
  onClearAll: () => void;
  activeFilterCount: number;
  shownCount: number;
  totalCount: number;
  showSeen: boolean;
  onShowSeen: (v: boolean) => void;
  hideFavorites: boolean;
  onHideFavorites: (v: boolean) => void;
  seenCount: number;
  tickers: string[];
  filteredTickers: string[];
  onActivateNotYetReviewed: () => void;
  extraControls?: ReactNode;
}

export function FacetFilterBar<P, K extends string>({
  facetGroups,
  selectedBuckets,
  bucketCounts,
  onToggleBucket,
  onClearAll,
  activeFilterCount,
  shownCount,
  totalCount,
  showSeen,
  onShowSeen,
  hideFavorites,
  onHideFavorites,
  seenCount,
  tickers,
  filteredTickers,
  onActivateNotYetReviewed,
  extraControls,
}: Props<P, K>) {
  return (
    <Card className="p-3">
      {/* Bovenrij: titel + meta-acties */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-bold">
          Filters{activeFilterCount > 0 && <span className="text-fog-pink"> ({activeFilterCount})</span>}
        </span>
        {activeFilterCount > 0 && (
          <button onClick={onClearAll} className="text-[11px] text-fog-lime hover:underline">
            wissen
          </button>
        )}
        <span className="text-[11px] text-neutral-500 ml-1">
          {shownCount} van {totalCount} getoond · {seenCount} gezien
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <ShowSeenToggle showSeen={showSeen} onChange={onShowSeen} />
          <HideFavoritesToggle hideFavorites={hideFavorites} onChange={onHideFavorites} />
          <NotYetReviewedTile tickers={tickers} onActivate={onActivateNotYetReviewed} />
          <MarkAllSeenButton tickers={filteredTickers} />
          {extraControls}
        </div>
      </div>

      {/* Per-facet rijtje: label links, pills horizontaal */}
      <div className="space-y-1.5">
        {facetGroups.map((g) => (
          <div key={g.key} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold text-neutral-300 min-w-[150px] shrink-0">
              {g.label}
            </span>
            {g.buckets.map((b) => {
              const count = bucketCounts[`${g.key}::${b.id}`] ?? 0;
              const checked = selectedBuckets[g.key].has(b.id);
              const disabled = count === 0 && !checked;
              const cls = checked
                ? "border-fog-pink/60 bg-fog-pink/15 text-fog-pink"
                : disabled
                ? "border-ink-5/40 text-neutral-600 cursor-not-allowed"
                : "border-ink-5 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500";
              return (
                <button
                  key={b.id}
                  onClick={() => !disabled && onToggleBucket(g.key, b.id)}
                  disabled={disabled}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${cls}`}
                >
                  {b.label} <span className="opacity-70 tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}
