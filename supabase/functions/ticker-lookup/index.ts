import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

interface LookupResult {
  ticker: string;
  recognized: boolean;
  company: string | null;
  currency: string | null;
  exchange: string | null;
  error?: string;
}

async function lookupOne(ticker: string): Promise<LookupResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) Xinix/TickerLookup",
      },
    });
    if (r.status === 404) {
      return {
        ticker,
        recognized: false,
        company: null,
        currency: null,
        exchange: null,
      };
    }
    if (!r.ok) {
      return {
        ticker,
        recognized: false,
        company: null,
        currency: null,
        exchange: null,
        error: `yahoo ${r.status}`,
      };
    }
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            shortName?: string;
            longName?: string;
            currency?: string;
            exchangeName?: string;
            fullExchangeName?: string;
          };
        }>;
      };
    };
    const meta = j.chart?.result?.[0]?.meta;
    if (!meta) {
      return {
        ticker,
        recognized: false,
        company: null,
        currency: null,
        exchange: null,
      };
    }
    return {
      ticker,
      recognized: true,
      company: meta.longName ?? meta.shortName ?? null,
      currency: meta.currency ?? null,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    };
  } catch (e) {
    return {
      ticker,
      recognized: false,
      company: null,
      currency: null,
      exchange: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  if (req.method !== "POST")
    return textResponse(req, "Method not allowed", { status: 405 });

  let body: { tickers?: unknown };
  try {
    body = (await req.json()) as { tickers?: unknown };
  } catch {
    return textResponse(req, "Bad JSON", { status: 400 });
  }
  const raw = Array.isArray(body.tickers) ? body.tickers : [];
  const tickers = Array.from(
    new Set(
      raw
        .map((t) => String(t ?? "").trim().toUpperCase())
        .filter((t) => /^[A-Z0-9][A-Z0-9.-]*$/.test(t))
    )
  ).slice(0, 50);

  const results: LookupResult[] = [];
  for (let i = 0; i < tickers.length; i += 4) {
    const batch = tickers.slice(i, i + 4);
    const part = await Promise.all(batch.map(lookupOne));
    results.push(...part);
    if (i + 4 < tickers.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return jsonResponse(req, { results });
});
