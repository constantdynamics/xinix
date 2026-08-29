// rocket-scores — leesbare uitvoer van xinix-rocket-background.
// Geeft de ranglijst (kans op +150% binnen ~30 dagen, ergens in de komende
// 6 maanden) plus de kalibratie waarop die ranglijst rust, zodat de UI kan
// laten zien waar de getallen vandaan komen.
//
// Publiek leesbaar (net als scan-results): geen geheimen, alleen scores.
// Client + CORS staan hier inline in plaats van in _shared, omdat de
// functie-deploy relatieve imports buiten de bronmap niet meeneemt.

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

const MAX_LIMIT = 400;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "GET") return text(req, "Method not allowed", { status: 405 });

  try {
    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "150");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_LIMIT) : 150;
    const favOnly = url.searchParams.get("favorites") === "1";

    const sb = getServiceClient();
    let q = sb
      .from("xinix_rocket_scores")
      .select(
        "ticker, rank, prob_6m, base_prob, days_since_explosion, company, sector, exchange, " +
        "last_close, market_cap_usd, dollar_volume, pct_change_22d, pct_below_high5y, " +
        "max_explosion_pct, catalyst_date, catalyst_type, explosion_count, is_favorite, rating, tradeable, factors, flags, computed_at",
      )
      .order("rank", { ascending: true })
      .limit(limit);
    if (favOnly) q = q.eq("is_favorite", true);

    const [scores, calib, favCount] = await Promise.all([
      q,
      sb.from("xinix_rocket_calibration").select("computed_at, curve, base_rate_6m, incidents, tickers_scored")
        .order("computed_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("xinix_rocket_scores").select("ticker", { count: "exact", head: true }).eq("is_favorite", true),
    ]);

    if (scores.error) return text(req, scores.error.message, { status: 500 });

    return json(req, {
      items: scores.data ?? [],
      calibration: calib.data ?? null,
      favorite_count: favCount.count ?? 0,
      computed_at: (scores.data?.[0] as { computed_at?: string } | undefined)?.computed_at ?? null,
    });
  } catch (e) {
    return text(req, e instanceof Error ? e.message : String(e), { status: 500 });
  }
});
