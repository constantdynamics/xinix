// poll-fda-background — checkt OpenFDA op recente goedkeuringen per
// biotech-ticker en schrijft signal_events. 80 tickers/run, round-robin
// op fda_polled_at NULLS FIRST.

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
const BATCH = 80;
const BUDGET_MS = 120_000;
const SLEEP_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── signal_events dedup insert ─────────────
type SB = ReturnType<typeof getServiceClient>;
async function insertSignal(sb: SB, opts: { ticker: string; signal_type: string; severity: string; title: string; detail?: string; payload?: Json; expires_at?: string; dedup_key: string; }): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: ex } = await sb.from("signal_events").select("id")
    .eq("ticker", opts.ticker).eq("signal_type", opts.signal_type)
    .gte("detected_at", since)
    .contains("payload", { dedup_key: opts.dedup_key })
    .limit(1);
  if (ex && ex.length > 0) return false;
  await sb.from("signal_events").insert({
    ticker: opts.ticker, signal_type: opts.signal_type, severity: opts.severity,
    title: opts.title, detail: opts.detail ?? null,
    payload: { ...(opts.payload ?? {}), dedup_key: opts.dedup_key },
    expires_at: opts.expires_at ?? null,
  });
  return true;
}

// ───────────── OpenFDA ─────────────
interface FDAResult {
  application_number?: string;
  sponsor_name?: string;
  openfda?: { brand_name?: string[]; generic_name?: string[] };
  submissions?: Array<{ submission_status?: string; submission_status_date?: string; submission_type?: string; submission_class_code?: string; }>;
}

async function searchSponsor(sponsor: string): Promise<FDAResult[]> {
  const url = `https://api.fda.gov/drug/drugsfda.json?search=${encodeURIComponent(`sponsor_name:"${sponsor.replace(/"/g, "")}"`)}&&limit=20`;
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`OpenFDA HTTP ${res.status}`);
  const json = (await res.json()) as { results?: FDAResult[] };
  return json.results ?? [];
}

// ───────────── main ─────────────
Deno.serve(runBackground("poll-fda", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker, company")
    .eq("active", true)
    .eq("sector", "biotech")
    .order("fda_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen biotech-tickers", metrics: { tickers: 0 } };

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const expires30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  let signalsInserted = 0;
  const errors: string[] = [];

  for (const t of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    try {
      const results = await searchSponsor(t.company);
      for (const r of results) {
        const sub = r.submissions?.find((s) => {
          if (s.submission_status !== "AP" || !s.submission_status_date) return false;
          const d = s.submission_status_date;
          return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`) > cutoff;
        });
        if (!sub) continue;
        const drug = r.openfda?.brand_name?.[0] ?? r.openfda?.generic_name?.[0] ?? r.application_number ?? "drug";
        const d = sub.submission_status_date!;
        const dateIso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const ok = await insertSignal(sb, {
          ticker: t.ticker, signal_type: "fda_approval", severity: "red",
          title: `${t.ticker}: FDA approval — ${drug}`,
          detail: `Application ${r.application_number}, ${sub.submission_type ?? ""} ${sub.submission_class_code ?? ""} approved ${dateIso}.`,
          payload: { application: r.application_number, drug, date: dateIso },
          expires_at: expires30,
          dedup_key: `fda_approval:${r.application_number}:${dateIso}`,
        });
        if (ok) signalsInserted++;
      }
      await sb.from("signal_tickers").update({ fda_polled_at: nowIso }).eq("ticker", t.ticker);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (errors.length < 5) errors.push(`${t.ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ fda_polled_at: new Date().toISOString() }).eq("ticker", t.ticker);
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: errors.length < tickers.length / 2,
    message: `${tickers.length} tickers, ${signalsInserted} signals` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { tickers: tickers.length, signals: signalsInserted, errors: errors.length },
  };
}));
