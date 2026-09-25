// xinix-engine/universe — dagelijks na de Amerikaanse slotbel (22:40–22:52 UTC,
// in vijf delen per marktgroep plus een afronding; zie PARTS).
//
// 1. Sweep: TradingView levert in ~25 verzoeken de actuele toestand van alle
//    ~22k primaire gewone aandelen op de beurzen die Saxo aanbiedt. Dat is de
//    goedkope, verse bron voor de live kenmerken (ook voor de watchlist: daar
//    ververst poll-prices niet-favorieten maar eens per week).
// 2. Scoren: elk aandeel dat de deep-scan al gemeten heeft krijgt per event
//    een gekalibreerde kans (hippo 7/14/21, spike 30/90, poefie 30/90, raket).
// 3. Criteria: per onderdeel de vaste definitie toetsen (hikkertje, poefie,
//    feniks, 5-sterren-fit ≥ 80, hippo, raket) → xinix_universe.hits.
//    Treffers buiten de watchlist gaan er automatisch in (dagplafond).
// 4. Track record: per event de kopgroep en favorieten met een verhoogde kans
//    vastleggen; de deep-scan rekent ze af als de horizon voorbij is.
// 5. Wachtrij: waar TradingView een sprong ziet, wordt de deep-scan naar voren
//    gehaald (een spike telt pas na 3 dagen standhouden, dus 4 dagen later).

import * as E from "../_shared/engine.ts";
import {
  getServiceClient, fetchAll, chunkedIn, num, r1, MARKETS, tvMarket, tvRegime, tierOf, loadPool,
  writeModels, MIN_POOL_TICKERS, addSettings, addedToday, addToWatchlist, type AddCandidate, type Json, type RunResult, type TvRow,
} from "../_shared/universe.ts";

const TOP_TRACK = 25;              // per event dagelijks vastgelegd in het track record
const FAV_TRACK_MULT = 2;          // favorieten vanaf 2× de basiskans ook
const HIT_MULT = { h21: 3, rk: 2.5, p90: 2.5 };   // "treffer" = zoveel keer de basiskans
const REQUEUE_DAYS = 4;
const SPIKE_JUMP = E.SPIKE_GAIN * 100 - 5;   // ≥ +50% op een dag: mogelijk een hikkertje-spike
const TRADE_MIN_PRICE = 0.05, TRADE_MIN_DVOL = 10_000;
const PROB_COLS = E.EVENTS.map((e) => `p_${e.key}`);

// De sweep past niet in één aanroep (CPU-limiet ~2 s): per deel een groep
// markten, daarna een afrondingsstap die uit de database werkt.
export const PARTS: string[][] = [
  ["america"],
  ["canada", "uk", "australia"],
  ["japan"],
  ["hongkong", "singapore", "germany", "france"],
  ["netherlands", "belgium", "italy", "spain", "portugal", "poland", "switzerland", "sweden", "norway", "denmark", "finland"],
];

export async function universeRun(part: string | null): Promise<RunResult> {
  if (part === "finish") return finishRun();
  const idx = Math.max(0, Math.min(PARTS.length - 1, Number(part ?? 0) || 0));
  const lastPart = idx === PARTS.length - 1;
  const sb = getServiceClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const errors: string[] = [];

  // ── 1. Sweep ───────────────────────────────────────────────────────────────
  const tv = new Map<string, TvRow>();
  const perMarket: Record<string, number> = {};
  for (const m of MARKETS.filter((x) => PARTS[idx].includes(x.region))) {
    try {
      const rows = await tvMarket(m.region);
      perMarket[m.region] = rows.length;
      for (const r of rows) if (!tv.has(r.ticker)) tv.set(r.ticker, r);
    } catch (e) { errors.push(`${m.region}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (tv.size < 100) throw new Error(`sweep leverde maar ${tv.size} aandelen op; ${errors.slice(0, 3).join("; ")}`);
  let regime = { iwm200: null as number | null, iwm22: null as number | null };
  try { regime = await tvRegime(); } catch (e) { errors.push(`IWM: ${e instanceof Error ? e.message : String(e)}`); }

  // ── 2. Stand van zaken ─────────────────────────────────────────────────────
  const [tickersAll, favs] = await Promise.all([
    fetchAll<Json>(sb, "signal_tickers", "ticker, active, market_cap_usd"),
    fetchAll<Json>(sb, "xinix_favorites", "ticker, rating"),
  ]);
  const active = new Map(tickersAll.filter((t) => t.active).map((t) => [t.ticker as string, t]));
  // Het laatste deel neemt ook de watchlist mee die TradingView niet dekt.
  const allTv = new Set<string>();
  if (lastPart) {
    const since = nowMs - 2 * E.DAY;
    const known = await chunkedIn<Json>(sb, "xinix_universe", "ticker, tv_at", [...active.keys()]);
    for (const r of known) if (r.tv_at && Date.parse(r.tv_at as string) >= since) allTv.add(r.ticker as string);
  }
  const extra = lastPart ? [...active.keys()].filter((t) => !tv.has(t) && !allTv.has(t)) : [];
  const uniRows = await chunkedIn<Json>(sb, "xinix_universe",
    "ticker, in_watchlist, deep_at, deep_ok, last_peak_date, spike_dates, spikes_1y, last_poefie_date, poefie_count_2y, " +
    "hi5y, lo5y, phoenix_run, phoenix_peak, phoenix_peak_date, volat22, own_n, own_h, requeue_at, added_at, name, exchange, tv_sector, tv_industry, currency, mcap_usd",
    [...tv.keys(), ...extra]);
  const favBy = new Map(favs.map((f) => [f.ticker as string, num(f.rating)]));
  const uniBy = new Map(uniRows.map((u) => [u.ticker as string, u]));
  // Watchlist die TradingView niet dekt (OTC, andere beurzen): koersen uit signal_price_summary.
  const noTv = extra;
  const psRows = noTv.length ? await fetchAll<Json>(sb, "signal_price_summary",
    "ticker, last_close, last_volume, avg_volume_30d, pct_change_1d, pct_change_5d, pct_change_22d, pct_change_6mo, high_1y, low_1y, high_90d, low_90d, high_5y, low_5y",
    (q) => q.in("ticker", noTv.slice(0, 900))) : [];
  const psBy = new Map(psRows.map((p) => [p.ticker as string, p]));

  // Pool één keer per dag volledig opnieuw optellen (herstelt drift).
  if (idx === 0) {
    const { error: refErr } = await sb.rpc("xinix_event_pool_refresh", { p_layout: E.LAYOUT });
    if (refErr) errors.push(`pool-refresh: ${refErr.message}`);
  }
  const pool = await loadPool(sb);
  const models = pool && pool.tickers >= MIN_POOL_TICKERS ? E.buildModels(pool.counts) : null;

  // ── 3. Scoren + criteria ───────────────────────────────────────────────────
  const tvRows: Json[] = [], wlRows: Json[] = [], requeue: string[] = [];
  const hitCount: Record<string, number> = {};
  let scored = 0;
  const allTickers = new Set<string>([...tv.keys(), ...extra]);

  for (const ticker of allTickers) {
    const t = tv.get(ticker) ?? null;
    const u = uniBy.get(ticker);
    const inWl = active.has(ticker);
    const ps = t ? null : psBy.get(ticker);
    const currency = t?.currency ?? (u?.currency as string) ?? null;
    const fx = E.fxUsd(currency);
    const close = t ? t.close : num(ps?.last_close);
    const avgVol = t ? t.avg_vol_30d : num(ps?.avg_volume_30d);
    const mcap = t?.mcap_usd ?? num(u?.mcap_usd) ?? num(active.get(ticker)?.market_cap_usd);
    const deepOk = u?.deep_ok === true && Array.isArray(u.own_n);
    const live: E.Live = {
      close, fx,
      r1: t ? t.change_1d : num(ps?.pct_change_1d),
      r5: t ? t.perf_w : num(ps?.pct_change_5d),
      r22: t ? t.perf_1m : num(ps?.pct_change_22d),
      r6mo: t ? t.perf_6m : num(ps?.pct_change_6mo),
      vol: t ? (t.volume != null && t.avg_vol_30d ? t.volume / t.avg_vol_30d : null)
        : (num(ps?.last_volume) != null && num(ps?.avg_volume_30d) ? num(ps?.last_volume)! / num(ps?.avg_volume_30d)! : null),
      hi52: t ? t.hi52 : num(ps?.high_1y), lo52: t ? t.lo52 : num(ps?.low_1y),
      hi5y: num(u?.hi5y) ?? num(ps?.high_5y), lo5y: num(u?.lo5y) ?? num(ps?.low_5y),
      hi90: t ? t.hi3m : num(ps?.high_90d), lo90: t ? t.lo3m : num(ps?.low_90d),
      volat: t?.volat_m ?? num(u?.volat22), avgVol30: avgVol, mcapUsd: mcap,
      lastPeakDate: (u?.last_peak_date as string) ?? null,
      spikeDates1y: (u?.spike_dates as string[]) ?? null,
      lastPoefieDate: (u?.last_poefie_date as string) ?? null,
      phoenixPeak: num(u?.phoenix_peak), phoenixRun: u?.phoenix_run === true,
      iwm200: regime.iwm200, iwm22: regime.iwm22,
    };
    const lv = E.liveSlots(live, nowMs);
    const priceUsd = close != null ? close * fx : 0;
    const dvol = close != null && avgVol != null ? close * avgVol * fx : 0;
    const tradeable = priceUsd >= TRADE_MIN_PRICE && dvol >= TRADE_MIN_DVOL;

    // Kansen per event (alleen als de deep-scan de eigen historie kent).
    const probs: (number | null)[] = new Array(E.NE).fill(null);
    const raws: (number | null)[] = new Array(E.NE).fill(null);
    if (deepOk && models && close != null) {
      const ownN = u!.own_n as number[], ownH = u!.own_h as number[];
      for (let e = 0; e < E.NE; e++) {
        const m = models[e];
        if (!m) continue;
        const s = E.scoreEvent(m, lv.slots, ownN[E.EVENTS[e].group] ?? 0, ownH[e] ?? 0);
        probs[e] = r1(s.prob); raws[e] = r1(s.raw);
      }
      scored++;
    }

    // Vaste criteria per onderdeel.
    const hits: string[] = [];
    const reasons: string[] = [];
    let strength = 0;
    if (deepOk && Number(u!.spikes_1y ?? 0) >= E.HIKK_MIN_SPIKES && lv.spikes1y >= E.HIKK_MIN_SPIKES) {
      hits.push("hikkertje"); reasons.push(`hikkertje (${lv.spikes1y} spikes in een jaar)`); strength = Math.max(strength, 3 + lv.spikes1y);
    }
    if (deepOk && u!.last_poefie_date && Date.parse(u!.last_poefie_date as string) >= nowMs - 365 * E.DAY) {
      hits.push("poefie"); reasons.push(`poefie op ${u!.last_poefie_date}`); strength = Math.max(strength, 2);
    }
    if (lv.values.phx === 1) { hits.push("feniks"); reasons.push("gevallen feniks"); strength = Math.max(strength, 6); }
    if (lv.star != null && lv.star >= E.STAR.MIN_SCORE) { hits.push("ster"); reasons.push(`5-sterren-DNA fit ${Math.round(lv.star)}`); strength = Math.max(strength, 2 + (lv.star - 80) / 10); }
    if (models) {
      const chk = (key: "h21" | "rk" | "p90", name: string, label: string) => {
        const e = E.EV[key], m = models[e], p = probs[e];
        if (!m || p == null) return;
        const mult = p / (m.p0 * 100);
        if (mult >= HIT_MULT[key]) { hits.push(name); reasons.push(`${label} ${p}% (${mult.toFixed(1)}× de basiskans)`); strength = Math.max(strength, 2 + mult / 3); }
      };
      chk("h21", "hippo", "kans op +50% binnen 21 dagen");
      chk("rk", "raket", "kans op een +150%-maand binnen 6 maanden");
      chk("p90", "poefie-kans", "kans op een poefie binnen 90 dagen");
    }
    for (const h of hits) hitCount[h] = (hitCount[h] ?? 0) + 1;

    const common: Json = {
      ticker, in_watchlist: inWl, is_favorite: favBy.has(ticker),
      ...Object.fromEntries(PROB_COLS.map((c, i) => [c, probs[i]])),
      raw: raws, fb: Array.from(lv.slots), star_fit: lv.star, hits, add_hint: hits.length ? reasons.join("; ") : null,
      strength: hits.length ? r1(strength) : null, tradeable, scored_at: nowIso,
    };
    if (t) {
      const tr = tierOf(t);
      tvRows.push({
        ...common,
        tv_symbol: t.tv_symbol, market: t.market, exchange: t.exchange, name: t.name, currency: t.currency,
        tv_sector: t.tv_sector, tv_industry: t.tv_industry,
        close: t.close, change_1d: t.change_1d, perf_w: t.perf_w, perf_1m: t.perf_1m, perf_6m: t.perf_6m,
        volume: t.volume, avg_vol_30d: t.avg_vol_30d, mcap_usd: t.mcap_usd,
        hi52: t.hi52, lo52: t.lo52, hi3m: t.hi3m, lo3m: t.lo3m, hi_all: t.hi_all, lo_all: t.lo_all, volat_m: t.volat_m,
        tv_at: nowIso, tier: tr.tier, priority: tr.priority,
      });
      // Sprong gezien: over 4 dagen opnieuw meten (dan is een spike bevestigd).
      const jumped = (t.change_1d ?? 0) >= SPIKE_JUMP || (t.perf_w ?? 0) >= 100;
      const recentlyDeep = u?.deep_at && nowMs - Date.parse(u.deep_at as string) < 2 * E.DAY;
      if (jumped && !u?.requeue_at && !recentlyDeep && (tr.tier <= 2 || inWl)) requeue.push(ticker);
    } else {
      wlRows.push(common);
    }
  }

  // ── 4. Wegschrijven ────────────────────────────────────────────────────────
  for (const [rows, label] of [[tvRows, "universum"], [wlRows, "watchlist"]] as const) {
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await sb.from("xinix_universe").upsert(rows.slice(i, i + 1000), { onConflict: "ticker" });
      if (error) { errors.push(`${label}: ${error.message}`); break; }
    }
  }
  // Van de watchlist gehaald: vlag bijwerken.
  const gone = uniRows.filter((u) => u.in_watchlist && !active.has(u.ticker as string)).map((u) => u.ticker as string);
  for (let i = 0; i < gone.length; i += 200) await sb.from("xinix_universe").update({ in_watchlist: false }).in("ticker", gone.slice(i, i + 200));
  const requeueAt = new Date(nowMs + REQUEUE_DAYS * E.DAY).toISOString();
  for (let i = 0; i < requeue.length; i += 200) await sb.from("xinix_universe").update({ requeue_at: requeueAt }).in("ticker", requeue.slice(i, i + 200));

  return {
    ok: errors.length === 0,
    message: `deel ${idx + 1}/${PARTS.length} (${PARTS[idx].join(", ")}): sweep ${tv.size} aandelen${extra.length ? ` + ${extra.length} watchlist zonder TradingView` : ""}; ${scored} gescoord${models ? "" : " (nog geen model: pool te klein)"}; treffers ${Object.entries(hitCount).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}; opnieuw meten ${requeue.length}` +
      (errors.length ? `; fouten: ${errors.slice(0, 4).join("; ")}` : ""),
    metrics: { part: idx, universe: tv.size, per_market: perMarket, extra: extra.length, scored, hits: hitCount, requeue: requeue.length, pool_tickers: pool?.tickers ?? 0 },
  };
}

/**
 * Afronding na de delen: track record vastleggen, modellen opslaan en
 * treffers buiten de watchlist toevoegen. Werkt vanuit xinix_universe, zodat
 * hij niets van de delen in het geheugen nodig heeft.
 */
async function finishRun(): Promise<RunResult> {
  const sb = getServiceClient();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const today = nowIso.slice(0, 10);
  const errors: string[] = [];
  const pool = await loadPool(sb);
  const models = pool && pool.tickers >= MIN_POOL_TICKERS ? E.buildModels(pool.counts) : null;
  const fresh = new Date(nowMs - 20 * 3600_000).toISOString();

  let tracks = 0;
  if (models) {
    const preds: Json[] = [];
    const extra: Record<number, Json> = {};
    for (let e = 0; e < E.NE; e++) {
      const m = models[e];
      if (!m) continue;
      const col = `p_${E.EVENTS[e].key}`;
      const base = m.p0 * 100;
      const [top, favs, cnt] = await Promise.all([
        sb.from("xinix_universe").select(`ticker, close, ${col}, raw`).eq("tradeable", true).gte("scored_at", fresh)
          .not(col, "is", null).order(col, { ascending: false }).limit(TOP_TRACK),
        sb.from("xinix_universe").select(`ticker, close, ${col}, raw`).eq("is_favorite", true).gte("scored_at", fresh)
          .gte(col, base * FAV_TRACK_MULT).order(col, { ascending: false }).limit(300),
        sb.from("xinix_universe").select("ticker", { count: "exact", head: true }).gte("scored_at", fresh).not(col, "is", null),
      ]);
      if (top.error) { errors.push(`top ${col}: ${top.error.message}`); continue; }
      const topRows = (top.data ?? []) as unknown as Json[];
      const topSet = new Set(topRows.map((r) => r.ticker as string));
      extra[e] = { max_prob: topRows.length ? num(topRows[0][col]) : null, scored: cnt.count ?? null };
      const due = new Date(nowMs + (E.EVENTS[e].days + 3) * E.DAY).toISOString().slice(0, 10);
      const favRows = ((favs.data ?? []) as unknown as Json[]).filter((r) => !topSet.has(r.ticker as string));
      for (const [list, source] of [[topRows, "top"], [favRows, "favoriet"]] as const) {
        for (const r of list) {
          const close = num(r.close);
          if (close == null || !(close > 0)) continue;
          preds.push({
            event: E.EVENTS[e].key, ticker: r.ticker, made_on: today, made_at: nowIso, prob: num(r[col]),
            raw_prob: Array.isArray(r.raw) ? num((r.raw as unknown[])[e]) : null,
            base_rate: Math.round(base * 100) / 100, entry_close: close, source, due_on: due,
          });
        }
      }
    }
    for (let i = 0; i < preds.length; i += 500) {
      const { error } = await sb.from("xinix_event_predictions").upsert(preds.slice(i, i + 500), { onConflict: "event,ticker,made_on", ignoreDuplicates: true });
      if (error) { errors.push(`track record: ${error.message}`); break; }
      tracks += preds.slice(i, i + 500).length;
    }
    const err = await writeModels(sb, models, pool!.counts, pool!.tickers, (e) => extra[e] ?? {});
    if (err) errors.push(`modellen: ${err}`);
  }

  // Treffers buiten de watchlist (sterkste eerst, binnen het dagplafond).
  let added: string[] = [], candidates = 0;
  const st = await addSettings(sb);
  if (st.on) {
    const room = Math.max(0, st.max - (await addedToday(sb)));
    if (room > 0) {
      const { data, error } = await sb.from("xinix_universe")
        .select("ticker, name, exchange, mcap_usd, tv_sector, tv_industry, hits, add_hint, strength, spikes_1y, deep_at")
        .eq("in_watchlist", false).eq("tradeable", true).eq("deep_ok", true).is("added_at", null)
        .not("add_hint", "is", null).gte("scored_at", fresh).order("strength", { ascending: false }).limit(room * 3);
      if (error) errors.push(`kandidaten: ${error.message}`);
      const cands: AddCandidate[] = ((data ?? []) as Json[]).map((u) => {
        const hits = (u.hits as string[]) ?? [];
        const fields: Json = {};
        if (u.spikes_1y != null) Object.assign(fields, { is_hikkertje: hits.includes("hikkertje"), hikkertje_spikes: Number(u.spikes_1y) > 0 ? u.spikes_1y : null, is_hikkertje_at: u.deep_at });
        if (hits.includes("feniks")) fields.is_phoenix = true;
        return {
          ticker: u.ticker as string, name: (u.name as string) ?? null, exchange: (u.exchange as string) ?? null, mcap_usd: num(u.mcap_usd),
          tv_sector: (u.tv_sector as string) ?? null, tv_industry: (u.tv_industry as string) ?? null,
          reasons: String(u.add_hint).split("; "), strength: num(u.strength) ?? 0, fields,
        };
      });
      candidates = cands.length;
      const r = await addToWatchlist(sb, cands, room);
      added = r.added;
      if (r.error) errors.push(`toevoegen: ${r.error}`);
    }
  }
  return {
    ok: errors.length === 0,
    message: `afronding: track record +${tracks}; ${models ? "modellen opgeslagen" : "nog geen model"}; kandidaten ${candidates}, toegevoegd ${added.length}${added.length ? ` (${added.slice(0, 10).join(", ")})` : ""}` +
      (errors.length ? `; fouten: ${errors.slice(0, 4).join("; ")}` : ""),
    metrics: { tracked: tracks, candidates, added: added.length },
  };
}
