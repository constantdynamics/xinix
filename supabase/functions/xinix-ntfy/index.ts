// xinix-ntfy — doorgeefluik voor alle ntfy-meldingen van Xinix.
//
// signal_settings.ntfy_server wijst hierheen; de meldingsfuncties posten hun
// melding (JSON met topic, title, message, priority, tags, click) zoals altijd.
// Het luik stuurt die ongewijzigd door via _shared/ntfy.ts naar
// signal_settings.ntfy_upstream: direct, en lukt dat niet door de daglimiet van
// ntfy.sh, dan via de database. Een tik op een melding opent dus wat de functie
// zelf als click meegaf; alleen Dagadvies-meldingen openen het Dagadvies
// (keuze gebruiker 2026-10-06, eerder herschreef het luik élke click).
// Alleen voor het eigen topic, anders zou dit een open doorgeefluik zijn.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { publishNtfy } from "../_shared/ntfy.ts";

type Json = Record<string, unknown>;

const MAX_BODY = 16_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST verwacht", { status: 405 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("bericht te groot", { status: 413 });
  let payload: Json;
  try {
    payload = JSON.parse(raw) as Json;
  } catch {
    return new Response("JSON verwacht", { status: 400 });
  }
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) return new Response("configuratie ontbreekt", { status: 500 });
  const s = createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: st } = await s.from("signal_settings").select("ntfy_topic, ntfy_upstream").eq("id", 1).maybeSingle();
  if (!st?.ntfy_topic || payload.topic !== st.ntfy_topic) return new Response("onbekend topic", { status: 403 });

  const err = await publishNtfy(s, String(st.ntfy_upstream ?? "https://ntfy.sh"), payload);
  if (err) {
    console.error("doorsturen mislukt:", err);
    return new Response(err, { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
});
