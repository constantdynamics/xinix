// xinix-evolve-background — survival-of-the-fittest voor de 100-strategie simulatie.
//
// v3 — drie extra verbeteringen bovenop v2:
//   1. Elitisme: top 2 cullable strategieën overleven altijd (nooit gecullled of vervroegd gepensioneerd)
//   2. Sharpe-fitness: returnPct + sharpe_bonus (max ±24pp) — risico-gecorrigeerd rendement
//   3. Niche-diversiteitsdruk: overcrowded niches (sector × score-bucket × signaalfilter)
//      krijgen een fitness-penalty zodat selectie-aanpakken structureel van elkaar blijven verschillen
//   4. Geleide crossover: 60% kans om top-donor waarde te erven i.p.v. random walk
//   5. Vervroegd pensioen: 30+ trades én hitrate < 30% → elites zijn uitgezonderd
//   6. trailingStop + opportunityReplace in de mutatie-ruimte

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const PROJECT_ID = "zfcjugqgufsyltxhvkuu";
const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey, x-force-evolve, x-cron-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const CULL_RATE                = 0.10;  // 10% van de cullable pool per cyclus
const PARENT_POOL              = 0.25;  // top 25% als donor-kandidaten voor crossover
const MIN_CYCLE_DAYS           = 75;    // snellere cyclus: ~4-5 per jaar
const MIN_AGE_DAYS             = 90;    // minimale leeftijd vóór eerste evolutie
const CROSSOVER_RATE           = 0.60;  // kans om donor-waarde te erven i.p.v. random walk
const EARLY_RETIRE_MIN_TRADES  = 30;    // minimale trades voor vervroegd pensioen
const EARLY_RETIRE_MAX_HITRATE = 0.30;  // < 30% hitrate → vervroegd pensioen
const ELITE_COUNT              = 2;     // top-N cullable strategieën overleven altijd
const SHARPE_WEIGHT            = 8;     // per Sharpe-eenheid: +8pp fitness-bonus
const SHARPE_MIN_TRADES        = 10;    // minimum trades voor betrouwbare Sharpe
const NICHE_TARGET             = 5;     // max gewenst aantal strategieën per niche
const NICHE_PENALTY            = 2;     // -2pp fitness per strategie boven NICHE_TARGET

interface Cfg {
  minScore:           number;
  redReq:             boolean;
  sector:             string;
  maxPos:             number;
  posSize:            number;
  holdDays:           number;
  stop:               number | null;
  tp:                 number | null;
  limitBuf:           number | null;
  minGold:            number;
  trailingStop:       number | null;   // trailing stop fractie; null = vaste stop
  opportunityReplace: boolean;         // kansrotatie activeren
}

// Selectieprofiel: sector × score-bucket × signaalfilter.
// Strategieën met hetzelfde profiel concurreren direct met elkaar.
function nicheKey(cfg: Cfg): string {
  const sb  = cfg.minScore <= 55 ? "low" : cfg.minScore <= 70 ? "med" : "hi";
  const sf  = cfg.redReq || cfg.minGold > 0 ? "sig" : "open";
  const sec = cfg.sector === "all" ? "all" : cfg.sector.startsWith("bio") ? "bio" : "min";
  return `${sec}_${sb}_${sf}`;
}

// Lineaire congruentiële generator — deterministisch op basis van seed.
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Geleide mutatie: 60% kans om donor-waarde te erven, anders random walk.
function mutate(cfg: Cfg, rand: () => number, donors: Cfg[]): Cfg {
  const donor = donors.length > 0 ? donors[Math.floor(rand() * donors.length)] : null;

  function inherit<T>(current: T, donorVal: T | undefined, randomFn: (c: T) => T): T {
    if (donorVal !== undefined && donor !== null && rand() < CROSSOVER_RATE) return donorVal;
    return randomFn(current);
  }

  const mutations: Array<(c: Cfg) => Cfg> = [
    (c) => ({ ...c, minScore: inherit(c.minScore, donor?.minScore,
      v => Math.max(50, Math.min(85, v + (rand() > 0.5 ? 5 : -5)))) }),
    (c) => ({ ...c, holdDays: inherit(c.holdDays, donor?.holdDays,
      v => Math.max(20, Math.min(180, v + (rand() > 0.5 ? 15 : -15)))) }),
    (c) => ({ ...c, redReq: inherit(c.redReq, donor?.redReq, v => !v) }),
    (c) => ({ ...c, sector: inherit(c.sector, donor?.sector,
      v => v === "all" ? (rand() > 0.5 ? "biotech" : "mining") : "all") }),
    (c) => ({ ...c, stop: inherit(c.stop, donor?.stop,
      v => v == null ? -0.12 : (v < -0.25 ? null : +(v - 0.03).toFixed(2))) }),
    (c) => ({ ...c, tp: inherit(c.tp, donor?.tp, v => v == null ? 0.30 : null) }),
    (c) => ({ ...c, maxPos: inherit(c.maxPos, donor?.maxPos,
      v => Math.max(3, Math.min(15, v + (rand() > 0.5 ? 2 : -2)))) }),
    (c) => ({ ...c, posSize: inherit(c.posSize, donor?.posSize,
      v => Math.max(600, Math.min(2500, v + (rand() > 0.5 ? 200 : -200)))) }),
    (c) => ({ ...c, minGold: inherit(c.minGold, donor?.minGold,
      v => Math.max(0, Math.min(3, v + (rand() > 0.5 ? 1 : -1)))) }),
    (c) => ({ ...c, limitBuf: inherit(c.limitBuf, donor?.limitBuf,
      v => v == null ? 0.05 : (v >= 0.20 ? null : +(v + 0.05).toFixed(2))) }),
    (c) => ({ ...c, trailingStop: inherit(c.trailingStop, donor?.trailingStop,
      v => v == null ? 0.12 : (v >= 0.25 ? null : +(v + 0.03).toFixed(2))) }),
    (c) => ({ ...c, opportunityReplace: inherit(c.opportunityReplace, donor?.opportunityReplace,
      v => !v) }),
  ];

  const n = 1 + Math.floor(rand() * 3); // 1, 2 of 3 mutaties
  let result = { ...cfg };
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let idx = 0, tries = 0;
    do { idx = Math.floor(rand() * mutations.length); tries++; } while (used.has(idx) && tries < 30);
    if (!used.has(idx)) { used.add(idx); result = mutations[idx](result); }
  }
  return result;
}

function cfgHash(cfg: Cfg): string {
  return JSON.stringify(Object.fromEntries(Object.entries(cfg).sort()));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const incomingSecret = req.headers.get("x-cron-secret") ?? "";
  const isForced = req.headers.get("x-force-evolve") === "1";

  if (cronSecret && incomingSecret !== cronSecret && !isForced) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors(req) });
  }

  try {
    const sb = getServiceClient();

    // ── Tijdcontrole ──────────────────────────────────────────────────────────
    const { data: lastEvolve } = await sb
      .from("signal_runs")
      .select("ran_at")
      .eq("job", "xinix-evolve")
      .eq("ok", true)
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let readyToEvolve = false;

    if (!lastEvolve) {
      const { data: oldest } = await sb
        .from("xinix_strategy_state")
        .select("started_at")
        .order("started_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (oldest?.started_at) {
        const ageDays = (Date.now() - new Date(oldest.started_at).getTime()) / 86400000;
        readyToEvolve = ageDays >= MIN_AGE_DAYS;
      }
    } else {
      const daysSinceLast = (Date.now() - new Date(lastEvolve.ran_at).getTime()) / 86400000;
      readyToEvolve = daysSinceLast >= MIN_CYCLE_DAYS;
    }

    if (!readyToEvolve && !isForced) {
      const msg = lastEvolve
        ? `Vorige evolutie was ${((Date.now() - new Date(lastEvolve.ran_at).getTime()) / 86400000).toFixed(0)} dagen geleden — minimum is ${MIN_CYCLE_DAYS}`
        : `Strategieën zijn nog geen ${MIN_AGE_DAYS} dagen actief`;
      return new Response(JSON.stringify({ skipped: true, reason: msg }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Laad actieve strategieën + closed positions voor hitrate + Sharpe ──────
    const [stratRes, statesRes, openRes, summaryRes, closedRes] = await Promise.all([
      sb.from("xinix_strategies").select("id, slug, name, grp, config, generation, protected").eq("active", true),
      sb.from("xinix_strategy_state").select("strategy_id, cash, initial_capital"),
      sb.from("xinix_strategy_positions").select("strategy_id, ticker, qty, avg_price").is("closed_at", null),
      sb.from("signal_price_summary").select("ticker, last_close"),
      sb.from("xinix_strategy_positions")
        .select("strategy_id, return_pct")
        .not("closed_at", "is", null),
    ]);

    const strats = stratRes.data ?? [];
    if (!strats.length) {
      return new Response(JSON.stringify({ skipped: "Geen actieve strategieën" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Hitrate + Sharpe per strategie ────────────────────────────────────────
    const hitByStrat    = new Map<number, { cnt: number; wins: number }>();
    const returnsByStrat = new Map<number, number[]>();

    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const ret = Number(p.return_pct);

      const hs = hitByStrat.get(sid) ?? { cnt: 0, wins: 0 };
      hs.cnt++;
      if (ret > 0) hs.wins++;
      hitByStrat.set(sid, hs);

      const rs = returnsByStrat.get(sid) ?? [];
      rs.push(ret);
      returnsByStrat.set(sid, rs);
    }

    // Sharpe per strategie: gemiddeld per-trade rendement / standaarddeviatie (min. 10 trades)
    const sharpeByStrat = new Map<number, number>();
    for (const [sid, rets] of returnsByStrat.entries()) {
      if (rets.length < SHARPE_MIN_TRADES) continue;
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
      const std = Math.sqrt(variance);
      if (std > 0) sharpeByStrat.set(sid, mean / std);
    }

    // ── Performance per strategie berekenen ───────────────────────────────────
    const priceMap = new Map<string, number>();
    for (const r of (summaryRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    const stateMap = new Map<number, { cash: number; initial: number }>();
    for (const s of (statesRes.data ?? [])) {
      stateMap.set(s.strategy_id as number, { cash: Number(s.cash), initial: Number(s.initial_capital ?? 10000) });
    }

    const openVal = new Map<number, number>();
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const px = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      openVal.set(sid, (openVal.get(sid) ?? 0) + Number(p.qty) * px);
    }

    interface Scored {
      id: number; slug: string; name: string; grp: string;
      config: Cfg; generation: number; protected: boolean;
      returnPct: number; sharpe: number | null;
      compositeFitness: number; adjustedFitness: number;
    }
    const scored: Scored[] = [];
    for (const strat of strats) {
      const state = stateMap.get(strat.id as number);
      if (!state) continue;
      const posVal = openVal.get(strat.id as number) ?? 0;
      const returnPct = (state.cash + posVal - state.initial) / state.initial * 100;
      const sharpe = sharpeByStrat.get(strat.id as number) ?? null;
      // Sharpe-bonus: geclampt op ±24pp om uitschieters te beperken
      const sharpeBonus = sharpe != null ? Math.max(-24, Math.min(24, sharpe * SHARPE_WEIGHT)) : 0;
      const compositeFitness = returnPct + sharpeBonus;
      scored.push({
        id:               strat.id as number,
        slug:             strat.slug as string,
        name:             strat.name as string,
        grp:              strat.grp as string,
        config:           strat.config as Cfg,
        generation:       (strat.generation as number) ?? 1,
        protected:        (strat.protected as boolean) ?? false,
        returnPct,
        sharpe,
        compositeFitness,
        adjustedFitness:  compositeFitness, // niche-penalty wordt hieronder opgeteld
      });
    }

    // ── Niche-diversiteitsdruk ────────────────────────────────────────────────
    // Tel hoeveel actieve strategieën per niche aanwezig zijn.
    // Overcrowded niches krijgen een penalty zodat vergelijkbare selectie-aanpakken
    // worden weggeselecteerd ten gunste van strategieën met een unieke invalshoek.
    const nicheCounts = new Map<string, number>();
    for (const s of scored) nicheCounts.set(nicheKey(s.config), (nicheCounts.get(nicheKey(s.config)) ?? 0) + 1);

    for (const s of scored) {
      const overcrowd = Math.max(0, (nicheCounts.get(nicheKey(s.config)) ?? 1) - NICHE_TARGET);
      s.adjustedFitness = s.compositeFitness - overcrowd * NICHE_PENALTY;
    }

    // ── Splits: beschermd vs cullable ─────────────────────────────────────────
    // Sorteer cullable op adjustedFitness oplopend (slechtste eerst)
    const cullable   = scored.filter(s => !s.protected).sort((a, b) => a.adjustedFitness - b.adjustedFitness);
    const protected_ = scored.filter(s => s.protected);

    const numToCull  = Math.max(1, Math.floor(cullable.length * CULL_RATE));

    // Elitisme: de top-2 cullable (op returnPct, niet op adjustedFitness) overleven altijd
    const eliteIds = new Set(
      [...cullable].sort((a, b) => b.returnPct - a.returnPct).slice(0, ELITE_COUNT).map(s => s.id)
    );

    // Normale cull: slechtste numToCull op basis van adjustedFitness
    const normalCull    = cullable.filter(s => !eliteIds.has(s.id)).slice(0, numToCull);
    const normalCullIds = new Set(normalCull.map(s => s.id));

    // Vervroegd pensioen: slechte hitrate — elites zijn uitgezonderd
    const earlyRetire = cullable.filter(s => {
      if (normalCullIds.has(s.id)) return false;
      if (eliteIds.has(s.id)) return false;
      const hs = hitByStrat.get(s.id);
      return hs != null && hs.cnt >= EARLY_RETIRE_MIN_TRADES && (hs.wins / hs.cnt) < EARLY_RETIRE_MAX_HITRATE;
    });

    const toCull = [...normalCull, ...earlyRetire];

    if (toCull.length === 0) {
      return new Response(JSON.stringify({ skipped: "Niets te cullen" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Donor-pool: top-25% op compositeFitness (Sharpe-gecorrigeerd, zonder niche-penalty) ──
    const allSorted  = [...scored].sort((a, b) => b.compositeFitness - a.compositeFitness);
    const numDonors  = Math.max(2, Math.ceil(allSorted.length * PARENT_POOL));
    const donors     = allSorted.slice(0, numDonors);
    const donorCfgs  = donors.map(d => d.config);

    // Volgende generatienummer
    const nextGen = Math.max(...scored.map(s => s.generation ?? 1)) + 1;

    // Bestaande config-hashes om duplicaten te voorkomen
    const { data: allStrats } = await sb.from("xinix_strategies").select("slug, config, active");
    const existingSlugs = new Set((allStrats ?? []).map(r => r.slug as string));
    const activeConfigs = new Set(
      (allStrats ?? []).filter(r => r.active).map(r => cfgHash(r.config as Cfg))
    );

    // ── Retire culled strategieën ─────────────────────────────────────────────
    const cullIds   = toCull.map(s => s.id);
    const retiredAt = new Date().toISOString();
    await sb.from("xinix_strategies")
      .update({ active: false, retired_at: retiredAt })
      .in("id", cullIds);

    // ── Spawn nakomelingen via geleide crossover ───────────────────────────────
    type OffspringRow = {
      slug: string; name: string; grp: string; config: Cfg;
      active: boolean; generation: number; protected: boolean; parent_id: number;
    };
    const offspringRows: OffspringRow[] = [];
    const now = Date.now();

    for (let i = 0; i < toCull.length; i++) {
      const parent = donors[i % donors.length];

      // Muteer totdat unieke config gevonden (max 10 pogingen)
      let newCfg = parent.config;
      let attempts = 0;
      do {
        const rand = lcg(now + i * 997 + parent.id * 31 + attempts * 7919);
        newCfg = mutate(parent.config, rand, donorCfgs);
        attempts++;
      } while (activeConfigs.has(cfgHash(newCfg)) && attempts < 10);

      activeConfigs.add(cfgHash(newCfg));

      let slug = `g${nextGen}-${parent.slug.replace(/^g\d+-/, "")}-v${i + 1}`;
      if (slug.length > 80) slug = slug.slice(0, 80);
      let suffix = 0;
      while (existingSlugs.has(slug)) { slug = `g${nextGen}-p${parent.id}-o${i + 1}-${++suffix}`; }
      existingSlugs.add(slug);

      offspringRows.push({
        slug,
        name:       `Gen-${nextGen} ↳ ${parent.name.replace(/^Gen-\d+ ↳ /, "")} #${i + 1}`,
        grp:        `N-Gen${nextGen}`,
        config:     newCfg,
        active:     true,
        generation: nextGen,
        protected:  false,
        parent_id:  parent.id,
      });
    }

    const { data: inserted, error: insErr } = await sb
      .from("xinix_strategies")
      .insert(offspringRows)
      .select("id");

    if (insErr) throw new Error(`Insert nakomelingen: ${insErr.message}`);

    // Initialiseer state voor nieuwe strategieën
    if (inserted?.length) {
      const stateRows = (inserted as { id: number }[]).map(s => ({
        strategy_id:     s.id,
        cash:            10000,
        initial_capital: 10000,
        started_at:      retiredAt,
        last_run_at:     null,
      }));
      await sb.from("xinix_strategy_state").insert(stateRows);
    }

    // ── Niche-verdeling na evolutie ───────────────────────────────────────────
    const nicheSummary: Record<string, number> = {};
    for (const [nk, cnt] of nicheCounts.entries()) nicheSummary[nk] = cnt;

    // ── Log ───────────────────────────────────────────────────────────────────
    const earlyMsg = earlyRetire.length > 0
      ? ` + ${earlyRetire.length} vervroegd gepensioneerd (slechte hitrate)`
      : "";
    const sharpeMsg = sharpeByStrat.size > 0
      ? `, ${sharpeByStrat.size} strategieën met Sharpe-data`
      : "";
    const logMsg = `Gen-${nextGen}: ${toCull.length} gecullled${earlyMsg} (${toCull.map(s => `${s.slug}(${s.returnPct.toFixed(1)}%)`).join(", ")}), `
      + `${offspringRows.length} nakomelingen gespawnd via geleide crossover (${donors.length} donors)${sharpeMsg}. `
      + `Beschermd: ${protected_.length} + ${ELITE_COUNT} elites. `
      + `Niches: ${Object.keys(nicheSummary).length} uniek.`;

    await sb.from("signal_runs").insert({
      job: "xinix-evolve", ok: true, message: logMsg, ran_at: retiredAt,
    });

    return new Response(JSON.stringify({
      generation:       nextGen,
      culled:           toCull.map(s => ({ id: s.id, slug: s.slug, returnPct: +s.returnPct.toFixed(2), adjustedFitness: +s.adjustedFitness.toFixed(2) })),
      early_retired:    earlyRetire.map(s => ({ id: s.id, slug: s.slug, returnPct: +s.returnPct.toFixed(2) })),
      elite_survivors:  [...eliteIds],
      spawned:          offspringRows.map(o => ({ slug: o.slug, parent_id: o.parent_id })),
      protected_count:  protected_.length,
      cullable_count:   cullable.length,
      donors_used:      donors.length,
      sharpe_coverage:  sharpeByStrat.size,
      niche_summary:    nicheSummary,
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors(req), "content-type": "application/json" },
    });
  }
});
