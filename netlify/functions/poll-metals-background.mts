import type { Config } from "@netlify/functions";
import { getServiceClient, logRun } from "./_lib/supabase.mts";
import { insertSignal } from "./_lib/signals.mts";

// Yahoo Finance daily bars for metals/FX/rates that drive sector tide.
// Free, no auth. Symbols below cover the macro mentioned in the mining framework.

interface MacroSymbol {
  symbol: string;
  yahoo: string;
  label: string;
  commodity?: string; // maps to signal_tickers.commodity (Au/Ag/Cu/Pt/Pd/U/Li)
  bullDirection: 1 | -1; // 1 = up is bullish for mining, -1 = down is bullish (DXY)
}

const SYMBOLS: MacroSymbol[] = [
  { symbol: "GOLD", yahoo: "GC=F", label: "Gold futures", commodity: "Au", bullDirection: 1 },
  { symbol: "SILVER", yahoo: "SI=F", label: "Silver futures", commodity: "Ag", bullDirection: 1 },
  { symbol: "COPPER", yahoo: "HG=F", label: "Copper futures", commodity: "Cu", bullDirection: 1 },
  { symbol: "PLATINUM", yahoo: "PL=F", label: "Platinum futures", commodity: "Pt", bullDirection: 1 },
  { symbol: "PALLADIUM", yahoo: "PA=F", label: "Palladium futures", commodity: "Pd", bullDirection: 1 },
  { symbol: "URANIUM", yahoo: "URA", label: "URA uranium ETF", commodity: "U", bullDirection: 1 },
  { symbol: "LITHIUM", yahoo: "LIT", label: "LIT lithium ETF", commodity: "Li", bullDirection: 1 },
  { symbol: "DXY", yahoo: "DX-Y.NYB", label: "US Dollar index", bullDirection: -1 },
  { symbol: "TNX", yahoo: "^TNX", label: "10Y treasury yield", bullDirection: -1 },
];

interface YahooBar {
  date: string;
  close: number;
}

async function fetchSeries(yahoo: string): Promise<YahooBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahoo
  )}?range=1y&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; SignalMacroBot/1.0; +https://github.com)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahoo} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: { quote: Array<{ close: (number | null)[] }> };
      }>;
    };
  };
  const r = json.chart.result?.[0];
  if (!r) return [];
  const ts = r.timestamp ?? [];
  const closes = r.indicators.quote[0]?.close ?? [];
  return ts
    .map((t, i) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      close: closes[i] ?? NaN,
    }))
    .filter((b): b is YahooBar => Number.isFinite(b.close));
}

function pct(a: number, b: number): number {
  if (!b) return 0;
  return ((a - b) / b) * 100;
}

export default async () => {
  await logRun("poll-metals", async () => {
    const supabase = getServiceClient();
    let updated = 0;
    let signalsInserted = 0;
    const errors: string[] = [];

    // Track per-commodity 90d move for downstream signal emission
    const commodityMove: Record<string, number> = {};

    for (const sym of SYMBOLS) {
      try {
        const bars = await fetchSeries(sym.yahoo);
        if (bars.length === 0) continue;
        const last = bars[bars.length - 1];
        const find = (daysAgo: number) => {
          const target = bars.length - 1 - daysAgo;
          return target >= 0 ? bars[target] : bars[0];
        };
        const b30 = find(30);
        const b90 = find(90);
        const b365 = find(365);
        const m30 = pct(last.close, b30.close);
        const m90 = pct(last.close, b90.close);
        const m365 = pct(last.close, b365.close);

        await supabase.from("signal_macro").upsert(
          {
            symbol: sym.symbol,
            date: last.date,
            close: last.close,
            pct_change_30d: Number(m30.toFixed(2)),
            pct_change_90d: Number(m90.toFixed(2)),
            pct_change_365d: Number(m365.toFixed(2)),
          },
          { onConflict: "symbol,date" }
        );
        updated++;

        // For commodity-anchored symbols: store directional move (signed by bullDirection)
        if (sym.commodity) {
          commodityMove[sym.commodity] = m90 * sym.bullDirection;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${sym.symbol}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    // Emit per-ticker macro_tide signals for mining tickers whose commodity is moving.
    // Yellow ≥20%, Orange ≥40%, Red ≥70% (90d move).
    const moversUp = Object.entries(commodityMove).filter(
      ([, m]) => m >= 20
    );
    if (moversUp.length > 0) {
      const { data: miningTickers } = await supabase
        .from("signal_tickers")
        .select("ticker, commodity")
        .eq("active", true)
        .eq("sector", "mining");

      const today = new Date().toISOString().slice(0, 10);
      const expires14 = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString();

      for (const t of miningTickers ?? []) {
        if (!t.commodity) continue;
        const move = commodityMove[t.commodity];
        if (move == null || move < 20) continue;
        const severity: "yellow" | "orange" | "red" =
          move >= 70 ? "red" : move >= 40 ? "orange" : "yellow";
        const id = await insertSignal(supabase, {
          ticker: t.ticker,
          signal_type: "macro_tide",
          severity,
          title: `${t.ticker}: ${t.commodity} +${move.toFixed(1)}% (90d)`,
          detail: `Onderliggende metaal-bull (${t.commodity}) — sectorbreed rugwind voor juniors.`,
          payload: { commodity: t.commodity, pct_90d: move },
          expires_at: expires14,
          dedup_key: `macro_tide:${t.ticker}:${t.commodity}:${today}`,
        });
        if (id) signalsInserted++;
      }
    }

    return {
      ok: errors.length === 0,
      message:
        `${updated}/${SYMBOLS.length} symbols, ${signalsInserted} tide signals` +
        (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""),
      metrics: { updated, signals: signalsInserted, errors: errors.length },
    };
  });
};

export const config: Config = {
  schedule: "30 22 * * 1-5", // weekdays 22:30 UTC, after US close
};
