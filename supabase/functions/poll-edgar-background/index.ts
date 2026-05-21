// poll-edgar-background — haalt SEC 8-K filings op per actieve ticker en
// schrijft signal_filings + signal_events (8k_material).
// BATCH=100 tickers/run, round-robin op edgar_polled_at NULLS FIRST.
// Enkel US-genoteerde tickers (CIK beschikbaar via SEC company_tickers.json);
// niet-gevonden tickers worden gemarkeerd en overgeslagen.

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
const BUDGET_MS = 120_000;
const SLEEP_MS = 200;
const UA = Deno.env.get("SEC_USER_AGENT") ?? "SignalEdgarBot contact@example.com";
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

// ───────────── SEC EDGAR ─────────────
interface TickerCikMap { [k: string]: { cik_str: number; ticker: string; title: string }; }
interface EdgarSubmissions {
  filings: { recent: { accessionNumber: string[]; form: string[]; filingDate: string[]; primaryDocument: string[]; items?: string[]; }; };
}

async function getCikMap(): Promise<Map<string, string>> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  const json = (await res.json()) as TickerCikMap;
  const map = new Map<string, string>();
  for (const v of Object.values(json)) {
    map.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
  }
  return map;
}

async function fetchSubmissions(cik: string): Promise<EdgarSubmissions> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`EDGAR ${cik} HTTP ${res.status}`);
  return (await res.json()) as EdgarSubmissions;
}

function classify8KItems(items: string): { severity: "yellow" | "orange" | "red"; label: string; } | null {
  const list = items.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.some((i) => ["1.01", "2.01"].includes(i))) return { severity: "red", label: "Material agreement / acquisition" };
  if (list.some((i) => ["7.01", "8.01"].includes(i))) return { severity: "orange", label: "Reg FD / other material event" };
  if (list.some((i) => ["1.03", "3.01"].includes(i))) return { severity: "red", label: "Bankruptcy / delisting" };
  if (list.some((i) => ["3.02"].includes(i))) return { severity: "yellow", label: "Capital raise" };
  if (list.some((i) => ["3.03", "5.02"].includes(i))) return { severity: "yellow", label: "Governance / mgmt change" };
  return null;
}

// ───────────── main ─────────────
Deno.serve(runBackground("poll-edgar", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker")
    .eq("active", true)
    .order("edgar_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen tickers", metrics: { tickers: 0 } };

  const cikMap = await getCikMap();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const expires14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  let filingsTracked = 0, signalsInserted = 0, skipped = 0;
  const errors: string[] = [];

  for (const { ticker } of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    const cik = cikMap.get(ticker.toUpperCase());
    if (!cik) {
      skipped++;
      await sb.from("signal_tickers").update({ edgar_polled_at: nowIso }).eq("ticker", ticker);
      continue;
    }
    try {
      const subs = await fetchSubmissions(cik);
      const recent = subs.filings?.recent;
      if (recent) {
        for (let i = 0; i < recent.accessionNumber.length; i++) {
          const form = recent.form[i];
          if (!["8-K", "8-K/A"].includes(form)) continue;
          if (new Date(recent.filingDate[i]) < cutoff) continue;
          const accession = recent.accessionNumber[i];
          const items = recent.items?.[i] ?? "";
          const accNoDash = accession.replace(/-/g, "");
          const primaryDoc = recent.primaryDocument[i];
          const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${primaryDoc}`;

          const { error: uErr } = await sb.from("signal_filings").upsert(
            { ticker, accession, form, filed_at: new Date(recent.filingDate[i]).toISOString(), primary_doc_url: url, items },
            { onConflict: "accession", ignoreDuplicates: true }
          );
          if (uErr) { if (errors.length < 5) errors.push(`${ticker} upsert: ${uErr.message.slice(0, 100)}`); continue; }
          filingsTracked++;

          const cls = classify8KItems(items);
          if (cls) {
            const ok = await insertSignal(sb, {
              ticker, signal_type: "8k_material", severity: cls.severity,
              title: `${ticker} 8-K: ${cls.label}`,
              detail: `Items ${items}. ${url}`,
              payload: { accession, items, url },
              expires_at: expires14,
              dedup_key: `8k:${accession}`,
            });
            if (ok) signalsInserted++;
          }
        }
      }
      await sb.from("signal_tickers").update({ edgar_polled_at: nowIso }).eq("ticker", ticker);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (errors.length < 5) errors.push(`${ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ edgar_polled_at: new Date().toISOString() }).eq("ticker", ticker);
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: errors.length < tickers.length / 2,
    message: `${tickers.length} tickers, ${filingsTracked} filings, ${signalsInserted} signals, ${skipped} geen CIK` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { tickers: tickers.length, filings: filingsTracked, signals: signalsInserted, skipped, errors: errors.length },
  };
}));
