export const ZIGZAG_SWING: Record<string, number> = {
  "1mo": 0.10, "6mo": 0.12, "1y": 0.15, "3y": 0.20, "5y": 0.25, "max": 0.25,
};

export function fmtDuration(secs: number): string {
  const d = Math.round(secs / 86400);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.round(d / 7)}wk`;
  if (d < 365) return `${Math.round(d / 30)}mnd`;
  return `${(d / 365).toFixed(1)}j`;
}

export function findZigzag(closes: number[], minSwing: number): { idx: number; type: "low" | "high" }[] {
  const n = closes.length;
  if (n < 6) return [];
  const win = Math.max(3, Math.floor(n / 20));
  const extrema: { idx: number; val: number; type: "low" | "high" }[] = [];
  for (let i = win; i < n - win; i++) {
    const v = closes[i];
    let isMin = true, isMax = true;
    for (let j = i - win; j <= i + win; j++) {
      if (j === i) continue;
      if (closes[j] < v) isMin = false;
      if (closes[j] > v) isMax = false;
    }
    if (isMin && v < closes[i - 1] && v < closes[i + 1]) extrema.push({ idx: i, val: v, type: "low" });
    else if (isMax && v > closes[i - 1] && v > closes[i + 1]) extrema.push({ idx: i, val: v, type: "high" });
  }
  if (!extrema.length) return [];
  const zz: typeof extrema = [extrema[0]];
  for (let i = 1; i < extrema.length; i++) {
    const cur = extrema[i];
    const last = zz[zz.length - 1];
    if (cur.type === last.type) {
      if (cur.type === "low" ? cur.val < last.val : cur.val > last.val) zz[zz.length - 1] = cur;
    } else if (Math.abs(cur.val - last.val) / last.val >= minSwing) {
      zz.push(cur);
    }
  }
  return zz.map(({ idx, type }) => ({ idx, type }));
}

export function computeTop3Swings(
  closes: number[],
  pts: { t: number; c: number }[],
  range: string,
): { lowIdx: number; highIdx: number; pct: number; dur: string }[] {
  const minSwing = ZIGZAG_SWING[range] ?? 0;
  if (!minSwing) return [];
  const zigzag = findZigzag(closes, minSwing);
  const swings: { lowIdx: number; highIdx: number; pct: number; dur: string }[] = [];
  for (let i = 1; i < zigzag.length; i++) {
    const a = zigzag[i - 1], b = zigzag[i];
    if (a.type === "low" && b.type === "high") {
      swings.push({
        lowIdx: a.idx,
        highIdx: b.idx,
        pct: (closes[b.idx] - closes[a.idx]) / closes[a.idx] * 100,
        dur: fmtDuration(pts[b.idx].t - pts[a.idx].t),
      });
    }
  }
  swings.sort((a, b) => b.pct - a.pct);
  return swings.slice(0, 3);
}
