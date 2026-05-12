import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
type Severity = "yellow" | "orange" | "red";
const SEVERITY_RANK: Record<Severity, number> = { yellow: 1, orange: 2, red: 3 };
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }
function tt(req: Request, body: string, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string,string>|undefined) } }); }
function runBackground(job: string, fn: () => Promise<RunResult>) { return async (req: Request) => { const p = pf(req); if (p) return p; if (!checkAdminOrCron(req)) return tt(req, "Unauthorized", { status: 401 }); try { const r = await logRun(job, fn); return j(req, { ok: r.ok, ...r }, { status: r.ok ? 200 : 500 }); } catch (e) { return j(req, { ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }; }

interface Settings { email: string | null; ntfy_topic: string | null; ntfy_server: string; alert_email_threshold: Severity; alert_ntfy_threshold: Severity; quiet_hours_start: number | null; quiet_hours_end: number | null; alert_only_goud_events: boolean; }

// Notificatie-beleid (wens owner): alleen pings die ook echt actie vragen.
//   1. Buy-limit events  -> ALTIJD pushen (de owner heeft die limiet zelf gezet).
//   2. Bullish catalyst events -> alleen pushen als de score-actie BUY of
//      STRONG_BUY is ("alleen aandelen die het systeem sterk aanbeveelt").
// Al het andere (8-K-ruis, koersdalingen/big_drop, near-low, trial failures,
// financiering, JV-nieuws, volume spikes, generieke price spikes) wordt NIET
// gepusht — dat staat wel gewoon op het dashboard.
const LIMIT_EVENT_TYPES = new Set<string>([
  "buy_limit_hit",
  "buy_limit_close",
  "buy_limit_warmup",
]);
const BULLISH_CATALYST_TYPES = new Set<string>([
  "bonanza_au", "bonanza_ag", "bonanza_cu",
  "discovery_announcement", "permit", "first_pour", "resource_update",
  "pea", "pfs", "dfs", "step_out_drill",
  "takeover_bid", "buyout_definitive",
  "fda_approval", "topline_positive", "phase_success",
  "breakthrough_designation", "licensing_deal",
]);
const POSITIVE_ACTIONS = new Set<string>(["BUY", "STRONG_BUY"]);

// Bepaalt of een signaal überhaupt een notificatie waard is.
function shouldNotify(signalType: string, action: string | null | undefined): boolean {
  if (LIMIT_EVENT_TYPES.has(signalType)) return true;
  if (BULLISH_CATALYST_TYPES.has(signalType) && action != null && POSITIVE_ACTIONS.has(action)) return true;
  return false;
}

function inQuietHours(s: Settings): boolean { if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false; const h = new Date().getUTCHours(); const start = s.quiet_hours_start; const end = s.quiet_hours_end; if (start === end) return false; if (start < end) return h >= start && h < end; return h >= start || h < end; }
async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> { const key = Deno.env.get("RESEND_API_KEY"); const from = Deno.env.get("RESEND_FROM") ?? "Xinix Signal <onboarding@resend.dev>"; if (!key) return { ok: false, error: "RESEND_API_KEY missing" }; const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to, subject, text }) }); if (!res.ok) { const body = await res.text(); return { ok: false, error: `Resend ${res.status}: ${body}` }; } return { ok: true }; }

// Plak een zero-width space tussen ticker base en suffix zodat
// notification clients .TO / .V / .AX niet als TLD herkennen en
// auto-linkificeren. Visueel onzichtbaar.
function safeTickerDisplay(ticker: string): string {
  return ticker.replace(/\./g, "​.");
}

async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
  if (clickUrl) payload.click = clickUrl;
  const res = await fetch(server.replace(/\/$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const text = await res.text(); return { ok: false, error: `ntfy ${res.status}: ${text}` }; }
  return { ok: true };
}
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO", L: "LON", DE: "ETR", F: "FRA", SG: "STU", MU: "MUN", BE: "BER", DU: "DUS", HM: "HAM", SW: "SWX", VI: "VIE", PA: "EPA", AS: "AMS", BR: "EBR", LS: "ELI", MI: "BIT", MC: "BME", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", WA: "WSE", AT: "ATH", HK: "HKG", T: "TYO", SS: "SHA", SZ: "SHE", KS: "KRX", KQ: "KOSDAQ", TW: "TPE", TWO: "TPE", NS: "NSE", BO: "BOM", SI: "SGX", JK: "IDX", KL: "KLSE", BK: "BKK", AX: "ASX", NZ: "NZE", TA: "TLV", IS: "IST", SR: "TADAWUL", JO: "JSE", SA: "BVMF", MX: "BMV", BA: "BCBA", SN: "SGO" };
function googleFinanceUrl(ticker: string): string { const t = ticker.trim().toUpperCase(); const dot = t.indexOf("."); if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`; const base = t.slice(0, dot); const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)]; if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`; return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`; }
interface ScoreSnapshot { action: string; final_score: number; expected_outcome: { catalystLabel?: string; peakReturnEst?: number; t90ReturnEst?: number; hitRateBaseline?: number; expectedPeakPrice?: number | null; expectedT90Price?: number | null; exitWindowDays?: number; } | null; components: { nearest_catalyst?: { type?: string; daysUntil?: number | null; date?: string | null; } | null; } | null; trade_setup: { entry?: number; target?: number; stop?: number; rr?: number; } | null; }
function pct(x: number | null | undefined): string { if (x == null || !Number.isFinite(x)) return "?"; return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`; }
function fmtPrice(x: number | null | undefined): string { if (x == null || !Number.isFinite(x)) return "?"; return `$${x.toFixed(x < 5 ? 3 : 2)}`; }
function fmtDate(iso: string | null | undefined): string | null { if (!iso) return null; return iso.slice(0, 10); }
interface AlertView { title: string; body: string; priority: number; tags: string[]; }
interface Medals { gold: number; silver: number; bronze: number; }
function medalLine(m: Medals | null): string | null {
  if (!m || (m.gold + m.silver + m.bronze) === 0) return null;
  const parts: string[] = [];
  if (m.gold > 0) parts.push(`\u{1F947}${m.gold}`);
  if (m.silver > 0) parts.push(`\u{1F948}${m.silver}`);
  if (m.bronze > 0) parts.push(`\u{1F949}${m.bronze}`);
  return `${parts.join(" ")} (medailles, 5y koers-runs)`;
}

// Notificatie-presentatie. Twee smaken:
//  - limiet-event: titel "💰 TICKER · <reden>" (geen score-actie in de titel
//    want die is voor de meeste micro-caps AVOID en dat verwart).
//  - bullish catalyst (alleen BUY/STRONG_BUY): groene titel met de actie + de
//    verwachting/timing/trade-setup blokken.
function formatAlert(
  sig: { ticker: string; signal_type: string; severity: Severity; title: string; detail: string | null; detected_at: string },
  score: ScoreSnapshot | null,
  company: string | null,
  medals: Medals | null,
  gfUrl: string,
  isLimit: boolean,
): AlertView {
  const tickerDisp = safeTickerDisplay(sig.ticker);
  const safeTitleBase = sig.title.replaceAll(sig.ticker, tickerDisp);
  const action = score?.action ?? null;
  const showAction = action != null && POSITIVE_ACTIONS.has(action);
  const exp = showAction ? (score?.expected_outcome ?? null) : null;
  const cat = showAction ? (score?.components?.nearest_catalyst ?? null) : null;
  const ts = showAction ? (score?.trade_setup ?? null) : null;

  const emoji = isLimit ? "\u{1F4B0}" : showAction ? "\u{1F680}" : "\u{1F4CC}";
  const priority = isLimit ? 5 : showAction && action === "STRONG_BUY" ? 5 : 4;
  const tags = isLimit ? ["moneybag"] : ["rocket"];

  const titleParts: string[] = [`${emoji} ${tickerDisp}`];
  if (showAction) titleParts.push(action!);
  if (isLimit) {
    titleParts.push(safeTitleBase);
  } else {
    if (exp?.peakReturnEst != null) titleParts.push(`piek ${pct(exp.peakReturnEst)}`);
    if (cat?.type && cat?.daysUntil != null) { const lbl = exp?.catalystLabel ?? cat.type; titleParts.push(`${lbl} ${cat.daysUntil}d`); }
    else titleParts.push(safeTitleBase);
  }
  const title = titleParts.join(" · ").slice(0, 120);

  const lines: string[] = [];
  lines.push(`${tickerDisp}${company ? ` (${company})` : ""}`);
  if (showAction && score) lines.push(`Actie: ${score.action} · score ${score.final_score.toFixed(2)}`);
  const ml = medalLine(medals);
  if (ml) lines.push(ml);
  lines.push("");

  if (exp && exp.peakReturnEst != null) {
    lines.push("\u{1F4C8} VERWACHTING (historische baseline)");
    const peakLine = `   Piek bij hit: ${pct(exp.peakReturnEst)}`;
    const peakPrice = ts?.entry != null && exp.expectedPeakPrice != null ? ` (${fmtPrice(ts.entry)} → ${fmtPrice(exp.expectedPeakPrice)})` : exp.expectedPeakPrice != null ? ` (→ ${fmtPrice(exp.expectedPeakPrice)})` : "";
    lines.push(peakLine + peakPrice);
    if (exp.t90ReturnEst != null) { const t90Price = exp.expectedT90Price != null ? ` (${fmtPrice(exp.expectedT90Price)})` : ""; lines.push(`   T+90 mediaan: ${pct(exp.t90ReturnEst)}${t90Price}`); }
    if (exp.hitRateBaseline != null) lines.push(`   Kans op hit: ${(exp.hitRateBaseline * 100).toFixed(0)}% (N≈20-50, wide CI)`);
    lines.push("");
  }
  if (cat?.type) {
    lines.push("\u{23F1} TIMING");
    const lbl = exp?.catalystLabel ?? cat.type;
    const days = cat.daysUntil != null ? `over ${cat.daysUntil}d` : "datum onbekend";
    const date = fmtDate(cat.date);
    lines.push(`   Catalyst: ${lbl} ${days}${date ? ` (~${date})` : ""}`);
    if (exp?.exitWindowDays != null) lines.push(`   Exit window: tot dag ${exp.exitWindowDays} (catalyst + 30d cushion)`);
    lines.push("");
  }
  if (ts?.entry != null && ts?.target != null && ts?.stop != null) {
    lines.push("\u{1F3AF} TRADE SETUP");
    lines.push(`   Entry ${fmtPrice(ts.entry)} · Target ${fmtPrice(ts.target)} · Stop ${fmtPrice(ts.stop)}`);
    if (ts.rr != null) lines.push(`   R:R ${ts.rr.toFixed(1)}`);
    lines.push("");
  }
  if (sig.detail) {
    lines.push(sig.detail.replaceAll(sig.ticker, tickerDisp));
    lines.push("");
  }
  lines.push(`Open op Google Finance: ${gfUrl}`);
  return { title, body: lines.join("\n"), priority, tags };
}

Deno.serve(runBackground("dispatch-alerts", async () => {
  const sb = getServiceClient();
  const { data: settings } = await sb.from("signal_settings").select("*").eq("id", 1).single();
  if (!settings) return { ok: false, message: "settings row missing" };
  const s = settings as Settings;
  if (inQuietHours(s)) return { ok: true, message: "quiet hours; skipping" };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: signals } = await sb.from("signal_events").select("*").eq("alerted", false).gte("detected_at", since).order("detected_at", { ascending: true });
  if (!signals || signals.length === 0) return { ok: true, message: "no new signals" };
  const tickers = Array.from(new Set(signals.map((x) => x.ticker as string)));
  const scoreByTicker = new Map<string, ScoreSnapshot>();
  if (tickers.length) {
    const { data: scores } = await sb.from("signal_scores").select("ticker, scan_date, action, final_score, expected_outcome, components, trade_setup").in("ticker", tickers).order("scan_date", { ascending: false });
    for (const row of scores ?? []) { const t = row.ticker as string; if (!scoreByTicker.has(t)) scoreByTicker.set(t, row as ScoreSnapshot); }
  }
  const companyByTicker = new Map<string, string>();
  const medalsByTicker = new Map<string, Medals>();
  if (tickers.length) {
    const { data: tks } = await sb.from("signal_tickers").select("ticker, company, medal_gold, medal_silver, medal_bronze").in("ticker", tickers);
    for (const row of tks ?? []) {
      if (row.company) companyByTicker.set(row.ticker as string, row.company as string);
      const g = (row as { medal_gold?: number }).medal_gold ?? 0;
      const si = (row as { medal_silver?: number }).medal_silver ?? 0;
      const br = (row as { medal_bronze?: number }).medal_bronze ?? 0;
      if (g + si + br > 0) medalsByTicker.set(row.ticker as string, { gold: g, silver: si, bronze: br });
    }
  }
  let sentEmail = 0, sentNtfy = 0, suppressed = 0;
  const errors: string[] = [];
  for (const sig of signals) {
    const score = scoreByTicker.get(sig.ticker) ?? null;
    const isLimit = LIMIT_EVENT_TYPES.has(sig.signal_type);

    if (!shouldNotify(sig.signal_type, score?.action ?? null)) {
      await sb.from("signal_events").update({ alerted: true }).eq("id", sig.id);
      suppressed++;
      continue;
    }

    const company = companyByTicker.get(sig.ticker) ?? null;
    const medals = medalsByTicker.get(sig.ticker) ?? null;
    const clickUrl = googleFinanceUrl(sig.ticker);
    const view = formatAlert(sig, score, company, medals, clickUrl, isLimit);

    if (s.email) {
      const r = await sendEmail(s.email, `[XINIX] ${view.title}`, `${view.body}\nDetected: ${sig.detected_at}`);
      await sb.from("signal_alerts_sent").insert({ signal_id: sig.id, channel: "email", success: r.ok, error: r.error ?? null });
      if (r.ok) sentEmail++; else errors.push(`email ${sig.id}: ${r.error}`);
    }
    if (s.ntfy_topic) {
      const r = await sendNtfy(s.ntfy_server, s.ntfy_topic, view.title, view.body, view.priority, view.tags, clickUrl);
      await sb.from("signal_alerts_sent").insert({ signal_id: sig.id, channel: "ntfy", success: r.ok, error: r.error ?? null });
      if (r.ok) sentNtfy++; else errors.push(`ntfy ${sig.id}: ${r.error}`);
    }
    await sb.from("signal_events").update({ alerted: true }).eq("id", sig.id);
  }
  return { ok: errors.length === 0, message: `email: ${sentEmail}, ntfy: ${sentNtfy}, suppressed: ${suppressed}` + (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""), metrics: { email: sentEmail, ntfy: sentNtfy, suppressed, errors: errors.length, total_signals: signals.length } };
}));
