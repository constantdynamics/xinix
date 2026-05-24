// watchlist-digest-background — Berekent top N stijgers/dalers uit de watchlist
// en stuurt een notificatie (ntfy + email) voor weekly en monthly digests.
//
// POST {"type":"daily"|"weekly"|"monthly"} → berekent + slaat op + notificeert
// GET  ?type=daily|weekly|monthly          → geeft laatste opgeslagen digest terug

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const NTFY_TOPIC   = Deno.env.get("NTFY_TOPIC")     ?? "";
const NTFY_BASE    = "https://ntfy.sh";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM  = "Xinix <noreply@constantdynamics.nl>";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")   ?? "";
const DASHBOARD_URL = "https://constantdynamics.github.io/xinix";

type DigestType = "daily" | "weekly" | "monthly";

const CFG: Record<DigestType, { field: string; n: number; emoji: string; label: string; period: string; notify: boolean }> = {
  daily:   { field: "pct_change_1d",  n: 5,  emoji: "📊", label: "Dagdigest",   period: "1 dag",   notify: false },
  weekly:  { field: "pct_change_5d",  n: 10, emoji: "📈", label: "Weekdigest",  period: "1 week",  notify: true  },
  monthly: { field: "pct_change_22d", n: 25, emoji: "📅", label: "Maanddigest", period: "~1 maand", notify: true },
};

function getClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function checkAuth(req: Request): boolean {
  const admin = Deno.env.get("ADMIN_TOKEN") ?? "";
  const cron  = Deno.env.get("CRON_SECRET") ?? "";
  return (req.headers.get("authorization") ?? "") === `Bearer ${admin}`
      || (req.headers.get("x-cron-secret") ?? "") === cron;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function dateLabel(): string {
  return new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

interface DigestRow { ticker: string; pct: number; last_close: number | null; company: string | null; }

async function sendNtfy(type: DigestType, risers: DigestRow[], fallers: DigestRow[], tickerCount: number) {
  const cfg = CFG[type];
  const half = Math.ceil(cfg.n / 2);
  const topR = risers.slice(0, half);
  const topF = fallers.slice(0, half);

  const lines: string[] = [
    `📈 Top ${topR.length} stijgers (${cfg.period}):`,
    ...topR.map((r, i) => `${i + 1}. ${r.ticker} ${fmtPct(r.pct)}`),
    ``,
    `📉 Top ${topF.length} dalers (${cfg.period}):`,
    ...topF.map((r, i) => `${i + 1}. ${r.ticker} ${fmtPct(r.pct)}`),
    ``,
    `(${tickerCount} aandelen geanalyseerd)`,
  ];

  await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: NTFY_TOPIC,
      title: `${cfg.emoji} ${cfg.label} Watchlist — ${dateLabel()}`,
      message: lines.join("\n"),
      priority: 3,
      tags: [type === "weekly" ? "chart_with_upwards_trend" : "calendar"],
      click: DASHBOARD_URL,
      actions: [{ action: "view", label: "Open Xinix", url: DASHBOARD_URL, clear: false }],
    }),
  }).catch(() => {});
}

async function sendEmail(type: DigestType, risers: DigestRow[], fallers: DigestRow[], tickerCount: number) {
  if (!RESEND_KEY || !NOTIFY_EMAIL) return;
  const cfg = CFG[type];
  const label = dateLabel();

  const riserLines = risers.map((r, i) => `  ${i + 1}. ${r.ticker.padEnd(12)} ${fmtPct(r.pct)}${r.company ? `  (${r.company})` : ""}`);
  const fallerLines = fallers.map((r, i) => `  ${i + 1}. ${r.ticker.padEnd(12)} ${fmtPct(r.pct)}${r.company ? `  (${r.company})` : ""}`);

  const text = [
    `${cfg.label} Watchlist — ${label}`,
    `Periode: ${cfg.period} | ${tickerCount} aandelen geanalyseerd`,
    ``,
    `── Top ${risers.length} stijgers ──────────────────────`,
    ...riserLines,
    ``,
    `── Top ${fallers.length} dalers ───────────────────────`,
    ...fallerLines,
    ``,
    `──────────────────────────────────────────────`,
    `Bekijk de volledige watchlist: ${DASHBOARD_URL}`,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: NOTIFY_EMAIL,
      subject: `${cfg.emoji} ${cfg.label} Watchlist — ${label}`,
      text,
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-cron-secret" } });
  }

  const sb = getClient();

  // ── GET: geef laatste opgeslagen digest(s) terug (publiek) ──────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const type = (url.searchParams.get("type") ?? "daily") as DigestType;
    const { data } = await sb
      .from("watchlist_digest")
      .select("id, type, generated_at, risers, fallers, ticker_count")
      .eq("type", type)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single();
    return new Response(JSON.stringify(data ?? null), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  }

  // ── POST: bereken en sla op ─────────────────────────────────────────────────
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({})) as { type?: string };
  const type = (body.type ?? "daily") as DigestType;
  const cfg = CFG[type] ?? CFG.daily;

  // Haal alle verse prijsdata op (max 3 dagen oud)
  const freshSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await sb
    .from("signal_price_summary")
    .select(`ticker, ${cfg.field}, last_close`)
    .not(cfg.field, "is", null)
    .gte("updated_at", freshSince);

  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { "content-type": "application/json" } });

  // Haal bedrijfsnamen op voor de tickers in het resultaat
  const allTickers = (rows ?? []).map((r) => r.ticker as string);
  const { data: companies } = await sb
    .from("signal_tickers")
    .select("ticker, company")
    .in("ticker", allTickers.slice(0, 500)); // Supabase limiet voor .in()
  const companyMap = new Map<string, string | null>((companies ?? []).map((c) => [c.ticker as string, (c.company as string | null)]));

  // Sorteer op pct field
  type RawRow = { ticker: string; last_close: number | null; [key: string]: unknown };
  const sorted = [...(rows ?? []) as RawRow[]].sort((a, b) => {
    const av = (a[cfg.field] as number | null) ?? 0;
    const bv = (b[cfg.field] as number | null) ?? 0;
    return bv - av; // DESC
  });

  const toDigestRow = (r: RawRow): DigestRow => ({
    ticker: r.ticker,
    pct: (r[cfg.field] as number) ?? 0,
    last_close: r.last_close as number | null,
    company: companyMap.get(r.ticker) ?? null,
  });

  const risers = sorted.slice(0, cfg.n).map(toDigestRow);
  const fallers = [...sorted].reverse().slice(0, cfg.n).map(toDigestRow);
  const tickerCount = sorted.length;

  // Sla op in DB
  await sb.from("watchlist_digest").insert({
    type,
    risers,
    fallers,
    ticker_count: tickerCount,
  });

  // Log
  await sb.from("signal_runs").insert({ job: `watchlist-digest-${type}`, ok: true, message: `${tickerCount} tickers, top ${cfg.n} risers/fallers opgeslagen` });

  // Notificatie voor weekly en monthly
  if (cfg.notify && NTFY_TOPIC) {
    await sendNtfy(type, risers, fallers, tickerCount);
    await sendEmail(type, risers, fallers, tickerCount);
  }

  return new Response(JSON.stringify({ ok: true, type, ticker_count: tickerCount, risers: risers.length, fallers: fallers.length, notified: cfg.notify }), {
    headers: { "content-type": "application/json" },
  });
});
