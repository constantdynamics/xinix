// xinix-engine/deep — de meetmotor. Haalt per aandeel 10 jaar
// dagkoersen bij Yahoo en meet daarin alles tegelijk: hikkertje-spikes,
// poefies, raket-maanden, +50%-sprints, feniks-runs en het 5-sterren-DNA, plus
// per handelsdag de toestand en wat er daarna gebeurde (zie _shared/engine.ts).
//
// Volgorde (xinix_deep_scan_queue): eerst de watchlist, dan voorspellingen die
// afgerekend moeten worden, dan aandelen waar de dagelijkse sweep een sprong
// zag, dan het universum (beweeglijkste eerst) en tot slot herscans.
//
// Per run: tellingen naar xinix_event_history (de pool waaruit de modellen
// komen), een samenvatting naar xinix_universe, het track record afrekenen, en
// aandelen die nu al aan een vast criterium voldoen (hikkertje, feniks, verse
// poefie) direct naar de watchlist. Criteria die live koersen nodig hebben
// (hippo, raket, 5-sterren) beoordeelt xinix-engine/universe.
//
// Budget: de edge runtime kapt af rond 2 s CPU. JSON-parsen + meten kost
// ~8–12 ms per aandeel; de run stopt ruim daarvoor.

import * as E from "../_shared/engine.ts";
import {
  getServiceClient, chunkedIn, num, loadPool, writeModels, MIN_POOL_TICKERS,
  addSettings, addedToday, addToWatchlist, type AddCandidate, type Json, type RunResult,
} from "../_shared/universe.ts";

const BATCH = 80;
const BUDGET_MS = 120_000;
const CPU_BUDGET_MS = 1200;       // gemeten rekentijd (parse + analyse), ruim onder de ~2 s-grens
const SLEEP_MS = 150;
const MAX_POOL = 6000;            // max aandelen in de pool (watchlist gaat altijd voor)
const MODEL_REFRESH_MS = 3 * 3600_000;
const TRADE_MIN_PRICE = 0.05, TRADE_MIN_DVOL = 10_000;

export async function deepScan(): Promise<RunResult> {
  const sb = getServiceClient();
  const startMs = Date.now();
  const nowMs = startMs;
  const errors: string[] = [];

  const { data: queue, error: qErr } = await sb.rpc("xinix_deep_scan_queue", { p_limit: BATCH });
  if (qErr) throw new Error(`wachtrij: ${qErr.message}`);
  const due = (queue ?? []) as Array<{ ticker: string; reason: string }>;
  if (!due.length) return { ok: true, message: "wachtrij leeg", metrics: { scanned: 0 } };
  const tickers = due.map((d) => d.ticker);

  // Het model van vóór deze batch: nodig voor de kalibratie per historische dag.
  const pool = await loadPool(sb);
  const models = pool && pool.tickers >= MIN_POOL_TICKERS ? E.buildModels(pool.counts) : null;

  const [uni, wl, hist, preds, histCountRes] = await Promise.all([
    chunkedIn<Json>(sb, "xinix_universe", "ticker, tier, currency, close, avg_vol_30d, mcap_usd, name, exchange, tv_sector, tv_industry, in_watchlist", tickers),
    chunkedIn<Json>(sb, "signal_tickers", "ticker, active, market_cap_usd", tickers),
    chunkedIn<Json>(sb, "xinix_event_history", "ticker, layout, ok, counts", tickers, 50),
    chunkedIn<Json>(sb, "xinix_event_predictions", "event, ticker, made_on, due_on, resolved", tickers)
      .then((r) => r.filter((p) => !p.resolved && String(p.due_on) <= new Date(nowMs).toISOString().slice(0, 10))),
    sb.from("xinix_event_history").select("ticker", { count: "exact", head: true }).eq("ok", true),
  ]);
  const uniBy = new Map(uni.map((r) => [r.ticker as string, r]));
  const wlBy = new Map(wl.map((r) => [r.ticker as string, r]));
  const histBy = new Map(hist.map((r) => [r.ticker as string, r]));
  const predsBy = new Map<string, Json[]>();
  for (const p of preds) { const k = p.ticker as string; (predsBy.get(k) ?? predsBy.set(k, []).get(k)!).push(p); }
  let poolTickers = histCountRes.count ?? 0;

  // Small-cap-klimaat (IWM) voor de regime-kenmerken: één fetch per run.
  let regime: E.Regime | null = null;
  try { regime = E.regimeFrom((await E.fetchYahoo10y("IWM")).clean); }
  catch (e) { errors.push(`IWM: ${e instanceof Error ? e.message : String(e)}`); }

  const poolDelta = new Float64Array(E.LEN);
  let poolTouched = false;
  const okRows: Json[] = [], errRows: Json[] = [], histRows: Json[] = [], predUpdates: Json[] = [];
  const addCands: AddCandidate[] = [];
  let scanned = 0, failed = 0, cpuMs = 0, resolved = 0;
  const failMsgs: string[] = [];
  const nowIso = new Date(nowMs).toISOString();

  for (const d of due) {
    if (Date.now() - startMs > BUDGET_MS || cpuMs > CPU_BUDGET_MS) break;
    scanned++;
    const u = uniBy.get(d.ticker);
    const w = wlBy.get(d.ticker);
    const inWatchlist = w?.active === true;
    const mcap = num(u?.mcap_usd) ?? num(w?.market_cap_usd);
    let fetched: E.Fetched;
    try {
      fetched = await E.fetchYahoo10y(d.ticker);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      if (failMsgs.length < 3) failMsgs.push(msg);
      errRows.push({ ticker: d.ticker, in_watchlist: inWatchlist, deep_at: nowIso, deep_ok: false, deep_error: msg.slice(0, 200), requeue_at: null });
      const old = histBy.get(d.ticker);
      if (old?.ok && old.layout === E.LAYOUT) {
        subtract(poolDelta, old.counts as number[]); poolTouched = true;
        histRows.push({ ticker: d.ticker, layout: E.LAYOUT, scanned_at: nowIso, ok: false, counts: old.counts });
        poolTickers--;
      }
      await sleep(SLEEP_MS);
      continue;
    }
    const t0 = performance.now();
    const fx = E.fxUsd((u?.currency as string) ?? fetched.clean.currency);
    const a = E.analyze(fetched, { nowMs, fx, mcapNow: mcap, regime, models });
    cpuMs += performance.now() - t0;
    const s = a.summary;

    // Track record: voorspellingen waarvan de horizon verstreken is afrekenen.
    for (const p of predsBy.get(d.ticker) ?? []) {
      const e = E.EV[p.event as string];
      if (e == null) continue;
      const out = E.outcomeFor(fetched, fx, String(p.made_on), e);
      // Geen data meer (geschrapt, geschorst) terwijl de horizon ruim voorbij
      // is: dan telt hij als niet uitgekomen, anders blijft hij eeuwig open.
      const stale = out == null && Date.parse(String(p.due_on)) < nowMs - 30 * E.DAY;
      if (out == null && !stale) continue;
      predUpdates.push({ event: p.event, ticker: d.ticker, made_on: p.made_on, resolved: true, hit: out === true, resolved_at: nowIso });
      resolved++;
    }

    okRows.push({
      ticker: d.ticker, in_watchlist: inWatchlist, deep_at: nowIso, deep_ok: a.ok, deep_error: a.error,
      requeue_at: null, bars: s.bars, first_date: s.first_date,
      last_peak_date: s.last_peak_date, peak_count: s.peak_count,
      spikes_1y: s.spikes_1y, spike_dates: s.spike_dates_1y, last_spike_date: s.last_spike_date,
      poefie_count: s.poefie_count, poefie_count_2y: s.poefie_count_2y, last_poefie_date: s.last_poefie_date,
      poefie_max_growth: s.poefie_max_growth, hist_peak: s.hist_peak,
      hi5y: s.hi5y, lo5y: s.lo5y, phoenix_run: s.phoenix_peak != null, phoenix_peak: s.phoenix_peak, phoenix_peak_date: s.phoenix_peak_date,
      volat22: s.volat22 != null ? Math.round(s.volat22 * 100) / 100 : null,
      own_n: s.own_n, own_h: s.own_h,
    });

    // Pool: watchlist altijd, beweeglijke universum-aandelen tot het plafond.
    const old = histBy.get(d.ticker);
    const oldOk = old?.ok === true && old.layout === E.LAYOUT;
    const eligible = inWatchlist || oldOk || (Number(u?.tier) === 1 && poolTickers < MAX_POOL);
    if (a.ok && eligible) {
      add(poolDelta, a.counts); poolTouched = true;
      if (oldOk) subtract(poolDelta, old!.counts as number[]); else poolTickers++;
      histRows.push({ ticker: d.ticker, layout: E.LAYOUT, scanned_at: nowIso, ok: true, counts: Array.from(a.counts) });
    } else if (!a.ok && oldOk) {
      subtract(poolDelta, old!.counts as number[]); poolTouched = true; poolTickers--;
      histRows.push({ ticker: d.ticker, layout: E.LAYOUT, scanned_at: nowIso, ok: false, counts: old!.counts });
    }

    // Vaste criteria die geen live koers nodig hebben → meteen toevoegen.
    if (!w && a.ok && u) {
      const close = num(u.close), vol = num(u.avg_vol_30d);
      const priceUsd = close != null ? close * fx : 0;
      const dvol = close != null && vol != null ? close * vol * fx : 0;
      const tradeable = priceUsd >= TRADE_MIN_PRICE && dvol >= TRADE_MIN_DVOL && s.hist_peak <= E.POEFIE_DEACTIVATE_PEAK;
      const reasons: string[] = [];
      let strength = 0;
      const fields: Json = {};
      if (s.spikes_1y >= E.HIKK_MIN_SPIKES) {
        reasons.push(`hikkertje (${s.spikes_1y} spikes in een jaar)`); strength = Math.max(strength, 3 + s.spikes_1y);
      }
      if (s.phoenix && s.phoenix_peak != null) {
        reasons.push(`gevallen feniks (piek ${s.phoenix_peak.toFixed(2)} op ${s.phoenix_peak_date})`); strength = Math.max(strength, 6);
        fields.is_phoenix = true;
      }
      const poefRecent = s.last_poefie_date != null && Date.parse(s.last_poefie_date) >= nowMs - 365 * E.DAY;
      if (poefRecent) { reasons.push(`poefie op ${s.last_poefie_date} (+${Math.round(s.poefie_max_growth ?? 0)}% max)`); strength = Math.max(strength, 2 + Math.min(3, s.poefie_count_2y)); }
      if (reasons.length && tradeable) {
        // Wat we al gemeten hebben meteen meegeven, zodat de losse functies
        // (compute-hikkertjes/-poefies) dit aandeel niet direct opnieuw halen.
        Object.assign(fields, {
          is_hikkertje: s.spikes_1y >= E.HIKK_MIN_SPIKES, hikkertje_spikes: s.spikes_1y > 0 ? s.spikes_1y : null, is_hikkertje_at: nowIso,
          ...E.poefieFields(a.incidents, nowMs),
          first_price_date: s.first_date,
        });
        addCands.push({
          ticker: d.ticker, name: (u.name as string) ?? null, exchange: (u.exchange as string) ?? null, mcap_usd: mcap,
          tv_sector: (u.tv_sector as string) ?? null, tv_industry: (u.tv_industry as string) ?? null,
          reasons, strength, fields,
        });
      }
    }
    await sleep(SLEEP_MS);
  }

  // ── Wegschrijven ───────────────────────────────────────────────────────────
  for (const [rows, label] of [[okRows, "universe"], [errRows, "universe-fouten"]] as const) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from("xinix_universe").upsert(rows.slice(i, i + 200), { onConflict: "ticker" });
      if (error) { errors.push(`${label}: ${error.message}`); break; }
    }
  }
  for (let i = 0; i < histRows.length; i += 25) {
    const { error } = await sb.from("xinix_event_history").upsert(histRows.slice(i, i + 25), { onConflict: "ticker" });
    if (error) { errors.push(`history: ${error.message}`); break; }
  }
  // Pool bijwerken: incrementeel als hij er al is, anders alles optellen.
  let poolNow: number[] | null = null;
  if (poolTouched) {
    if (pool && !errors.some((e) => e.startsWith("history"))) {
      poolNow = pool.counts.map((v, i) => v + poolDelta[i]);
      const { error } = await sb.from("xinix_event_pool").update({ counts: poolNow, tickers: poolTickers, computed_at: nowIso }).eq("id", 1);
      if (error) errors.push(`pool: ${error.message}`);
    } else {
      const { error } = await sb.rpc("xinix_event_pool_refresh", { p_layout: E.LAYOUT });
      if (error) errors.push(`pool-refresh: ${error.message}`);
      const p2 = await loadPool(sb);
      poolNow = p2?.counts ?? null;
    }
  }
  for (let i = 0; i < predUpdates.length; i += 200) {
    const { error } = await sb.from("xinix_event_predictions").upsert(predUpdates.slice(i, i + 200), { onConflict: "event,ticker,made_on" });
    if (error) { errors.push(`track record: ${error.message}`); break; }
  }

  // Modellen voor de weergave hoogstens eens per 3 uur verversen (IO-budget).
  if (poolNow && poolTickers >= MIN_POOL_TICKERS) {
    const { data: last } = await sb.from("xinix_event_models").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle();
    if (!last || nowMs - Date.parse(last.computed_at as string) > MODEL_REFRESH_MS) {
      const err = await writeModels(sb, E.buildModels(poolNow), poolNow, poolTickers);
      if (err) errors.push(`modellen: ${err}`);
    }
  }

  let added: string[] = [];
  if (addCands.length) {
    const st = await addSettings(sb);
    if (st.on) {
      const room = Math.max(0, st.max - (await addedToday(sb)));
      const r = await addToWatchlist(sb, addCands, room);
      added = r.added;
      if (r.error) errors.push(`toevoegen: ${r.error}`);
    }
  }

  const reasons: Record<string, number> = {};
  for (const d of due.slice(0, scanned)) reasons[d.reason] = (reasons[d.reason] ?? 0) + 1;
  const broken = scanned > 5 && failed >= Math.ceil(scanned * 0.6);
  return {
    ok: errors.length === 0 && !broken,
    message: `gemeten ${scanned - failed}/${due.length} (${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(", ")}), fouten ${failed}, rekentijd ${Math.round(cpuMs)} ms; pool ${poolTickers} aandelen; track record ${resolved} afgerekend; toegevoegd ${added.length}${added.length ? ` (${added.slice(0, 8).join(", ")})` : ""}` +
      (failMsgs.length ? `; yahoo: ${failMsgs.join("; ")}` : "") + (errors.length ? `; fouten: ${errors.slice(0, 3).join("; ")}` : ""),
    metrics: { queued: due.length, scanned, failed, cpu_ms: Math.round(cpuMs), pool_tickers: poolTickers, resolved, added: added.length, reasons, models: !!models },
  };
}

function add(dst: Float64Array, src: ArrayLike<number>) { for (let i = 0; i < dst.length; i++) dst[i] += Number(src[i] ?? 0); }
function subtract(dst: Float64Array, src: ArrayLike<number>) { for (let i = 0; i < dst.length; i++) dst[i] -= Number(src[i] ?? 0); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
