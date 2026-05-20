// poll-mining-news-background — scant nieuws voor mining-tickers op
// PEA/PFS/DFS/permit/bonanza-patronen en schrijft signal_events +
// signal_catalysts (status: "pending" zodat de scorer ze oppikt).
//
// 60 tickers per run, round-robin op mining_news_polled_at NULLS FIRST.
// Fixes t.o.v. origineel:
//   - status "occurred" -> "pending"  (was de reden van 0 mining-catalysts)
//   - round-robin batch ipv alle 820 tickers ineens (was de timeoutreden)
//   - bron: Google News RSS i.p.v. Yahoo ticker-nieuwszoek. Yahoo's
//     ticker-search gaf algemene beursjournalistiek; Google News RSS
//     indexeert de bedrijfs-persberichten (resource estimate, PEA, permit
//     granted, …) waar de catalyst-patronen op matchen. Mining-catalysts
//     zijn zelden vooraf gedateerd (geen PDUFA-equivalent) — dit is dus
//     supersnel-reactief: Google indexeert persberichten binnen minuten.

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
const UA = "Mozilla/5.0 (compatible; SignalMiningBot/1.0; +https://github.com)";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────── nieuws-bron ─────────────
interface NewsItem { uuid?: string; title?: string; link?: string; publisher?: string; providerPublishTime?: number; summary?: string; }

// Minimale HTML-entity decode + tag-strip voor RSS-velden.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function extractTag(block: string, tag: string): string {
  // <![CDATA[ ... ]]> of platte inhoud
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

// Google News RSS — indexeert bedrijfs-persberichten (resource estimate,
// PEA/PFS/DFS, permit granted, drill results) die de catalyst-patronen
// hieronder herkennen. Gratis, geen key.
async function searchNews(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}"`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const xml = await res.text();
  const out: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && out.length < 25) {
    const block = m[1];
    const rawTitle = decodeEntities(extractTag(block, "title"));
    // Google News-titels hebben een " - Bron"-suffix; die laten we staan
    // (schaadt de pattern-match niet) maar de summary stripen we wel.
    const link = decodeEntities(extractTag(block, "link"));
    const summary = decodeEntities(stripHtml(extractTag(block, "description")));
    const pub = extractTag(block, "pubDate");
    const ts = pub ? Math.floor(new Date(pub).getTime() / 1000) : undefined;
    if (rawTitle) {
      out.push({
        title: rawTitle, link, summary,
        providerPublishTime: Number.isFinite(ts) ? ts : undefined,
        uuid: link || `${query}:${rawTitle.slice(0, 80)}`,
      });
    }
  }
  return out;
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

// ───────────── patterns ─────────────
interface Pat { type: string; severity: "yellow" | "orange" | "red"; re: RegExp; label: string; catalyst?: string; }

const BONANZA: Pat[] = [
  { type: "bonanza_au", severity: "orange", re: /(\d{1,4}(?:[.,]\d+)?)\s*(?:g\s*\/\s*t|gpt|grams?\s*per\s*tonne)\s*(?:au|gold)/i, label: "high-grade Au intercept" },
  { type: "bonanza_ag", severity: "orange", re: /(\d{2,5}(?:[.,]\d+)?)\s*(?:g\s*\/\s*t|gpt|grams?\s*per\s*tonne)\s*(?:ag|silver)/i, label: "high-grade Ag intercept" },
  { type: "bonanza_cu", severity: "orange", re: /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:cu|copper)/i, label: "high-grade Cu intercept" },
];
function bonanzaTier(type: string, value: number): "none" | "orange" | "red" {
  if (type === "bonanza_au") return value >= 100 ? "red" : value >= 30 ? "orange" : "none";
  if (type === "bonanza_ag") return value >= 3000 ? "red" : value >= 1000 ? "orange" : "none";
  if (type === "bonanza_cu") return value >= 8 ? "red" : value >= 5 ? "orange" : "none";
  return "none";
}

const NEWS_PATTERNS: Pat[] = [
  { type: "resource_update", severity: "orange", re: /(?:initial\s+)?(?:mineral\s+)?resource\s+estimate|maiden\s+resource|updated?\s+resource/i, label: "Resource estimate update", catalyst: "resource_update" },
  { type: "pea", severity: "orange", re: /preliminary\s+economic\s+assessment|\bpea\b/i, label: "PEA published", catalyst: "PEA" },
  { type: "pfs", severity: "orange", re: /pre[\s-]?feasibility\s+study|\bpfs\b/i, label: "PFS published", catalyst: "PFS" },
  { type: "dfs", severity: "orange", re: /(?:definitive|bankable)\s+feasibility|\bdfs\b/i, label: "DFS published", catalyst: "DFS" },
  { type: "permit", severity: "red", re: /(?:mining|construction|environmental|operating|exploration)\s+(?:permit|licen[cs]e|approval)|(?:permit|licen[cs]e)\s+(?:granted|approved|received|awarded|issued)|environmental\s+approval|\beia\s+approv/i, label: "Permit granted", catalyst: "permit" },
  { type: "jv_strategic", severity: "yellow", re: /(?:strategic\s+)?(?:joint\s+venture|earn[-\s]?in\b|cornerstone\s+investment)/i, label: "JV / strategic investment" },
  { type: "first_pour", severity: "orange", re: /first\s+gold\s+pour|commercial\s+production\s+(?:declared|achieved|announced)/i, label: "First pour / commercial production" },
  { type: "takeover_bid", severity: "red", re: /(?:takeover|acquisition|all[-\s]?cash)\s+(?:offer|bid|proposal)|(?:definitive|binding)\s+agreement\s+to\s+(?:acquire|be\s+acquired)|to\s+be\s+acquired\s+(?:for|by)/i, label: "Takeover bid" },
  { type: "discovery_announcement", severity: "red", re: /(?:announces?|reports?)\s+(?:major\s+|significant\s+|new\s+)?(?:high[-\s]?grade\s+)?(?:gold\s+|silver\s+|copper\s+)?discovery|new\s+(?:high[-\s]?grade\s+)?zone\s+discovered/i, label: "Discovery announcement" },
  { type: "financing", severity: "yellow", re: /(?:bought\s+deal|private\s+placement|prospectus\s+offering)\s+(?:financing|of)/i, label: "Equity financing" },
  { type: "step_out_drill", severity: "orange", re: /step[-\s]?out\s+drill|extends?\s+mineralization|expands?\s+(?:high[-\s]?grade\s+)?zone/i, label: "Step-out drill / zone extension" },
];

// ───────────── main ─────────────
Deno.serve(runBackground("poll-mining-news", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();

  const { data: tickers } = await sb
    .from("signal_tickers")
    .select("ticker, company, commodity")
    .eq("active", true)
    .eq("sector", "mining")
    .order("mining_news_polled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (!tickers?.length) return { ok: true, message: "geen mining-tickers", metrics: { tickers: 0 } };

  const cutoff = Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const expires14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  let signalsInserted = 0, catalystsAdded = 0, scanned = 0;
  const errors: string[] = [];

  for (const t of tickers) {
    if (Date.now() - startMs > BUDGET_MS) break;
    const nowIso = new Date().toISOString();
    try {
      // Zoek op bedrijfsnaam — bij Google News geeft dat de persberichten;
      // een kale ticker ("ABC") is te ambigu. Ticker alleen als fallback.
      let news = t.company ? await searchNews(t.company) : [];
      if (news.length === 0) news = await searchNews(t.ticker);

      for (const item of news) {
        if (!item.title) continue;
        if (item.providerPublishTime && item.providerPublishTime < cutoff) continue;
        scanned++;
        const haystack = `${item.title} ${item.summary ?? ""}`;
        const link = item.link ?? "";
        const uniq = item.uuid ?? `${t.ticker}:${item.title.slice(0, 80)}`;

        for (const p of BONANZA) {
          const m = haystack.match(p.re);
          if (!m) continue;
          const value = Number((m[1] ?? "").replace(",", "."));
          if (!Number.isFinite(value)) continue;
          const tier = bonanzaTier(p.type, value);
          if (tier === "none") continue;
          const ok = await insertSignal(sb, { ticker: t.ticker, signal_type: p.type, severity: tier, title: `${t.ticker}: ${p.label} (${value}${p.type === "bonanza_cu" ? "%" : " g/t"})`, detail: `${item.title}${link ? `\n${link}` : ""}`, expires_at: expires14, dedup_key: `${p.type}:${uniq}` });
          if (ok) signalsInserted++;
        }

        for (const p of NEWS_PATTERNS) {
          if (!p.re.test(haystack)) continue;
          const ok = await insertSignal(sb, { ticker: t.ticker, signal_type: p.type, severity: p.severity, title: `${t.ticker}: ${p.label}`, detail: `${item.title}${link ? `\n${link}` : ""}`, expires_at: expires14, dedup_key: `${p.type}:${uniq}` });
          if (ok) signalsInserted++;

          if (p.catalyst) {
            const { data: existing } = await sb.from("signal_catalysts").select("id")
              .eq("ticker", t.ticker).eq("source", "google-news").eq("source_id", uniq).maybeSingle();
            if (!existing) {
              await sb.from("signal_catalysts").insert({
                ticker: t.ticker, sector: "mining",
                catalyst_type: p.catalyst,
                description: item.title,
                expected_date: new Date().toISOString().slice(0, 10),
                source: "google-news", source_id: uniq,
                status: "pending",
              });
              catalystsAdded++;
            }
          }
          break;
        }
      }
      await sb.from("signal_tickers").update({ mining_news_polled_at: nowIso }).eq("ticker", t.ticker);
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (errors.length < 5) errors.push(`${t.ticker}: ${msg}`);
      await sb.from("signal_tickers").update({ mining_news_polled_at: new Date().toISOString() }).eq("ticker", t.ticker);
    }
    await sleep(SLEEP_MS);
  }

  return {
    ok: errors.length < tickers.length / 2,
    message: `${tickers.length} tickers, ${scanned} items gescand, ${signalsInserted} signals, ${catalystsAdded} catalysts` + (errors.length ? `; ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { tickers: tickers.length, scanned, signals: signalsInserted, catalysts: catalystsAdded, errors: errors.length },
  };
}));
