// xinix-rocket-background — maandelijkse ranglijst van "raketten": aandelen met
// de grootste kans om de komende 6 maanden ergens een maand van +150% te maken.
//
// Vervangt het verdubbel-model (P(+100%) binnen 12 maanden) dat in ditzelfde
// tabblad stond. Dat model beantwoordde een andere vraag en miste de sterkste
// meetbare regelmaat in de data.
//
// ── Waar het model op rust ───────────────────────────────────────────────────
// Uit het 10-jarige poefie-archief (explosies van +125% binnen 7 dagen) blijkt
// dat explosies CLUSTEREN. Na een explosie volgt in 15% van de gevallen binnen
// 6 maanden een nieuwe >=150%-explosie, tegen een basiskans van 4.6%. En dat
// effect dooft meetbaar uit naarmate de vorige explosie langer geleden is:
//
//     dagen sinds vorige explosie:   30    90   180   365   730  1460
//     kans op >=150% binnen 6m:    12.1  10.2   9.2   7.0   5.2   4.2  (%)
//     waarnemingen:                2314  2074  1790  1386   899   522
//
// Die curve is de motor. Hij wordt bij ELKE run opnieuw uit het archief
// gemeten (niet ingebakken), zodat het model meegroeit met de data.
//
// Daaroverheen komen vermenigvuldigers die apart zijn gemeten op de watchlist.
// Belangrijk: marktkapitalisatie lijkt 11x waard op de hele watchlist, maar
// BINNEN de groep die al eens explodeerde nog maar 1.4x — het meeste zat al
// besloten in "kleine aandelen exploderen sowieso vaker". Daarom een andere
// mcap-schaal voor aandelen mét en zonder explosie-historie; anders telt het
// model dubbel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() { const u = Deno.env.get("SUPABASE_URL"); const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (!u||!k) throw new Error("env"); return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } }); }
type Json = Record<string, unknown>;
interface RunResult { ok: boolean; message?: string; metrics?: Json; }
async function logRun(job: string, fn: () => Promise<RunResult>): Promise<RunResult> { const sb = getServiceClient(); const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single(); const id = row?.id as number | undefined; try { const r = await fn(); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: r.ok, message: r.message ?? null, metrics: r.metrics ?? null }).eq("id", id); return r; } catch (e) { const msg = e instanceof Error ? e.message : String(e); if (id) await sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", id); throw e; } }
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

const PAGE = 1000;                 // gepagineerd lezen tegen de 10k-rijencap
const EVENT_PCT = 150;             // de gebeurtenis die we voorspellen
const HORIZON_DAYS = 185;          // ~6 maanden vooruit
const LAGS = [30, 90, 180, 365, 730, 1460];  // meetpunten van de vervalcurve
// Een explosie die de poefie-scan nog niet zag (die herscant per 90 dagen):
// een lopende +125% in 22 handelsdagen telt als "explosie nu".
const LIVE_EXPLOSION_PCT = 125;

// Voorwaarden (prior) waar de gemeten waarden naartoe krimpen als de steekproef
// klein is. Zonder krimp slaat één toevallige treffer door in de hele ranglijst.
const PRIOR_NO_HISTORY_MONTHLY = 0.35;  // %/maand voor aandelen zonder explosie-historie
const PRIOR_WEIGHT = 10;                // in "aantal treffers"

async function fetchAll<T>(sb: ReturnType<typeof getServiceClient>, table: string, cols: string, tweak?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q: any = sb.from(table).select(cols).range(from, from + PAGE - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

interface Incident { ticker: string; date: string; ms: number; growth: number }

/** Alle explosie-incidenten uit het archief, chronologisch per ticker. */
function flattenIncidents(rows: Array<{ ticker: string; poefie_incidents: unknown }>): Map<string, Incident[]> {
  const byTicker = new Map<string, Incident[]>();
  for (const r of rows) {
    const arr = Array.isArray(r.poefie_incidents) ? r.poefie_incidents : [];
    const list: Incident[] = [];
    for (const e of arr) {
      const o = e as Record<string, unknown>;
      const date = typeof o.peak_date === "string" ? o.peak_date : null;
      const growth = Number(o.growth_pct);
      if (!date || !Number.isFinite(growth)) continue;
      const ms = Date.parse(date + "T00:00:00Z");
      if (!Number.isFinite(ms)) continue;
      list.push({ ticker: r.ticker, date, ms, growth });
    }
    if (list.length) {
      list.sort((a, b) => a.ms - b.ms);
      byTicker.set(r.ticker, list);
    }
  }
  return byTicker;
}

interface CurvePoint { days: number; prob_pct: number; n: number; hits: number }

/**
 * Meet de vervalcurve uit het archief. Voor elk incident en elke lag: als er in
 * die lag geen nieuwe explosie was ("de laatste explosie is precies lag dagen
 * geleden"), keek dan in de 6 maanden daarna een nieuwe >=150%-explosie?
 * Dat is exact de vraag die het model per aandeel stelt.
 */
function calibrateCurve(byTicker: Map<string, Incident[]>, nowMs: number): CurvePoint[] {
  const DAY = 86400000;
  const out: CurvePoint[] = [];
  for (const lag of LAGS) {
    let n = 0, hits = 0;
    for (const list of byTicker.values()) {
      for (const a of list) {
        const obs = a.ms + lag * DAY;
        if (obs + HORIZON_DAYS * DAY > nowMs) continue;         // geen volle 6m vooruit
        // "laatste explosie was lag dagen geleden": niets tussenin
        if (list.some((c) => c.ms > a.ms && c.ms <= obs)) continue;
        n++;
        if (list.some((b) => b.ms > obs && b.ms <= obs + HORIZON_DAYS * DAY && b.growth >= EVENT_PCT)) hits++;
      }
    }
    if (n > 0) out.push({ days: lag, prob_pct: (100 * hits) / n, n, hits });
  }
  return out;
}

/** Log-lineaire interpolatie over de gemeten curve. */
function probFromCurve(curve: CurvePoint[], days: number): number {
  if (!curve.length) return 4.6;
  if (days <= curve[0].days) return curve[0].prob_pct;
  const last = curve[curve.length - 1];
  if (days >= last.days) return last.prob_pct;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (days >= a.days && days <= b.days) {
      const t = (Math.log(days) - Math.log(a.days)) / (Math.log(b.days) - Math.log(a.days));
      return a.prob_pct + t * (b.prob_pct - a.prob_pct);
    }
  }
  return last.prob_pct;
}

interface Factor { label: string; detail: string; mult: number }

Deno.serve(runBackground("xinix-rocket", async () => {
  const sb = getServiceClient();
  const runStart = new Date().toISOString();
  const nowMs = Date.now();
  const DAY = 86400000;

  // ── Data ───────────────────────────────────────────────────────────────────
  const tickers = await fetchAll<any>(sb, "signal_tickers",
    "ticker, company, sector, yahoo_sector, exchange, market_cap_usd, share_count_millions, dividend_yield, " +
    "is_hikkertje, hikkertje_spikes, is_poefie, poefie_max_growth_pct, poefie_incidents, medal_gold",
    (q) => q.eq("active", true));
  // De vervalcurve is een algemene regelmaat, geen eigenschap van de huidige
  // watchlist: kalibreer op het HELE archief (ook inactief geworden tickers),
  // anders gooi je een derde van de waarnemingen weg.
  const archive = await fetchAll<any>(sb, "signal_tickers", "ticker, poefie_incidents",
    (q) => q.not("poefie_incidents", "is", null));
  const prices = await fetchAll<any>(sb, "signal_price_summary",
    "ticker, last_close, avg_volume_30d, pct_change_22d, high_5y, low_1y");
  const favs = await fetchAll<any>(sb, "xinix_favorites", "ticker, rating");
  const cats = await fetchAll<any>(sb, "signal_catalysts", "ticker, expected_date, catalyst_type, status");

  const priceBy = new Map(prices.map((p) => [p.ticker, p]));
  const favBy = new Map(favs.map((f) => [f.ticker, f]));
  const catBy = new Map<string, { n: number; first: string; type: string }>();
  const todayISO = new Date(nowMs).toISOString().slice(0, 10);
  const horizonISO = new Date(nowMs + HORIZON_DAYS * DAY).toISOString().slice(0, 10);
  for (const c of cats) {
    if (!c.expected_date || c.expected_date < todayISO || c.expected_date > horizonISO) continue;
    if (c.status === "cancelled") continue;
    const cur = catBy.get(c.ticker);
    if (!cur || c.expected_date < cur.first) catBy.set(c.ticker, { n: (cur?.n ?? 0) + 1, first: c.expected_date, type: c.catalyst_type ?? "katalysator" });
    else cur.n++;
  }

  // ── Kalibratie: meet de vervalcurve opnieuw uit het archief ────────────────
  const archiveAll = flattenIncidents(archive);
  const curve = calibrateCurve(archiveAll, nowMs);
  const totalIncidents = [...archiveAll.values()].reduce((n, l) => n + l.length, 0);
  // Scoren gebeurt wél alleen op de actieve watchlist.
  const byTicker = flattenIncidents(
    tickers.filter((t) => Array.isArray(t.poefie_incidents) && t.poefie_incidents.length));

  // Basiskans voor aandelen zónder explosie-historie: meet live op de watchlist
  // (hoeveel van hen doen op dit moment >=150% in 22 dagen?) en krimp naar de
  // prior, zodat één toevallige maand de hele lijst niet omgooit.
  let noHistN = 0, noHistHits = 0;
  for (const t of tickers) {
    if (byTicker.has(t.ticker)) continue;
    const p = priceBy.get(t.ticker);
    if (!p || p.pct_change_22d == null) continue;
    noHistN++;
    if (Number(p.pct_change_22d) >= EVENT_PCT) noHistHits++;
  }
  const measuredMonthly = noHistN > 0 ? (100 * noHistHits) / noHistN : PRIOR_NO_HISTORY_MONTHLY;
  const w = noHistHits / (noHistHits + PRIOR_WEIGHT);
  const blendedMonthly = PRIOR_NO_HISTORY_MONTHLY + w * (measuredMonthly - PRIOR_NO_HISTORY_MONTHLY);
  const baseNoHistory6m = 100 * (1 - Math.pow(1 - blendedMonthly / 100, 6));

  // ── Scoren ─────────────────────────────────────────────────────────────────
  const scored: any[] = [];
  for (const t of tickers) {
    const p = priceBy.get(t.ticker);
    const lastClose = p?.last_close != null ? Number(p.last_close) : null;
    if (!p || lastClose == null || !(lastClose > 0)) continue;   // zonder koers geen oordeel

    const chg22 = p.pct_change_22d != null ? Number(p.pct_change_22d) : null;
    const high5 = p.high_5y != null ? Number(p.high_5y) : null;
    const dollarVol = p.avg_volume_30d != null ? Number(p.avg_volume_30d) * lastClose : null;
    const mcapRaw = t.market_cap_usd != null ? Number(t.market_cap_usd) : null;
    const mcap = mcapRaw && mcapRaw > 0 ? mcapRaw
      : (t.share_count_millions ? Number(t.share_count_millions) * 1e6 * lastClose : null);

    const list = byTicker.get(t.ticker) ?? [];
    const lastInc = list.length ? list[list.length - 1] : null;
    let daysSince = lastInc ? Math.round((nowMs - lastInc.ms) / DAY) : null;

    // Explosie die de scan nog niet zag: lopende +125% in 22 dagen telt als nu.
    const liveExplosion = chg22 != null && chg22 >= LIVE_EXPLOSION_PCT;
    if (liveExplosion) daysSince = daysSince == null ? 20 : Math.min(daysSince, 20);

    const factors: Factor[] = [];
    let prob: number;
    let baseProb: number;
    if (daysSince != null) {
      baseProb = probFromCurve(curve, daysSince);
      prob = baseProb;
      factors.push({
        label: "Explosie-historie",
        detail: liveExplosion && (!lastInc || daysSince === 20)
          ? `explosie loopt nu (+${Math.round(chg22!)}% in 22 dagen) — clustering op zijn sterkst`
          : `laatste explosie ${daysSince} dagen geleden${lastInc ? ` (+${Math.round(lastInc.growth)}%)` : ""}`,
        mult: 1,
      });
    } else {
      baseProb = baseNoHistory6m;
      prob = baseProb;
      factors.push({ label: "Explosie-historie", detail: "geen explosie in het archief — vlakke basiskans", mult: 1 });
    }

    const hasHistory = daysSince != null;
    const mul = (label: string, detail: string, m: number) => { prob *= m; factors.push({ label, detail, mult: m }); };

    // Marktkap. Mét historie is het effect klein (1.4x gemeten binnen de
    // poefie-groep); zonder historie draagt het de volle last (11x op <5M).
    if (mcap != null) {
      const cap = mcap >= 1e9 ? `${(mcap / 1e9).toFixed(1)} mrd` : `${Math.round(mcap / 1e6)} mln`;
      if (hasHistory) {
        if (mcap < 25e6) mul("Marktkap", `$${cap} — microcap`, 1.35);
        else if (mcap >= 500e6) mul("Marktkap", `$${cap} — te groot om snel te verdrievoudigen`, 0.85);
        else factors.push({ label: "Marktkap", detail: `$${cap}`, mult: 1 });
      } else {
        if (mcap < 5e6) mul("Marktkap", `$${cap} — nanocap`, 4.0);
        else if (mcap < 25e6) mul("Marktkap", `$${cap} — microcap`, 2.0);
        else if (mcap < 100e6) factors.push({ label: "Marktkap", detail: `$${cap}`, mult: 1 });
        else if (mcap < 1e9) mul("Marktkap", `$${cap}`, 0.6);
        else mul("Marktkap", `$${cap} — large cap`, 0.55);
      }
    }

    // Hikkertje: >=2 losse dagen van +55% die 3 dagen standhielden, afgelopen jaar.
    if (t.is_hikkertje) {
      const spikes = Number(t.hikkertje_spikes ?? 0);
      mul("Hikkertje", `${spikes || 2} explosieve losse dagen in het afgelopen jaar`, spikes >= 3 ? 1.9 : 1.6);
    }

    // Ruimte omhoog. Diep onder de meerjarentop = ruimte én short-squeeze-brandstof.
    let pctBelow: number | null = null;
    if (high5 && high5 > 0) {
      pctBelow = 100 * (1 - lastClose / high5);
      if (pctBelow > 80) mul("Ruimte omhoog", `${Math.round(pctBelow)}% onder de 5-jaarstop`, 1.25);
      else if (pctBelow > 40) mul("Ruimte omhoog", `${Math.round(pctBelow)}% onder de 5-jaarstop`, 0.95);
      else mul("Ruimte omhoog", `${Math.round(pctBelow)}% onder de 5-jaarstop — weinig ruimte`, 0.85);
    }

    // Aangekondigde katalysator binnen de horizon (het ARCT/MRNA-mechanisme).
    const cat = catBy.get(t.ticker);
    if (cat) mul("Katalysator", `${cat.type} verwacht op ${cat.first}`, 1.35);

    // Dividendbetaler = volwassen bedrijf.
    const dy = t.dividend_yield != null ? Number(t.dividend_yield) : null;
    if (dy != null && dy > 0.02) mul("Dividend", `${(dy * 100).toFixed(1)}% — volwassen bedrijf`, 0.8);

    // Handelbaarheid. Bij een sub-penny of een dood orderboek is +150% een
    // spread-artefact: op papier winst, in werkelijkheid niet te verzilveren.
    const flags: string[] = [];
    let tradeable = true;
    if (lastClose < 0.02 || (dollarVol != null && dollarVol < 2000)) {
      mul("Handelbaarheid", "sub-penny of dood orderboek — +150% is hier een spread-artefact", 0.6);
      flags.push("onhandelbaar");
      tradeable = false;
    } else if (dollarVol != null && dollarVol < 20000) {
      mul("Handelbaarheid", `slechts $${Math.round(dollarVol / 1000)}k omzet per dag`, 0.85);
      flags.push("illiquide");
      tradeable = false;
    }

    // Beursgenoteerde shell: de explosie is echt, maar het vehikel is een lege
    // huls (plaatsing of omgekeerde overname, geen herwaardering om op mee te
    // liften). Geen kansstraf — gemeten exploderen die juist het vaakst — wel
    // een vlag, zodat het handelbaar-filter ze eruit haalt.
    if (mcap != null && mcap < 2e6) {
      flags.push("shell <$2 mln");
      tradeable = false;
    }

    if (chg22 != null && chg22 >= EVENT_PCT) {
      mul("Recente sprong", `deed net al +${Math.round(chg22)}% — beweging deels achter de rug`, 0.9);
      flags.push("net geëxplodeerd");
    }

    prob = Math.min(prob, 55);
    const fav = favBy.get(t.ticker);

    scored.push({
      ticker: t.ticker,
      prob_6m: Math.round(prob * 10) / 10,
      base_prob: Math.round(baseProb * 10) / 10,
      days_since_explosion: daysSince,
      company: t.company ?? null,
      sector: t.yahoo_sector ?? t.sector ?? null,
      exchange: t.exchange ?? null,
      last_close: lastClose,
      market_cap_usd: mcap != null ? Math.round(mcap) : null,
      dollar_volume: dollarVol != null ? Math.round(dollarVol) : null,
      pct_change_22d: chg22,
      pct_below_high5y: pctBelow != null ? Math.round(pctBelow * 10) / 10 : null,
      max_explosion_pct: t.poefie_max_growth_pct != null ? Number(t.poefie_max_growth_pct) : null,
      catalyst_date: cat?.first ?? null,
      catalyst_type: cat?.type ?? null,
      explosion_count: list.length,
      is_favorite: !!fav,
      rating: fav?.rating ?? null,
      tradeable,
      factors,
      flags,
      computed_at: runStart,
    });
  }

  scored.sort((a, b) => b.prob_6m - a.prob_6m);
  scored.forEach((r, i) => { r.rank = i + 1; });

  // ── Wegschrijven ───────────────────────────────────────────────────────────
  for (let i = 0; i < scored.length; i += 500) {
    const { error } = await sb.from("xinix_rocket_scores").upsert(scored.slice(i, i + 500), { onConflict: "ticker" });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
  // Tickers die niet meer meedoen (inactief geworden, koers weg) opruimen.
  const { error: delErr } = await sb.from("xinix_rocket_scores").delete().lt("computed_at", runStart);
  if (delErr) throw new Error(`opruimen: ${delErr.message}`);

  const { error: calErr } = await sb.from("xinix_rocket_calibration").insert({
    computed_at: runStart,
    curve,
    base_rate_6m: Math.round(baseNoHistory6m * 100) / 100,
    incidents: totalIncidents,
    tickers_scored: scored.length,
  });
  if (calErr) throw new Error(`kalibratie: ${calErr.message}`);

  return {
    ok: true,
    message: `${scored.length} aandelen gescoord; curve op ${totalIncidents} incidenten`,
    metrics: {
      tickers_scored: scored.length,
      incidents: totalIncidents,
      curve: curve.map((c) => ({ days: c.days, pct: Math.round(c.prob_pct * 10) / 10, n: c.n })),
      base_no_history_6m: Math.round(baseNoHistory6m * 100) / 100,
      top10: scored.slice(0, 10).map((s) => `${s.ticker} ${s.prob_6m}%`),
    },
  };
}));
