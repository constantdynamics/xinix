// Tiny inline sparkline per ticker — fetches 1-month price history lazily.
// Module-level cache voorkomt duplicate fetches als dezelfde ticker
// meerdere keren in een tabel staat (of de tabel herrendert).

import { useEffect, useState } from "react";
import { fetchPriceHistory } from "../api";
import { Sparkline } from "./ui";

type CacheEntry = { values: number[]; up: boolean } | "loading" | "error";
const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function getOrFetch(ticker: string): CacheEntry | undefined {
  const existing = cache.get(ticker);
  if (existing) return existing;
  cache.set(ticker, "loading");
  fetchPriceHistory(ticker, "1mo")
    .then((h) => {
      const closes = h.points.map((p) => p.c).filter((v) => Number.isFinite(v));
      if (closes.length < 2) {
        cache.set(ticker, "error");
      } else {
        const lo = Math.min(...closes);
        const hi = Math.max(...closes);
        const span = hi - lo || 1;
        const values = closes.map((v) => (v - lo) / span);
        const up = closes[closes.length - 1] >= closes[0];
        cache.set(ticker, { values, up });
      }
    })
    .catch(() => cache.set(ticker, "error"))
    .finally(() => notify(ticker));
  return "loading";
}

export function TickerSparkline({
  ticker,
  width = 60,
  height = 16,
  className,
}: {
  ticker: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    let set = listeners.get(ticker);
    if (!set) { set = new Set(); listeners.set(ticker, set); }
    const fn = () => setTick((n) => n + 1);
    set.add(fn);
    // Trigger fetch if not started yet
    getOrFetch(ticker);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) listeners.delete(ticker);
    };
  }, [ticker]);

  const entry = cache.get(ticker);
  if (!entry || entry === "loading") {
    // Placeholder: thin dim line
    return (
      <svg width={width} height={height} className={className ?? ""} aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#333" strokeWidth={1} />
      </svg>
    );
  }
  if (entry === "error") return null;
  return (
    <Sparkline
      values={entry.values}
      width={width}
      height={height}
      tone={entry.up ? "lime" : "loss"}
      className={className}
    />
  );
}
