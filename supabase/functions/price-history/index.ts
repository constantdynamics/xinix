// Koershistorie-proxy voor de koersgrafiek-popup (Favorieten).
// Yahoo's v8 chart-endpoint geeft historische candles voor elk venster maar
// stuurt geen CORS-headers — daarom proxyen we het server-side. Read-only,
// publiek (geen secrets), met cache zodat herhaald openen snel is.
const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) } });
}

// Venster → Yahoo range + interval. De interval is afgestemd op het venster
// zodat de grafiek genoeg detail heeft zonder onnodig veel punten.
const RANGE_MAP: Record<string, { range: string; interval: string }> = {
  "1d":  { range: "1d",  interval: "5m" },
  "5d":  { range: "5d",  interval: "30m" },
  "1mo": { range: "1mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y":  { range: "1y",  interval: "1d" },
  "3y":  { range: "3y",  interval: "1wk" },
  "5y":  { range: "5y",  interval: "1wk" },
  "max": { range: "max", interval: "1mo" },
};

Deno.serve(async (req) => {
  const p = pf(req); if (p) return p;
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const rangeKey = (url.searchParams.get("range") ?? "1y").trim();
  // Strikte ticker-validatie — voorkomt rare input richting de Yahoo-fetch.
  if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker)) return j(req, { error: "ongeldige ticker" }, { status: 400 });
  const mapped = RANGE_MAP[rangeKey];
  if (!mapped) return j(req, { error: "ongeldige range" }, { status: 400 });

  const qs = `range=${mapped.range}&interval=${mapped.interval}`;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; XinixChart/1.0; +https://github.com)" };
  let json: { chart?: { result?: unknown[]; error?: { description?: string } | null } } | null = null;
  // query1 met query2 als fallback — Yahoo wisselt af en toe een host af.
  for (const host of ["query1", "query2"]) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`, { headers });
      if (!res.ok) continue;
      json = await res.json();
      if (json?.chart?.result?.[0]) break;
    } catch { /* probeer de volgende host */ }
  }
  const result = json?.chart?.result?.[0] as {
    timestamp?: number[];
    indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    meta?: { currency?: string; fullExchangeName?: string; exchangeName?: string; chartPreviousClose?: number; previousClose?: number; regularMarketPrice?: number };
  } | undefined;
  if (!result) {
    return j(req, { error: json?.chart?.error?.description ?? "geen koersdata gevonden" }, { status: 502 });
  }

  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: Array<{ t: number; c: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && isFinite(c)) points.push({ t: ts[i], c });
  }
  const meta = result.meta ?? {};
  // Intraday-vensters vaker verversen, langere vensters langer cachen.
  const cacheSec = rangeKey === "1d" || rangeKey === "5d" ? 120 : 900;
  return j(req, {
    ticker,
    range: rangeKey,
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    previous_close: meta.chartPreviousClose ?? meta.previousClose ?? null,
    market_price: meta.regularMarketPrice ?? null,
    points,
  }, { headers: { "cache-control": `public, max-age=${cacheSec}` } });
});
