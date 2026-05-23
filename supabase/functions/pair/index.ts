// Apparaat-koppeling: wissel een kortlevende koppelcode in voor het
// admin-token, zodat een telefoon kan inloggen zonder het token over te
// typen.
//
// POST { action: "create" }        (Bearer admin-token) -> { code, expires_at, ttl_minutes }
// POST { action: "redeem", code }  (geen auth)           -> { token }
//
// De code is 6 tekens uit een 31-symbool alfabet (~9e8 combinaties),
// 5 minuten geldig en eenmalig inwisselbaar — brute-forcen binnen dat
// venster is onhaalbaar.

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
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(origin) ? origin : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function json(req: Request, body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders(req), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}
function text(req: Request, body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: { ...corsHeaders(req), "content-type": "text/plain", ...(init.headers as Record<string, string> | undefined) },
  });
}
function checkAuth(req: Request): boolean {
  const required = Deno.env.get("ADMIN_TOKEN");
  if (!required) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${required}`;
}

// Alfabet zonder dubbelzinnige tekens (geen 0/O/1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const TTL_MINUTES = 5;

function generateCode(): string {
  // Rejection sampling: alleen bytes onder het grootste veelvoud van de
  // alfabetlengte gebruiken, zodat `% lengte` geen modulo-bias naar de
  // eerste alfabettekens introduceert.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < CODE_LEN) {
    const buf = new Uint8Array(CODE_LEN);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < CODE_LEN; i++) {
      if (buf[i] < limit) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    }
  }
  return out;
}
function normalizeCode(v: unknown): string {
  return typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return text(req, "Method not allowed", { status: 405 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return text(req, "Invalid JSON body", { status: 400 });
  }

  const sb = getServiceClient();
  const nowIso = new Date().toISOString();

  // ── Laptop: nieuwe koppelcode aanmaken (vereist admin-token) ──
  if (body.action === "create") {
    if (!checkAuth(req)) return text(req, "Unauthorized", { status: 401 });
    // Verlopen codes opruimen zodat de tabel klein blijft.
    await sb.from("xinix_pairing_codes").delete().lt("expires_at", nowIso);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();
    // Botsing is met ~9e8 sleutels onwaarschijnlijk; één retry is ruim zat.
    let code = generateCode();
    let { error } = await sb.from("xinix_pairing_codes").insert({ code, expires_at: expiresAt });
    if (error) {
      code = generateCode();
      ({ error } = await sb.from("xinix_pairing_codes").insert({ code, expires_at: expiresAt }));
    }
    if (error) return text(req, error.message, { status: 500 });
    return json(req, { code, expires_at: expiresAt, ttl_minutes: TTL_MINUTES });
  }

  // ── Telefoon: koppelcode inwisselen voor het token (geen auth) ──
  if (body.action === "redeem") {
    const code = normalizeCode(body.code);
    if (code.length !== CODE_LEN) return text(req, "Ongeldige code", { status: 400 });
    // Atomisch claimen: alleen een niet-gebruikte, niet-verlopen code kan
    // worden geüpdatet. Twee gelijktijdige redeems → maar één slaagt.
    const { data: claimed, error } = await sb
      .from("xinix_pairing_codes")
      .update({ used_at: nowIso })
      .eq("code", code)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("code")
      .maybeSingle();
    if (error) return text(req, error.message, { status: 500 });
    if (!claimed) return text(req, "Code ongeldig, verlopen of al gebruikt", { status: 404 });
    const token = Deno.env.get("ADMIN_TOKEN");
    if (!token) return text(req, "Server niet geconfigureerd", { status: 500 });
    return json(req, { token });
  }

  return text(req, "Onbekende actie", { status: 400 });
});
