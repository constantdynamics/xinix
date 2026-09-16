// hippo-scores — leesbare uitvoer van xinix-hippo-background: per favoriet de
// gekalibreerde kans op +50% binnen 14 dagen, plus de gemeten lifts en de
// kalibratietabel waarop die kans rust.
//
// Publiek leesbaar (net als rocket-scores): geen geheimen, alleen scores.
// Client + CORS staan hier inline omdat de functie-deploy relatieve imports
// buiten de bronmap niet meeneemt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set([
  "https://constantdynamics.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);
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
function json(req: Request, body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}
function text(req: Request, body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: { ...cors(req), "content-type": "text/plain", ...(init.headers as Record<string, string> | undefined) },
  });
}

const MAX_LIMIT = 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "GET") return text(req, "Method not allowed", { status: 405 });

  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "700");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_LIMIT) : 700;
    // De ranglijst beslaat de hele watchlist; met favorites=1 blijft het bij de
    // aandelen met een hartje, wat het standaardbeeld van het tabblad is.
    const favOnly = url.searchParams.get("favorites") === "1";

    const sb = getServiceClient();
    let scoreQuery = sb.from("xinix_hippo_scores")
        .select(
          "ticker, rank, prob, raw_prob, base_rate, own_rate, prob_7d, raw_prob_7d, base_rate_7d, " +
          "company, sector, exchange, last_close, dollar_volume, " +
          "pct_change_5d, pct_change_22d, volume_ratio, days_since_peak, pct_below_high1y, peak_count, rating, " +
          "tradeable, is_favorite, factors, factors_7d, flags, scanned_at, alerted_at, alerted_prob, alerted_horizon, computed_at",
        )
        .order("rank", { ascending: true })
        .limit(limit);
    if (favOnly) scoreQuery = scoreQuery.eq("is_favorite", true);

    const [scores, calib, settings, favCount, histCount, track, scoredCount] = await Promise.all([
      scoreQuery,
      // Eén kalibratierij per horizon (7 en 14 dagen).
      sb.from("xinix_hippo_calibration").select("horizon, computed_at, base_rate, days_n, hits, tickers_scanned, favorites, lifts, calib, max_prob, ceiling").order("horizon", { ascending: true }),
      sb.from("signal_settings").select("hippo_alert_min_prob, hippo_alert_horizon, hippo_alert_max_per_week").eq("id", 1).maybeSingle(),
      sb.from("xinix_favorites").select("ticker", { count: "exact", head: true }),
      sb.from("xinix_hippo_history").select("ticker", { count: "exact", head: true }).eq("ok", true),
      // Track record: wat voorspelde het model, en kwam het uit? Aggregeren
      // gebeurt in de database, want het gaat om tellingen en niet om de
      // duizenden losse voorspellingen.
      sb.rpc("xinix_hippo_track_record"),
      sb.from("xinix_hippo_scores").select("ticker", { count: "exact", head: true }),
    ]);
    if (scores.error) return text(req, scores.error.message, { status: 500 });

    const calRows = (calib.data ?? []) as Array<{ horizon: number; computed_at?: string }>;
    const byHorizon: Record<string, unknown> = {};
    for (const row of calRows) byHorizon[String(row.horizon)] = row;
    const st = settings.data as { hippo_alert_min_prob?: unknown; hippo_alert_horizon?: unknown; hippo_alert_max_per_week?: unknown } | null;

    return json(req, {
      items: scores.data ?? [],
      calibrations: byHorizon,
      // De 14-daagse blijft los meegestuurd zodat een oudere frontend blijft werken.
      calibration: byHorizon["14"] ?? null,
      threshold: Number(st?.hippo_alert_min_prob ?? 80),
      alert_horizon: Number(st?.hippo_alert_horizon ?? 14),
      max_per_week: Number(st?.hippo_alert_max_per_week ?? 1),
      track_record: track.error ? null : (track.data ?? null),
      favorite_count: favCount.count ?? 0,
      scanned_count: histCount.count ?? 0,
      scored_count: scoredCount.count ?? 0,
      computed_at: calRows[0]?.computed_at ?? null,
    });
  } catch (e) {
    return text(req, e instanceof Error ? e.message : String(e), { status: 500 });
  }
});
