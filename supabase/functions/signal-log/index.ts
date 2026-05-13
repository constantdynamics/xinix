// signal-log — geeft BUY/STRONG_BUY episodes terug per ticker (gaps-and-islands).
// Publiek leesbaar (geen auth vereist), max 500 episodes per aanroep.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const url = new URL(req.url);
  const daysBack = Math.min(365, Math.max(7, parseInt(url.searchParams.get("days") ?? "180", 10)));

  try {
    const sb = getServiceClient();
    const { data, error } = await sb.rpc("get_signal_log", { days_back: daysBack });
    if (error) throw error;
    return new Response(
      JSON.stringify({ episodes: data ?? [], as_of: new Date().toISOString(), days_back: daysBack }),
      { status: 200, headers: { ...cors(req), "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors(req), "content-type": "application/json" } }
    );
  }
});
