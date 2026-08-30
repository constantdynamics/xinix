import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }
function tt(req: Request, body: string, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string,string>|undefined) } }); }
function runBackground(job: string, fn: () => Promise<RunResult>) { return async (req: Request) => { const p = pf(req); if (p) return p; if (!checkAdminOrCron(req)) return tt(req, "Unauthorized", { status: 401 }); try { const r = await logRun(job, fn); return j(req, { ok: r.ok, ...r }, { status: r.ok ? 200 : 500 }); } catch (e) { return j(req, { ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }; }

// Backfill van signal_price_summary.pct_change_6mo (~6 maanden koersverandering,
// getoond als 6M-kolom op het Favorieten-tabblad).
//
// poll-prices vult die kolom alleen als de beurs van een ticker open is; bij een
// nieuwe kolom duurt het daardoor tot de volgende handelsdag voor er iets staat.
// Deze functie kan altijd draaien en raakt uitsluitend die ene kolom aan — geen
// koersen, geen signalen, geen poll-status. Draai hem tot "0 bijgewerkt".
// Favorieten gaan voor, want daar wordt de kolom getoond.
const BUDGET_MS = 110_000;
const PAGE = 1000;
const YAHOO_DELAY_MS = 120;

interface Bar { date: string; close: number; }
async function fetchYahoo1y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BiotechSignalBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp?: number[]; indicators: { quote: Array<{ close?: (number | null)[] }> } }>; error?: { description?: string } | null } };
  const result = json.chart.result?.[0];
  if (!result) throw new Error(json.chart.error?.description ?? "no result");
  const ts = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];
  const out: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && Number.isFinite(c)) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  return out;
}
function pct(a: number, b: number): number { if (!b) return 0; return ((a - b) / b) * 100; }

// Alle tickers van een selectie ophalen, langs de 1000-rijencap heen.
type TickerPage = PromiseLike<{ data: Array<{ ticker: string }> | null; error: { message?: string } | null }>;
async function pageTickers(fetchPage: (from: number, to: number) => TickerPage): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = data ?? [];
    for (const r of rows) out.push(r.ticker);
    if (rows.length < PAGE) break;
  }
  return out;
}

Deno.serve(runBackground("backfill-6mo", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const missing = await pageTickers((f, t) => sb.from("signal_price_summary").select("ticker").is("pct_change_6mo", null).order("ticker").range(f, t));
  if (missing.length === 0) return { ok: true, message: "alle tickers hebben al een 6M-waarde", metrics: { candidates: 0 } };

  // Gebenchte en inactieve tickers overslaan — die geven toch een Yahoo-fout en
  // kosten alleen tijdsbudget.
  const skipSet = new Set(await pageTickers((f, t) => sb.from("signal_tickers").select("ticker").or("price_benched.eq.true,active.eq.false").order("ticker").range(f, t)));
  const { data: favData } = await sb.from("xinix_favorites").select("ticker");
  const favSet = new Set((favData ?? []).map((f) => f.ticker as string));

  const candidates = missing.filter((t) => !skipSet.has(t));
  candidates.sort((a, b) => (favSet.has(b) ? 1 : 0) - (favSet.has(a) ? 1 : 0));

  let processed = 0, updated = 0, short = 0, failed = 0;
  const errors: string[] = [];
  const cutoff6mo = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const ticker of candidates) {
    if (Date.now() - startMs > BUDGET_MS) break;
    processed++;
    try {
      const bars = await fetchYahoo1y(ticker);
      const last = bars[bars.length - 1];
      let sixMonthsAgo: Bar | null = null;
      for (let i = bars.length - 1; i >= 0; i--) {
        if (bars[i].date <= cutoff6mo) { sixMonthsAgo = bars[i]; break; }
      }
      if (!last || !sixMonthsAgo) { short++; continue; }
      const { error } = await sb.from("signal_price_summary").update({ pct_change_6mo: pct(last.close, sixMonthsAgo.close) }).eq("ticker", ticker);
      if (error) { failed++; if (errors.length < 5) errors.push(`${ticker}: ${error.message}`); }
      else updated++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(`${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, YAHOO_DELAY_MS));
  }

  const remaining = candidates.length - processed;
  return {
    ok: failed < Math.max(processed / 2, 1),
    message: `${updated} bijgewerkt, ${short} te korte historie, ${failed} mislukt, ${remaining} nog te doen` + (errors.length ? `; bv: ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { candidates: candidates.length, processed, updated, short_history: short, failed, remaining },
  };
}));
