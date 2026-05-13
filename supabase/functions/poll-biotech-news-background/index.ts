// poll-biotech-news-background — scant Yahoo-nieuws voor biotech-tickers
// op topline/trial/FDA/deal-patronen en schrijft signal_events.
// 60 tickers/run, round-robin op biotech_news_polled_at NULLS FIRST.

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
const BATCH = 60;
const BUDGET_MS = 120_000;
const SLEEP_MS = 250;
const UA = "Mozilla/5.0 (compatible; SignalBiotechBot/1.0; +https://github.com)";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── Yahoo news ─────────────
interface NewsItem { uuid?: string; title?: string; link?: string; publisher?: string; providerPublishTime?: number; summary?: string; }

async function searchNews(query: string): Promise<NewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=20&lang=en-US`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Yahoo news HTTP ${res.status}`);
  const json = (await res.json()) as { news?: NewsItem[] };
  return json.news ?? [];
}

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

// ───────────── patronen ─────────────
interface Pat { type: string; severity: "yellow" | "orange" | "red"; re: RegExp; label: string; }

const NEGATIVE = /(?:did\s+not|failed?\s+to|miss(?:ed)?|fails?\s+to)\s+(?:meet|achieve)/i;

const PATTERNS: Pat[] = [
  { type: "topline_positive", severity: "red", re: /(?:topline|interim)\s+(?:data|results?)\s+(?:positive|favourable|favorable)|primary\s+endpoint\s+(?:met|achieved)|met\s+(?:its\s+)?primary\s+endpoint|achieved\s+statistical\s+significance|statistically\s+significant\s+(?:improvement|reduction)/i, label: "Topline data positief / primary endpoint behaald" },
  { type: "phase_success", severity: "red", re: /phase\s*(?:2|ii|3|iii)\s+(?:trial\s+)?(?:successful|positive|met)/i, label: "Phase 2/3 trial succesvol" },
  { type: "breakthrough_designation", severity: "red", re: /breakthrough\s+therapy\s+designation|granted\s+(?:fast\s+track|priority\s+review)/i, label: "Breakthrough / fast track designation" },
  { type: "licensing_deal", severity: "red", re: /licensing\s+agreement\s+(?:with|worth|valued)|exclusive\s+(?:worldwide\s+)?license\s+to|upfront\s+payment\s+of\s+\$\d/i, label: "Grote licensing deal" },
  { type: "buyout_definitive", severity: "red", re: /(?:definitive|binding)\s+agreement\s+to\s+(?:acquire|be\s+acquired)|to\s+be\s+acquired\s+(?:for|by)|all[-\s]?cash\s+(?:offer|tender)/i, label: "Definitieve overname" },
  { type: "trial_failed", severity: "red", re: /(?:phase\s*(?:2|ii|3|iii)\s+(?:trial\s+)?(?:fails?|failed))|did\s+not\s+meet\s+(?:its\s+)?primary\s+endpoint|trial\s+(?:halted|terminated)/i, label: "Trial mislukt / gestopt" },
  { type: "topline_mixed", severity: "orange", re: /mixed\s+(?:results|data)|(?:secondary|exploratory)\s+endpoint\s+met/i, label: "Gemixte / secundaire endpoint" },
];

// ───────────── main ─────────────
Deno.serve(runBackground("poll-biotech-news", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker, company")
    .eq("active", true)
    .eq("sector", "biotech")
    .order("biotech_news_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen biotech-tickers", metrics: { tickers: 0 } };

  const cutoff = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const expires14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  let signalsInserted = 0, scanned = 0;
  const errors: string[] = [];

  for (const t of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    try {
      let news = await searchNews(t.ticker);
      if (news.length === 0 && t.company) news = await searchNews(t.company);

      for (const item of news) {
        if (!item.title) continue;
        if (item.providerPublishTime && item.providerPublishTime < cutoff) continue;
        scanned++;
        const haystack = `${item.title} ${item.summary ?? ""}`;
        const link = item.link ?? "";
        const uniq = item.uuid ?? `${t.ticker}:${item.title.slice(0, 80)}`;
        const hasNegative = NEGATIVE.test(haystack);

        for (const p of PATTERNS) {
          if (!p.re.test(haystack)) continue;
          if (p.type === "topline_positive" && hasNegative) continue;
          const ok = await insertSignal(sb, {
            ticker: t.ticker, signal_type: p.type, severity: p.severity,
            title: `${t.ticker}: ${p.label}`,
            detail: `${item.title}${link ? `\n${link}` : ""}`,
            payload: { title: item.title, publisher: item.publisher, link },
            expires_at: expires14,
            dedup_key: `${p.type}:${uniq}`,
          });
          if (ok) signalsInserted++;
          break;
        }
      }
      await sb.from("signal_tickers").update({ biotech_news_polled_at: nowIso }).eq("ticker", t.ticker);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (errors.length < 5) errors.push(`${t.ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ biotech_news_polled_at: new Date().toISOString() }).eq("ticker", t.ticker);
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: errors.length < tickers.length / 2,
    message: `${tickers.length} tickers, ${scanned} items gescand, ${signalsInserted} signals` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { tickers: tickers.length, scanned, signals: signalsInserted, errors: errors.length },
  };
}));
