import type { Config } from "@netlify/functions";

// POST /api/ticker-lookup
// Body: { tickers: string[] }   (max 50 per call)
// Resp: { results: [{ ticker, recognized, company, currency? }, ...] }
//
// Yahoo chart endpoint geeft 200 met meta.shortName/longName als de ticker
// bestaat, en 404/lege chart als niet. Geen API key nodig. Alleen voor
// admins want Yahoo limiteert per IP — niet als publieke proxy openzetten.

function checkAuth(req: Request): boolean {
  const required = Netlify.env.get("ADMIN_TOKEN");
  if (!required) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

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
        error?: { description?: string } | null;
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

export default async (req: Request) => {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });

  let body: { tickers?: unknown };
  try {
    body = (await req.json()) as { tickers?: unknown };
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const raw = Array.isArray(body.tickers) ? body.tickers : [];
  const tickers = Array.from(
    new Set(
      raw
        .map((t) => String(t ?? "").trim().toUpperCase())
        .filter((t) => /^[A-Z0-9][A-Z0-9.-]*$/.test(t))
    )
  ).slice(0, 50);

  // Pacing: 4 parallel, 200ms tussen batches. Yahoo throttelt vrij snel.
  const results: LookupResult[] = [];
  for (let i = 0; i < tickers.length; i += 4) {
    const batch = tickers.slice(i, i + 4);
    const part = await Promise.all(batch.map(lookupOne));
    results.push(...part);
    if (i + 4 < tickers.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/ticker-lookup",
};
