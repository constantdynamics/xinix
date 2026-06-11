// xinix-evolve-background — survival-of-the-fittest voor de 200-strategie simulatie.
//
// v4 — niche-diversiteit via spawn-sturing (geen fitness-penalty):
//   Als een nakomelingniche al vol zit (>NICHE_MAX strategieën met dezelfde
//   sector × score-bucket × signaalfilter), wordt de selectie-dimensie van de
//   nakomelingen gemuteerd totdat ze een andere niche vertegenwoordigen.
//   Diversiteit ontstaat zo inhoudelijk — de evolutie verkent bewust lege ruimte.
//
// Alle verbeteringen op een rij:
//   1. Elitisme: top 2 cullable strategieën (op raw returnPct) overleven altijd
//   2. Sharpe-fitness: compositeFitness = returnPct + clamp(sharpe×8, ±24pp)
//   3. Niche-sturing bij spawnen: volle niches worden actief vermeden
//   4. Geleide crossover: 60% kans om top-donor waarde te erven i.p.v. random walk
//   5. Vervroegd pensioen: 30+ trades én hitrate < 30% (elites uitgezonderd)
//   6. trailingStop + opportunityReplace in de mutatie-ruimte

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

const CULL_RATE                = 0.10;
const PARENT_POOL              = 0.25;
const MIN_CYCLE_DAYS           = 75;
const MIN_AGE_DAYS             = 90;
const CROSSOVER_RATE           = 0.60;
const EARLY_RETIRE_MIN_TRADES  = 30;
const EARLY_RETIRE_MAX_HITRATE = 0.30;
const ELITE_COUNT              = 2;
const SHARPE_WEIGHT            = 8;
const SHARPE_MIN_TRADES        = 10;
const NICHE_MAX                = 5;   // max strategieën per niche vóór spawn-sturing

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
  trailingStop:       number | null;
  opportunityReplace: boolean;
}

// Selectieprofiel op basis van de drie inhoudelijke keuze-dimensies.
function nicheKey(cfg: Cfg): string {
  const sb  = cfg.minScore <= 55 ? "low" : cfg.minScore <= 70 ? "med" : "hi";
  const sf  = cfg.redReq || cfg.minGold > 0 ? "sig" : "open";
  const sec = cfg.sector === "all" ? "all" : cfg.sector.startsWith("bio") ? "bio" : "min";
  return `${sec}_${sb}_${sf}`;
}

// Forceert een andere selectie-aanpak door één niche-dimensie te draaien.
// Probeert tot maxAttempts keer; geeft het beste resultaat terug (ook al zit
// het nog in een volle niche — liever dat dan uren zoeken naar perfectie).
function forceNicheMutation(cfg: Cfg, rand: () => number, crowded: Set<string>): Cfg {
  const sectorAlts = cfg.sector === "all"
    ? ["biotech", "mining"]
    : ["all"];
  const scoreBucketTargets: number[] = cfg.minScore <= 55 ? [65, 75] : cfg.minScore <= 70 ? [50, 75] : [50, 65];
  const signalFlip: Cfg[] = [
    { ...cfg, redReq: !cfg.redReq },
    { ...cfg, minGold: cfg.minGold > 0 ? 0 : 1 },
  ];

  const candidates: Cfg[] = [
    ...sectorAlts.map(s => ({ ...cfg, sector: s })),
    ...scoreBucketTargets.map(v => ({ ...cfg, minScore: v })),
    ...signalFlip,
  ];

  // Shuffle candidates deterministisch
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (const c of candidates) {
    if (!crowded.has(nicheKey(c))) return c;
  }
  return candidates[0] ?? cfg; // alle niches vol → neem eerste kandidaat
}

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function mutate(cfg: Cfg, rand: () => number, donors: Cfg[], maxMuts = 3): Cfg {
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
      v => v == null ? 0.12 : (v >= 0.25 ? null : +(v + 0.03).toFixed(2))) }),
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

  const n = 1 + Math.floor(rand() * maxMuts);
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

// De Data API kapt elke request af op max-rows (hier 10k). Open posities
// (4000+) en gesloten posities (3500+, groeiend) moeten gepagineerd worden —
// anders selecteert de evolutie op stilletjes afgekapte resultaten.
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const cronSecret     = Deno.env.get("CRON_SECRET") ?? "";
  const incomingSecret = req.headers.get("x-cron-secret") ?? "";
  const isForced       = req.headers.get("x-force-evolve") === "1";

  if (cronSecret && incomingSecret !== cronSecret && !isForced) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors(req) });
  }

  try {
    const sb = getServiceClient();

    // ── Tijdcontrole ──────────────────────────────────────────────────────────
    // NB: signal_runs heeft geen kolom `ran_at` — die stond hier eerder en liet
    // deze query (en de run-insert onderaan) stilletjes falen, waardoor evoluties
    // nooit gelogd werden en de cyclus-bewaking nooit werkte.
    const { data: lastEvolve } = await sb
      .from("signal_runs").select("finished_at").eq("job", "xinix-evolve").eq("ok", true)
      .order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();

    let readyToEvolve = false;
    if (!lastEvolve?.finished_at) {
      const { data: oldest } = await sb
        .from("xinix_strategy_state").select("started_at")
        .order("started_at", { ascending: true }).limit(1).maybeSingle();
      if (oldest?.started_at) {
        readyToEvolve = (Date.now() - new Date(oldest.started_at).getTime()) / 86400000 >= MIN_AGE_DAYS;
      }
    } else {
      readyToEvolve = (Date.now() - new Date(lastEvolve.finished_at).getTime()) / 86400000 >= MIN_CYCLE_DAYS;
    }

    if (!readyToEvolve && !isForced) {
      const msg = lastEvolve?.finished_at
        ? `Vorige evolutie was ${((Date.now() - new Date(lastEvolve.finished_at).getTime()) / 86400000).toFixed(0)} dagen geleden — minimum is ${MIN_CYCLE_DAYS}`
        : `Strategieën zijn nog geen ${MIN_AGE_DAYS} dagen actief`;
      return new Response(JSON.stringify({ skipped: true, reason: msg }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Data ophalen ──────────────────────────────────────────────────────────
    const [stratRes, statesRes, openRes, summaryRes, closedRes, lastEvolveRes] = await Promise.all([
      sb.from("xinix_strategies").select("id, slug, name, grp, config, generation, protected").eq("active", true),
      fetchAllPages((f, t) => sb.from("xinix_strategy_state")
        .select("strategy_id, cash, initial_capital, max_drawdown_pct").order("strategy_id").range(f, t)),
      fetchAllPages((f, t) => sb.from("xinix_strategy_positions")
        .select("strategy_id, ticker, qty, avg_price").is("closed_at", null).order("id").range(f, t)),
      fetchAllPages((f, t) => sb.from("signal_price_summary")
        .select("ticker, last_close").order("ticker").range(f, t)),
      fetchAllPages((f, t) => sb.from("xinix_strategy_positions")
        .select("strategy_id, return_pct").not("closed_at", "is", null).order("id").range(f, t)),
      // Vorige evolve-run voor stagnatie-detectie (adaptieve mutatierate)
      sb.from("signal_runs").select("metrics").eq("job", "xinix-evolve").eq("ok", true)
        .order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    ]);
    for (const [name, res] of [
      ["strategieën", stratRes], ["state", statesRes], ["open posities", openRes],
      ["koersen", summaryRes], ["gesloten posities", closedRes],
    ] as const) {
      if (res.error) throw new Error(`query ${name} faalde: ${res.error.message}`);
    }

    const strats = stratRes.data ?? [];
    if (!strats.length) {
      return new Response(JSON.stringify({ skipped: "Geen actieve strategieën" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Hitrate + Sharpe per strategie ────────────────────────────────────────
    const hitByStrat     = new Map<number, { cnt: number; wins: number }>();
    const returnsByStrat = new Map<number, number[]>();

    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const ret = Number(p.return_pct);
      const hs  = hitByStrat.get(sid) ?? { cnt: 0, wins: 0 };
      hs.cnt++; if (ret > 0) hs.wins++;
      hitByStrat.set(sid, hs);
      const rs = returnsByStrat.get(sid) ?? []; rs.push(ret);
      returnsByStrat.set(sid, rs);
    }

    const sharpeByStrat = new Map<number, number>();
    for (const [sid, rets] of returnsByStrat.entries()) {
      if (rets.length < SHARPE_MIN_TRADES) continue;
      const mean     = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
      const std      = Math.sqrt(variance);
      if (std > 0) sharpeByStrat.set(sid, mean / std);
    }

    // ── Performance per strategie ─────────────────────────────────────────────
    const priceMap = new Map<string, number>();
    for (const r of (summaryRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    const stateMap = new Map<number, { cash: number; initial: number; maxDrawdown: number }>();
    for (const s of (statesRes.data ?? [])) {
      stateMap.set(s.strategy_id as number, {
        cash: Number(s.cash),
        initial: Number(s.initial_capital ?? 10000),
        maxDrawdown: Number(s.max_drawdown_pct ?? 0),
      });
    }

    const openVal = new Map<number, number>();
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const px  = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      openVal.set(sid, (openVal.get(sid) ?? 0) + Number(p.qty) * px);
    }

    interface Scored {
      id: number; slug: string; name: string; grp: string;
      config: Cfg; generation: number; protected: boolean;
      returnPct: number; sharpe: number | null; maxDrawdown: number; compositeFitness: number;
    }
    const scored: Scored[] = [];
    for (const strat of strats) {
      const state = stateMap.get(strat.id as number);
      if (!state) continue;
      const posVal      = openVal.get(strat.id as number) ?? 0;
      const returnPct   = (state.cash + posVal - state.initial) / state.initial * 100;
      const sharpe      = sharpeByStrat.get(strat.id as number) ?? null;
      const sharpeBonus = sharpe != null ? Math.max(-24, Math.min(24, sharpe * SHARPE_WEIGHT)) : 0;
      const maxDrawdown = state.maxDrawdown;
      // Drawdown-penalty: elke % max-drawdown kost 0,4 fitness-punt (max -16).
      // Gecombineerd met Sharpe-bonus selecteert dit op echte risico-gecorrigeerde prestatie.
      const drawdownPenalty  = Math.min(maxDrawdown * 0.4, 16);
      const compositeFitness = returnPct + sharpeBonus - drawdownPenalty;
      scored.push({
        id: strat.id as number, slug: strat.slug as string, name: strat.name as string,
        grp: strat.grp as string, config: strat.config as Cfg,
        generation: (strat.generation as number) ?? 1, protected: (strat.protected as boolean) ?? false,
        returnPct, sharpe, maxDrawdown, compositeFitness,
      });
    }

    // ── Stagnatie-detectie voor adaptieve mutatierate ─────────────────────────
    // Als de top-10% fitness minder dan 1pp verbetert t.o.v. de vorige cyclus →
    // verhoog het aantal mutaties per nakomeling (meer exploratief).
    const prevAvgTopFitness = ((lastEvolveRes.data?.metrics ?? {}) as Record<string, unknown>)?.avg_top_fitness as number | null ?? null;
    const topN = Math.max(5, Math.ceil(scored.length * 0.10));
    const avgTopFitness = [...scored]
      .sort((a, b) => b.compositeFitness - a.compositeFitness)
      .slice(0, topN)
      .reduce((sum, s) => sum + s.compositeFitness, 0) / topN;
    const isStagnating = prevAvgTopFitness !== null && (avgTopFitness - prevAvgTopFitness) < 1.0;
    // maxMuts: normaal 1–3, bij stagnatie 2–5 mutaties per nakomeling
    const maxMuts = isStagnating ? 5 : 3;

    // ── Splits: beschermd vs cullable (gesorteerd op compositeFitness) ────────
    const cullable   = scored.filter(s => !s.protected).sort((a, b) => a.compositeFitness - b.compositeFitness);
    const protected_ = scored.filter(s => s.protected);
    const numToCull  = Math.max(1, Math.floor(cullable.length * CULL_RATE));

    // Elitisme: top-2 op raw returnPct overleven altijd
    const eliteIds = new Set(
      [...cullable].sort((a, b) => b.returnPct - a.returnPct).slice(0, ELITE_COUNT).map(s => s.id)
    );

    const normalCull    = cullable.filter(s => !eliteIds.has(s.id)).slice(0, numToCull);
    const normalCullIds = new Set(normalCull.map(s => s.id));

    // Vervroegd pensioen: slechte hitrate — elites uitgezonderd
    const earlyRetire = cullable.filter(s => {
      if (normalCullIds.has(s.id) || eliteIds.has(s.id)) return false;
      const hs = hitByStrat.get(s.id);
      return hs != null && hs.cnt >= EARLY_RETIRE_MIN_TRADES && (hs.wins / hs.cnt) < EARLY_RETIRE_MAX_HITRATE;
    });

    const toCull = [...normalCull, ...earlyRetire];

    if (toCull.length === 0) {
      return new Response(JSON.stringify({ skipped: "Niets te cullen" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Donor-pool: top-25% op compositeFitness ───────────────────────────────
    const allSorted  = [...scored].sort((a, b) => b.compositeFitness - a.compositeFitness);
    const numDonors  = Math.max(2, Math.ceil(allSorted.length * PARENT_POOL));
    const donors     = allSorted.slice(0, numDonors);
    const donorCfgs  = donors.map(d => d.config);

    // ── Niche-tellingen van overlevende strategieën ───────────────────────────
    // Berekend nádat we weten wie gecullled wordt, zodat de spawn-sturing
    // de werkelijke toestand na culling weerspiegelt.
    const culledIds = new Set(toCull.map(s => s.id));
    const nicheCounts = new Map<string, number>();
    for (const s of scored) {
      if (!culledIds.has(s.id)) {
        const nk = nicheKey(s.config);
        nicheCounts.set(nk, (nicheCounts.get(nk) ?? 0) + 1);
      }
    }
    // Niches die al vol zitten — nakomelingen die hier in vallen worden bijgestuurd
    const crowdedNiches = new Set(
      [...nicheCounts.entries()].filter(([, cnt]) => cnt >= NICHE_MAX).map(([nk]) => nk)
    );

    const nextGen = Math.max(...scored.map(s => s.generation ?? 1)) + 1;

    const { data: allStrats } = await sb.from("xinix_strategies").select("slug, config, active");
    const existingSlugs = new Set((allStrats ?? []).map(r => r.slug as string));
    const activeConfigs = new Set(
      (allStrats ?? []).filter(r => r.active).map(r => cfgHash(r.config as Cfg))
    );

    // ── Retire culled strategieën ─────────────────────────────────────────────
    const retiredAt = new Date().toISOString();
    await sb.from("xinix_strategies")
      .update({ active: false, retired_at: retiredAt })
      .in("id", [...culledIds]);

    // ── Spawn nakomelingen met niche-sturing ──────────────────────────────────
    type OffspringRow = {
      slug: string; name: string; grp: string; config: Cfg;
      active: boolean; generation: number; protected: boolean; parent_id: number;
    };
    const offspringRows: OffspringRow[] = [];
    const now = Date.now();
    let nicheRedirects = 0;

    for (let i = 0; i < toCull.length; i++) {
      const parent = donors[i % donors.length];

      let newCfg = parent.config;
      let attempts = 0;
      do {
        const rand = lcg(now + i * 997 + parent.id * 31 + attempts * 7919);
        newCfg = mutate(parent.config, rand, donorCfgs, maxMuts);
        attempts++;
      } while (activeConfigs.has(cfgHash(newCfg)) && attempts < 10);

      // Als de nakomelingniche vol is: stuur bij naar een andere selectie-aanpak
      if (crowdedNiches.has(nicheKey(newCfg))) {
        const randNiche = lcg(now + i * 4567 + parent.id * 89);
        newCfg = forceNicheMutation(newCfg, randNiche, crowdedNiches);
        nicheRedirects++;
      }
      // Registreer niche van nieuwe strategie zodat volgende iteraties dit meenemen
      const nk = nicheKey(newCfg);
      nicheCounts.set(nk, (nicheCounts.get(nk) ?? 0) + 1);
      if ((nicheCounts.get(nk) ?? 0) >= NICHE_MAX) crowdedNiches.add(nk);

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
      .from("xinix_strategies").insert(offspringRows).select("id");
    if (insErr) throw new Error(`Insert nakomelingen: ${insErr.message}`);

    if (inserted?.length) {
      await sb.from("xinix_strategy_state").insert(
        (inserted as { id: number }[]).map(s => ({
          strategy_id: s.id, cash: 10000, initial_capital: 10000,
          max_equity: 10000, started_at: retiredAt, last_run_at: null,
        }))
      );
    }

    // ── Log ───────────────────────────────────────────────────────────────────
    const earlyMsg    = earlyRetire.length > 0 ? ` + ${earlyRetire.length} vervroegd gepensioneerd` : "";
    const sharpeMsg   = sharpeByStrat.size > 0 ? `, ${sharpeByStrat.size} met Sharpe-data` : "";
    const nicheMsg    = nicheRedirects > 0 ? `, ${nicheRedirects}× bijgestuurd naar vrije niche` : "";
    const stagMsg     = isStagnating ? ` [STAGNATIE: hoge mutatierate ${maxMuts}]` : "";
    const nichesNow   = new Set([...nicheCounts.keys()]).size;
    const logMsg = `Gen-${nextGen}: ${toCull.length} gecullled${earlyMsg}, `
      + `${offspringRows.length} nakomelingen gespawnd (${donors.length} donors${sharpeMsg}${nicheMsg}${stagMsg}). `
      + `Beschermd: ${protected_.length} + ${ELITE_COUNT} elites. Niches actief: ${nichesNow}. Top-fitness: ${avgTopFitness.toFixed(1)}pp.`;

    const { error: logErr } = await sb.from("signal_runs").insert({
      job: "xinix-evolve", ok: true, message: logMsg, finished_at: retiredAt,
      metrics: {
        generation: nextGen, avg_top_fitness: +avgTopFitness.toFixed(2),
        is_stagnating: isStagnating, max_muts: maxMuts,
        culled: toCull.length, spawned: offspringRows.length,
        niche_redirects: nicheRedirects, niches_active: nichesNow,
      },
    });
    if (logErr) console.error("evolve: run-log insert faalde:", logErr.message);

    const nicheDistribution: Record<string, number> = {};
    for (const [nk, cnt] of nicheCounts.entries()) nicheDistribution[nk] = cnt;

    return new Response(JSON.stringify({
      generation:          nextGen,
      culled:              toCull.map(s => ({ id: s.id, slug: s.slug, returnPct: +s.returnPct.toFixed(2) })),
      early_retired:       earlyRetire.map(s => ({ id: s.id, slug: s.slug, returnPct: +s.returnPct.toFixed(2) })),
      elite_survivors:     [...eliteIds],
      spawned:             offspringRows.map(o => ({ slug: o.slug, parent_id: o.parent_id, niche: nicheKey(o.config) })),
      protected_count:     protected_.length,
      cullable_count:      cullable.length,
      donors_used:         donors.length,
      sharpe_coverage:     sharpeByStrat.size,
      niche_redirects:     nicheRedirects,
      niche_distribution:  nicheDistribution,
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors(req), "content-type": "application/json" },
    });
  }
});
