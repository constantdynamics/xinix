// xinix-sprint — Sprinters: aandelen met ≥4★ (jouw rating) die binnen 10
// handelsdagen ≥ +50% kunnen doen, met een directe melding.
//
//   GET  /xinix-sprint              ranglijst + nieuws-lift + track record (publiek)
//   POST /xinix-sprint?mode=run     elke 2 uur op werkdagen: verse koersen, scoren, melden
//   POST /xinix-sprint?mode=news    nieuwsberichten afrekenen (volgde er +50%?)
//
// Kans = het h14-model van de explosie-motor (10 handelsdagen, +50% en de dag
// erna nog ≥ +20%; gekalibreerd op 10 jaar dagkoersen van ~6000 aandelen) op
// koersen van nu, maal de gemeten lift van recent nieuws. Een nieuwsgroep telt
// alleen mee als hij de kans aantoonbaar ≥ 1,5× verhoogt of ≤ 1/1,5× verlaagt
// (xinix_sprint_news_lift); de lift wordt gemeten over álle berichten, maar
// toegepast op alleen de ≥4★-aandelen.
import * as E from "../_shared/engine.ts";
import {
  getServiceClient, runBackground, chunkedIn, fetchAll, num, r1, loadPool, MIN_POOL_TICKERS, tvQuotes, tvRegime,
  type Json, type RunResult, type TvRow,
} from "../_shared/universe.ts";

const H14 = E.EV.h14, H7 = E.EV.h7, H21 = E.EV.h21;
const NEWS_FRESH_DAYS = 7;            // nieuws telt mee tot een week na het bericht
const NEWS_MULT_MIN = 1 / 3, NEWS_MULT_MAX = 3;
const RESOLVE_AFTER_DAYS = 16;        // 10 handelsdagen + de controle-dag, met marge
const NEWS_TICKERS_PER_RUN = 40;
const PRED_TICKERS_PER_RUN = 20;
const REALERT_DAYS = 10, REALERT_GAIN = 5;
const TRADE_MIN_DVOL = 10_000;
const DAY = E.DAY, WEEK_MS = 7 * DAY;

const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey, x-cron-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const run = (req: Request) => {
  const mode = new URL(req.url).searchParams.get("mode");
  return runBackground(mode === "news" ? "xinix-sprint-news" : "xinix-sprint", () => (mode === "news" ? newsRun(NEWS_TICKERS_PER_RUN) : sprintRun()))(req);
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method === "GET") return read(req);
  return run(req);
});

// ── Lezen ───────────────────────────────────────────────────────────────────
async function read(req: Request): Promise<Response> {
  try {
    const sb = getServiceClient();
    const [scores, lifts, track, settings, model] = await Promise.all([
      sb.from("xinix_sprint_scores").select("*").order("prob", { ascending: false, nullsFirst: false }),
      sb.from("xinix_sprint_news_lift").select("*").order("lift", { ascending: false }),
      sb.rpc("xinix_sprint_track_record"),
      sb.from("signal_settings").select("sprint_min_rating, sprint_alert_min_prob, sprint_alert_max_per_week, sprint_override_min_prob").eq("id", 1).maybeSingle(),
      sb.from("xinix_event_models").select("base_rate, ceiling, calib, computed_at, tickers, days_n").eq("event", "h14").maybeSingle(),
    ]);
    const items = scores.data ?? [];
    const computed = items.reduce((m: string | null, r: Json) => (!m || String(r.scored_at) > m ? String(r.scored_at) : m), null);
    return new Response(JSON.stringify({
      items, news_lift: lifts.data ?? [], track_record: track.error ? null : track.data,
      settings: settings.data ?? null, model: model.data ?? null, computed_at: computed,
    }), { headers: { ...cors(req), "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
  }
}

// ── Uitkomst na 10 handelsdagen (zelfde eis als de motor) ──────────────────
function outcome10(b: E.Bars, dateIso: string): { hit: boolean; touched: boolean } | null {
  const madeMs = Date.parse(dateIso + "T23:59:59Z");
  let t = -1;
  for (let i = 0; i < b.n; i++) { if (b.ms[i] <= madeMs) t = i; else break; }
  if (t < 0 || t + 11 > b.n - 1) return null;
  const v = b.close[t];
  let touched = false;
  for (let j = t + 1; j <= t + 10; j++) {
    if (b.close[j] < v * 1.5) continue;
    touched = true;
    if (b.close[j + 1] >= v * 1.2) return { hit: true, touched };
  }
  return { hit: false, touched };
}

// ── Nieuws afrekenen ────────────────────────────────────────────────────────
async function newsRun(maxTickers: number): Promise<RunResult> {
  const sb = getServiceClient();
  const errors: string[] = [];
  const { data: synced, error: syncErr } = await sb.rpc("xinix_sprint_news_sync");
  if (syncErr) errors.push(`sync: ${syncErr.message}`);
  const cutoff = new Date(Date.now() - RESOLVE_AFTER_DAYS * DAY).toISOString().slice(0, 10);
  const { data: open, error } = await sb.from("xinix_sprint_news").select("event_id, ticker, event_date")
    .is("resolved_at", null).lte("event_date", cutoff).order("event_date").limit(2000);
  if (error) throw new Error(`nieuws: ${error.message}`);
  const byTicker = new Map<string, Array<{ event_id: number; event_date: string }>>();
  for (const r of (open ?? []) as Array<{ event_id: number; ticker: string; event_date: string }>) {
    if (!byTicker.has(r.ticker) && byTicker.size >= maxTickers) continue;
    (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);
  }
  const updates: Json[] = [];
  let resolved = 0, failed = 0;
  const nowIso = new Date().toISOString();
  for (const [ticker, evs] of byTicker) {
    let bars: E.Bars;
    try { bars = (await E.fetchYahoo10y(ticker, "1y")).clean; }
    catch (e) {
      failed++;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
      for (const ev of evs) updates.push({ event_id: ev.event_id, resolved_at: nowIso, hit: null, error: msg });
      continue;
    }
    for (const ev of evs) {
      const o = outcome10(bars, ev.event_date);
      // Koersen lopen nog niet ver genoeg door (dun verhandeld of geschorst):
      // na 60 dagen geven we het op, anders blijft hij eeuwig open.
      if (!o) {
        if (Date.parse(ev.event_date) < Date.now() - 60 * DAY) updates.push({ event_id: ev.event_id, resolved_at: nowIso, hit: null, error: "te weinig koersen na het bericht" });
        continue;
      }
      updates.push({ event_id: ev.event_id, resolved_at: nowIso, hit: o.hit, error: null });
      resolved++;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  for (const u of updates) {
    const { error: e } = await sb.from("xinix_sprint_news").update({ resolved_at: u.resolved_at, hit: u.hit, error: u.error }).eq("event_id", u.event_id as number);
    if (e) { errors.push(`update: ${e.message}`); break; }
  }
  const { data: model } = await sb.from("xinix_event_models").select("base_rate").eq("event", "h14").maybeSingle();
  const base = (num(model?.base_rate) ?? 2.5) / 100;
  const { error: liftErr } = await sb.rpc("xinix_sprint_news_lift_refresh", { p_base: base });
  if (liftErr) errors.push(`lift: ${liftErr.message}`);
  const { count: left } = await sb.from("xinix_sprint_news").select("event_id", { count: "exact", head: true }).is("resolved_at", null).lte("event_date", cutoff);
  return {
    ok: errors.length === 0,
    message: `nieuws: ${synced ?? 0} nieuw gesynchroniseerd; ${resolved} afgerekend over ${byTicker.size} aandelen (${failed} zonder koersen); nog ${left ?? "?"} open` + (errors.length ? `; fouten: ${errors.join("; ")}` : ""),
    metrics: { synced, resolved, tickers: byTicker.size, failed, left },
  };
}

// ── Scoren + melden ─────────────────────────────────────────────────────────
interface Settings {
  ntfy_topic: string | null; ntfy_server: string; quiet_hours_start: number | null; quiet_hours_end: number | null;
  sprint_min_rating: number | null; sprint_alert_min_prob: number | null; sprint_alert_max_per_week: number | null; sprint_override_min_prob: number | null;
}

async function sprintRun(): Promise<RunResult> {
  const sb = getServiceClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = nowIso.slice(0, 10);
  const errors: string[] = [];

  const { data: st } = await sb.from("signal_settings")
    .select("ntfy_topic, ntfy_server, quiet_hours_start, quiet_hours_end, sprint_min_rating, sprint_alert_min_prob, sprint_alert_max_per_week, sprint_override_min_prob")
    .eq("id", 1).single();
  const settings = st as Settings | null;
  const minRating = num(settings?.sprint_min_rating) ?? 4;

  // ── Wie doet mee ────────────────────────────────────────────────────────
  const favs = await fetchAll<{ ticker: string; rating: number | null }>(sb, "xinix_favorites", "ticker, rating", (q) => q.gte("rating", minRating));
  const tickers = favs.map((f) => f.ticker);
  const ratingBy = new Map(favs.map((f) => [f.ticker, f.rating]));
  if (!tickers.length) return { ok: true, message: `geen favorieten met ≥${minRating}★`, metrics: { scored: 0 } };
  const [tick, uni, ps, prevScores] = await Promise.all([
    chunkedIn<Json>(sb, "signal_tickers", "ticker, company, exchange, sector, active", tickers),
    chunkedIn<Json>(sb, "xinix_universe",
      "ticker, tv_symbol, market, currency, mcap_usd, deep_ok, own_n, own_h, last_peak_date, spike_dates, last_poefie_date, phoenix_peak, phoenix_run, hi5y, lo5y, volat22, close, change_1d, perf_w, perf_1m, perf_6m, volume, avg_vol_30d, hi52, lo52, hi3m, lo3m, volat_m",
      tickers),
    chunkedIn<Json>(sb, "signal_price_summary",
      "ticker, last_close, last_volume, avg_volume_30d, pct_change_1d, pct_change_5d, pct_change_22d, pct_change_6mo, high_1y, low_1y, high_90d, low_90d, high_5y, low_5y", tickers),
    chunkedIn<Json>(sb, "xinix_sprint_scores", "ticker, alerted_at, alerted_prob", tickers),
  ]);
  const tickBy = new Map(tick.map((r) => [r.ticker as string, r]));
  const uniBy = new Map(uni.map((r) => [r.ticker as string, r]));
  const psBy = new Map(ps.map((r) => [r.ticker as string, r]));
  const prevBy = new Map(prevScores.map((r) => [r.ticker as string, r]));

  // ── Verse koersen: TradingView per markt, anders de laatste poll ─────────
  const byRegion = new Map<string, string[]>();
  for (const u of uni) if (u.tv_symbol && u.market) (byRegion.get(u.market as string) ?? byRegion.set(u.market as string, []).get(u.market as string)!).push(u.tv_symbol as string);
  const quotes = new Map<string, TvRow>();
  for (const [region, syms] of byRegion) {
    try { for (const [s, row] of await tvQuotes(region, syms)) quotes.set(s, row); }
    catch (e) { errors.push(`TV ${region}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  let regime = { iwm200: null as number | null, iwm22: null as number | null };
  try { regime = await tvRegime(); } catch (e) { errors.push(`IWM: ${e instanceof Error ? e.message : String(e)}`); }

  const pool = await loadPool(sb);
  const models = pool && pool.tickers >= MIN_POOL_TICKERS ? E.buildModels(pool.counts) : null;
  if (!models || !models[H14]) throw new Error("nog geen h14-model (pool te klein)");
  const m14 = models[H14]!;

  // ── Nieuws: gemeten lift per groep + recente berichten van deze aandelen ─
  const [{ data: lifts }, recent] = await Promise.all([
    sb.from("xinix_sprint_news_lift").select("grp, label, lift, used, n, hits"),
    chunkedIn<Json>(sb, "xinix_sprint_news", "event_id, ticker, grp, signal_type, event_date", tickers)
      .then((r) => r.filter((x) => Date.parse(String(x.event_date)) >= nowMs - 30 * DAY)),
  ]);
  const liftBy = new Map(((lifts ?? []) as Json[]).map((l) => [l.grp as string, l]));
  const evIds = recent.map((r) => r.event_id as number);
  const titles = new Map<number, Json>();
  for (let i = 0; i < evIds.length; i += 200) {
    const { data } = await sb.from("signal_events").select("id, title, detected_at").in("id", evIds.slice(i, i + 200));
    for (const r of (data ?? []) as Json[]) titles.set(r.id as number, r);
  }
  const newsBy = new Map<string, Json[]>();
  for (const r of recent) (newsBy.get(r.ticker as string) ?? newsBy.set(r.ticker as string, []).get(r.ticker as string)!).push(r);

  // ── Scoren ──────────────────────────────────────────────────────────────
  const rows: Json[] = [];
  for (const ticker of tickers) {
    const u = uniBy.get(ticker), p = psBy.get(ticker), t = tickBy.get(ticker);
    const q = u?.tv_symbol ? quotes.get(u.tv_symbol as string) ?? null : null;
    const fx = E.fxUsd((q?.currency ?? (u?.currency as string)) ?? null);
    const close = q?.close ?? num(u?.close) ?? num(p?.last_close);
    const avgVol = q?.avg_vol_30d ?? num(u?.avg_vol_30d) ?? num(p?.avg_volume_30d);
    const src = q ? "tradingview" : u?.close != null ? "sweep" : "poll";
    const pick = (a: number | null | undefined, b: unknown, c: unknown) => a ?? num(b) ?? num(c);
    const live: E.Live = {
      close, fx,
      r1: pick(q?.change_1d, u?.change_1d, p?.pct_change_1d),
      r5: pick(q?.perf_w, u?.perf_w, p?.pct_change_5d),
      r22: pick(q?.perf_1m, u?.perf_1m, p?.pct_change_22d),
      r6mo: pick(q?.perf_6m, u?.perf_6m, p?.pct_change_6mo),
      vol: q ? (q.volume != null && q.avg_vol_30d ? q.volume / q.avg_vol_30d : null)
        : (num(p?.last_volume) != null && num(p?.avg_volume_30d) ? num(p?.last_volume)! / num(p?.avg_volume_30d)! : null),
      hi52: pick(q?.hi52, u?.hi52, p?.high_1y), lo52: pick(q?.lo52, u?.lo52, p?.low_1y),
      hi5y: num(u?.hi5y) ?? num(p?.high_5y), lo5y: num(u?.lo5y) ?? num(p?.low_5y),
      hi90: pick(q?.hi3m, u?.hi3m, p?.high_90d), lo90: pick(q?.lo3m, u?.lo3m, p?.low_90d),
      volat: q?.volat_m ?? num(u?.volat_m) ?? num(u?.volat22), avgVol30: avgVol, mcapUsd: q?.mcap_usd ?? num(u?.mcap_usd),
      lastPeakDate: (u?.last_peak_date as string) ?? null, spikeDates1y: (u?.spike_dates as string[]) ?? null,
      lastPoefieDate: (u?.last_poefie_date as string) ?? null,
      phoenixPeak: num(u?.phoenix_peak), phoenixRun: u?.phoenix_run === true,
      iwm200: regime.iwm200, iwm22: regime.iwm22,
    };
    const measured = u?.deep_ok === true && Array.isArray(u.own_n) && close != null;
    const base: Json = {
      ticker, rating: ratingBy.get(ticker) ?? null, company: (t?.company as string) ?? null, exchange: (t?.exchange as string) ?? null,
      sector: (t?.sector as string) ?? null, close, change_1d: live.r1, perf_w: live.r5, price_source: src,
      base_rate: Math.round(m14.p0 * 10000) / 100, scored_at: nowIso,
    };
    if (!measured) {
      rows.push({ ...base, measured: false, prob: null, prob_model: null, prob_7d: null, prob_21d: null, news_mult: null, news: null, factors: null });
      continue;
    }
    const lv = E.liveSlots(live, nowMs);
    const ownN = u!.own_n as number[], ownH = u!.own_h as number[];
    const s14 = E.scoreEvent(m14, lv.slots, ownN[0] ?? 0, ownH[H14] ?? 0);
    const s7 = models[H7] ? E.scoreEvent(models[H7]!, lv.slots, ownN[0] ?? 0, ownH[H7] ?? 0) : null;
    const s21 = models[H21] ? E.scoreEvent(models[H21]!, lv.slots, ownN[0] ?? 0, ownH[H21] ?? 0) : null;

    // Nieuws: per groep hoogstens één keer, alleen gemeten en vers.
    const news: Json[] = [];
    let newsMult = 1;
    const seenGrp = new Set<string>();
    for (const n of (newsBy.get(ticker) ?? []).sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))) {
      const grp = n.grp as string;
      const l = liftBy.get(grp);
      const fresh = Date.parse(String(n.event_date)) >= nowMs - NEWS_FRESH_DAYS * DAY;
      const counts = fresh && l?.used === true && !seenGrp.has(grp);
      if (counts) { newsMult *= Number(l!.lift); seenGrp.add(grp); }
      const ti = titles.get(n.event_id as number);
      if (news.length < 8) news.push({
        date: n.event_date, grp, label: (l?.label as string) ?? grp, title: (ti?.title as string) ?? n.signal_type,
        lift: l ? num(l.lift) : null, measured_n: l ? num(l.n) : null, counts,
      });
    }
    newsMult = Math.min(NEWS_MULT_MAX, Math.max(NEWS_MULT_MIN, newsMult));
    const pm = s14.prob / 100;
    const odds = (pm / (1 - pm)) * newsMult;
    const prob = Math.min(90, (odds / (1 + odds)) * 100);

    // De sterkste kenmerken van dit moment (lift van de bucket waar hij nu in zit).
    const factors: Json[] = [];
    for (let f = 0; f < E.NF; f++) {
      if (!m14.selected[f]) continue;
      const sl = lv.slots[f];
      const lift = m14.lift[f * E.SLOTS + sl];
      if (lift >= 1.3) factors.push({ label: E.FEATURES[f].label, bucket: E.slotLabel(f, sl), mult: Math.round(lift * 100) / 100 });
    }
    if (s14.own >= 1.3) factors.push({ label: "Eigen historie", bucket: `${r1(s14.ownRate * 100)}% van de dagen in 10 jaar`, mult: Math.round(s14.own * 100) / 100 });
    factors.sort((a, b) => Number(b.mult) - Number(a.mult));

    const dvol = close != null && avgVol != null ? close * avgVol * fx : 0;
    rows.push({
      ...base, measured: true,
      prob: r1(prob), prob_model: r1(s14.prob), prob_7d: s7 ? r1(s7.prob) : null, prob_21d: s21 ? r1(s21.prob) : null,
      news_mult: Math.round(newsMult * 100) / 100, news, factors: factors.slice(0, 6),
      _tradeable: dvol >= TRADE_MIN_DVOL,
    });
  }

  // ── Wegschrijven ────────────────────────────────────────────────────────
  const clean = rows.map(({ _tradeable, ...r }) => r);
  const { error: upErr } = await sb.from("xinix_sprint_scores").upsert(clean, { onConflict: "ticker" });
  if (upErr) errors.push(`scores: ${upErr.message}`);
  // Niet meer ≥4★: van de lijst.
  const { data: all } = await sb.from("xinix_sprint_scores").select("ticker");
  const gone = ((all ?? []) as Json[]).map((r) => r.ticker as string).filter((t) => !ratingBy.has(t));
  if (gone.length) await sb.from("xinix_sprint_scores").delete().in("ticker", gone);

  const preds = rows.filter((r) => r.prob != null && r.close != null).map((r) => ({
    ticker: r.ticker, made_on: today, prob: r.prob, prob_model: r.prob_model, news_mult: r.news_mult, entry_close: r.close,
  }));
  if (preds.length) {
    const { error } = await sb.from("xinix_sprint_predictions").upsert(preds, { onConflict: "ticker,made_on", ignoreDuplicates: true });
    if (error) errors.push(`track record: ${error.message}`);
  }

  // ── Track record afrekenen ─────────────────────────────────────────────
  let resolvedPreds = 0;
  {
    const cutoff = new Date(nowMs - RESOLVE_AFTER_DAYS * DAY).toISOString().slice(0, 10);
    const { data: open } = await sb.from("xinix_sprint_predictions").select("ticker, made_on").is("resolved_at", null).lte("made_on", cutoff).order("made_on").limit(500);
    const byT = new Map<string, string[]>();
    for (const r of (open ?? []) as Array<{ ticker: string; made_on: string }>) {
      if (!byT.has(r.ticker) && byT.size >= PRED_TICKERS_PER_RUN) continue;
      (byT.get(r.ticker) ?? byT.set(r.ticker, []).get(r.ticker)!).push(r.made_on);
    }
    for (const [ticker, dates] of byT) {
      let bars: E.Bars | null = null;
      try { bars = (await E.fetchYahoo10y(ticker, "6mo")).clean; } catch { /* volgende run opnieuw */ }
      if (!bars) continue;
      for (const d of dates) {
        const o = outcome10(bars, d);
        if (!o) continue;
        const { error } = await sb.from("xinix_sprint_predictions").update({ hit: o.hit, touched: o.touched, resolved_at: nowIso }).eq("ticker", ticker).eq("made_on", d);
        if (!error) resolvedPreds++;
      }
    }
  }

  // ── Melden ──────────────────────────────────────────────────────────────
  let sent = 0, candidates = 0, blocked = 0, capped = 0;
  const threshold = num(settings?.sprint_alert_min_prob) ?? 15;
  const override = num(settings?.sprint_override_min_prob) ?? 15;
  const maxPerWeek = Math.max(0, num(settings?.sprint_alert_max_per_week) ?? 3);
  if (settings?.ntfy_topic && threshold > 0 && !inQuietHours(settings)) {
    const cands = rows.filter((r) => r.prob != null && Number(r.prob) >= threshold && r._tradeable);
    candidates = cands.length;
    if (cands.length) {
      const ct = cands.map((c) => c.ticker as string);
      const [mutes, seen] = await Promise.all([
        chunkedIn<{ ticker: string; muted_until: string | null }>(sb, "xinix_notify_mute", "ticker, muted_until", ct),
        chunkedIn<{ ticker: string }>(sb, "xinix_seen", "ticker", ct),
      ]);
      const muted = new Set(mutes.filter((m) => !m.muted_until || Date.parse(m.muted_until) > nowMs).map((m) => m.ticker.toUpperCase()));
      const seenSet = new Set(seen.map((s) => s.ticker.toUpperCase()));
      const toSend: Json[] = [];
      for (const c of cands) {
        const up = String(c.ticker).toUpperCase();
        const prob = Number(c.prob);
        // Demping en "gezien" wijken alleen voor een zeer hoge kans.
        if ((muted.has(up) || seenSet.has(up)) && prob < override) { blocked++; continue; }
        const prev = prevBy.get(c.ticker as string);
        const lastMs = prev?.alerted_at ? Date.parse(prev.alerted_at as string) : null;
        const lastProb = num(prev?.alerted_prob);
        if (lastMs != null && nowMs - lastMs < REALERT_DAYS * DAY && !(lastProb != null && prob >= lastProb + REALERT_GAIN)) { blocked++; continue; }
        toSend.push(c);
      }
      toSend.sort((a, b) => Number(b.prob) - Number(a.prob));
      let room = toSend.length;
      if (maxPerWeek > 0) {
        const { count } = await sb.from("xinix_notify_log").select("id", { count: "exact", head: true })
          .eq("source", "sprint").gte("sent_at", new Date(nowMs - WEEK_MS).toISOString());
        room = Math.max(0, maxPerWeek - (count ?? 0));
        capped = Math.max(0, toSend.length - room);
      }
      const log: Array<{ ticker: string; source: string; alert_key: string; priority: number }> = [];
      for (const c of toSend.slice(0, room)) {
        const ticker = c.ticker as string;
        const prob = Number(c.prob);
        const base = Number(c.base_rate);
        const factors = ((c.factors as Json[]) ?? []).slice(0, 3);
        const news = ((c.news as Json[]) ?? []).filter((n) => n.counts);
        const title = `🚀 ${safeTicker(ticker)} · ${Math.round(prob)}% kans op +50% in 10 handelsdagen`.slice(0, 120);
        const lines = [
          `${safeTicker(ticker)}${c.company ? ` · ${c.company}` : ""} · ${"★".repeat(Number(c.rating ?? 0))}`,
          `🚀 Kans op +50% binnen 10 handelsdagen: ${Math.round(prob)}% (${(prob / base).toFixed(1)}× de basiskans van ${base}%)`,
          c.news_mult != null && Number(c.news_mult) !== 1 ? `📰 Waarvan nieuws ×${c.news_mult} (model zonder nieuws ${Math.round(Number(c.prob_model))}%)` : "",
          `📆 7 dagen ${c.prob_7d ?? "—"}% · 21 dagen ${c.prob_21d ?? "—"}%`,
          `💲 Koers ${fmtPrice(num(c.close))} · 1d ${fmtPct(num(c.change_1d))} · 5d ${fmtPct(num(c.perf_w))}`,
          `🔗 ${googleFinanceUrl(ticker, c.exchange as string)}`,
          `📲 ${favAppUrl(ticker)}`,
          "",
          "Waarom:",
          ...factors.map((f) => `• ×${f.mult} ${f.label}: ${f.bucket}`),
          ...news.map((n) => `• 📰 ×${n.lift} ${n.label}: ${String(n.title).slice(0, 90)}`),
        ].filter((l) => l !== "");
        const r = await sendNtfy(settings.ntfy_server, settings.ntfy_topic, title, lines.join("\n"), 5, ["rocket"], googleFinanceUrl(ticker, c.exchange as string));
        if (!r.ok) { errors.push(`${ticker}: ${r.error}`); continue; }
        sent++;
        log.push({ ticker, source: "sprint", alert_key: "sprint_50_10d", priority: 5 });
        await sb.from("xinix_sprint_scores").update({ alerted_at: new Date().toISOString(), alerted_prob: prob }).eq("ticker", ticker);
        await sb.from("xinix_sprint_predictions").update({ alerted: true }).eq("ticker", ticker).eq("made_on", today);
      }
      if (log.length) {
        const { error } = await sb.rpc("xinix_notify_record", { p_items: log });
        if (error) errors.push(`notify-log: ${error.message}`);
      }
    }
  }

  // Nieuws dat ondertussen binnenkwam meteen meenemen (klein beetje per run).
  let newsMsg = "";
  try { newsMsg = (await newsRun(10)).message ?? ""; } catch (e) { errors.push(`nieuws: ${e instanceof Error ? e.message : String(e)}`); }

  const scoredRows = rows.filter((r) => r.prob != null);
  const top = [...scoredRows].sort((a, b) => Number(b.prob) - Number(a.prob)).slice(0, 5).map((r) => `${r.ticker} ${r.prob}%`).join(", ");
  return {
    ok: errors.length === 0,
    message: `sprinters: ${scoredRows.length}/${rows.length} gescoord (${quotes.size} verse koersen); top ${top || "—"}; kandidaten ${candidates}, gemeld ${sent}, tegengehouden ${blocked}, weekplafond ${capped}; track record ${resolvedPreds} afgerekend; ${newsMsg}` +
      (errors.length ? `; fouten: ${errors.slice(0, 4).join("; ")}` : ""),
    metrics: { scored: scoredRows.length, total: rows.length, quotes: quotes.size, candidates, sent, blocked, capped, resolved: resolvedPreds },
  };
}

// ── ntfy + links (zelfde aanpak als xinix-hippo-background) ─────────────────
function inQuietHours(s: Settings): boolean {
  if (s.quiet_hours_start == null || s.quiet_hours_end == null) return false;
  const h = new Date().getUTCHours(), a = s.quiet_hours_start, b = s.quiet_hours_end;
  if (a === b) return false;
  return a < b ? h >= a && h < b : h >= a || h < b;
}
async function sendNtfy(server: string, topic: string, title: string, body: string, priority: number, tags: string[], clickUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  const payload: Record<string, unknown> = { topic, title, message: body, priority, tags };
  if (clickUrl) payload.click = clickUrl;
  const res = await fetch(server.replace(/\/$/, ""), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) return { ok: false, error: `ntfy ${res.status}: ${await res.text()}` };
  return { ok: true };
}
function safeTicker(t: string): string { return t.replace(/\./g, "​."); }
function fmtPrice(v: number | null): string { if (v == null) return "—"; return v < 1 ? v.toFixed(4) : v < 10 ? v.toFixed(3) : v.toFixed(2); }
function fmtPct(v: number | null): string { if (v == null) return "—"; return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`; }
const SUFFIX_TO_EXCHANGE: Record<string, string> = { TO: "TSE", V: "CVE", CN: "CNSX", NE: "NEO", L: "LON", DE: "ETR", F: "FRA", SW: "SWX", PA: "EPA", AS: "AMS", BR: "EBR", MI: "BIT", MC: "BME", ST: "STO", OL: "OSL", CO: "CPH", HE: "HEL", HK: "HKG", T: "TYO", AX: "ASX", NZ: "NZE", TA: "TLV", JO: "JSE", SA: "BVMF", MX: "BMV" };
function googleExchangeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (e.includes("nasdaq") || e === "nms" || e === "ngm" || e === "ncm") return "NASDAQ";
  if (e.includes("arca") || e === "pcx") return "NYSEARCA";
  if (e.includes("amex") || e === "ase" || e.includes("nyse mkt") || e.includes("nyse american")) return "NYSEAMERICAN";
  if (e === "nyse" || e === "nyq" || e === "new york stock exchange") return "NYSE";
  if (e.includes("otc") || e.includes("pink") || e === "pnk") return "OTCMKTS";
  return null;
}
function googleFinanceUrl(ticker: string, exchange?: string | null): string {
  const t = ticker.trim().toUpperCase();
  const dot = t.indexOf(".");
  if (dot === -1) return `https://www.google.com/finance/quote/${encodeURIComponent(t)}:${googleExchangeCode(exchange) ?? "NASDAQ"}`;
  const exch = SUFFIX_TO_EXCHANGE[t.slice(dot + 1)];
  return exch ? `https://www.google.com/finance/quote/${encodeURIComponent(t.slice(0, dot))}:${exch}` : `https://www.google.com/finance/quote/${encodeURIComponent(t)}`;
}
function favAppUrl(ticker: string): string { return `https://constantdynamics.github.io/xinix/?review=${encodeURIComponent(ticker.trim().toUpperCase())}`; }
