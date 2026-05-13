// signal-log — geeft BUY/STRONG_BUY episodes terug per ticker (gaps-and-islands).
// Publiek leesbaar (geen auth vereist), max 500 episodes per aanroep.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(req.url);
  const daysBack = Math.min(365, Math.max(7, parseInt(url.searchParams.get("days") ?? "180", 10)));

  try {
    const sb = getServiceClient();
    const { data, error } = await sb.rpc("get_signal_log", { days_back: daysBack });
    if (error) throw error;
    return new Response(
      JSON.stringify({ episodes: data ?? [], as_of: new Date().toISOString(), days_back: daysBack }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
});
