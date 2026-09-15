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

    const sb = getServiceClient();
    const [scores, calib, settings, favCount, histCount] = await Promise.all([
      sb.from("xinix_hippo_scores")
        .select(
          "ticker, rank, prob, raw_prob, base_rate, own_rate, company, sector, exchange, last_close, dollar_volume, " +
          "pct_change_5d, pct_change_22d, volume_ratio, days_since_peak, pct_below_high1y, peak_count, rating, " +
          "tradeable, factors, flags, scanned_at, alerted_at, alerted_prob, computed_at",
        )
        .order("rank", { ascending: true })
        .limit(limit),
      sb.from("xinix_hippo_calibration").select("computed_at, base_rate, days_n, hits, tickers_scanned, favorites, lifts, calib, max_prob").eq("id", 1).maybeSingle(),
      sb.from("signal_settings").select("hippo_alert_min_prob").eq("id", 1).maybeSingle(),
      sb.from("xinix_favorites").select("ticker", { count: "exact", head: true }),
      sb.from("xinix_hippo_history").select("ticker", { count: "exact", head: true }).eq("ok", true),
    ]);
    if (scores.error) return text(req, scores.error.message, { status: 500 });

    return json(req, {
      items: scores.data ?? [],
      calibration: calib.data ?? null,
      threshold: Number((settings.data as { hippo_alert_min_prob?: unknown } | null)?.hippo_alert_min_prob ?? 80),
      favorite_count: favCount.count ?? 0,
      scanned_count: histCount.count ?? 0,
      computed_at: (calib.data as { computed_at?: string } | null)?.computed_at ?? null,
    });
  } catch (e) {
    return text(req, e instanceof Error ? e.message : String(e), { status: 500 });
  }
});
