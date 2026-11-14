// xinix-supersprint/run — het werk zelf: rondes, meldingen, track record, lezen. Krijgt de
// databaseclient aangereikt, zodat het ook met een nagebootste database te testen is.
import * as C from "./core.ts";

// deno-lint-ignore no-explicit-any
export type SB = any;
export type Json = Record<string, unknown>;
export interface RunResult { ok: boolean; message?: string; metrics?: Json }

// ── Zuinigheid ──────────────────────────────────────────────────────────────
// Per regio hoogstens zoveel aandelen wegschrijven; de rest van de markt blijft in het geheugen.
// (De ronde "amerika" telt twee regio's: de VS en Canada hebben elk hun eigen kopgroep.)
export const TOP_N = 100, TOP_MIN = 25, MIN_BASE = 0.01;
const NEWS_TOP = 12;
// Dagbudget. Gewoon verbruik: 5 runs, ±25 TradingView-verzoeken, ±120 Yahoo-verzoeken, ±800 rijen.
export const BUDGET = { runs: 30, tv: 80, yahoo: 400, rows: 2500 };
const BRAKE_FAILS = 3, BRAKE_HOURS = 24;
const REALERT_DAYS = 10, REALERT_GAIN = 5, PENDING_MAX_H = 20;
const RESOLVE_AFTER_DAYS = 16, RESOLVE_TICKERS = 80, GIVE_UP_DAYS = 45;
const SEED_URL = "https://constantdynamics.github.io/xinix/ss-breadth-seed.json";
const DAY = C.DAY;

export interface Settings {
  ntfy_topic: string | null; ntfy_server: string | null; quiet_hours_start: number | null; quiet_hours_end: number | null;
  ss_enabled: boolean | null; ss_alerts: boolean | null; ss_alert_min_prob: number | null; ss_alert_max_per_week: number | null; ss_override_min_prob: number | null;
}
export interface Meter { tv: number; yahoo: number; rows: number; alerts: number; errors: number }
export interface Ctx { sb: SB; settings: Settings; meter: Meter; spent: { yahoo: number }; today: string; nowMs: number }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r2 = (v: number) => Math.round(v * 100) / 100;
const fin = (v: number) => (Number.isFinite(v) ? v : null);
const isoMinus = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") - days * DAY).toISOString().slice(0, 10);
function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
function inQuietHours(s: Settings): boolean {
  if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false;
  const h = new Date().getUTCHours(), a = s.quiet_hours_start, b = s.quiet_hours_end;
  if (a === b) return false;
  return a < b ? h >= a && h < b : h >= a || h < b;
}
const yahooLeft = (ctx: Ctx) => BUDGET.yahoo - ctx.spent.yahoo - ctx.meter.yahoo;

/** Schakelaar, rem en dagbudget rond elke run; boekt het verbruik af. */
export async function guarded(sb: SB, fn: (ctx: Ctx) => Promise<RunResult>): Promise<RunResult> {
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const [st, br, bu] = await Promise.all([
    sb.from("signal_settings").select("ntfy_topic, ntfy_server, quiet_hours_start, quiet_hours_end, ss_enabled, ss_alerts, ss_alert_min_prob, ss_alert_max_per_week, ss_override_min_prob").eq("id", 1).maybeSingle(),
    sb.from("xinix_ss_state").select("value").eq("key", "brake").maybeSingle(),
    sb.from("xinix_ss_budget").select("runs, tv, yahoo, rows_written").eq("day", today).maybeSingle(),
  ]);
  const settings = must(st, "instellingen") as Settings | null;
  if (!settings) throw new Error("instellingen niet gevonden");
  if (settings.ss_enabled === false) return { ok: true, message: "SUPERsprinters staat uit (ss_enabled)", metrics: { skipped: "uit" } };
  const brake = (br.data?.value ?? {}) as { fails?: number; paused_until?: string | null; last_error?: string | null };
  if (brake.paused_until && Date.parse(brake.paused_until) > nowMs) {
    return { ok: true, message: `op de rem tot ${brake.paused_until} na ${brake.fails} mislukte runs: ${brake.last_error ?? ""}`, metrics: { skipped: "rem" } };
  }
  const bud = bu.data as { runs: number; tv: number; yahoo: number; rows_written: number } | null;
  if (bud && (bud.runs >= BUDGET.runs || bud.tv >= BUDGET.tv || bud.rows_written >= BUDGET.rows)) {
    return { ok: true, message: `dagbudget op: runs ${bud.runs}/${BUDGET.runs}, TradingView ${bud.tv}/${BUDGET.tv}, rijen ${bud.rows_written}/${BUDGET.rows}`, metrics: { skipped: "budget" } };
  }
  const meter: Meter = { tv: 0, yahoo: 0, rows: 0, alerts: 0, errors: 0 };
  const ctx: Ctx = { sb, settings, meter, spent: { yahoo: bud?.yahoo ?? 0 }, today, nowMs };
  let res: RunResult | null = null, err: unknown = null;
  try { res = await fn(ctx); } catch (e) { err = e; }
  const nowIso = new Date().toISOString();
  if (err) {
    meter.errors++;
    const fails = (brake.fails ?? 0) + 1;
    await sb.from("xinix_ss_state").upsert({ key: "brake", updated_at: nowIso, value: {
      fails, last_error: msg(err).slice(0, 200), at: nowIso,
      paused_until: fails >= BRAKE_FAILS ? new Date(Date.now() + BRAKE_HOURS * 3600_000).toISOString() : null,
    } });
  } else if ((brake.fails ?? 0) > 0) {
    await sb.from("xinix_ss_state").upsert({ key: "brake", updated_at: nowIso, value: { fails: 0, last_error: null, at: nowIso, paused_until: null } });
  }
  await sb.rpc("xinix_ss_budget_add", {
    p_day: today, p_runs: 1, p_tv: meter.tv, p_yahoo: meter.yahoo, p_rows: meter.rows,
    p_ms: Date.now() - nowMs, p_errors: meter.errors, p_alerts: meter.alerts,
  });
  if (err) throw err;
  return res!;
}

// ── Ronde: markt ophalen, scoren, kopgroep wegschrijven, melden ─────────────
interface Cand {
  ticker: string; name: string | null; region: number; exchange: string | null; currency: string | null;
  close: number; close_usd: number | null; change_1d: number | null; perf_1m: number | null; dvol_usd: number | null;
  prob: number; reasons: C.Reason[]; news: C.NewsItem[] | null; session_date: string; base_rate: number;
}

export async function round(ctx: Ctx, region: string, dateOverride: string | null): Promise<RunResult> {
  const markets = C.ROUNDS[region];
  if (!markets) throw new Error(`onbekende ronde "${region}" (apac, europa of amerika)`);
  const { sb, meter } = ctx;
  const day = dateOverride ?? ctx.today;
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  const [model, st, fx] = await Promise.all([
    C.loadModel(),
    sb.from("xinix_ss_state").select("key, value").in("key", ["calib", `round:${region}`]),
    sb.from("xinix_fx_rates").select("currency, per_eur"),
  ]);
  const state = new Map<string, Json>(((must(st, "toestand") ?? []) as Array<{ key: string; value: Json }>).map((r) => [r.key, r.value]));
  const m0 = Number(state.get("calib")?.mult);
  const mult = Number.isFinite(m0) ? Math.min(2, Math.max(0.5, m0)) : model.mult_seed;
  const perEur: Record<string, number> = { EUR: 1 };
  for (const r of (must(fx, "wisselkoersen") ?? []) as Array<{ currency: string; per_eur: number }>) perEur[r.currency] = Number(r.per_eur);
  if (!(perEur.USD > 0)) throw new Error("geen wisselkoersen in xinix_fx_rates");
  const prevFp = ((state.get(`round:${region}`)?.markets ?? {}) as Record<string, { fp: string; day: string }>);

  // 1. De hele markt bij TradingView (één verzoek per 3000 aandelen). Dezelfde cijfers als de vorige
  //    ronde betekent dat de beurs dicht was: die markt slaan we over.
  const fresh: C.TvRow[] = [];
  const fp: Record<string, { fp: string; day: string }> = {};
  const closed: string[] = [];
  let reached = 0, universe = 0;
  for (const m of markets) {
    try {
      const { rows, requests } = await C.tvMarket(m);
      meter.tv += requests;
      if (rows.length < 10) { errors.push(`${m}: maar ${rows.length} aandelen`); if (prevFp[m]) fp[m] = prevFp[m]; continue; }
      reached++; universe += rows.length;
      let sv = 0, sc = 0;
      for (const r of rows) { sv += r.volume > 0 ? r.volume : 0; sc += r.close; }
      const f = `${rows.length}:${Math.round(sv)}:${sc.toFixed(2)}`;
      if (prevFp[m]?.fp === f) { closed.push(m); fp[m] = prevFp[m]; continue; }
      fp[m] = { fp: f, day };
      for (const r of rows) fresh.push(r);
    } catch (e) { errors.push(`${m}: ${msg(e)}`); if (prevFp[m]) fp[m] = prevFp[m]; }
  }
  if (reached === 0) throw new Error(`TradingView gaf niets terug: ${errors.slice(0, 3).join("; ")}`);
  if (!fresh.length) {
    const fl = await flush(ctx);
    return { ok: errors.length === 0, message: `${region}: geen nieuwe sessie (${closed.join(", ")} dicht); ${fl.message ?? ""}`, metrics: { universe, closed: closed.length } };
  }

  // 2. Wie doet mee: koers ≥ $0,50 en omzet ≥ $10.000 per dag.
  const elig: Array<{ r: C.TvRow; usd: number; pxUsd: number; dvolUsd: number }> = [];
  for (const r of fresh) {
    const usd = C.usdPer(r.currency, perEur);
    if (usd == null) continue;
    const e = C.eligible(r, usd, model.min_px_usd, model.min_dvol_usd);
    if (e.ok) elig.push({ r, usd, pxUsd: e.pxUsd, dvolUsd: e.dvolUsd });
  }
  if (elig.length < 50) throw new Error(`${region}: maar ${elig.length} aandelen voldoen aan de eisen (van ${fresh.length})`);

  // 3. Marktklimaat per regio: vandaag uit deze ronde, de voortschrijdende gemiddelden uit de tabel.
  const regs = [...new Set(elig.map((e) => e.r.region))];
  const needRegs = [...new Set([...regs, 0])];
  const bh = await sb.from("xinix_ss_breadth").select("region, day, n, b1_20, b1_10, bm_50, bm_100, bvw_15").in("region", needRegs).gte("day", isoMinus(day, 60)).order("day");
  const hist = new Map<number, C.BreadthDay[]>();
  for (const b of (must(bh, "marktklimaat") ?? []) as Array<C.BreadthDay & { region: number }>) (hist.get(b.region) ?? hist.set(b.region, []).get(b.region)!).push(b);
  let seeded = 0;
  if (needRegs.some((g) => (hist.get(g)?.length ?? 0) < 10)) {
    // Eerste weken: startwaarden uit het onderzoek, zodat de gemiddelden over 5 en 22 dagen meteen kloppen.
    try {
      const res = await fetch(SEED_URL);
      if (res.ok) {
        const seed = ((await res.json()) as Array<C.BreadthDay & { region: number }>).filter((s) => needRegs.includes(s.region) && s.day < day);
        const rows = seed.filter((s) => !(hist.get(s.region) ?? []).some((h) => h.day === s.day))
          .map((s) => ({ region: s.region, day: s.day, n: 0, b1_20: s.b1_20, b1_10: s.b1_10, bm_50: s.bm_50, bm_100: s.bm_100, bvw_15: s.bvw_15 }));
        if (rows.length) {
          must(await sb.from("xinix_ss_breadth").upsert(rows, { onConflict: "region,day", ignoreDuplicates: true }), "startwaarden marktklimaat");
          seeded = rows.length; meter.rows += rows.length;
          for (const s of rows) (hist.get(s.region) ?? hist.set(s.region, []).get(s.region)!).push(s);
          for (const h of hist.values()) h.sort((a, b) => a.day.localeCompare(b.day));
        }
      } else errors.push(`startwaarden marktklimaat: HTTP ${res.status}`);
    } catch (e) { errors.push(`startwaarden marktklimaat: ${msg(e)}`); }
  }
  const todayB: Array<C.BreadthDay & { region: number }> = [];
  for (const g of regs) {
    const rows = elig.filter((e) => e.r.region === g).map((e) => e.r);
    if (rows.length < C.MIN_BREADTH_N) continue;
    const b = C.breadthOf(day, rows);
    const h = (hist.get(g) ?? []).filter((x) => x.day < day);
    h.push(b); hist.set(g, h);
    todayB.push({ ...b, region: g });
  }
  const bmap = new Map<number, Record<string, number>>();
  for (const g of regs) {
    const own = C.breadthVector((hist.get(g) ?? []).filter((x) => x.day <= day).slice(-30));
    // VS-klimaat: voor VS en Canada dezelfde dag, voor Europa en Azië de laatste Amerikaanse sessie ervóór.
    const us = C.breadthVector((hist.get(0) ?? []).filter((x) => (g <= 1 ? x.day <= day : x.day < day)).slice(-30));
    const o: Record<string, number> = {};
    C.BREADTH_NAMES.forEach((n, i) => { o[n] = own[i]; o["us_" + n] = us[i]; });
    bmap.set(g, o);
  }

  // 4. Scoren (in het geheugen, de hele markt) en de kopgroep kiezen.
  const scored: C.Scored[] = [];
  for (const e of elig) {
    const x = C.vectorOf(model, e.r, e.usd, bmap.get(e.r.region)!);
    const raw = C.rawScore(model, x);
    const base = C.curveProb(model, raw);
    scored.push({ row: e.r, pxUsd: e.pxUsd, dvolUsd: e.dvolUsd, x, raw, base, prob: C.finalProb(model, base, mult) });
  }
  const ranked = scored.filter((s) => !C.isSpac(s.row.name)).sort((a, b) => b.raw - a.raw);
  const seenPerRegion = new Map<number, number>();
  const top = ranked.filter((s) => {
    const i = seenPerRegion.get(s.row.region) ?? 0;
    const keep = i < TOP_MIN || (i < TOP_N && s.base >= MIN_BASE);
    if (keep) seenPerRegion.set(s.row.region, i + 1);
    return keep;
  });
  const ref = C.medianVector(model, scored.map((s) => s.x));
  const tickers = top.map((s) => s.row.ticker);
  const prevRows = must(await sb.from("xinix_ss_scores").select("ticker, first_seen, news, news_at").in("ticker", tickers), "vorige stand") as Array<{ ticker: string; first_seen: string | null; news: C.NewsItem[] | null; news_at: string | null }>;
  const prev = new Map((prevRows ?? []).map((r) => [r.ticker, r]));

  // 5. Nieuws voor de bovenste aandelen en voor wie boven de meldgrens staat.
  const minProb = Number(ctx.settings.ss_alert_min_prob ?? 15);
  const news = new Map<string, C.NewsItem[]>();
  for (const s of top.filter((s, i) => i < NEWS_TOP || s.prob * 100 >= minProb).slice(0, NEWS_TOP + 8)) {
    if (yahooLeft(ctx) <= 20) break;
    meter.yahoo++;
    try { news.set(s.row.ticker, await C.yahooNews(s.row.ticker, s.row.name, ctx.nowMs)); } catch { /* nieuws is bijzaak */ }
    await sleep(100);
  }

  // 6. Wegschrijven: de kopgroep in één opdracht, het track record erbij.
  const fresh3 = isoMinus(day, 3);
  const scoreRows: Json[] = [], predRows: Json[] = [], cands: Cand[] = [];
  const rankIn = new Map<number, number>();
  top.forEach((s) => {
    const r = s.row, p = prev.get(r.ticker), nw = news.get(r.ticker);
    const i = rankIn.get(r.region) ?? 0;          // plaats binnen de eigen regio
    rankIn.set(r.region, i + 1);
    const reasons = C.explain(model, s, ref, bmap.get(r.region)!);
    const mcapUsd = r.mcap * (C.usdPer(r.mcapCur ?? r.currency, perEur) ?? NaN);
    const prob = r2(s.prob * 100);
    scoreRows.push({
      ticker: r.ticker, tv_symbol: r.tv_symbol, market: r.market, region: r.region, exchange: r.exchange, name: r.name, currency: r.currency, sector: r.sector,
      close: r.close, close_usd: Math.round(s.pxUsd * 10000) / 10000, change_1d: fin(r2(r.change)), perf_1m: fin(r2(r.perf1m)), vol_m: fin(r2(r.volM)), rel_vol: fin(r2(r.rv10)),
      dvol_usd: Math.round(s.dvolUsd), mcap_usd: Number.isFinite(mcapUsd) ? Math.round(mcapUsd) : null, float_shares: Number.isFinite(r.float) ? Math.round(r.float) : null,
      prob, prob_base: r2(s.base * 100), raw: s.raw, rank: i + 1, reasons,
      news: nw ?? p?.news ?? null, news_at: nw ? nowIso : (p?.news_at ?? null),
      session_date: day, scored_at: nowIso, first_seen: p?.first_seen ?? day,
    });
    const grp = nw ? [...new Set(nw.filter((n) => n.d >= fresh3).map((n) => n.g))] : [];
    predRows.push({ ticker: r.ticker, made_on: day, region: r.region, prob, prob_base: r2(s.base * 100), raw: s.raw, rank: i + 1, entry_close: r.close, news_grp: grp.length ? grp : null });
    if (prob >= minProb) cands.push({
      ticker: r.ticker, name: r.name, region: r.region, exchange: r.exchange, currency: r.currency, close: r.close, close_usd: s.pxUsd, change_1d: fin(r.change), perf_1m: fin(r.perf1m),
      dvol_usd: s.dvolUsd, prob, reasons, news: nw ?? null, session_date: day, base_rate: model.base_rate_pct,
    });
  });
  must(await sb.from("xinix_ss_scores").upsert(scoreRows, { onConflict: "ticker" }), "scores");
  must(await sb.from("xinix_ss_predictions").upsert(predRows, { onConflict: "ticker,made_on", ignoreDuplicates: true }), "track record");
  if (todayB.length) must(await sb.from("xinix_ss_breadth").upsert(todayB, { onConflict: "region,day" }), "marktklimaat");
  must(await sb.from("xinix_ss_state").upsert({ key: `round:${region}`, updated_at: nowIso, value: { markets: fp, day, at: nowIso, universe, eligible: elig.length, top: top.length, mult, model: model.version } }), "toestand");
  meter.rows += scoreRows.length + predRows.length + todayB.length + 1;

  // 7. Melden (eerst wat nog wachtte uit de stille uren, dan deze ronde).
  const fl = await flush(ctx);
  const al = await sendAlerts(ctx, cands);
  const head = top.slice(0, 5).map((s) => `${s.row.ticker} ${r2(s.prob * 100)}%`).join(", ");
  return {
    ok: errors.length === 0,
    message: `${region} ${day}: ${universe} aandelen opgehaald, ${elig.length} doen mee, ${top.length} bewaard; top ${head}; ` +
      `boven ${minProb}%: ${cands.length}, ${al.text}` + (fl.metrics?.pending ? `; wachtend: ${fl.message}` : "") +
      (closed.length ? `; dicht: ${closed.join(", ")}` : "") + (seeded ? `; ${seeded} startwaarden marktklimaat` : "") +
      (errors.length ? `; fouten: ${errors.slice(0, 4).join("; ")}` : ""),
    metrics: { universe, eligible: elig.length, top: top.length, candidates: cands.length, sent: al.sent, held: al.held, capped: al.capped, blocked: al.blocked, pending: al.pending, closed: closed.length, mult, tv: meter.tv, yahoo: meter.yahoo, rows: meter.rows },
  };
}

// ── Meldingen ───────────────────────────────────────────────────────────────
interface AlertOut { sent: number; held: number; capped: number; blocked: number; pending: number; text: string }

async function sendAlerts(ctx: Ctx, cands: Cand[]): Promise<AlertOut> {
  const out: AlertOut = { sent: 0, held: 0, capped: 0, blocked: 0, pending: 0, text: "" };
  const { sb, settings: s, meter } = ctx;
  const done = (why?: string): AlertOut => {
    out.text = why ?? `gemeld ${out.sent}, wacht op einde stille uren ${out.pending}, weekplafond ${out.capped}, tegengehouden ${out.blocked}, niet te controleren ${out.held}`;
    return out;
  };
  if (!cands.length) return done("geen kandidaten");
  if (s.ss_alerts !== true) return done("meldingen staan uit (ss_alerts)");
  if (!s.ntfy_topic || !s.ntfy_server) return done("geen ntfy ingesteld");
  const minProb = Number(s.ss_alert_min_prob ?? 15), override = Number(s.ss_override_min_prob ?? 15);
  const maxWeek = Math.max(0, Number(s.ss_alert_max_per_week ?? 3));
  if (!(minProb > 0)) return done("meldgrens 0: uit");
  const ct = cands.map((c) => c.ticker);
  const nowMs = Date.now();
  const [mu, se, pr, wk] = await Promise.all([
    sb.from("xinix_notify_mute").select("ticker, muted_until").in("ticker", ct),
    sb.from("xinix_seen").select("ticker").in("ticker", ct),
    sb.from("xinix_ss_scores").select("ticker, alerted_at, alerted_prob").in("ticker", ct),
    sb.from("xinix_ss_predictions").select("ticker", { count: "exact", head: true }).gte("alerted_at", new Date(nowMs - 7 * DAY).toISOString()),
  ]);
  const muted = new Set(((mu.data ?? []) as Array<{ ticker: string; muted_until: string | null }>).filter((m) => !m.muted_until || Date.parse(m.muted_until) > nowMs).map((m) => m.ticker.toUpperCase()));
  const seen = new Set(((se.data ?? []) as Array<{ ticker: string }>).map((x) => x.ticker.toUpperCase()));
  const last = new Map(((pr.data ?? []) as Array<{ ticker: string; alerted_at: string | null; alerted_prob: number | null }>).map((r) => [r.ticker, r]));
  let room = maxWeek > 0 ? Math.max(0, maxWeek - (wk.count ?? 0)) : cands.length;
  const quiet = inQuietHours(s);
  const log: Array<{ ticker: string; source: string; alert_key: string; priority: number }> = [];
  const note = (ticker: string, patch: Json) => sb.from("xinix_ss_scores").update(patch).eq("ticker", ticker);

  for (const c of [...cands].sort((a, b) => b.prob - a.prob)) {
    if (c.prob < minProb) continue;
    const up = c.ticker.toUpperCase();
    // Gedempt of gezien wijkt alleen voor een kans vanaf de override-grens (zoals bij Sprinters).
    if ((muted.has(up) || seen.has(up)) && c.prob < override) { out.blocked++; await note(c.ticker, { alert_pending: false, alert_note: "gedempt of gezien" }); continue; }
    const l = last.get(c.ticker);
    if (l?.alerted_at && nowMs - Date.parse(l.alerted_at) < REALERT_DAYS * DAY && !(l.alerted_prob != null && c.prob >= Number(l.alerted_prob) + REALERT_GAIN)) {
      out.blocked++; await note(c.ticker, { alert_pending: false }); continue;
    }
    if (room <= 0) { out.capped++; await note(c.ticker, { alert_pending: false, alert_note: `weekplafond van ${maxWeek} meldingen bereikt` }); continue; }
    if (quiet) { out.pending++; await note(c.ticker, { alert_pending: true, alert_note: "wacht tot na de stille uren" }); continue; }
    // Tweede bron: klopt de koers bij Yahoo? Zo niet, dan is ook het track record niet af te rekenen.
    if (yahooLeft(ctx) <= 0) { out.held++; await note(c.ticker, { alert_pending: false, alert_note: "dagbudget Yahoo op: niet gecontroleerd, niet gemeld" }); continue; }
    try {
      meter.yahoo++;
      const b = await C.yahooBars(c.ticker, "5d");
      const q = b.close[b.close.length - 1] / c.close;
      const ok = (x: number) => Math.abs(x - 1) <= 0.03;
      if (!(ok(q) || ok(q * 100) || ok(q / 100))) throw new Error(`slot bij Yahoo ${C.fmtPrice(b.close[b.close.length - 1])}, bij TradingView ${C.fmtPrice(c.close)}`);
    } catch (e) {
      out.held++; await note(c.ticker, { alert_pending: false, alert_note: `niet gemeld: ${msg(e).slice(0, 120)}` }); continue;
    }
    const sent = await sendNtfy(s, c);
    if (!sent.ok) { meter.errors++; await note(c.ticker, { alert_note: `melding mislukt: ${sent.error?.slice(0, 100)}` }); continue; }
    out.sent++; room--; meter.alerts++;
    const at = new Date().toISOString();
    await note(c.ticker, { alerted_at: at, alerted_prob: c.prob, alert_pending: false, alert_note: null });
    // De kans en de koers van het moment van melden komen in het track record te staan.
    await sb.from("xinix_ss_predictions").update({ alerted_at: at, alerted_prob: c.prob, alert_close: c.close }).eq("ticker", c.ticker).eq("made_on", c.session_date);
    meter.rows += 2;
    log.push({ ticker: c.ticker, source: "supersprint", alert_key: "supersprint_50_10d", priority: 5 });
  }
  if (log.length) await sb.rpc("xinix_notify_record", { p_items: log });
  return done();
}

async function sendNtfy(s: Settings, c: Cand): Promise<{ ok: boolean; error?: string }> {
  const p = Math.round(c.prob);
  const pctS = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")}%`);
  const usd = c.currency && c.currency !== "USD" && c.close_usd != null ? ` (≈ $${c.close_usd < 10 ? c.close_usd.toFixed(2) : Math.round(c.close_usd)})` : "";
  const lines = [
    `${C.safeTicker(c.ticker)}${c.name ? ` · ${c.name}` : ""}`,
    `${C.REGION_NL[c.region]} · ${c.exchange ?? ""}`,
    `🚀 Kans op +50% binnen 10 handelsdagen: ${p}% (${Math.round(c.prob / c.base_rate)}× de basiskans van ${c.base_rate.toFixed(1).replace(".", ",")}%)`,
    `💲 Slot ${C.fmtPrice(c.close)} ${c.currency ?? ""}${usd} · vandaag ${pctS(c.change_1d)} · maand ${pctS(c.perf_1m)}`,
    c.dvol_usd != null ? `📊 Omzet ${C.fmtUsd(c.dvol_usd)} per dag` : "",
    "",
    "Waarom:",
    ...c.reasons.filter((r) => r.f > 1).slice(0, 3).map((r) => `• ×${String(r.f).replace(".", ",")} ${r.label}: ${r.t}`),
    c.news?.[0] ? `📰 ${c.news[0].t}` : "",
    "",
    `📲 ${C.appUrl(c.ticker)}`,
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
  const payload = {
    topic: s.ntfy_topic, title: `🚀 ${C.safeTicker(c.ticker)} · ${p}% kans op +50% in 10 handelsdagen`.slice(0, 120),
    message: lines.join("\n").slice(0, 3000), priority: 5, tags: ["rocket"], click: C.appUrl(c.ticker),
    actions: [{ action: "view", label: "Koers bekijken", url: C.googleFinanceUrl(c.ticker, c.exchange) }],
  };
  try {
    const res = await fetch(String(s.ntfy_server).replace(/\/$/, ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return { ok: false, error: `ntfy ${res.status}: ${(await res.text()).slice(0, 150)}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

/** Meldingen die in de stille uren bleven wachten alsnog versturen (zolang ze vers zijn). */
export async function flush(ctx: Ctx): Promise<RunResult> {
  const { sb } = ctx;
  const rows = (must(await sb.from("xinix_ss_scores")
    .select("ticker, name, region, exchange, currency, close, close_usd, change_1d, perf_1m, dvol_usd, prob, reasons, news, session_date, scored_at")
    .eq("alert_pending", true), "wachtende meldingen") ?? []) as Array<Json>;
  if (!rows.length) return { ok: true, message: "niets wachtend", metrics: { pending: 0 } };
  if (inQuietHours(ctx.settings)) return { ok: true, message: `${rows.length} wachten op het einde van de stille uren`, metrics: { pending: rows.length } };
  const freshRows = rows.filter((r) => ctx.nowMs - Date.parse(String(r.scored_at)) <= PENDING_MAX_H * 3600_000);
  const old = rows.filter((r) => !freshRows.includes(r)).map((r) => String(r.ticker));
  if (old.length) await sb.from("xinix_ss_scores").update({ alert_pending: false, alert_note: "verlopen: te lang gewacht" }).in("ticker", old);
  const model = await C.loadModel();
  const al = await sendAlerts(ctx, freshRows.map((r) => ({
    ticker: String(r.ticker), name: (r.name as string) ?? null, region: Number(r.region), exchange: (r.exchange as string) ?? null, currency: (r.currency as string) ?? null,
    close: Number(r.close), close_usd: r.close_usd == null ? null : Number(r.close_usd), change_1d: r.change_1d == null ? null : Number(r.change_1d),
    perf_1m: r.perf_1m == null ? null : Number(r.perf_1m), dvol_usd: r.dvol_usd == null ? null : Number(r.dvol_usd), prob: Number(r.prob),
    reasons: (r.reasons as C.Reason[]) ?? [], news: (r.news as C.NewsItem[]) ?? null, session_date: String(r.session_date), base_rate: model.base_rate_pct,
  })));
  return { ok: true, message: `wachtende meldingen (${rows.length}): ${al.text}${old.length ? `; ${old.length} verlopen` : ""}`, metrics: { pending: rows.length, sent: al.sent, expired: old.length } };
}

// ── Track record afrekenen ──────────────────────────────────────────────────
export async function resolve(ctx: Ctx): Promise<RunResult> {
  const { sb, meter } = ctx;
  const cutoff = isoMinus(ctx.today, RESOLVE_AFTER_DAYS);
  const giveUp = isoMinus(ctx.today, GIVE_UP_DAYS);
  const open = (must(await sb.from("xinix_ss_predictions").select("ticker, made_on").is("resolved_at", null).lte("made_on", cutoff).order("made_on").limit(2000), "open voorspellingen") ?? []) as Array<{ ticker: string; made_on: string }>;
  const byT = new Map<string, string[]>();
  for (const r of open) {
    if (!byT.has(r.ticker) && byT.size >= RESOLVE_TICKERS) continue;
    (byT.get(r.ticker) ?? byT.set(r.ticker, []).get(r.ticker)!).push(r.made_on);
  }
  const updates: Json[] = [];
  let failed = 0, waiting = 0;
  for (const [ticker, dates] of byT) {
    if (yahooLeft(ctx) <= 0) break;
    meter.yahoo++;
    let bars: C.YBars | null = null, err = "";
    try { bars = await C.yahooBars(ticker, "3mo"); } catch (e) { failed++; err = msg(e).slice(0, 150); }
    for (const d of dates) {
      const o = bars ? C.outcome10(bars, d) : null;
      if (o && "hit" in o) updates.push({ ticker, made_on: d, hit: o.hit, touched: o.touched, error: null });
      else if (o && "error" in o) updates.push({ ticker, made_on: d, hit: null, touched: null, error: o.error });
      // Geen koersen (meer): na anderhalve maand geven we het op, anders blijft hij eeuwig open.
      else if (d <= giveUp) updates.push({ ticker, made_on: d, hit: null, touched: null, error: err || "te weinig koersen na de voorspeldag" });
      else waiting++;
    }
    await sleep(100);
  }
  let resolved = 0;
  if (updates.length) {
    resolved = Number(must(await sb.rpc("xinix_ss_resolve", { p_rows: updates }), "afrekenen") ?? 0);
    meter.rows += resolved;
  }
  const model = await C.loadModel();
  const calib = must(await sb.rpc("xinix_ss_calib_refresh", { p_seed: model.mult_seed }), "bijsturing") as Json;
  const lifts = must(await sb.rpc("xinix_ss_news_lift_refresh"), "nieuwsmeting");
  meter.rows += 1 + Number(lifts ?? 0);
  const hits = updates.filter((u) => u.hit === true).length;
  return {
    ok: true,
    message: `track record: ${resolved} afgerekend over ${byT.size} aandelen (${hits} raak, ${failed} zonder koersen, ${waiting} wachten nog); nog ${Math.max(0, open.length - updates.length - waiting)} open; bijsturing ×${calib.mult} (${calib.hits} raak tegen ${calib.expected} verwacht, ${calib.n} voorspellingen)`,
    metrics: { resolved, hits, tickers: byT.size, failed, waiting, mult: calib.mult, yahoo: meter.yahoo },
  };
}

// ── Lezen (tabblad) ─────────────────────────────────────────────────────────
export async function read(sb: SB): Promise<Json> {
  const today = new Date().toISOString().slice(0, 10);
  const [sc, tr, se, st, sta, bu, br, li] = await Promise.all([
    sb.from("xinix_ss_scores").select("ticker, market, region, exchange, name, currency, sector, close, close_usd, change_1d, perf_1m, vol_m, rel_vol, dvol_usd, mcap_usd, float_shares, prob, prob_base, rank, reasons, news, news_at, session_date, scored_at, first_seen, alerted_at, alerted_prob, alert_pending, alert_note")
      .gte("session_date", isoMinus(today, 6)).order("prob", { ascending: false }).limit(600),
    sb.rpc("xinix_ss_track_record"),
    sb.rpc("xinix_sprint_track_record"),
    sb.from("signal_settings").select("ss_enabled, ss_alerts, ss_alert_min_prob, ss_alert_max_per_week, ss_override_min_prob, sprint_alert_min_prob, quiet_hours_start, quiet_hours_end").eq("id", 1).maybeSingle(),
    sb.from("xinix_ss_state").select("key, value, updated_at"),
    sb.from("xinix_ss_budget").select("*").gte("day", isoMinus(today, 7)).order("day", { ascending: false }),
    sb.from("xinix_ss_breadth").select("region, day, n, b1_20, b1_10, bm_50").gte("day", isoMinus(today, 7)).gt("n", 0).order("day", { ascending: false }),
    sb.from("xinix_ss_news_lift").select("*").order("n", { ascending: false }),
  ]);
  const rows = (sc.data ?? []) as Array<Json>;
  // Alleen de laatste sessie per markt is actueel: oudere rijen zijn aandelen die uit de kopgroep vielen.
  const latest = new Map<string, string>();
  for (const r of rows) { const m = String(r.market), d = String(r.session_date); if (!latest.has(m) || d > latest.get(m)!) latest.set(m, d); }
  const items = rows.filter((r) => latest.get(String(r.market)) === String(r.session_date));
  const state: Json = {};
  for (const r of (sta.data ?? []) as Array<{ key: string; value: Json; updated_at: string }>) state[r.key] = { ...r.value, updated_at: r.updated_at };
  return {
    items, track_record: tr.error ? null : tr.data, sprint_track_record: se.error ? null : se.data,
    settings: st.data ?? null, state, budget: { limits: BUDGET, days: bu.data ?? [] }, breadth: br.data ?? [], news_lift: li.data ?? [],
    model: { url: C.MODEL_URL, sha256: C.MODEL_SHA256 }, top_n: TOP_N,
    computed_at: items.reduce((m: string | null, r) => (!m || String(r.scored_at) > m ? String(r.scored_at) : m), null),
    error: sc.error?.message ?? null,
  };
}

// ── Hartje: op de watchlist, maar niet in het Potje en de papieren portefeuille ──
export async function adopt(sb: SB, tickerRaw: unknown): Promise<{ status: number; body: Json }> {
  const ticker = typeof tickerRaw === "string" ? tickerRaw.trim().toUpperCase() : "";
  if (!ticker) return { status: 400, body: { error: "ticker ontbreekt" } };
  const [{ data: row }, { data: existing }] = await Promise.all([
    sb.from("xinix_ss_scores").select("name, exchange, sector, mcap_usd").eq("ticker", ticker).maybeSingle(),
    sb.from("signal_tickers").select("ticker, active").eq("ticker", ticker).maybeSingle(),
  ]);
  if (existing) {
    // Stond hij al actief op de watchlist, dan blijft alles zoals het was.
    if (existing.active !== true) {
      const { error } = await sb.from("signal_tickers").update({ active: true, no_sim: true }).eq("ticker", ticker);
      if (error) return { status: 500, body: { error: error.message } };
    }
    return { status: 200, body: { ok: true, ticker, added: false, reactivated: existing.active !== true } };
  }
  if (!row) return { status: 404, body: { error: "onbekend in SUPERsprinters" } };
  const { error } = await sb.from("signal_tickers").insert({
    ticker, company: String(row.name ?? ticker), exchange: C.watchlistExchange(String(row.exchange ?? ""), ticker),
    sector: C.watchlistSector((row.sector as string) ?? null, (row.name as string) ?? null), active: true, no_sim: true,
    market_cap_usd: row.mcap_usd ?? null,
    notes: `Toegevoegd via SUPERsprinters (${new Date().toISOString().slice(0, 10)}); doet niet mee in het Potje en de papieren portefeuille.`,
  });
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true, ticker, added: true } };
}

/** Schakelaars vanuit het tabblad (beheertoken). Meldingen aan zet die van Sprinters uit, en omgekeerd. */
export async function saveSettings(sb: SB, body: Json): Promise<{ status: number; body: Json }> {
  const patch: Json = {};
  if (typeof body.ss_enabled === "boolean") patch.ss_enabled = body.ss_enabled;
  if (typeof body.ss_alerts === "boolean") {
    patch.ss_alerts = body.ss_alerts;
    patch.sprint_alert_min_prob = body.ss_alerts ? 0 : 15;      // alleen één van de twee meldt
  }
  const numIn = (k: string, lo: number, hi: number) => {
    const v = Number(body[k]);
    if (body[k] != null && Number.isFinite(v) && v >= lo && v <= hi) patch[k] = v;
  };
  numIn("ss_alert_min_prob", 0, 90); numIn("ss_alert_max_per_week", 0, 50); numIn("ss_override_min_prob", 0, 90);
  if (!Object.keys(patch).length) return { status: 400, body: { error: "niets te wijzigen" } };
  const { error } = await sb.from("signal_settings").update(patch).eq("id", 1);
  if (error) return { status: 500, body: { error: error.message } };
  return { status: 200, body: { ok: true, ...patch } };
}
