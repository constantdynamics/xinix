// xinix-evolve-background — survival-of-the-fittest voor de 100-strategie simulatie.
//
// Na elke 180 dagen:
//   1. Cull de onderste 10% van de NIET-beschermde strategieën (mark active=false)
//   2. Spawn nakomelingen van de top-15% met 1-3 mutaties per dimensie
//   3. Nieuwe strategieën erven het generatienummer van hun ouder + 1
//
// Beschermde strategieën (holdDays >= 90 OF protected=true) overleven altijd.
// Gedachte: lotterij-tickers die eens per 5 jaar hard spiked hebben tijd nodig.
//
// Geforceerde run (admin): stuur x-force-evolve: 1 header.

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

const CULL_RATE       = 0.10;  // 10% van de cullable pool per cyclus
const PARENT_POOL     = 0.15;  // top 15% als ouder-kandidaten
const MIN_CYCLE_DAYS  = 150;   // minimaal interval tussen cycli (iets minder dan 180 voor cron-drift)
const MIN_AGE_DAYS    = 180;   // minimale leeftijd vóór eerste evolutie

interface Cfg {
  minScore:  number;
  redReq:    boolean;
  sector:    string;
  maxPos:    number;
  posSize:   number;
  holdDays:  number;
  stop:      number | null;
  tp:        number | null;
  limitBuf:  number | null;
  minGold:   number;
}

// Lineaire congruentiële generator — deterministisch op basis van seed.
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Muteer config: verander 1-3 willekeurige dimensies, blijf binnen geldige ranges.
function mutate(cfg: Cfg, rand: () => number): Cfg {
  const mutations: Array<(c: Cfg) => Cfg> = [
    (c) => ({ ...c, minScore:  Math.max(55, Math.min(82, c.minScore  + (rand() > 0.5 ? 5 : -5))) }),
    (c) => ({ ...c, holdDays:  Math.max(30, Math.min(120, c.holdDays + (rand() > 0.5 ? 15 : -15))) }),
    (c) => ({ ...c, redReq:   !c.redReq }),
    (c) => ({ ...c, sector:    c.sector === "all" ? (rand() > 0.5 ? "biotech" : "mining") : "all" }),
    (c) => ({ ...c, stop:      c.stop == null ? -0.12 : (c.stop < -0.20 ? null : +(c.stop - 0.03).toFixed(2)) }),
    (c) => ({ ...c, tp:        c.tp   == null ? 0.30  : null }),
    (c) => ({ ...c, maxPos:    Math.max(4, Math.min(12, c.maxPos   + (rand() > 0.5 ? 2 : -2))) }),
    (c) => ({ ...c, posSize:   Math.max(800, Math.min(2000, c.posSize + (rand() > 0.5 ? 200 : -200))) }),
    (c) => ({ ...c, minGold:   Math.max(0,   Math.min(3,   c.minGold   + (rand() > 0.5 ? 1 : -1))) }),
    (c) => ({ ...c, limitBuf:  c.limitBuf == null ? 0.05 : (c.limitBuf >= 0.20 ? null : +(c.limitBuf + 0.05).toFixed(2)) }),
  ];

  const n = 1 + Math.floor(rand() * 3); // 1, 2 of 3 mutaties
  let result = { ...cfg };
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let idx = 0;
    let tries = 0;
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

  // Verificeer aanroeper (cron secret of forced via UI met service key)
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
      // Eerste evolutie: check leeftijd van de oudste strategie
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

    // ── Laad actieve strategieën ──────────────────────────────────────────────
    const { data: strats } = await sb
      .from("xinix_strategies")
      .select("id, slug, name, grp, config, generation, protected")
      .eq("active", true);

    if (!strats?.length) {
      return new Response(JSON.stringify({ skipped: "Geen actieve strategieën" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Performance per strategie berekenen ───────────────────────────────────
    const [statesRes, openRes, summaryRes] = await Promise.all([
      sb.from("xinix_strategy_state").select("strategy_id, cash, initial_capital"),
      sb.from("xinix_strategy_positions").select("strategy_id, ticker, qty, avg_price").is("closed_at", null),
      sb.from("signal_price_summary").select("ticker, last_close"),
    ]);

    const priceMap = new Map<string, number>();
    for (const r of summaryRes.data ?? []) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    const stateMap = new Map<number, { cash: number; initial: number }>();
    for (const s of statesRes.data ?? []) {
      stateMap.set(s.strategy_id as number, { cash: Number(s.cash), initial: Number(s.initial_capital ?? 10000) });
    }

    const openVal = new Map<number, number>();
    for (const p of openRes.data ?? []) {
      const sid = p.strategy_id as number;
      const px = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      openVal.set(sid, (openVal.get(sid) ?? 0) + Number(p.qty) * px);
    }

    interface Scored {
      id: number; slug: string; name: string; grp: string;
      config: Cfg; generation: number; protected: boolean; returnPct: number;
    }
    const scored: Scored[] = [];
    for (const strat of strats) {
      const state = stateMap.get(strat.id as number);
      if (!state) continue;
      const posVal = openVal.get(strat.id as number) ?? 0;
      const equity = state.cash + posVal;
      const returnPct = (equity - state.initial) / state.initial * 100;
      scored.push({
        id: strat.id as number,
        slug: strat.slug as string,
        name: strat.name as string,
        grp:  strat.grp as string,
        config: strat.config as Cfg,
        generation: (strat.generation as number) ?? 1,
        protected: (strat.protected as boolean) ?? false,
        returnPct,
      });
    }

    // ── Splits: beschermd vs cullable ─────────────────────────────────────────
    const cullable  = scored.filter(s => !s.protected).sort((a, b) => a.returnPct - b.returnPct);
    const protected_ = scored.filter(s => s.protected);

    const numToCull = Math.max(1, Math.floor(cullable.length * CULL_RATE));
    const toCull    = cullable.slice(0, numToCull);

    if (toCull.length === 0) {
      return new Response(JSON.stringify({ skipped: "Niets te cullen" }), {
        status: 200, headers: { ...cors(req), "content-type": "application/json" },
      });
    }

    // ── Ouder-pool: top-15% van alle strategieën ──────────────────────────────
    const allSorted  = [...scored].sort((a, b) => b.returnPct - a.returnPct);
    const numParents = Math.max(2, Math.ceil(allSorted.length * PARENT_POOL));
    const parents    = allSorted.slice(0, numParents);

    // Bepaal volgende generatienummer
    const nextGen = Math.max(...scored.map(s => s.generation ?? 1)) + 1;

    // Bestaande config-hashes om duplicaten te voorkomen
    const { data: allStrats } = await sb.from("xinix_strategies").select("slug, config, active");
    const existingSlugs   = new Set((allStrats ?? []).map(r => r.slug as string));
    const activeConfigs   = new Set(
      (allStrats ?? []).filter(r => r.active).map(r => cfgHash(r.config as Cfg))
    );

    // ── Retire culled strategieën ─────────────────────────────────────────────
    const cullIds  = toCull.map(s => s.id);
    const retiredAt = new Date().toISOString();
    await sb.from("xinix_strategies")
      .update({ active: false, retired_at: retiredAt })
      .in("id", cullIds);

    // ── Spawn nakomelingen ────────────────────────────────────────────────────
    type OffspringRow = {
      slug: string; name: string; grp: string; config: Cfg;
      active: boolean; generation: number; protected: boolean; parent_id: number;
    };
    const offspringRows: OffspringRow[] = [];
    const now = Date.now();

    for (let i = 0; i < toCull.length; i++) {
      const parent = parents[i % parents.length];

      // Muteer totdat we een unieke config hebben (max 10 pogingen)
      let newCfg = parent.config;
      let attempts = 0;
      do {
        const rand = lcg(now + i * 997 + parent.id * 31 + attempts * 7919);
        newCfg = mutate(parent.config, rand);
        attempts++;
      } while (activeConfigs.has(cfgHash(newCfg)) && attempts < 10);

      activeConfigs.add(cfgHash(newCfg));

      // Unieke slug
      let slug = `g${nextGen}-${parent.slug.replace(/^g\d+-/, "")}-v${i + 1}`;
      if (slug.length > 80) slug = slug.slice(0, 80);
      let suffix = 0;
      while (existingSlugs.has(slug)) { slug = `g${nextGen}-p${parent.id}-o${i + 1}-${++suffix}`; }
      existingSlugs.add(slug);

      offspringRows.push({
        slug,
        name:      `Gen-${nextGen} ↳ ${parent.name.replace(/^Gen-\d+ ↳ /, "")} #${i + 1}`,
        grp:       `N-Gen${nextGen}`,
        config:    newCfg,
        active:    true,
        generation: nextGen,
        protected: false,
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

    // ── Log ───────────────────────────────────────────────────────────────────
    const logMsg = `Gen-${nextGen}: ${toCull.length} gecullled (${toCull.map(s => `${s.slug}(${s.returnPct.toFixed(1)}%)`).join(", ")}), `
      + `${offspringRows.length} nakomelingen gespawnd. `
      + `Beschermd: ${protected_.length} strategieën.`;

    await sb.from("signal_runs").insert({
      job: "xinix-evolve", ok: true, message: logMsg, ran_at: retiredAt,
    });

    return new Response(JSON.stringify({
      generation:      nextGen,
      culled:          toCull.map(s => ({ id: s.id, slug: s.slug, returnPct: +s.returnPct.toFixed(2) })),
      spawned:         offspringRows.map(o => ({ slug: o.slug, parent_id: o.parent_id })),
      protected_count: protected_.length,
      cullable_count:  cullable.length,
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...cors(req), "content-type": "application/json" },
    });
  }
});
