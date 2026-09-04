// ticker-lookup — verifieert tickers bij Yahoo en geeft bedrijfsnaam, beurs,
// valuta én koers-context terug. De koers-context (laatste slotkoers +
// 5-jaars bodem/top) komt uit dezelfde chart-call en wordt in de UI gebruikt
// om een aankooplimiet voor te stellen vóórdat een aandeel wordt toegevoegd.
//
// Input: { tickers: string[] } of { tickers: Array<{ticker, name?, currency?}> }
// De tweede vorm doet "smart resolve": met een currency-hint proberen we
// eerst de juiste beurssuffix (ANTA + HKD -> 2020.HK) en vallen we terug op
// Yahoo's naam-zoekfunctie.

import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

interface LookupResult {
  ticker: string; // opgeloste ticker
  input_ticker?: string; // origineel zoals de gebruiker 'm typte
  recognized: boolean;
  company: string | null;
  currency: string | null;
  exchange: string | null;
  last_close: number | null;
  low_5y: number | null;
  high_5y: number | null;
  error?: string;
}

interface LookupItem {
  ticker: string;
  name?: string;
  currency?: string;
}

function miss(ticker: string, error?: string): LookupResult {
  return {
    ticker,
    recognized: false,
    company: null,
    currency: null,
    exchange: null,
    last_close: null,
    low_5y: null,
    high_5y: null,
    ...(error ? { error } : {}),
  };
}

// Yahoo exchange codes per valuta — ruwe mapping voor het naam-zoekfilter.
const EXCH_FOR_CURRENCY: Record<string, string[]> = {
  USD: ["NMS", "NYQ", "NAS", "PCX", "ASE", "BTS", "NCM", "NGM"],
  HKD: ["HKG"],
  GBP: ["LSE", "LON", "AIM"],
  EUR: ["AMS", "PAR", "ETR", "FRA", "MIL", "BRU", "MCE", "STO", "HEL", "VIE", "DUB", "OSL", "LIS"],
  CAD: ["TSE", "TOR", "CVE", "VAN", "CNQ", "NEO"],
  AUD: ["ASX"],
  JPY: ["TOK", "JPX"],
  CHF: ["SWX", "EBS"],
};

// Weekkoersen over 5 jaar: ~260 punten per ticker in plaats van ~1250 bij
// dagkoersen. Genoeg voor een limiet-suggestie en veel lichter bij een
// batch van 50 tickers.
async function lookupOne(ticker: string): Promise<LookupResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1wk`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Xinix/TickerLookup" },
    });
    if (r.status === 404) return miss(ticker);
    if (!r.ok) return miss(ticker, `yahoo ${r.status}`);
    const j = (await r.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            shortName?: string;
            longName?: string;
            currency?: string;
            exchangeName?: string;
            fullExchangeName?: string;
            symbol?: string;
            regularMarketPrice?: number;
          };
          indicators?: { quote?: Array<{ close?: Array<number | null> }> };
        }>;
      };
    };
    const res0 = j.chart?.result?.[0];
    const meta = res0?.meta;
    if (!meta) return miss(ticker);

    const closes = (res0?.indicators?.quote?.[0]?.close ?? []).filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0
    );
    const lastClose =
      typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
        ? meta.regularMarketPrice
        : closes.length > 0
        ? closes[closes.length - 1]
        : null;

    return {
      ticker: (meta.symbol ?? ticker).toUpperCase(),
      recognized: true,
      company: meta.longName ?? meta.shortName ?? null,
      currency: meta.currency ?? null,
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
      last_close: lastClose,
      low_5y: closes.length > 0 ? Math.min(...closes) : null,
      high_5y: closes.length > 0 ? Math.max(...closes) : null,
    };
  } catch (e) {
    return miss(ticker, e instanceof Error ? e.message : String(e));
  }
}

interface YahooSearchHit {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
}

async function searchYahoo(query: string): Promise<YahooSearchHit[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Xinix/TickerSearch" },
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { quotes?: YahooSearchHit[] };
    return (j.quotes ?? []).filter(
      (q) => q.quoteType === "EQUITY" || q.quoteType === "ETF" || !q.quoteType
    );
  } catch {
    return [];
  }
}

// Probeer de ticker met een valuta-bewuste suffix, val terug op Yahoo's
// naam-zoekfunctie gefilterd op de verwachte beurs.
async function resolve(item: LookupItem): Promise<LookupResult> {
  const base = item.ticker.toUpperCase().trim();
  const cur = item.currency?.toUpperCase()?.trim() || null;
  const attempts: string[] = [];
  const hasSuffix = base.includes(".");

  if (cur === "HKD" && !hasSuffix) {
    if (/^\d{1,5}$/.test(base)) attempts.push(base.padStart(4, "0") + ".HK");
    else attempts.push(base + ".HK");
  } else if (cur === "GBP" && !hasSuffix) {
    attempts.push(base + ".L");
  } else if (cur === "AUD" && !hasSuffix) {
    attempts.push(base + ".AX");
  } else if (cur === "CAD" && !hasSuffix) {
    attempts.push(base + ".TO", base + ".V", base + ".CN");
  } else if (cur === "EUR" && !hasSuffix) {
    attempts.push(base + ".AS", base + ".DE", base + ".PA", base + ".MI", base + ".BR");
  } else if (cur === "CHF" && !hasSuffix) {
    attempts.push(base + ".SW");
  }
  if (!attempts.includes(base)) attempts.push(base);

  for (const sym of attempts) {
    const r = await lookupOne(sym);
    if (!r.recognized) continue;
    // Klopt de valuta met de hint, dan zijn we klaar. Zo niet, dan kan een
    // volgende poging een ander land raken dat wél klopt.
    if (!cur || (r.currency ?? "").toUpperCase() === cur) {
      return { ...r, input_ticker: item.ticker };
    }
  }

  if (item.name) {
    const hits = await searchYahoo(item.name);
    const expected = cur ? EXCH_FOR_CURRENCY[cur] ?? [] : [];
    let pick = expected.length
      ? hits.find((h) => h.exchange && expected.includes(h.exchange))
      : null;
    if (!pick && hits.length > 0) pick = hits[0];
    if (pick?.symbol) {
      const r = await lookupOne(pick.symbol);
      if (r.recognized) return { ...r, input_ticker: item.ticker };
    }
  }

  return { ...miss(item.ticker), input_ticker: item.ticker };
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

  const items: LookupItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    let item: LookupItem | null = null;
    if (typeof x === "string") {
      const s = x.trim().toUpperCase();
      if (/^[A-Z0-9][A-Z0-9.-]*$/.test(s)) item = { ticker: s };
    } else if (x && typeof x === "object" && typeof (x as LookupItem).ticker === "string") {
      const o = x as Record<string, unknown>;
      const s = String(o.ticker).trim().toUpperCase();
      if (/^[A-Z0-9][A-Z0-9.-]*$/.test(s))
        item = {
          ticker: s,
          name: typeof o.name === "string" ? o.name : undefined,
          currency: typeof o.currency === "string" ? o.currency : undefined,
        };
    }
    if (!item) continue;
    const key = `${item.ticker}|${item.currency ?? ""}|${item.name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= 50) break;
  }

  const results: LookupResult[] = [];
  for (let i = 0; i < items.length; i += 4) {
    const batch = items.slice(i, i + 4);
    const part = await Promise.all(batch.map((it) => resolve(it)));
    results.push(...part);
    if (i + 4 < items.length) await new Promise((r) => setTimeout(r, 200));
  }

  return jsonResponse(req, { results });
});
