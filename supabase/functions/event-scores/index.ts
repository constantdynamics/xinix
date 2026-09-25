// event-scores — leesbare uitvoer van de explosie-motor (xinix-engine): de
// gemeten modellen per event, het track record, de dekking van het universum
// en ranglijsten.
//
//   GET /event-scores                     modellen + track record + dekking
//   GET /event-scores?event=h21&scope=…    ranglijst op kans (scope: watchlist | universum | alles)
//   GET /event-scores?hit=hikkertje&…      aandelen die nu aan een criterium voldoen
//   GET /event-scores?probs=watchlist      compacte kansen per watchlist-aandeel {ticker: [p_h7..p_rk]}
//
// Publiek leesbaar (net als hippo-scores): geen geheimen, alleen scores.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const EVENTS = ["h7", "h14", "h21", "k30", "k90", "p30", "p90", "rk"];
const HITS = new Set(["hikkertje", "poefie", "feniks", "ster", "hippo", "raket", "poefie-kans"]);
const LIST_COLS = "ticker, name, market, exchange, currency, close, change_1d, perf_w, perf_1m, mcap_usd, avg_vol_30d, " +
  EVENTS.map((e) => `p_${e}`).join(", ") + ", fb, hits, star_fit, in_watchlist, is_favorite, added_at, add_reason, " +
  "spikes_1y, last_spike_date, poefie_count, poefie_count_2y, last_poefie_date, poefie_max_growth, phoenix_peak, phoenix_peak_date, deep_at, scored_at";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);
  try {
    const url = new URL(req.url);
    const sb = getServiceClient();
    const limitRaw = Number(url.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 1000) : 200;
    const scope = url.searchParams.get("scope") ?? "alles";
    // deno-lint-ignore no-explicit-any
    const scoped = (q: any) => scope === "watchlist" ? q.eq("in_watchlist", true) : scope === "universum" ? q.eq("in_watchlist", false) : q;

    const probs = url.searchParams.get("probs");
    if (probs === "watchlist") {
      const out: Record<string, (number | null)[]> = {};
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from("xinix_universe").select(`ticker, ${EVENTS.map((e) => `p_${e}`).join(", ")}`)
          .eq("in_watchlist", true).not("scored_at", "is", null).order("ticker").range(from, from + 999);
        if (error) return json(req, { error: error.message }, 500);
        // deno-lint-ignore no-explicit-any
        for (const r of (data ?? []) as any[]) out[r.ticker] = EVENTS.map((e) => (r[`p_${e}`] == null ? null : Number(r[`p_${e}`])));
        if ((data ?? []).length < 1000) break;
      }
      return json(req, { events: EVENTS, probs: out });
    }

    const event = url.searchParams.get("event");
    if (event) {
      if (!EVENTS.includes(event)) return json(req, { error: "onbekend event" }, 400);
      const { data, error } = await scoped(sb.from("xinix_universe").select(LIST_COLS).not(`p_${event}`, "is", null))
        .order(`p_${event}`, { ascending: false }).limit(limit);
      if (error) return json(req, { error: error.message }, 500);
      return json(req, { event, scope, items: data ?? [] });
    }

    const hit = url.searchParams.get("hit");
    if (hit) {
      if (!HITS.has(hit)) return json(req, { error: "onbekend criterium" }, 400);
      const sortEv = url.searchParams.get("sort");
      let q = scoped(sb.from("xinix_universe").select(LIST_COLS).contains("hits", [hit]));
      q = sortEv && EVENTS.includes(sortEv) ? q.order(`p_${sortEv}`, { ascending: false, nullsFirst: false }) : q.order("added_at", { ascending: false, nullsFirst: false });
      const { data, error } = await q.limit(limit);
      if (error) return json(req, { error: error.message }, 500);
      return json(req, { hit, scope, items: data ?? [] });
    }

    // Overzicht: modellen, track record en dekking.
    // deno-lint-ignore no-explicit-any
    const count = (f: (q: any) => any) => f(sb.from("xinix_universe").select("ticker", { count: "exact", head: true })).then((r: { count: number | null }) => r.count ?? 0);
    const start = new Date(); start.setUTCHours(0, 0, 0, 0);
    const [models, track, total, tv, deep, deepOk, wl, added, addedToday, pool, ...hitCounts] = await Promise.all([
      sb.from("xinix_event_models").select("*"),
      sb.rpc("xinix_event_track_record"),
      count((q) => q),
      count((q) => q.not("tv_at", "is", null)),
      count((q) => q.not("deep_at", "is", null)),
      count((q) => q.eq("deep_ok", true)),
      count((q) => q.eq("in_watchlist", true)),
      count((q) => q.not("added_at", "is", null)),
      count((q) => q.gte("added_at", start.toISOString())),
      sb.from("xinix_event_pool").select("tickers, computed_at").eq("id", 1).maybeSingle(),
      ...[...HITS].map((h) => count((q) => q.contains("hits", [h]))),
      ...[...HITS].map((h) => count((q) => q.contains("hits", [h]).eq("in_watchlist", false))),
    ]);
    const hitNames = [...HITS];
    const { count: pending } = await sb.from("xinix_universe").select("ticker", { count: "exact", head: true }).is("deep_at", null).in("tier", [1, 2]);
    const { data: lastTv } = await sb.from("xinix_universe").select("tv_at").not("tv_at", "is", null).order("tv_at", { ascending: false }).limit(1).maybeSingle();
    const byEvent: Record<string, unknown> = {};
    for (const m of (models.data ?? []) as Array<{ event: string }>) byEvent[m.event] = m;
    return json(req, {
      models: byEvent,
      track_record: track.error ? null : track.data,
      coverage: {
        universe: total, tv, deep_scanned: deep, deep_ok: deepOk, in_watchlist: wl, pending_scan: pending ?? 0,
        added_total: added, added_today: addedToday,
        pool_tickers: (pool.data as { tickers?: number } | null)?.tickers ?? 0,
        pool_at: (pool.data as { computed_at?: string } | null)?.computed_at ?? null,
        sweep_at: (lastTv as { tv_at?: string } | null)?.tv_at ?? null,
        hits: Object.fromEntries(hitNames.map((h, i) => [h, { all: hitCounts[i], outside: hitCounts[i + hitNames.length] }])),
      },
    });
  } catch (e) {
    return json(req, { error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
