// xinix-auth — inlogpagina: op een onbekend apparaat opent Xinix pas na het wachtwoord.
//
//   POST {action:"login", password}               → {token, device}  (3× fout vanaf één IP = 1 uur dicht)
//   POST {action:"check", token}                  → {ok, device}
//   POST {action:"logout", token}                 → {ok}
//   POST {action:"reset_request"}                 → herstellink per e-mail; lukt dat niet, dan als pushmelding
//   POST {action:"reset", reset_token, password}  → nieuw wachtwoord, en dit apparaat is meteen ingelogd
//   POST {action:"devices"}        (beheertoken)  → {devices, failures}
//   POST {action:"revoke", id}     (beheertoken)  → {ok}
//
// Stap 1 van de afscherming: zonder bekend apparaat toont de site alleen het
// inlogscherm; de gegevens zelf zijn via de API nog op te vragen (stap 2 volgt).
// Bewerken blijft het beheertoken vragen. Het wachtwoord staat nergens, alleen
// een PBKDF2-hash in xinix_auth_password (migratie 2026-10-03_xinix_auth.sql).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { publishNtfy } from "../_shared/ntfy.ts";

type SB = SupabaseClient;
type Json = Record<string, unknown>;

const HOUR = 3_600_000;
const MAX_FAILS = 3;                // per IP binnen een uur
const GLOBAL_MAX_FAILS = 20;        // alle IP's samen binnen een uur: dan dicht voor iedereen (aanval vanaf veel adressen)
const FAIL_NOTIFY_PER_HOUR = 6;     // niet meer pushmeldingen over foute pogingen dan dit
const RESET_PER_HOUR = 3;
const PBKDF2_ITERATIONS = 300_000;
const MIN_PASSWORD = 8;
const APP_URL = "https://constantdynamics.github.io/xinix/";

function client(): SB {
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function reply(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });
}
function isAdmin(req: Request): boolean {
  const t = Deno.env.get("ADMIN_TOKEN");
  return !!t && (req.headers.get("authorization") ?? "") === `Bearer ${t}`;
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── Sleutels en hashes ──────────────────────────────────────────────────────
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function pbkdf2(password: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2_sha256" || !it || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(it));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ── Wie klopt er aan ────────────────────────────────────────────────────────
function clientIp(req: Request): string {
  // cf-connecting-ip zet Cloudflare zelf; x-forwarded-for kan de bezoeker vervalsen (daarom ook de globale grens).
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip");
  return (ip ?? "onbekend").trim().slice(0, 64);
}
function deviceName(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  if (!os && !br) return `Onbekend apparaat (${ua.slice(0, 40) || "geen browserinfo"})`;
  return `${os ?? "Onbekend"} · ${br ?? "browser"}`;
}

// ── Meldingen ───────────────────────────────────────────────────────────────
async function notify(s: SB, title: string, message: string, priority: number, tags: string[]) {
  const { data: st } = await s.from("signal_settings").select("ntfy_topic, ntfy_server").eq("id", 1).maybeSingle();
  if (!st?.ntfy_topic) return;
  // Beveiliging gaat voor de stille uren; de klik opent Instellingen → Apparaten.
  const err = await publishNtfy(s, String(st.ntfy_server ?? "https://ntfy.sh"), {
    topic: st.ntfy_topic, title, message, priority, tags, click: `${APP_URL}?tab=settings`,
  });
  if (err) console.error("ntfy:", err);
}
async function sendEmail(to: string, subject: string, text: string): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return "geen e-maildienst ingesteld";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM") ?? "Xinix <onboarding@resend.dev>", to, subject, text }),
    });
    if (res.ok) return null;
    // De foutmelding van Resend noemt het adres van het account; dat hoort niet op het (openbare) inlogscherm.
    console.error("Resend:", res.status, await res.text());
    return res.status === 403 ? "de e-maildienst weigert dit adres (alleen testadres toegestaan)" : `de e-maildienst gaf fout ${res.status}`;
  } catch (e) {
    return `de e-maildienst is niet bereikbaar (${msg(e)})`;
  }
}

async function newDevice(req: Request, s: SB): Promise<{ token: string; device: Json }> {
  const ua = req.headers.get("user-agent") ?? "";
  const token = randomToken();
  const { data, error } = await s.from("xinix_auth_devices").insert({
    token_hash: await sha256Hex(token), name: deviceName(ua), user_agent: ua.slice(0, 400), ip: clientIp(req),
  }).select("id, name, created_at").single();
  if (error || !data) throw new Error(`apparaat opslaan: ${error?.message}`);
  return { token, device: data as Json };
}

// ── Acties ──────────────────────────────────────────────────────────────────
async function login(req: Request, s: SB, body: Json): Promise<Response> {
  const ip = clientIp(req), name = deviceName(req.headers.get("user-agent") ?? "");
  const now = Date.now(), since = new Date(now - HOUR).toISOString();
  const [{ data: mine }, { count: allFails }] = await Promise.all([
    s.from("xinix_auth_attempts").select("at").eq("ip", ip).eq("ok", false).gte("at", since).order("at", { ascending: false }).limit(MAX_FAILS),
    s.from("xinix_auth_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", since),
  ]);
  const fails = (mine ?? []) as Json[];
  if (fails.length >= MAX_FAILS) {
    return reply(req, { error: "locked", locked_until: new Date(Date.parse(String(fails[MAX_FAILS - 1].at)) + HOUR).toISOString() }, 429);
  }
  if ((allFails ?? 0) >= GLOBAL_MAX_FAILS) return reply(req, { error: "locked", locked_until: new Date(now + HOUR).toISOString() }, 429);

  const password = String(body.password ?? "");
  const { data: pw } = await s.from("xinix_auth_password").select("hash").eq("id", 1).maybeSingle();
  if (!pw?.hash) return reply(req, { error: "Er is nog geen wachtwoord ingesteld." }, 503);
  const ok = password.length > 0 && password.length <= 200 && await verifyPassword(password, String(pw.hash));
  await s.from("xinix_auth_attempts").insert({ ip, device: name, ok });

  if (!ok) {
    const n = fails.length + 1;
    const left = MAX_FAILS - n;
    if ((allFails ?? 0) < FAIL_NOTIFY_PER_HOUR) {
      await notify(s, "⚠️ Fout wachtwoord op Xinix",
        `${name} (IP ${ip}): poging ${n} van ${MAX_FAILS}.${left ? "" : " Dit adres kan nu een uur niet inloggen."} Was jij dit niet, dan probeert iemand anders binnen te komen.`,
        left ? 4 : 5, ["warning"]);
    }
    return left > 0
      ? reply(req, { error: "wrong", attempts_left: left }, 401)
      : reply(req, { error: "locked", locked_until: new Date(now + HOUR).toISOString() }, 429);
  }

  const created = await newDevice(req, s);
  await notify(s, "🔐 Nieuw apparaat ingelogd op Xinix",
    `${name} (IP ${ip}). Was jij dit niet? Trek het apparaat in bij Instellingen → Apparaten en vraag een nieuw wachtwoord aan.`, 4, ["lock"]);
  await s.from("xinix_auth_attempts").delete().lt("at", new Date(now - 90 * 24 * HOUR).toISOString());
  return reply(req, created);
}

async function check(req: Request, s: SB, body: Json): Promise<Response> {
  const token = String(body.token ?? "");
  if (token.length < 20) return reply(req, { ok: false }, 401);
  const { data: dev } = await s.from("xinix_auth_devices").select("id, name, last_seen_at, revoked_at")
    .eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!dev || dev.revoked_at) return reply(req, { ok: false }, 401);
  if (Date.now() - Date.parse(String(dev.last_seen_at)) > 10 * 60_000) {
    await s.from("xinix_auth_devices").update({ last_seen_at: new Date().toISOString(), ip: clientIp(req) }).eq("id", dev.id);
  }
  return reply(req, { ok: true, device: { id: dev.id, name: dev.name } });
}

async function logout(req: Request, s: SB, body: Json): Promise<Response> {
  const token = String(body.token ?? "");
  if (token.length >= 20) {
    await s.from("xinix_auth_devices").update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", await sha256Hex(token)).is("revoked_at", null);
  }
  return reply(req, { ok: true });
}

async function resetRequest(req: Request, s: SB): Promise<Response> {
  const { count } = await s.from("xinix_auth_resets").select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - HOUR).toISOString());
  if ((count ?? 0) >= RESET_PER_HOUR) {
    return reply(req, { error: `Er zijn het afgelopen uur al ${RESET_PER_HOUR} herstellinks verstuurd. Probeer het later opnieuw.` }, 429);
  }
  const token = randomToken();
  const { data: row, error } = await s.from("xinix_auth_resets").insert({
    token_hash: await sha256Hex(token), expires_at: new Date(Date.now() + HOUR).toISOString(),
  }).select("id").single();
  if (error || !row) return reply(req, { error: `opslaan mislukt: ${error?.message}` }, 500);

  const link = `${APP_URL}?reset=${token}`;
  const { data: st } = await s.from("signal_settings").select("email, ntfy_topic, ntfy_server").eq("id", 1).maybeSingle();
  let channel: "email" | "push" | null = null;
  let emailProblem: string | null = null;
  const email = String(st?.email ?? "").trim();
  if (email) {
    emailProblem = await sendEmail(email, "Xinix: nieuw wachtwoord instellen", [
      "Er is gevraagd om een nieuw wachtwoord voor Xinix.",
      "",
      "Klik binnen een uur op deze link om een nieuw wachtwoord in te stellen:",
      link,
      "",
      "Niet zelf aangevraagd? Dan kun je dit bericht negeren; je wachtwoord blijft hetzelfde.",
    ].join("\n"));
    if (!emailProblem) channel = "email";
  } else {
    emailProblem = "er is geen e-mailadres ingesteld";
  }
  if (!channel && st?.ntfy_topic) {
    const err = await publishNtfy(s, String(st.ntfy_server ?? "https://ntfy.sh"), {
      topic: st.ntfy_topic, title: "🔑 Xinix: nieuw wachtwoord instellen",
      message: `Tik op deze melding om een nieuw wachtwoord in te stellen; de link werkt een uur. Niet zelf aangevraagd? Negeer dit bericht. (Per e-mail lukte het niet: ${emailProblem}.)`,
      priority: 5, tags: ["key"], click: link,
    });
    if (!err) channel = "push";
  }
  if (!channel) {
    await s.from("xinix_auth_resets").delete().eq("id", row.id);
    return reply(req, { error: `Versturen mislukt: ${emailProblem}.` }, 502);
  }
  await s.from("xinix_auth_resets").update({ channel }).eq("id", row.id);
  const masked = channel === "email" ? email.replace(/^(.).*(@.*)$/, "$1***$2") : null;
  return reply(req, { ok: true, channel, to: masked, email_problem: channel === "push" ? emailProblem : null });
}

async function reset(req: Request, s: SB, body: Json): Promise<Response> {
  const token = String(body.reset_token ?? ""), password = String(body.password ?? "");
  if (password.length < MIN_PASSWORD) return reply(req, { error: `Kies een wachtwoord van minstens ${MIN_PASSWORD} tekens.` }, 400);
  if (password.length > 200) return reply(req, { error: "Dat wachtwoord is te lang." }, 400);
  const { data: r } = await s.from("xinix_auth_resets").select("id, expires_at, used_at").eq("token_hash", await sha256Hex(token)).maybeSingle();
  if (!r || r.used_at || Date.parse(String(r.expires_at)) < Date.now()) {
    return reply(req, { error: "Deze link is ongeldig of verlopen. Vraag op het inlogscherm een nieuwe aan." }, 400);
  }
  // Eenmalig: wie hem het eerst gebruikt, wint.
  const { data: claimed } = await s.from("xinix_auth_resets").update({ used_at: new Date().toISOString() })
    .eq("id", r.id).is("used_at", null).select("id");
  if (!claimed?.length) return reply(req, { error: "Deze link is al gebruikt." }, 400);
  const { error } = await s.from("xinix_auth_password").upsert({ id: 1, hash: await hashPassword(password), updated_at: new Date().toISOString() });
  if (error) return reply(req, { error: `opslaan mislukt: ${error.message}` }, 500);
  const created = await newDevice(req, s);
  await notify(s, "🔑 Xinix-wachtwoord gewijzigd",
    `Via een herstellink, op ${created.device.name} (IP ${clientIp(req)}). Andere apparaten blijven ingelogd; trek ze zo nodig in bij Instellingen → Apparaten.`,
    4, ["key"]);
  return reply(req, created);
}

async function devices(req: Request, s: SB): Promise<Response> {
  const [{ data: devs, error }, { data: fails }] = await Promise.all([
    s.from("xinix_auth_devices").select("id, name, user_agent, ip, created_at, last_seen_at, revoked_at")
      .order("last_seen_at", { ascending: false }).limit(200),
    s.from("xinix_auth_attempts").select("at, ip, device").eq("ok", false)
      .gte("at", new Date(Date.now() - 30 * 24 * HOUR).toISOString()).order("at", { ascending: false }).limit(20),
  ]);
  if (error) return reply(req, { error: error.message }, 500);
  return reply(req, { devices: devs ?? [], failures: fails ?? [] });
}

async function revoke(req: Request, s: SB, body: Json): Promise<Response> {
  const id = Number(body.id);
  if (!Number.isFinite(id)) return reply(req, { error: "id ontbreekt" }, 400);
  const { error } = await s.from("xinix_auth_devices").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null);
  if (error) return reply(req, { error: error.message }, 500);
  return reply(req, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { error: "POST verwacht" }, 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Json;
    const s = client();
    switch (body.action) {
      case "login": return await login(req, s, body);
      case "check": return await check(req, s, body);
      case "logout": return await logout(req, s, body);
      case "reset_request": return await resetRequest(req, s);
      case "reset": return await reset(req, s, body);
      case "devices": return isAdmin(req) ? await devices(req, s) : reply(req, { error: "beheertoken nodig" }, 401);
      case "revoke": return isAdmin(req) ? await revoke(req, s, body) : reply(req, { error: "beheertoken nodig" }, 401);
      default: return reply(req, { error: "onbekende actie" }, 400);
    }
  } catch (e) {
    return reply(req, { error: msg(e) }, 500);
  }
});
