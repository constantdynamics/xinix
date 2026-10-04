// xinix-ntfy — doorgeefluik voor alle ntfy-meldingen van Xinix.
//
// signal_settings.ntfy_server wijst hierheen; de meldingsfuncties posten hun
// melding (JSON met topic, title, message, priority, tags, click) zoals altijd.
//  1. Een tik op de melding opent het Dagadvies (keuze gebruiker, 2026-10-03).
//     Een link naar één aandeel (Google Finance, Yahoo of het beoordeelscherm)
//     wordt een knop "📈 TICKER bekijken". Een link naar een tabblad (?tab=…)
//     blijft staan: die is bewust gekozen (Dagadvies, Favorieten, Instellingen).
//  2. Doorsturen via _shared/ntfy.ts naar signal_settings.ntfy_upstream: direct,
//     en lukt dat niet door de daglimiet van ntfy.sh, dan via de database.
// Alleen voor het eigen topic, anders zou dit een open doorgeefluik zijn.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { publishNtfy } from "../_shared/ntfy.ts";

type Json = Record<string, unknown>;

const APP_URL = "https://constantdynamics.github.io/xinix/";
const DAGADVIES_URL = `${APP_URL}?tab=dagadvies#dagadvies`;
const MAX_BODY = 16_000;

function stockButton(url: string): Json {
  const m = /[?&]review=([^&#]+)/.exec(url) ?? /google\.com\/finance\/quote\/([^:/?#]+)/.exec(url) ??
    /finance\.yahoo\.com\/quote\/([^/?#]+)/.exec(url);
  const ticker = m ? decodeURIComponent(m[1]).toUpperCase() : null;
  return { action: "view", label: ticker ? `📈 ${ticker} bekijken` : "📈 Aandeel bekijken", url, clear: true };
}

function rewrite(p: Json): Json {
  const click = typeof p.click === "string" && p.click ? p.click : null;
  if (click && click.startsWith(APP_URL) && /[?&]tab=/.test(click)) return p;
  const actions = Array.isArray(p.actions) ? [...p.actions] : [];
  if (click) actions.unshift(stockButton(click));
  return { ...p, click: DAGADVIES_URL, ...(actions.length ? { actions: actions.slice(0, 3) } : {}) };
}

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

  const err = await publishNtfy(s, String(st.ntfy_upstream ?? "https://ntfy.sh"), rewrite(payload));
  if (err) {
    console.error("doorsturen mislukt:", err);
    return new Response(err, { status: 502 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
});
