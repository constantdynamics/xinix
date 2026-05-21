// poll-fundamentals-background — haalt Yahoo quoteSummary op per ticker en
// vult fundamentele kolommen op signal_tickers. 80 tickers per run,
// round-robin op fundamentals_polled_at NULLS FIRST (niet-gepolled eerst).
//
// Mapping Yahoo -> signal_tickers:
//   summaryDetail.marketCap.raw           -> market_cap_usd (altijd overschrijven)
//   defaultKeyStatistics.sharesOutstanding -> share_count_millions (altijd overschrijven)
//   defaultKeyStatistics.heldPercentInsiders -> insider_ownership_pct (alleen als NULL)
//   assetProfile.country                  -> jurisdiction (alleen als NULL)
//   assetProfile.sector/industry          -> yahoo_sector / yahoo_industry (informatief)
//   financialData cash + fcf              -> cash_runway_months (alleen als NULL, biotech/mining)
//   summaryDetail.dividendYield           -> dividend_yield (altijd overschrijven)
//
// Fallback (geen crumb): query1 v7/finance/quote geeft marketCap + shares + dividendYield.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { checkAuth, checkCron, checkAdminOrCron } from "../_shared/auth.ts";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> {
  const sb = getServiceClient();
  const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single();
  const id = row?.id as number | undefined;
  try {
    const r = await fn();
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id);
    throw e;
  }
}
function runBackground(job: string, fn: () => Promise<RunResult>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!checkAdminOrCron(req)) return new Response("Unauthorized", { status: 401 });
    try {
      const r = await logRun(job, fn);
      return new Response(JSON.stringify({ ok: r.ok, ...r }), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, message: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "content-type": "application/json" } });
    }
  };
}

// ───────────── config ─────────────
const BATCH = 100;
const BUDGET_MS = 130_000;
const SLEEP_MS = 250;
const UA = "Mozilla/5.0 (compatible; XinixFundamentalsBot/1.0)";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── helpers ─────────────
function dig(obj: unknown, ...path: (string | number)[]): unknown {
  let v: unknown = obj;
  for (const k of path) {
    if (v == null) return undefined;
    if (Array.isArray(v)) { v = (v as unknown[])[k as number]; continue; }
    if (typeof v === "object") { v = (v as Record<string, unknown>)[String(k)]; continue; }
    return undefined;
  }
  return v;
}
function numVal(obj: unknown, ...path: (string | number)[]): number | null {
  const v = dig(obj, ...path);
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : null;
  return n != null && isFinite(n) ? n : null;
}
function strVal(obj: unknown, ...path: (string | number)[]): string | null {
  const v = dig(obj, ...path);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ───────────── Yahoo crumb ─────────────
// Supabase edge functions run on Deno 1.40+ which supports Headers.getSetCookie().
type HeadersWithGSC = Headers & { getSetCookie(): string[] };
function getSetCookies(h: Headers): string[] {
  return typeof (h as HeadersWithGSC).getSetCookie === "function"
    ? (h as HeadersWithGSC).getSetCookie()
    : (h.get("set-cookie") ?? "").split(/,\s*(?=[A-Za-z_])/).filter(Boolean);
}

async function fetchCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const r1 = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA }, redirect: "manual" });
    let cookies = getSetCookies(r1.headers).map((c) => c.split(";")[0].trim()).filter(Boolean);
    if (!cookies.length) {
      const loc = r1.headers.get("location");
      if (!loc) return null;
      const r1b = await fetch(loc, { headers: { "User-Agent": UA }, redirect: "manual" });
      cookies = getSetCookies(r1b.headers).map((c) => c.split(";")[0].trim()).filter(Boolean);
      if (!cookies.length) return null;
    }
    const cookieStr = cookies.join("; ");
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookieStr },
    });
    if (!r2.ok) return null;
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 64 || crumb.includes("<")) return null;
    return { crumb, cookie: cookieStr };
  } catch { return null; }
}

// ───────────── Yahoo API calls ─────────────
async function fetchSummary(ticker: string, crumb: string, cookie: string): Promise<Record<string, unknown> | null> {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail%2CdefaultKeyStatistics%2CassetProfile%2CfinancialData&crumb=${encodeURIComponent(crumb)}`;
  let res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } });
  if (res.status === 429) { await sleep(2000); res = await fetch(url, { headers: { "User-Agent": UA, Cookie: cookie } }); }
  if (!res.ok) return null;
  try { return (await res.json()) as Record<string, unknown>; } catch { return null; }
}

async function fetchFallback(ticker: string): Promise<Record<string, unknown> | null> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
  let res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status === 429) { await sleep(2000); res = await fetch(url, { headers: { "User-Agent": UA } }); }
  if (!res.ok) return null;
  try { return (await res.json()) as Record<string, unknown>; } catch { return null; }
}

// ───────────── main ─────────────
Deno.serve(runBackground("poll-fundamentals", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const crumbData = await fetchCrumb();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker, sector, jurisdiction, cash_runway_months, insider_ownership_pct")
    .eq("active", true)
    .eq("price_benched", false)
    .order("fundamentals_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen tickers", metrics: { polled: 0, ok: 0, fail: 0 } };

  let okCount = 0, failCount = 0;
  const errMsgs: string[] = [];

  for (const t of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    try {
      let rawJson: Record<string, unknown> | null = null;
      let usedFallback = false;

      if (crumbData) rawJson = await fetchSummary(t.ticker, crumbData.crumb, crumbData.cookie);
      if (!rawJson) { usedFallback = true; rawJson = await fetchFallback(t.ticker); }
      if (!rawJson) throw new Error("geen data van Yahoo");

      let marketCap: number | null = null;
      let shareCountM: number | null = null;
      let insiderOwn: number | null = null;
      let country: string | null = null;
      let yahooSector: string | null = null;
      let yahooIndustry: string | null = null;
      let totalCash: number | null = null;
      let freeCashflow: number | null = null;
      let divYield: number | null = null;

      if (!usedFallback) {
        const qErr = dig(rawJson, "quoteSummary", "error");
        if (qErr != null) throw new Error(`Yahoo fout: ${JSON.stringify(qErr).slice(0, 100)}`);
        const r = dig(rawJson, "quoteSummary", "result", 0) as Record<string, unknown> | null;
        if (!r) throw new Error("quoteSummary leeg");
        const sd = (r.summaryDetail ?? {}) as Record<string, unknown>;
        const ks = (r.defaultKeyStatistics ?? {}) as Record<string, unknown>;
        const ap = (r.assetProfile ?? {}) as Record<string, unknown>;
        const fd = (r.financialData ?? {}) as Record<string, unknown>;
        marketCap = numVal(sd, "marketCap", "raw");
        const sharesOut = numVal(ks, "sharesOutstanding", "raw");
        shareCountM = sharesOut != null ? sharesOut / 1e6 : null;
        insiderOwn = numVal(ks, "heldPercentInsiders", "raw");
        country = strVal(ap, "country");
        yahooSector = strVal(ap, "sector");
        yahooIndustry = strVal(ap, "industry");
        totalCash = numVal(fd, "totalCash", "raw");
        freeCashflow = numVal(fd, "freeCashflow", "raw");
        divYield = numVal(sd, "dividendYield", "raw") ?? numVal(sd, "trailingAnnualDividendYield", "raw");
      } else {
        const r = dig(rawJson, "quoteResponse", "result", 0) as Record<string, unknown> | null;
        if (!r) throw new Error("quoteResponse leeg");
        marketCap = numVal(r, "marketCap");
        const sharesOut = numVal(r, "sharesOutstanding");
        shareCountM = sharesOut != null ? sharesOut / 1e6 : null;
        divYield = numVal(r, "dividendYield") ?? numVal(r, "trailingAnnualDividendYield");
      }

      // cash_runway_months: alleen voor biotech/mining, alleen als NULL
      let cashRunway: number | null = null;
      if ((t.sector === "biotech" || t.sector === "mining") && totalCash != null && freeCashflow != null) {
        if (freeCashflow >= 0) {
          cashRunway = 60; // cash-flow-positief -> max runway
        } else {
          const burnPerMonth = Math.abs(freeCashflow) / 12;
          cashRunway = burnPerMonth > 0 ? Math.min(60, Math.max(1, Math.round(totalCash / burnPerMonth))) : null;
        }
      }

      // Build update: market_cap + shares altijd; rest alleen als NULL
      const upd: Record<string, unknown> = { fundamentals_polled_at: nowIso, fundamentals_last_error: null };
      if (marketCap != null) upd.market_cap_usd = Math.round(marketCap);
      if (shareCountM != null) upd.share_count_millions = Math.round(shareCountM * 100) / 100;
      if (insiderOwn != null && t.insider_ownership_pct == null) upd.insider_ownership_pct = insiderOwn;
      if (country && !t.jurisdiction) upd.jurisdiction = country;
      if (cashRunway != null && t.cash_runway_months == null) upd.cash_runway_months = cashRunway;
      if (yahooSector) upd.yahoo_sector = yahooSector;
      if (yahooIndustry) upd.yahoo_industry = yahooIndustry;
      if (divYield != null) upd.dividend_yield = divYield;

      await sb.from("signal_tickers").update(upd).eq("ticker", t.ticker);
      okCount++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      if (errMsgs.length < 5) errMsgs.push(`${t.ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ fundamentals_polled_at: nowIso, fundamentals_last_error: msg }).eq("ticker", t.ticker);
      failCount++;
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: failCount < tickers.length / 2,
    message: `${tickers.length} gepolled, ${okCount} ok, ${failCount} fout` + (errMsgs.length ? `; ${errMsgs.slice(0, 3).join("; ")}` : ""),
    metrics: { polled: tickers.length, ok: okCount, fail: failCount, crumb_ok: crumbData != null },
  };
}));
