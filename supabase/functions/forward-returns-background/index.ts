// forward-returns-background — meet werkelijke returns 7/14/30/90 dagen na
// STRONG_BUY/BUY-scores. Haalt huidige koers op via Yahoo v8 (Stooq fallback).
// Verwerkt alleen scores van exacte doeldatums; aantal calls is klein.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
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
const TARGET_DAYS = [7, 14, 30, 90];
const UA = "Mozilla/5.0 (X11; Linux x86_64) Xinix/SignalForwardReturns";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── price fetchers ─────────────
async function fetchYahooClose(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) {
        if ((r.status === 429 || r.status >= 500) && attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        return null;
      }
      const j = (await r.json()) as { chart?: { result?: Array<{ indicators?: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote?: Array<{ close?: (number | null)[] }>; }; }>; }; };
      const result = j.chart?.result?.[0];
      const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? result?.indicators?.quote?.[0]?.close ?? [];
      for (let i = closes.length - 1; i >= 0; i--) {
        const v = closes[i];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return null;
    } catch {
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

async function fetchStooqClose(ticker: string): Promise<number | null> {
  if (ticker.includes(".")) return null;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker.toLowerCase())}.us&i=d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Xinix/ForwardReturnsFallback" } });
    if (!r.ok) return null;
    const csv = await r.text();
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(",");
    const close = Number(last[4]);
    return Number.isFinite(close) && close > 0 ? close : null;
  } catch { return null; }
}

async function fetchCurrentClose(ticker: string): Promise<number | null> {
  const yahoo = await fetchYahooClose(ticker);
  return yahoo ?? fetchStooqClose(ticker);
}

// ───────────── main ─────────────
interface ScoreRow { id: number; ticker: string; scan_date: string; trade_setup: { entry?: number } | null; }

Deno.serve(runBackground("forward-returns", async () => {
  const sb = getServiceClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let recorded = 0, failed = 0, skipped = 0;
  const priceCache = new Map<string, number | null>();

  for (const days of TARGET_DAYS) {
    const target = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);

    const { data: scores } = await sb
      .from("signal_scores")
      .select("id, ticker, scan_date, trade_setup")
      .eq("scan_date", target)
      .in("action", ["STRONG_BUY", "BUY"])
      .returns<ScoreRow[]>();

    if (!scores || scores.length === 0) continue;

    const ids = scores.map((s) => s.id);
    const { data: existing } = await sb
      .from("signal_forward_returns")
      .select("signal_score_id")
      .in("signal_score_id", ids)
      .eq("days_after_signal", days);
    const existingIds = new Set((existing ?? []).map((e: { signal_score_id: number }) => e.signal_score_id));

    for (const s of scores) {
      if (existingIds.has(s.id)) { skipped++; continue; }
      const entry = s.trade_setup?.entry;
      if (typeof entry !== "number") { skipped++; continue; }
      let current = priceCache.get(s.ticker);
      if (current === undefined) {
        current = await fetchCurrentClose(s.ticker);
        priceCache.set(s.ticker, current);
        await sleep(250);
      }
      if (current == null) { failed++; continue; }
      const ret = (current - entry) / entry;
      const { error } = await sb.from("signal_forward_returns").upsert(
        {
          signal_score_id: s.id, ticker: s.ticker, signal_date: s.scan_date,
          measurement_date: todayStr, days_after_signal: days,
          entry_price: entry, measurement_price: current, return_pct: +ret.toFixed(4),
        },
        { onConflict: "signal_score_id,days_after_signal" }
      );
      if (error) { failed++; } else { recorded++; }
    }
  }

  return {
    ok: true,
    message: `recorded=${recorded} failed=${failed} skipped=${skipped}`,
    metrics: { recorded, failed, skipped },
  };
}));
