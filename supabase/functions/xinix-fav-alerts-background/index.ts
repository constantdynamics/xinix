import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
function checkAuth(req: Request) { const r = Deno.env.get("ADMIN_TOKEN"); if (!r) return false; return (req.headers.get("authorization") ?? "") === `Bearer ${r}`; }
function checkCron(req: Request) { const r = Deno.env.get("CRON_SECRET"); if (!r) return false; return (req.headers.get("x-cron-secret") ?? "") === r; }
function checkAdminOrCron(req: Request) { return checkAuth(req) || checkCron(req); }
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) { const o = req.headers.get("origin") ?? ""; return { "access-control-allow-origin": ALLOWED.has(o) ? o : "null", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey", "access-control-max-age": "86400", vary: "origin" }; }
function pf(req: Request) { if (req.method !== "OPTIONS") return null; return new Response(null, { status: 204, headers: cors(req) }); }
function j(req: Request, body: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(body), { ...init, headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string,string>|undefined) } }); }
function tt(req: Request, body: string, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string,string>|undefined) } }); }
function runBackground(job: string, fn: () => Promise<RunResult>) { return async (req: Request) => { const p = pf(req); if (p) return p; if (!checkAdminOrCron(req)) return tt(req, "Unauthorized", { status: 401 }); try { const r = await logRun(job, fn); return j(req, { ok: r.ok, ...r }, { status: r.ok ? 200 : 500 }); } catch (e) { return j(req, { ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }; }

// ── ntfy + link-helpers (zelfde aanpak als dispatch-alerts) ───────────────────
interface Settings { ntfy_topic: string | null; ntfy_server: string; quiet_hours_start: number | null; quiet_hours_end: number | null; }
function inQuietHours(s: Settings): boolean { if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false; const h = new Date().getUTCHours(); const start = s.quiet_hours_start; const end = s.quiet_hours_end; if (start === end) return false; if (start < end) return h >= start && h < end; return h >= start || h < end; }
async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
  if (clickUrl) payload.click = clickUrl;
  const res = await fetch(server.replace(/\/$/, ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) { const text = await res.text(); return { ok: false, error: `ntfy ${res.status}: ${text}` }; }
  return { ok: true };
}
// Plak een zero-width space tussen ticker-base en suffix zodat ntfy-clients
// .TO / .V / .AX niet als TLD herkennen en auto-linkificeren. Visueel onzichtbaar.
function safeTickerDisplay(ticker: string): string { return ticker.replace(/\./g, "​."); }
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO", L: "LON", DE: "ETR", F: "FRA", SG: "STU", MU: "MUN", BE: "BER", DU: "DUS", HM: "HAM", SW: "SWX", VI: "VIE", PA: "EPA", AS: "AMS", BR: "EBR", LS: "ELI", MI: "BIT", MC: "BME", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", WA: "WSE", AT: "ATH", HK: "HKG", T: "TYO", SS: "SHA", SZ: "SHE", KS: "KRX", KQ: "KOSDAQ", TW: "TPE", TWO: "TPE", NS: "NSE", BO: "BOM", SI: "SGX", JK: "IDX", KL: "KLSE", BK: "BKK", AX: "ASX", NZ: "NZE", TA: "TLV", IS: "IST", SR: "TADAWUL", JO: "JSE", SA: "BVMF", MX: "BMV", BA: "BCBA", SN: "SGO" };
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
  if (dot === -1) { const code = googleExchangeCode(exchange) ?? "NASDAQ"; return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${code}`; }
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}
function yahooFinanceUrl(ticker: string): string { return `https://finance.yahoo.com/quote/${encodeURIComponent(ticker.trim().toUpperCase())}`; }
function favAppUrl(ticker: string): string { return `https://constantdynamics.github.io/xinix/?review=${encodeURIComponent(ticker.trim().toUpperCase())}`; }

// ── Drempels & cooldowns ──────────────────────────────────────────────────────
const DROP_1D_PCT = -30;        // >30% daling op één dag (iedereen)
const STAR_DROP_1D_PCT = -20;   // >20% daling op één dag (≥4★)
const STAR_DROP_1W_PCT = -50;   // >50% daling in een week (≥4★)
const STAR_MIN = 4;             // "minimaal 4 sterren"
const TOP10 = 10;
const TOP20 = 20;
const LOW_TOL = 1.005;          // koers binnen 0,5% van de meerjaars-low telt als "op de low" (weekly vs daily granulariteit)
const REPRICE_DROP = 0.90;      // re-alert bij een materieel nieuwe low: ≥10% onder de koers bij de vorige melding
const MAX_TICKER_ALERTS = 20;   // veiligheidsklep tegen een flood (bv. na bulk-toevoegen van favorieten)
const DAY = 24 * 60 * 60 * 1000;

type AlertType = "drop_30_1d" | "star_drop_20_1d" | "star_drop_50_1w" | "low_5y" | "low_3y" | "below_limit" | "top10_limit" | "top20_limit";
const TYPE_META: Record<AlertType, { priority: number; tags: string[]; persistent: boolean }> = {
  drop_30_1d:      { priority: 5, tags: ["chart_with_downwards_trend", "rotating_light"], persistent: false },
  star_drop_20_1d: { priority: 5, tags: ["chart_with_downwards_trend", "star"], persistent: false },
  star_drop_50_1w: { priority: 5, tags: ["chart_with_downwards_trend", "star"], persistent: false },
  low_5y:          { priority: 5, tags: ["chart_with_downwards_trend"], persistent: true },
  low_3y:          { priority: 4, tags: ["chart_with_downwards_trend"], persistent: true },
  below_limit:     { priority: 5, tags: ["dart"], persistent: true },
  top10_limit:     { priority: 4, tags: ["keycap_ten"], persistent: true },
  top20_limit:     { priority: 3, tags: ["1234"], persistent: true },
};

interface Fav {
  ticker: string;
  rating: number | null;
  company: string | null;
  exchange: string | null;
  buy_limit: number | null;
  last_close: number | null;
  pct_change_1d: number | null;
  pct_change_5d: number | null;
  low_5y: number | null;
  low_3y: number | null;
  above_limit_pct: number | null;
}
interface StateRow { last_alert_at: string; ref_close: number | null; }

function num(v: unknown): number | null { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function fmtPct(v: number | null): string { if (v == null) return "onbekend"; return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`; }
function fmtPrice(v: number | null): string { if (v == null) return "?"; if (v < 1) return `$${v.toFixed(4)}`; if (v < 10) return `$${v.toFixed(3)}`; return `$${v.toFixed(2)}`; }
function fmtAbove(v: number | null): string { if (v == null) return "geen limiet ingesteld"; if (v <= 0) return `${v.toFixed(1)}% (onder limiet)`; return `+${v.toFixed(1)}% boven limiet`; }
function ratingStr(r: number | null): string { if (!r || r < 1) return "geen sterren"; return `${"★".repeat(r)} (${r}/5)`; }

function reasonLine(type: AlertType, f: Fav): string {
  switch (type) {
    case "drop_30_1d": return `\u{1F4C9} Meer dan 30% gezakt vandaag (${fmtPct(f.pct_change_1d)})`;
    case "star_drop_20_1d": return `\u{1F4C9} ${f.rating}★-aandeel: meer dan 20% gezakt vandaag (${fmtPct(f.pct_change_1d)})`;
    case "star_drop_50_1w": return `\u{1F4C9} ${f.rating}★-aandeel: meer dan 50% gezakt deze week (${fmtPct(f.pct_change_5d)})`;
    case "low_5y": return `\u{1F53B} Nieuw 5-jaars dieptepunt (5y-low ${fmtPrice(f.low_5y)})`;
    case "low_3y": return `\u{1F53B} Nieuw 3-jaars dieptepunt (3y-low ${fmtPrice(f.low_3y)})`;
    case "below_limit": return `\u{1F3AF} Onder je aankooplimiet ${fmtPrice(f.buy_limit)} gezakt`;
    case "top10_limit": return `\u{1F51F} Nieuw in de top 10 dichtst bij je aankooplimiet`;
    case "top20_limit": return `\u{1F522} Nieuw in de top 20 dichtst bij je aankooplimiet`;
  }
}
function shortTitle(type: AlertType, f: Fav): string {
  switch (type) {
    case "drop_30_1d": return `${fmtPct(f.pct_change_1d)} vandaag`;
    case "star_drop_20_1d": return `${fmtPct(f.pct_change_1d)} vandaag (${f.rating}★)`;
    case "star_drop_50_1w": return `${fmtPct(f.pct_change_5d)} deze week (${f.rating}★)`;
    case "low_5y": return `5-jaars low`;
    case "low_3y": return `3-jaars low`;
    case "below_limit": return `onder limiet`;
    case "top10_limit": return `nieuw in top 10`;
    case "top20_limit": return `nieuw in top 20`;
  }
}

// Gemeenschappelijk blok: de gegevens die de gebruiker bij ELKE melding wil zien —
// aandeel, link, daling vandaag, afstand tot limiet en het aantal sterren.
function commonBlock(f: Fav): string[] {
  return [
    `${safeTickerDisplay(f.ticker)}${f.company ? ` · ${f.company}` : ""}`,
    `⭐ Sterren: ${ratingStr(f.rating)}`,
    `\u{1F4C9} Daling vandaag: ${fmtPct(f.pct_change_1d)}`,
    `\u{1F3AF} Afstand tot limiet: ${fmtAbove(f.above_limit_pct)}`,
    `\u{1F517} ${googleFinanceUrl(f.ticker, f.exchange)}`,
    `\u{1F501} ${yahooFinanceUrl(f.ticker)}`,
    `\u{1F4F2} ${favAppUrl(f.ticker)}`,
  ];
}

async function chunkedIn<T>(sb: ReturnType<typeof getServiceClient>, table: string, cols: string, tickers: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tickers.length; i += 300) {
    const { data, error } = await sb.from(table).select(cols).in("ticker", tickers.slice(i, i + 300));
    if (error) throw new Error(`${table}: ${(error as { message?: string }).message ?? String(error)}`);
    for (const r of data ?? []) out.push(r as T);
  }
  return out;
}

Deno.serve(runBackground("xinix-fav-alerts", async () => {
  const sb = getServiceClient();
  const { data: settingsRow } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server, quiet_hours_start, quiet_hours_end").eq("id", 1).single();
  if (!settingsRow) return { ok: false, message: "settings row missing" };
  const settings = settingsRow as Settings;
  if (!settings.ntfy_topic) return { ok: true, message: "geen ntfy_topic geconfigureerd" };
  // Respecteer de globale quiet hours (de cron draait om 07:00 UTC, ruim buiten de
  // standaard 21-4 quiet hours; deze check is een vangnet als het tijdstip wijzigt).
  if (inQuietHours(settings)) return { ok: true, message: "quiet hours; overgeslagen" };

  const { data: favRows } = await sb.from("xinix_favorites").select("ticker, rating");
  const favList = (favRows ?? []).map((r) => ({ ticker: r.ticker as string, rating: num((r as { rating?: unknown }).rating) }));
  if (favList.length === 0) return { ok: true, message: "geen favorieten" };
  const tickers = favList.map((f) => f.ticker);

  const [tk, pr] = await Promise.all([
    chunkedIn<{ ticker: string; company: string | null; exchange: string | null; buy_limit: unknown }>(sb, "signal_tickers", "ticker, company, exchange, buy_limit", tickers),
    chunkedIn<{ ticker: string; last_close: unknown; pct_change_1d: unknown; pct_change_5d: unknown; low_5y: unknown; low_3y: unknown }>(sb, "signal_price_summary", "ticker, last_close, pct_change_1d, pct_change_5d, low_5y, low_3y", tickers),
  ]);
  const tkByTicker = new Map(tk.map((r) => [r.ticker, r]));
  const prByTicker = new Map(pr.map((r) => [r.ticker, r]));

  const favs: Fav[] = favList.map((f) => {
    const t = tkByTicker.get(f.ticker);
    const p = prByTicker.get(f.ticker);
    const last_close = num(p?.last_close);
    const buy_limit = num(t?.buy_limit);
    const above_limit_pct = last_close != null && buy_limit != null && buy_limit > 0 ? ((last_close - buy_limit) / buy_limit) * 100 : null;
    return {
      ticker: f.ticker,
      rating: f.rating,
      company: (t?.company as string | null) ?? null,
      exchange: (t?.exchange as string | null) ?? null,
      buy_limit,
      last_close,
      pct_change_1d: num(p?.pct_change_1d),
      pct_change_5d: num(p?.pct_change_5d),
      low_5y: num(p?.low_5y),
      low_3y: num(p?.low_3y),
      above_limit_pct,
    };
  });

  // Ranking op afstand tot limiet (oplopend) — zelfde sortering als het tabblad.
  // Alleen favorieten met een berekende afstand doen mee (anders sorteren ze achteraan).
  const ranked = favs.filter((f) => f.above_limit_pct != null).sort((a, b) => (a.above_limit_pct as number) - (b.above_limit_pct as number));
  const top10Set = new Set(ranked.slice(0, TOP10).map((f) => f.ticker));
  const top20Set = new Set(ranked.slice(0, TOP20).map((f) => f.ticker));

  // Dedup-state voor de huidige favorieten
  const stateRows = await chunkedIn<{ ticker: string; alert_type: string; last_alert_at: string; ref_close: unknown }>(sb, "xinix_fav_alert_state", "ticker, alert_type, last_alert_at, ref_close", tickers);
  const stateMap = new Map<string, StateRow>();
  for (const s of stateRows) stateMap.set(`${s.ticker}|${s.alert_type}`, { last_alert_at: s.last_alert_at, ref_close: num(s.ref_close) });
  // Eerste run = de tabel is GLOBAAL leeg (niet alleen voor de huidige favorieten).
  // Anders zou een volledige wissel van favorieten de baseline-seeding opnieuw
  // triggeren en echte alerts van nieuwe favorieten stilletjes onderdrukken.
  const { count: stateTotal } = await sb.from("xinix_fav_alert_state").select("ticker", { count: "exact", head: true });
  const isFirstRun = (stateTotal ?? 0) === 0;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayStartMs = (() => { const d = new Date(nowMs); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();

  function repriced(st: StateRow, f: Fav): boolean { return st.ref_close != null && st.ref_close > 0 && f.last_close != null && f.last_close <= st.ref_close * REPRICE_DROP; }
  function isFresh(type: AlertType, f: Fav): boolean {
    const st = stateMap.get(`${f.ticker}|${type}`);
    if (!st) return true;
    const lastMs = new Date(st.last_alert_at).getTime();
    switch (type) {
      case "drop_30_1d":
      case "star_drop_20_1d": return lastMs < todayStartMs;                  // 1×/UTC-dag
      case "star_drop_50_1w": return nowMs - lastMs >= 7 * DAY;
      case "below_limit": return nowMs - lastMs >= 7 * DAY || repriced(st, f);
      case "low_5y":
      case "low_3y": return nowMs - lastMs >= 30 * DAY || repriced(st, f);
      case "top10_limit":
      case "top20_limit": return nowMs - lastMs >= 180 * DAY;
    }
  }

  // Welke condities vuren voor een favoriet? (met onderlinge onderdrukking)
  function triggeredTypes(f: Fav): AlertType[] {
    const out: AlertType[] = [];
    const p1 = f.pct_change_1d, p5 = f.pct_change_5d, lc = f.last_close, al = f.above_limit_pct, rating = f.rating ?? 0;
    // 1-daags: >30% (iedereen) heeft voorrang; anders ≥4★ >20% (de 20-30% band)
    if (p1 != null && p1 < DROP_1D_PCT) out.push("drop_30_1d");
    else if (rating >= STAR_MIN && p1 != null && p1 < STAR_DROP_1D_PCT) out.push("star_drop_20_1d");
    // ≥4★ >50% in een week
    if (rating >= STAR_MIN && p5 != null && p5 < STAR_DROP_1W_PCT) out.push("star_drop_50_1w");
    // 5y-low heeft voorrang op 3y-low (een 5y-low is per definitie ook een 3y-low)
    const atLow5y = lc != null && f.low_5y != null && f.low_5y > 0 && lc <= f.low_5y * LOW_TOL;
    const atLow3y = !atLow5y && lc != null && f.low_3y != null && f.low_3y > 0 && lc <= f.low_3y * LOW_TOL;
    if (atLow5y) out.push("low_5y");
    else if (atLow3y) out.push("low_3y");
    // onder de aankooplimiet
    if (al != null && al <= 0) out.push("below_limit");
    // top-20 én top-10 zijn onafhankelijk (genest); top-10 onderdrukt de top-20-regel
    // alleen in de weergave, maar beide state-rijen worden bijgehouden.
    if (top20Set.has(f.ticker)) out.push("top20_limit");
    if (top10Set.has(f.ticker)) out.push("top10_limit");
    return out;
  }

  interface PendingReason { type: AlertType; }
  interface Pending { fav: Fav; reasons: PendingReason[]; }
  const perTicker = new Map<string, Pending>();
  const stateUpsertsAlways: Array<{ ticker: string; alert_type: string; last_alert_at: string; ref_close: number | null }> = [];
  // Baseline-sets voor de eerste-run-samenvatting
  const seedSummary: Record<string, string[]> = { below_limit: [], low_5y: [], low_3y: [], top10: [], top20: [] };
  let seeded = 0;

  for (const f of favs) {
    for (const type of triggeredTypes(f)) {
      const meta = TYPE_META[type];
      if (isFirstRun && meta.persistent) {
        // Eerste run: persistente condities stil als baseline vastleggen (geen losse pings).
        stateUpsertsAlways.push({ ticker: f.ticker, alert_type: type, last_alert_at: nowIso, ref_close: f.last_close });
        seeded++;
        if (type === "below_limit") seedSummary.below_limit.push(f.ticker);
        else if (type === "low_5y") seedSummary.low_5y.push(f.ticker);
        else if (type === "low_3y") seedSummary.low_3y.push(f.ticker);
        else if (type === "top10_limit") seedSummary.top10.push(f.ticker);
        else if (type === "top20_limit" && !top10Set.has(f.ticker)) seedSummary.top20.push(f.ticker);
        continue;
      }
      if (!isFresh(type, f)) continue;
      let pend = perTicker.get(f.ticker);
      if (!pend) { pend = { fav: f, reasons: [] }; perTicker.set(f.ticker, pend); }
      pend.reasons.push({ type });
    }
  }

  // Sorteer te-melden tickers op hoogste prioriteit, dan ticker; pas de veiligheidsklep toe.
  const prioOf = (p: Pending) => Math.max(...p.reasons.map((r) => TYPE_META[r.type].priority));
  const notifyAll = [...perTicker.values()].sort((a, b) => prioOf(b) - prioOf(a) || a.fav.ticker.localeCompare(b.fav.ticker));
  const toSend = notifyAll.slice(0, MAX_TICKER_ALERTS);
  const overflow = notifyAll.length - toSend.length;

  let sent = 0; const errors: string[] = [];
  const stateUpserts = [...stateUpsertsAlways];

  for (const pend of toSend) {
    const f = pend.fav;
    // Weergave: top-20-regel onderdrukken als top-10 ook nieuw is (top-10 is sterker),
    // maar beide state-rijen blijven we wel schrijven.
    const hasTop10 = pend.reasons.some((r) => r.type === "top10_limit");
    const displayReasons = pend.reasons.filter((r) => !(hasTop10 && r.type === "top20_limit"));
    // Hoogste prioriteit eerst voor titel + body-volgorde
    displayReasons.sort((a, b) => TYPE_META[b.type].priority - TYPE_META[a.type].priority);
    const primary = displayReasons[0];
    const extra = displayReasons.length > 1 ? ` (+${displayReasons.length - 1})` : "";
    const title = `⭐ ${safeTickerDisplay(f.ticker)} · ${shortTitle(primary.type, f)}${extra}`.slice(0, 120);
    const lines = [...commonBlock(f), ""];
    lines.push("Wat is er aan de hand:");
    for (const r of displayReasons) lines.push(`• ${reasonLine(r.type, f)}`);
    const priority = Math.max(...displayReasons.map((r) => TYPE_META[r.type].priority));
    const tags = Array.from(new Set(displayReasons.flatMap((r) => TYPE_META[r.type].tags)));

    const r = await sendNtfy(settings.ntfy_server, settings.ntfy_topic!, title, lines.join("\n"), priority, tags, googleFinanceUrl(f.ticker, f.exchange));
    if (r.ok) {
      sent++;
      for (const reason of pend.reasons) stateUpserts.push({ ticker: f.ticker, alert_type: reason.type, last_alert_at: nowIso, ref_close: f.last_close });
    } else {
      errors.push(`${f.ticker}: ${r.error}`);
      // niet wegschrijven → volgende run probeert opnieuw
    }
  }

  // Eerste-run-samenvatting: één digest i.p.v. tientallen losse pings.
  if (isFirstRun) {
    const cap = (arr: string[]) => arr.length === 0 ? "—" : arr.slice(0, 15).map(safeTickerDisplay).join(", ") + (arr.length > 15 ? `, … (+${arr.length - 15})` : "");
    const body = [
      "Vanaf nu krijg je een melding zodra er iets verandert bij je favorieten.",
      "",
      "Huidige stand (baseline, geen losse meldingen):",
      `\u{1F3AF} Onder aankooplimiet (${seedSummary.below_limit.length}): ${cap(seedSummary.below_limit)}`,
      `\u{1F53B} Op 5-jaars low (${seedSummary.low_5y.length}): ${cap(seedSummary.low_5y)}`,
      `\u{1F53B} Op 3-jaars low (${seedSummary.low_3y.length}): ${cap(seedSummary.low_3y)}`,
      `\u{1F51F} Top 10 dichtst bij limiet: ${cap(seedSummary.top10)}`,
      `\u{1F522} Top 20 (rang 11-20): ${cap(seedSummary.top20)}`,
    ].join("\n");
    const r = await sendNtfy(settings.ntfy_server, settings.ntfy_topic!, "⭐ Favorieten-alerts staan aan", body, 3, ["star"], "https://constantdynamics.github.io/xinix/?tab=favorieten");
    if (r.ok) sent++; else errors.push(`summary: ${r.error}`);
  }

  // Overflow-melding (zeldzaam): meld het aantal, laat hun state ongemoeid → volgende run.
  if (overflow > 0) {
    const r = await sendNtfy(settings.ntfy_server, settings.ntfy_topic!, "⭐ Meer favorieten met nieuwe situaties", `Er zijn nog ${overflow} favorieten met een nieuwe situatie. Bekijk ze in de app.`, 3, ["star"], "https://constantdynamics.github.io/xinix/?tab=favorieten");
    if (r.ok) sent++; else errors.push(`overflow: ${r.error}`);
  }

  if (stateUpserts.length > 0) {
    const { error } = await sb.from("xinix_fav_alert_state").upsert(stateUpserts, { onConflict: "ticker,alert_type" });
    if (error) errors.push(`state upsert: ${(error as { message?: string }).message ?? String(error)}`);
  }

  return {
    ok: errors.length === 0,
    message: `favorieten: ${favs.length}, gemeld: ${sent}, baseline: ${seeded}${isFirstRun ? " (eerste run)" : ""}, overflow: ${overflow}` + (errors.length ? `; fouten: ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { favorites: favs.length, notified: sent, seeded, overflow, first_run: isFirstRun, errors: errors.length },
  };
}));
