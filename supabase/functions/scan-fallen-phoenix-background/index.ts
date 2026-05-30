// scan-fallen-phoenix-background — gerichte feniks-jacht + profielmatch.
// Vindt aandelen met het echte feniks-profiel:
//   • ooit een run van ≥40× met een piek ≥ $1
//   • nu ≥90% onder die piek gevallen
// Elke treffer is per definitie een feniks. Bovenop dat alle treffers naar de
// watchlist gaan, krijgt elke treffer een "profielmatch"-beoordeling op basis
// van het 4-5★-patroon van de gebruiker (uit analyse van zijn hartjes):
//   geschikte beurs (VS/Canada/Australië/UK) + goedkoop (≤ $15)
//   + actueel thema (crypto/AI/quantum/…) of tekenen van leven (bounce/volume).
// Alleen profielmatches sturen een ntfy-melding (hoge prioriteit, met redenen);
// overige feniksen gaan stil naar de watchlist — geen ruis.
//
// Goedkoop: TradingView's all-time-high-kolom (High.All) is een voorfilter
// (≥90% onder een ATH ≥ $1); de échte run-detectie gebeurt op de Yahoo 10y-bars
// (hasPhoenixRun + drawdown), conform compute-phoenix-background. VS/Canada/
// Australië worden élke run gescand (daar zitten je profielmatches), de overige
// markten roteren over de week voor brede ontdekking.

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
const PHOENIX_MULT = 40;            // run moet ≥40× zijn (afgesproken feniks-drempel)
const PHOENIX_MIN_PEAK = 1.0;       // piek moet ≥ $1 raken (geen sub-penny nep-feniks)
const PHOENIX_MAX_BAR_JUMP = 5;     // enkele bar ≥5× vorige = split/ruis-artefact, overslaan
const ATH_MIN = 1.0;                // all-time-high moet ≥ $1 zijn geweest
const MAX_FRACTION_OF_PEAK = 0.10;  // huidige koers ≤ 10% van de piek = ≥90% gevallen
const PERF_TOPN = 300;              // brede pool per markt per zoekvenster
const MAX_CANDIDATES = 280;         // harde cap op Yahoo-checks per run
const BUDGET_MS = 134_000;
const SLEEP_MS = 210;

// Profielmatch-drempels (uit analyse van de 4-5★-favorieten)
const PROFILE_MAX_PRICE = 15;       // goedkoop genoeg voor "ruimte om te lopen"
const LIVELY_BOUNCE_MULT = 1.30;    // ≥30% boven het 13-weeks-dieptepunt = bounce
const LIVELY_VOL_MULT = 1.5;        // recente 8w-volume ≥1,5× het ~1j-gemiddelde
// Geografie die voor jou meetelt als profielmatch — niet alleen VS, ook de
// markten waar je 4-5★-picks zitten (Canada/UK/Australië).
const PROFILE_REGIONS = new Set(["america", "canada", "australia", "uk"]);
const REGION_LABEL: Record<string, string> = { america: "VS", canada: "Canada", australia: "Australië", uk: "UK" };

// Markten die élke run worden gescand: jouw profiel-markten met de meeste
// matches. UK telt ook als profielmatch maar roteert mee (zie MARKETS_BY_DAY).
interface Mkt { region: string; suffix: string }
const ALWAYS: Mkt[] = [
  { region: "america", suffix: "" },
  { region: "canada", suffix: ".TO" },
  { region: "australia", suffix: ".AX" },
];
// Overige markten verdeeld over de week (getUTCDay 0=zo … 6=za) voor brede
// ontdekking. america/canada/australia zitten al in ALWAYS.
const MARKETS_BY_DAY: Record<number, Mkt[]> = {
  0: [],
  1: [{ region: "uk", suffix: ".L" }, { region: "germany", suffix: ".DE" }, { region: "france", suffix: ".PA" }],
  2: [{ region: "netherlands", suffix: ".AS" }, { region: "belgium", suffix: ".BR" }, { region: "italy", suffix: ".MI" }, { region: "spain", suffix: ".MC" }, { region: "portugal", suffix: ".LS" }, { region: "poland", suffix: ".WA" }],
  3: [{ region: "switzerland", suffix: ".SW" }, { region: "sweden", suffix: ".ST" }, { region: "norway", suffix: ".OL" }, { region: "denmark", suffix: ".CO" }, { region: "finland", suffix: ".HE" }],
  4: [{ region: "hongkong", suffix: ".HK" }],
  5: [{ region: "japan", suffix: ".T" }, { region: "singapore", suffix: ".SI" }],
  6: [],
};
const SKIP = " ";
const PREFIX_OVERRIDE: Record<string, string> = {
  TSX: ".TO", TSXV: ".V", CSE: ".CN", NEO: ".NE", CBOECA: ".NE",
  OTC: SKIP, OTCMKTS: SKIP, PINK: SKIP, OTCQB: SKIP, OTCQX: SKIP, GREY: SKIP,
};

const ETP_RE = /\b(leverage\s*shares|direxion|wisdomtree|proshares|invesco|graniteshares|boost\s*etp|roundhill)\b|\b[2-9]x\s+(long|short|bull|bear)\b|\betp\b|\betf\b/i;
function isEtp(name: string): boolean { return ETP_RE.test(name); }

const LONDON_IOB_RE = /^[0-9][0-9A-Z]{3}\.L$/i;
function isLondonIOB(yahoo: string): boolean { return LONDON_IOB_RE.test(yahoo); }

// Actuele thema's uit het 4-5★-patroon (crypto, AI, quantum, vaccine, clean
// energy, critical minerals, defense/space, ...). Heuristiek op bedrijfsnaam.
const THEME_RE = /\b(crypto|bitcoin|ether(?:eum)?|blockchain|digital\s*asset|web3|coin|token|stablecoin|miner|mining\s*(?:rig|data)?|ai|artificial\s*intelligence|machine\s*learning|quantum|cyber|semiconductor|chip|robot(?:ic)?s?|drone|aerial|aerospace|space|satellite|defen[cs]e|hydrogen|fuel\s*cell|solar|wind|renewable|clean\s*energy|lithium|battery|electric\s*vehicle|\bev\b|lidar|autonomous|uranium|nuclear|rare\s*earth|niobium|graphite|vaccine|gene|oncolog|obesity|glp-?1|therapeutics|biopharma|cannabis|psychedelic|fintech|payments?)\b/i;
function hasTheme(name: string): boolean { return THEME_RE.test(name); }

const MINING_RE = /\b(mining|miner|mines|metals?|minerals?|resources?|exploration|drill(?:ing)?|royalt(?:y|ies)|streaming|gold|silver|copper|lithium|uranium|nickel|cobalt|graphite|zinc|platinum|palladium|tin|tungsten|molybdenum|rare\s*earth|potash|iron\s*ore|coal)\b/i;
const BIOTECH_RE = /\b(pharma(?:ceuticals?)?|biopharma|therapeutics|bio(?:science|tech(?:nology)?|logics|pharm)?|genomics?|gene(?:tic|ric)?|oncolog(?:y|ic)|immuno(?:logy|therap)|cell\s*(?:therap|technolog)|gene\s*therap|medicines?|medical|laboratories|labs|sciences|clinical|antibody|antibodies|vaccines?|RNA|DNA|protein)\b/i;
function inferSector(name: string | null | undefined): "biotech" | "mining" | "other" {
  if (!name) return "other";
  if (MINING_RE.test(name)) return "mining";
  if (BIOTECH_RE.test(name)) return "biotech";
  return "other";
}

const SUFFIX_TO_EXCHANGE: Record<string, string> = {
  TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO",
  L: "LON", AX: "ASX", NZ: "NZE", SW: "SWX",
  DE: "ETR", PA: "EPA", AS: "AMS", MI: "BIT", MC: "BME",
  ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", WA: "WSE",
  BR: "EBR", LS: "ELI", HK: "HKG", T: "TYO", SI: "SGX",
};
function googleFinanceUrl(yahoo: string): string {
  const t = yahoo.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:NASDAQ`;
  const base = t.slice(0, dot);
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  if (!exch) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
  return `https://www.google.com/finance/quote/${encodeURIComponent(base)}:${exch}`;
}

interface Cand { yahoo: string; name: string; exch: string; region: string; geoOk: boolean }
// TradingView per markt × zoekvenster (Perf.5Y én Perf.Y), met all-time-high
// als goedkope voorfilter (≥90% onder een ATH ≥ $1).
async function tvScan(region: string, sortBy: string, topN: number, suffix: string): Promise<Cand[]> {
  const geoOk = PROFILE_REGIONS.has(region);
  const body = {
    filter: [
      { left: "type", operation: "equal", right: "stock" },
      { left: "close", operation: "in_range", right: [0.02, 50] },
      { left: "volume", operation: "egreater", right: 5000 },
    ],
    options: { lang: "en" },
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "description", "close", "High.All", "exchange"],
    sort: { sortBy, sortOrder: "asc" },
    range: [0, topN],
  };
  const res = await fetch(`https://scanner.tradingview.com/${region}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0", Origin: "https://www.tradingview.com" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`TV ${region}/${sortBy} HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ s?: string; d?: unknown[] }> };
  const out: Cand[] = [];
  for (const row of json.data ?? []) {
    const s = String(row.s ?? "");
    const colon = s.indexOf(":");
    if (colon === -1) continue;
    const prefix = s.slice(0, colon).toUpperCase();
    const sym = s.slice(colon + 1).toUpperCase().replace(/\./g, "-");
    const ov = PREFIX_OVERRIDE[prefix];
    if (ov === SKIP) continue;
    const sfx = ov ?? suffix;
    const d = (row.d ?? []) as unknown[];
    const name = (d[1] as string) || (d[0] as string) || sym;
    const close = typeof d[2] === "number" ? (d[2] as number) : null;
    const athAll = typeof d[3] === "number" ? (d[3] as number) : null;
    if (isEtp(name)) continue;
    if (athAll != null && athAll > 0 && close != null) {
      if (athAll < ATH_MIN) continue;
      if (close > athAll * MAX_FRACTION_OF_PEAK) continue;
    }
    const yahoo = `${sym}${sfx}`;
    if (isLondonIOB(yahoo)) continue;
    out.push({ yahoo, name, exch: prefix, region, geoOk });
  }
  return out;
}

interface Bar { date: string; close: number; volume: number }
async function fetchYahoo10y(ticker: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1wk`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SignalFallenPhoenixBot/1.0; +https://github.com)" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker} HTTP ${res.status}`);
  const json = (await res.json()) as { chart: { result?: Array<{ timestamp: number[]; indicators: { adjclose?: Array<{ adjclose?: (number | null)[] }>; quote: Array<{ close: (number | null)[]; volume: (number | null)[] }> }; }>; error?: { description?: string } | null; }; };
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo ${ticker}: ${json.chart.error?.description ?? "no result"}`);
  const ts = r.timestamp ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const closes = adj ?? r.indicators.quote[0]?.close ?? [];
  const vols = r.indicators.quote[0]?.volume ?? [];
  return ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] ?? NaN, volume: vols[i] ?? 0 })).filter((b): b is Bar => Number.isFinite(b.close) && b.close > 0);
}

// Feniks-run, in lijn met compute-phoenix-background: ≥40× vanaf een lopend
// minimum, piek ≥ $1, enkele bar ≥5× de vorige (split/ruis) overgeslagen.
function hasPhoenixRun(closes: number[]): boolean {
  const clean: number[] = [];
  let prev = NaN;
  for (const c of closes) {
    if (Number.isFinite(prev) && prev > 0 && c >= prev * PHOENIX_MAX_BAR_JUMP) { prev = c; continue; }
    clean.push(c); prev = c;
  }
  let minSoFar = Infinity;
  for (const c of clean) {
    if (c < minSoFar) { minSoFar = c; continue; }
    if (minSoFar > 0 && c >= minSoFar * PHOENIX_MULT && c >= PHOENIX_MIN_PEAK) return true;
  }
  return false;
}

// "Tekenen van leven": recente bounce (≥30% boven het 13-weeks-dieptepunt) OF
// een volume-opleving (recente 8w ≥1,5× het ~1j-gemiddelde). Dode, vlak op de
// bodem liggende namen (zoals MVIS) vallen af; actieve (zoals PLUG) niet.
function livelinessReasons(bars: Bar[]): string[] {
  const reasons: string[] = [];
  const closes = bars.map((b) => b.close);
  const last = closes[closes.length - 1];
  const recent13 = closes.slice(-13);
  const low13 = recent13.length ? Math.min(...recent13) : last;
  if (low13 > 0 && last >= low13 * LIVELY_BOUNCE_MULT) reasons.push("recente bounce");
  const vols = bars.map((b) => b.volume).filter((v) => v > 0);
  if (vols.length >= 60) {
    const recent8 = vols.slice(-8);
    const base = vols.slice(-60, -8);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    if (recent8.length && base.length && avg(base) > 0 && avg(recent8) >= avg(base) * LIVELY_VOL_MULT) reasons.push("volume-opleving");
  }
  return reasons;
}

async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl?: string): Promise<boolean> {
  try {
    const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
    if (clickUrl) payload.click = clickUrl;
    const res = await fetch((server || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface Gem {
  yahoo: string; name: string; sector: string; lastClose: number; peak: number; peakDate: string;
  low5y: number; drawdownPct: number; exch: string; region: string; geoOk: boolean; firstPriceDate: string | null;
  profileMatch: boolean; profileReasons: string[];
}

Deno.serve(runBackground("scan-fallen-phoenix", async () => {
  const sb = getServiceClient();
  const startMs = Date.now();
  // Profiel-markten élke run (VS/Canada/Australië) + de dag-rotatie. Dedup op region.
  const dayMarkets = (MARKETS_BY_DAY[new Date().getUTCDay()] ?? []).filter((m) => !ALWAYS.some((a) => a.region === m.region));
  const markets: Mkt[] = [...ALWAYS, ...dayMarkets];

  // 1) Kandidaten per markt × zoekvenster (Perf.5Y + Perf.Y), voorgefilterd op ATH.
  const candMap = new Map<string, Cand>();
  const tvErrors: string[] = [];
  for (const m of markets) {
    for (const sortBy of ["Perf.5Y", "Perf.Y"]) {
      try {
        const rows = await tvScan(m.region, sortBy, PERF_TOPN, m.suffix);
        for (const c of rows) if (!candMap.has(c.yahoo)) candMap.set(c.yahoo, c);
      } catch (e) {
        tvErrors.push(`${m.region}/${sortBy}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  // Profiel-markten eerst, zodat de meeste profielmatches binnen het budget passen.
  const allCands = [...candMap.values()].sort((a, b) => (b.geoOk ? 1 : 0) - (a.geoOk ? 1 : 0));

  // 2) Al in de watchlist? Overslaan.
  const existing = new Set<string>();
  const allSyms = allCands.map((c) => c.yahoo);
  for (let i = 0; i < allSyms.length; i += 200) {
    const { data } = await sb.from("signal_tickers").select("ticker").in("ticker", allSyms.slice(i, i + 200));
    for (const r of data ?? []) existing.add(r.ticker as string);
  }
  const candidates = allCands.filter((c) => !existing.has(c.yahoo)).slice(0, MAX_CANDIDATES);

  // 3) Per kandidaat: feniks-run + ≥90%-drawdown verifiëren + profielmatch bepalen.
  const gems: Gem[] = [];
  let checked = 0;
  const yErrors: string[] = [];
  for (const c of candidates) {
    if (Date.now() - startMs > BUDGET_MS) break;
    checked++;
    try {
      const bars = await fetchYahoo10y(c.yahoo);
      if (bars.length < 20) continue;
      const closes = bars.map((b) => b.close);
      if (!hasPhoenixRun(closes)) continue;
      const lastClose = closes[closes.length - 1];
      let peak = -Infinity, peakIdx = 0;
      for (let k = 0; k < closes.length; k++) if (closes[k] > peak) { peak = closes[k]; peakIdx = k; }
      if (peak <= 0) continue;
      if (lastClose / peak > MAX_FRACTION_OF_PEAK) continue; // niet ≥90% gevallen
      const bars5y = bars.slice(-260);
      const low5y = Math.min(...bars5y.map((b) => b.close));

      // Profielmatch (4-5★-patroon): geschikte beurs + goedkoop + (thema OF leeft).
      const lively = livelinessReasons(bars);
      const themed = hasTheme(c.name);
      const cheap = lastClose <= PROFILE_MAX_PRICE;
      const profileMatch = c.geoOk && cheap && (themed || lively.length > 0);
      const reasons: string[] = [];
      if (c.geoOk) reasons.push(REGION_LABEL[c.region] ?? c.region);
      if (cheap) reasons.push(`goedkoop ($${lastClose.toFixed(lastClose < 5 ? 3 : 2)})`);
      if (themed) reasons.push("actueel thema");
      reasons.push(...lively);

      gems.push({
        yahoo: c.yahoo, name: c.name, sector: inferSector(c.name),
        lastClose, peak, peakDate: bars[peakIdx]?.date ?? "", low5y,
        drawdownPct: (1 - lastClose / peak) * 100, exch: c.exch, region: c.region, geoOk: c.geoOk,
        firstPriceDate: bars[0]?.date ?? null, profileMatch, profileReasons: reasons,
      });
    } catch (e) {
      if (yErrors.length < 5) yErrors.push(`${c.yahoo}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }

  // 4) Toevoegen + signal_event (alle treffers) + ntfy (alleen profielmatches).
  let added = 0;
  const matches = gems.filter((g) => g.profileMatch);
  if (gems.length) {
    const rows = gems.map((g) => {
      const smartLimit = g.low5y > 0 ? Number(g.low5y.toFixed(g.low5y < 1 ? 4 : g.low5y < 10 ? 3 : 2)) : null;
      const exchange = g.yahoo.includes(".") ? null : g.exch;
      const matchTag = g.profileMatch ? "★ PROFIELMATCH — " : "";
      return {
        ticker: g.yahoo, company: g.name, sector: g.sector, active: true,
        exchange, buy_limit: smartLimit, is_phoenix: true,
        first_price_date: g.firstPriceDate ?? null,
        notes: `${matchTag}Auto-toegevoegd: gevallen feniks — ${g.drawdownPct.toFixed(0)}% onder piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} (${g.peakDate}); run ≥${PHOENIX_MULT}×.${g.profileReasons.length ? " Profiel: " + g.profileReasons.join(", ") + "." : ""}`,
      };
    });
    const { error } = await sb.from("signal_tickers").upsert(rows, { onConflict: "ticker", ignoreDuplicates: false });
    if (!error) added = rows.length;

    for (const g of gems) {
      await sb.from("signal_events").insert({
        ticker: g.yahoo, signal_type: "fallen_phoenix_gem", severity: g.profileMatch ? "orange" : "yellow",
        title: `${g.profileMatch ? "★ " : ""}${g.yahoo} — gevallen feniks · -${g.drawdownPct.toFixed(0)}% onder piek`,
        detail: `${g.name} · koers ~${g.lastClose.toFixed(g.lastClose < 5 ? 3 : 2)}, piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} (${g.peakDate}). Ooit ≥${PHOENIX_MULT}× gestegen en nu ${g.drawdownPct.toFixed(0)}% gevallen.${g.profileMatch ? " ★ Past bij je 4-5★-profiel: " + g.profileReasons.join(", ") + "." : ""} Auto-toegevoegd aan de watchlist.`,
        payload: { source: "tradingview_fallen_phoenix", last_close: g.lastClose, peak: g.peak, peak_date: g.peakDate, drawdown_pct: g.drawdownPct, low_5y: g.low5y, region: g.region, profile_match: g.profileMatch, profile_reasons: g.profileReasons },
        alerted: true,
        expires_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ntfy — ALLEEN profielmatches (de namen die je waarschijnlijk hart). De rest
    // staat stil op je watchlist/dashboard. Geen ruis.
    if (matches.length) {
      const { data: settings } = await sb.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).single();
      const topic = settings?.ntfy_topic as string | null | undefined;
      if (topic) {
        const sorted = matches.sort((a, b) => b.drawdownPct - a.drawdownPct);
        const lines = sorted.map((g) => {
          const url = googleFinanceUrl(g.yahoo);
          return `\u{1F985} ${g.yahoo} — ${g.name}\n   piek $${g.peak.toFixed(g.peak < 5 ? 3 : 2)} → nu ~${g.lastClose.toFixed(g.lastClose < 5 ? 3 : 2)} (-${g.drawdownPct.toFixed(0)}%)\n   ${g.profileReasons.join(" · ")}\n${url}`;
        });
        await sendNtfy(
          (settings?.ntfy_server as string) ?? "https://ntfy.sh",
          topic,
          `\u{2B50} ${matches.length} feniks die bij je profiel past`,
          lines.join("\n\n") + `\n\nGevallen feniksen die matchen met je 4-5★-patroon (feniks + geschikte beurs + goedkoop + thema/leeft). Nu in je watchlist.`,
          5,
          ["star", "bird"],
          sorted.length === 1 ? googleFinanceUrl(sorted[0].yahoo) : undefined,
        );
      }
    }
  }

  const errs = [...tvErrors, ...yErrors];
  return {
    ok: tvErrors.length < markets.length, // alleen fout als (vrijwel) alle markten faalden
    message: `markten: ${markets.map((m) => m.region).join("/")}; ${allCands.length} kandidaten (voorgefilterd), ${candidates.length} nieuw, ${checked} gecheckt, ${gems.length} gevallen feniks(en), ${matches.length} profielmatch, ${added} toegevoegd` + (errs.length ? `; ${errs.slice(0, 3).join("; ")}` : ""),
    metrics: { day: new Date().getUTCDay(), markets: markets.map((m) => m.region), candidates_total: allCands.length, candidates_new: candidates.length, checked, gems: gems.length, profile_matches: matches.length, added },
  };
}));
