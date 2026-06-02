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
  "phoenix_near_limit",
  "zwitserleven_laag",
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

// Impact-tier van een catalyst-event: hoe lager het cijfer, hoe groter de
// verwachte koersimpact. Een tier 1/2 event op een aandeel dat ≤10% boven
// (of onder) de aankooplimiet staat triggert de near-limit-snelalert — die
// negeert de medal-eis en de score-actie, want de combinatie "groot event +
// nabij limiet" IS zelf het kwaliteitssignaal. Tier 3 (boorresultaten, JV,
// financiering) staat wel op het dashboard maar pingt niet via dit kanaal.
const IMPACT_TIER: Record<string, 1 | 2> = {
  takeover_bid: 1, buyout_definitive: 1, discovery_announcement: 1,
  fda_approval: 1, licensing_deal: 1,
  resource_update: 2, pea: 2, pfs: 2, dfs: 2, permit: 2, first_pour: 2,
  topline_positive: 2, phase_success: 2, breakthrough_designation: 2,
};
const NEAR_LIMIT_MAX_ABOVE_PCT = 10;

// Bepaalt of een signaal überhaupt een notificatie waard is.
//  - Vereist meestal: ≥2 goud OF ≥3 zilver OF ≥4 brons (kwaliteitsdrempel).
//  - Uitzonderingen die de medalcheck bypassen: phoenix_near_limit,
//    zwitserleven_laag, en de near-limit-snelalert (groot event ≤10% boven limiet).
//  - Bullish catalysts: alleen bij BUY/STRONG_BUY-actie.
function shouldNotify(signalType: string, action: string | null | undefined, medals: Medals | null, nearLimitImpact: boolean): boolean {
  // Groot event op een aandeel ≤10% boven de aankooplimiet — die combinatie
  // is zelf het kwaliteitssignaal, dus medal-eis en score-actie vervallen.
  if (nearLimitImpact) return true;
  // Speciale typen bypass de medal-eis — het type zelf is het kwaliteitssignaal
  if (signalType === "phoenix_near_limit") return true;
  if (signalType === "zwitserleven_laag") return true;
  const g = medals?.gold ?? 0;
  const si = medals?.silver ?? 0;
  const br = medals?.bronze ?? 0;
  if (g < 2 && si < 3 && br < 4) return false;
  if (LIMIT_EVENT_TYPES.has(signalType)) return true;
  if (BULLISH_CATALYST_TYPES.has(signalType) && action != null && POSITIVE_ACTIONS.has(action)) return true;
  return false;
}

function inQuietHours(s: Settings): boolean { if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false; const h = new Date().getUTCHours(); const start = s.quiet_hours_start; const end = s.quiet_hours_end; if (start === end) return false; if (start < end) return h >= start && h < end; return h >= start || h < end; }
async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") ?? "Xinix Signal <onboarding@resend.dev>";
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  // Bouw HTML: escape entities, vervang https-URLs door klikbare <a> tags,
  // bewaar newlines als <br> zodat de opmaak van de plain-text body bewaard blijft.
  function esc(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;font-size:13px;white-space:pre-wrap;max-width:680px">${
    esc(text).replace(/https?:\/\/[^\s<"]+/g, u => `<a href="${u}" style="color:#3b82f6">${u}</a>`)
  }</body></html>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!res.ok) { const body = await res.text(); return { ok: false, error: `Resend ${res.status}: ${body}` }; }
  return { ok: true };
}

// Plak een zero-width space tussen ticker base en suffix zodat
// notification clients .TO / .V / .AX niet als TLD herkennen en
// auto-linkificeren. Visueel onzichtbaar.
function safeTickerDisplay(ticker: string): string {
  return ticker.replace(/\./g, "​.");
}

async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
  if (clickUrl) {
    payload.click = clickUrl;
  }
  const res = await fetch(server.replace(/\/$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const text = await res.text(); return { ok: false, error: `ntfy ${res.status}: ${text}` }; }
  return { ok: true };
}
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO", L: "LON", DE: "ETR", F: "FRA", SG: "STU", MU: "MUN", BE: "BER", DU: "DUS", HM: "HAM", SW: "SWX", VI: "VIE", PA: "EPA", AS: "AMS", BR: "EBR", LS: "ELI", MI: "BIT", MC: "BME", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", WA: "WSE", AT: "ATH", HK: "HKG", T: "TYO", SS: "SHA", SZ: "SHE", KS: "KRX", KQ: "KOSDAQ", TW: "TPE", TWO: "TPE", NS: "NSE", BO: "BOM", SI: "SGX", JK: "IDX", KL: "KLSE", BK: "BKK", AX: "ASX", NZ: "NZE", TA: "TLV", IS: "IST", SR: "TADAWUL", JO: "JSE", SA: "BVMF", MX: "BMV", BA: "BCBA", SN: "SGO" };
// Yahoo fullExchangeName/exchangeName -> Google-code (vooral US-tickers zonder
// landsuffix; NMS/NYQ/... zijn de korte exchangeName-waardes).
function googleExchangeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.includes("nasdaq") || e === "nms" || e === "ngm" || e === "ncm") return "NASDAQ";
  if (e.includes("arca") || e === "pcx") return "NYSEARCA";
  if (e.includes("amex") || e === "ase" || e.includes("nyse mkt") || e.includes("nyse american")) return "NYSEAMERICAN";
  if (e === "nyse" || e === "nyq" || e === "new york stock exchange") return "NYSE";
  if (e.includes("cboe") || e.includes("bats") || e === "bts" || e === "bzx") return "BATS";
  if (e.includes("otc") || e.includes("pink") || e === "pnk") return "OTCMKTS";
  if (e.includes("toronto") && e.includes("vent")) return "CVE";
  if (e === "toronto") return "TSE";
  return null;
}
function googleFinanceUrl(ticker: string, exchange?: string | null): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) {
    // US ticker zonder landsuffix: altijd exchange-code meegeven voor betrouwbare deep-link
    const code = googleExchangeCode(exchange) ?? "NASDAQ";
    return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${code}`;
  }
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}
// Yahoo Finance fallback — onze data komt van Yahoo, dus elke ticker in onze
// DB heeft per definitie een werkende Yahoo-quote-pagina. Google Finance heeft
// niet alle tickers (vooral SPACs, OTC, kleine Aziatische listings) → die
// link doodt zonder dat we het merken.
function yahooFinanceUrl(ticker: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.trim().toUpperCase())}`;
}
// Deep-link naar het beoordeelscherm van precies deze ticker in de app.
function reviewUrl(ticker: string): string {
  return `https://constantdynamics.github.io/xinix/?review=${encodeURIComponent(ticker.trim().toUpperCase())}`;
}
interface ScoreSnapshot { action: string; final_score: number; expected_outcome: { catalystLabel?: string; peakReturnEst?: number; t90ReturnEst?: number; hitRateBaseline?: number; expectedPeakPrice?: number | null; expectedT90Price?: number | null; exitWindowDays?: number; } | null; components: { nearest_catalyst?: { type?: string; daysUntil?: number | null; date?: string | null; } | null; } | null; trade_setup: { entry?: number; target?: number; stop?: number; rr?: number; } | null; }
function pct(x: number | null | undefined): string { if (x == null || !Number.isFinite(x)) return "?"; return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)}%`; }
function fmtPrice(x: number | null | undefined): string { if (x == null || !Number.isFinite(x)) return "?"; return `$${x.toFixed(x < 5 ? 3 : 2)}`; }
function fmtDate(iso: string | null | undefined): string | null { if (!iso) return null; return iso.slice(0, 10); }
function fmtAbove(p: number): string { return p <= 0 ? `${p.toFixed(0)}% onder limiet` : `+${p.toFixed(0)}% boven limiet`; }
interface AlertView { title: string; body: string; priority: number; tags: string[]; }
interface Medals { gold: number; silver: number; bronze: number; }
interface NearLimitInfo { tier: 1 | 2; abovePct: number; buyLimit: number; lastClose: number; }
function medalLine(m: Medals | null): string | null {
  if (!m || (m.gold + m.silver + m.bronze) === 0) return null;
  const parts: string[] = [];
  if (m.gold > 0) parts.push(`🏆${m.gold}`);
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
  nearLimit: NearLimitInfo | null,
): AlertView {
  const tickerDisp = safeTickerDisplay(sig.ticker);
  const safeTitleBase = sig.title.replaceAll(sig.ticker, tickerDisp);
  const action = score?.action ?? null;
  const showAction = action != null && POSITIVE_ACTIONS.has(action);
  const exp = showAction ? (score?.expected_outcome ?? null) : null;
  const cat = showAction ? (score?.components?.nearest_catalyst ?? null) : null;
  const ts = showAction ? (score?.trade_setup ?? null) : null;

  const isPhoenixAlert = sig.signal_type === "phoenix_near_limit";
  const isZwitserlevenAlert = sig.signal_type === "zwitserleven_laag";
  const emoji = nearLimit ? (nearLimit.tier === 1 ? "🚨" : "⚡") : isPhoenixAlert ? "🦅" : isZwitserlevenAlert ? "🌴" : isLimit ? "📉" : showAction ? "\u{1F680}" : "\u{1F4CC}";
  const priority = nearLimit || isPhoenixAlert || isZwitserlevenAlert ? 5 : isLimit ? 5 : showAction && action === "STRONG_BUY" ? 5 : 4;
  const tags = nearLimit ? (nearLimit.tier === 1 ? ["rotating_light", "dart"] : ["zap", "dart"]) : isPhoenixAlert ? ["eagle", "chart_with_downwards_trend"] : isZwitserlevenAlert ? ["palm_tree", "moneybag"] : isLimit ? ["chart_with_downwards_trend"] : ["rocket"];

  // Verwijder leading ticker uit de signaaltitel om dubbele ticker in header te voorkomen
  const cleanSigTitle = safeTitleBase
    .replace(new RegExp(`^${tickerDisp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[·\\-–—:,]?\\s*`, "u"), "")
    .replace(new RegExp(`^${sig.ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[·\\-–—:,]?\\s*`, "u"), "")
    .trim();

  const titleParts: string[] = [`${emoji} ${tickerDisp}`];
  if (nearLimit) {
    if (cleanSigTitle) titleParts.push(cleanSigTitle);
    titleParts.push(`T${nearLimit.tier}`);
    titleParts.push(fmtAbove(nearLimit.abovePct));
  } else {
    if (showAction) titleParts.push(action!);
    if (isLimit) {
      if (cleanSigTitle) titleParts.push(cleanSigTitle);
    } else {
      if (exp?.peakReturnEst != null) titleParts.push(`piek ${pct(exp.peakReturnEst)}`);
      if (cat?.type && cat?.daysUntil != null) { const lbl = exp?.catalystLabel ?? cat.type; titleParts.push(`${lbl} ${cat.daysUntil}d`); }
      else if (cleanSigTitle) titleParts.push(cleanSigTitle);
    }
  }
  const title = titleParts.join(" · ").slice(0, 120);

  const lines: string[] = [];
  // Twee link-bronnen — Google Finance is gebruiksvriendelijker maar mist soms
  // SPACs/OTC/Aziatische tickers (zoals ATON onlangs). Yahoo Finance heeft per
  // definitie elke ticker uit onze DB. Beide links staan bovenaan voor preview.
  const yfUrl = yahooFinanceUrl(sig.ticker);
  lines.push(`📲 Beoordeel: ${reviewUrl(sig.ticker)}`);
  lines.push(`🔗 ${gfUrl}`);
  lines.push(`🔁 ${yfUrl}`);
  lines.push(`${tickerDisp}${company ? ` (${company})` : ""}`);
  if (showAction && score) lines.push(`Actie: ${score.action} · score ${score.final_score.toFixed(2)}`);
  const ml = medalLine(medals);
  if (ml) lines.push(ml);
  lines.push("");

  if (nearLimit) {
    lines.push("\u{26A1} GROOT EVENT NABIJ AANKOOPLIMIET");
    lines.push(`   Impact-tier: ${nearLimit.tier === 1
      ? "T1 — grootste impact (overname / FDA / grote ontdekking)"
      : "T2 — hoge impact (resource / feasibility / trial-readout)"}`);
    lines.push(`   Koers ${fmtPrice(nearLimit.lastClose)} · Aankooplimiet ${fmtPrice(nearLimit.buyLimit)} · ${fmtAbove(nearLimit.abovePct)}`);
    lines.push("   \u{26A0} Geen koersvoorspelling — een groot event vraagt nu je aandacht.");
    lines.push("");
  }

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
  return { title, body: lines.join("\n").trimEnd(), priority, tags };
}

Deno.serve(runBackground("dispatch-alerts", async () => {
  const sb = getServiceClient();
  const { data: settings } = await sb.from("signal_settings").select("*").eq("id", 1).single();
  if (!settings) return { ok: false, message: "settings row missing" };
  const s = settings as Settings;
  if (inQuietHours(s)) return { ok: true, message: "quiet hours; skipping" };

  // Genereer phoenix_near_limit events voor feniks-aandelen die op/onder aankooplimiet staan.
  // Deduplicatie: max 1 event per ticker per 30 dagen, tenzij de koers ≥10% verder gedaald is
  // t.o.v. de koers bij de laatste melding (dan is het een wezenlijk nieuw signaal).
  const PHOENIX_THRESHOLD_PCT = 5; // notificeer wanneer ≤5% boven buy_limit (of eronder)
  const PHOENIX_DEDUP_DAYS = 30;
  const PHOENIX_REPRICE_DROP_PCT = 10; // re-alert als koers ≥10% lager dan bij vorige melding
  let phoenixGenerated = 0;
  {
    const { data: phoenixTickers } = await sb
      .from("signal_tickers")
      .select("ticker, company, buy_limit, exchange")
      .eq("is_phoenix", true)
      .eq("active", true)
      .not("buy_limit", "is", null)
      // Extra veiligheidsklep: alleen tickers die DAADWERKELIJK door de scanner
      // zijn geverifieerd. Voorkomt notificaties op legacy/handmatige is_phoenix
      // flags zonder scan-bewijs (zoals H2O.DE eerder).
      .not("is_phoenix_at", "is", null);

    if (phoenixTickers?.length) {
      const ptickers = phoenixTickers.map((p) => p.ticker as string);
      const { data: prices } = await sb
        .from("signal_price_summary")
        .select("ticker, last_close")
        .in("ticker", ptickers);
      const priceMap = new Map((prices ?? []).map((p) => [p.ticker as string, p.last_close as number]));

      const dedupSince = new Date(Date.now() - PHOENIX_DEDUP_DAYS * 24 * 3600 * 1000).toISOString();
      const { data: existing } = await sb
        .from("signal_events")
        .select("ticker, payload, detected_at")
        .eq("signal_type", "phoenix_near_limit")
        .gte("detected_at", dedupSince)
        .in("ticker", ptickers)
        .order("detected_at", { ascending: false });

      // Meest recente event per ticker (+ de koers waarmee die melding werd gedaan)
      const lastNotified = new Map<string, number | null>();
      for (const e of existing ?? []) {
        const t = e.ticker as string;
        if (!lastNotified.has(t)) {
          const payload = e.payload as { last_close?: number | null } | null;
          lastNotified.set(t, payload?.last_close ?? null);
        }
      }

      for (const p of phoenixTickers) {
        const lastClose = priceMap.get(p.ticker as string) ?? null;
        const buyLimit = p.buy_limit as number | null;
        if (lastClose == null || !buyLimit) continue;
        const abovePct = ((lastClose - buyLimit) / buyLimit) * 100;
        if (abovePct > PHOENIX_THRESHOLD_PCT) continue;

        // Skip als er een recente melding was EN de koers niet significant verder gedaald is.
        if (lastNotified.has(p.ticker as string)) {
          const prevClose = lastNotified.get(p.ticker as string) ?? null;
          if (prevClose == null) continue; // legacy event zonder koerspayload → conservatief: skip
          const dropPct = ((prevClose - lastClose) / prevClose) * 100;
          if (dropPct < PHOENIX_REPRICE_DROP_PCT) continue;
        }

        const direction = abovePct <= 0 ? "onder" : "dicht bij";
        const pctStr = abovePct <= 0
          ? `${abovePct.toFixed(1)}%`
          : `+${abovePct.toFixed(1)}%`;
        const priceStr = `$${lastClose.toFixed(lastClose < 5 ? 3 : 2)}`;
        const limitStr = `$${buyLimit.toFixed(buyLimit < 5 ? 3 : 2)}`;
        await sb.from("signal_events").insert({
          ticker: p.ticker,
          signal_type: "phoenix_near_limit",
          severity: "orange",
          title: `${p.ticker} · Feniks ${direction} aankooplimiet · ${pctStr}`,
          detail: `Koers: ${priceStr} · Aankooplimiet: ${limitStr} · Dit aandeel heeft ooit ≥50× gestegen.`,
          payload: { last_close: lastClose },
        });
        phoenixGenerated++;
      }
    }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: signals } = await sb.from("signal_events").select("*").eq("alerted", false).gte("detected_at", since).order("detected_at", { ascending: true });
  if (!signals || signals.length === 0) return { ok: true, message: phoenixGenerated > 0 ? `phoenix_generated: ${phoenixGenerated}, no pending signals` : "no new signals", metrics: { phoenix_generated: phoenixGenerated } };
  const tickers = Array.from(new Set(signals.map((x) => x.ticker as string)));
  const scoreByTicker = new Map<string, ScoreSnapshot>();
  if (tickers.length) {
    const { data: scores } = await sb.from("signal_scores").select("ticker, scan_date, action, final_score, expected_outcome, components, trade_setup").in("ticker", tickers).order("scan_date", { ascending: false });
    for (const row of scores ?? []) { const t = row.ticker as string; if (!scoreByTicker.has(t)) scoreByTicker.set(t, row as ScoreSnapshot); }
  }
  const companyByTicker = new Map<string, string>();
  const medalsByTicker = new Map<string, Medals>();
  const exchangeByTicker = new Map<string, string>();
  const buyLimitByTicker = new Map<string, number>();
  const lastCloseByTicker = new Map<string, number>();
  if (tickers.length) {
    const { data: tks } = await sb.from("signal_tickers").select("ticker, company, exchange, buy_limit, medal_gold, medal_silver, medal_bronze").in("ticker", tickers);
    for (const row of tks ?? []) {
      if (row.company) companyByTicker.set(row.ticker as string, row.company as string);
      if ((row as { exchange?: string | null }).exchange) exchangeByTicker.set(row.ticker as string, (row as { exchange: string }).exchange);
      const bl = (row as { buy_limit?: number | null }).buy_limit;
      if (bl != null && bl > 0) buyLimitByTicker.set(row.ticker as string, bl);
      const g = (row as { medal_gold?: number }).medal_gold ?? 0;
      const si = (row as { medal_silver?: number }).medal_silver ?? 0;
      const br = (row as { medal_bronze?: number }).medal_bronze ?? 0;
      if (g + si + br > 0) medalsByTicker.set(row.ticker as string, { gold: g, silver: si, bronze: br });
    }
    const { data: prices } = await sb.from("signal_price_summary").select("ticker, last_close").in("ticker", tickers);
    for (const row of prices ?? []) {
      const lc = (row as { last_close?: number | null }).last_close;
      if (lc != null) lastCloseByTicker.set(row.ticker as string, lc);
    }
  }
  let sentEmail = 0, sentNtfy = 0, suppressed = 0, nearLimitAlerts = 0;
  const errors: string[] = [];

  // Onderdrukken: GEEN meldingen voor aandelen die de gebruiker al als 'gezien'
  // of als favoriet heeft gemarkeerd (die kent hij al), en max 1 melding per
  // ticker per dag (voorkomt bv. SNBR buy_limit_hit + buy_limit_close op 1 dag).
  const suppressTickers = new Set<string>();
  {
    const [seenRes, favRes] = await Promise.all([
      sb.from("xinix_seen").select("ticker").in("ticker", tickers),
      sb.from("xinix_favorites").select("ticker").in("ticker", tickers),
    ]);
    for (const r of seenRes.data ?? []) suppressTickers.add(r.ticker as string);
    for (const r of favRes.data ?? []) suppressTickers.add(r.ticker as string);
  }
  // Tickers die vandaag (UTC) al een geslaagde melding kregen → niet nogmaals.
  const notifiedToday = new Set<string>();
  {
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const { data: sentRows } = await sb.from("signal_alerts_sent").select("signal_id").eq("success", true).gte("sent_at", dayStart.toISOString());
    const sentIds = Array.from(new Set((sentRows ?? []).map((r) => r.signal_id as number)));
    for (let i = 0; i < sentIds.length; i += 200) {
      const { data: evRows } = await sb.from("signal_events").select("ticker").in("id", sentIds.slice(i, i + 200));
      for (const r of evRows ?? []) notifiedToday.add(r.ticker as string);
    }
  }

  for (const sig of signals) {
    // Onderdruk favorieten/gezien + dubbele melding per dag (vóór alle andere logica).
    if (suppressTickers.has(sig.ticker) || notifiedToday.has(sig.ticker)) {
      await sb.from("signal_events").update({ alerted: true }).eq("id", sig.id);
      suppressed++;
      continue;
    }
    const score = scoreByTicker.get(sig.ticker) ?? null;
    const isLimit = LIMIT_EVENT_TYPES.has(sig.signal_type);
    const medals = medalsByTicker.get(sig.ticker) ?? null;

    // Near-limit-snelalert: tier 1/2 catalyst-event op een aandeel dat
    // ≤10% boven (of onder) de aankooplimiet staat.
    let nearLimit: NearLimitInfo | null = null;
    const tier: 1 | 2 | undefined = IMPACT_TIER[sig.signal_type];
    if (tier) {
      const buyLimit = buyLimitByTicker.get(sig.ticker) ?? null;
      const lastClose = lastCloseByTicker.get(sig.ticker) ?? null;
      if (buyLimit != null && lastClose != null) {
        const abovePct = ((lastClose - buyLimit) / buyLimit) * 100;
        if (abovePct <= NEAR_LIMIT_MAX_ABOVE_PCT) {
          nearLimit = { tier, abovePct, buyLimit, lastClose };
        }
      }
    }

    if (!shouldNotify(sig.signal_type, score?.action ?? null, medals, nearLimit != null)) {
      await sb.from("signal_events").update({ alerted: true }).eq("id", sig.id);
      suppressed++;
      continue;
    }
    if (nearLimit) nearLimitAlerts++;

    const company = companyByTicker.get(sig.ticker) ?? null;
    const clickUrl = googleFinanceUrl(sig.ticker, exchangeByTicker.get(sig.ticker) ?? null);
    const view = formatAlert(sig, score, company, medals, clickUrl, isLimit, nearLimit);

    let anyAttempted = false;
    let anySent = false;
    if (s.email) {
      anyAttempted = true;
      const r = await sendEmail(s.email, `[XINIX] ${view.title}`, `${view.body}\nDetected: ${sig.detected_at}`);
      await sb.from("signal_alerts_sent").insert({ signal_id: sig.id, channel: "email", success: r.ok, error: r.error ?? null });
      if (r.ok) { sentEmail++; anySent = true; } else errors.push(`email ${sig.id}: ${r.error}`);
    }
    if (s.ntfy_topic) {
      anyAttempted = true;
      const r = await sendNtfy(s.ntfy_server, s.ntfy_topic, view.title, view.body, view.priority, view.tags, reviewUrl(sig.ticker));
      await sb.from("signal_alerts_sent").insert({ signal_id: sig.id, channel: "ntfy", success: r.ok, error: r.error ?? null });
      if (r.ok) { sentNtfy++; anySent = true; } else errors.push(`ntfy ${sig.id}: ${r.error}`);
    }
    // Eén geslaagde melding per ticker per dag: markeer 'm zodat volgende
    // signalen voor dezelfde ticker (deze run én latere runs vandaag) wegvallen.
    if (anySent) notifiedToday.add(sig.ticker);
    // Markeer alleen als 'verstuurd' wanneer minstens één kanaal slaagde, of
    // wanneer er geen kanaal is geconfigureerd. Bij totale mislukking blijft het
    // event open zodat de volgende run (binnen het 24u-venster) opnieuw probeert.
    if (anySent || !anyAttempted) {
      await sb.from("signal_events").update({ alerted: true }).eq("id", sig.id);
    }
  }
  return { ok: errors.length === 0, message: `email: ${sentEmail}, ntfy: ${sentNtfy}, suppressed: ${suppressed}, near_limit: ${nearLimitAlerts}, phoenix_generated: ${phoenixGenerated}` + (errors.length ? `; errors: ${errors.slice(0, 3).join("; ")}` : ""), metrics: { email: sentEmail, ntfy: sentNtfy, suppressed, near_limit: nearLimitAlerts, errors: errors.length, total_signals: signals.length, phoenix_generated: phoenixGenerated } };
}));
