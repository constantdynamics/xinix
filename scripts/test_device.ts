// Test van de inlogcontrole van de API (supabase/functions/_shared/device.ts) met een nagebootste database.
// Draaien: deno run --allow-env --no-config scripts/test_device.ts
import { deviceStatus, requireDevice } from "../supabase/functions/_shared/device.ts";

Deno.env.set("ADMIN_TOKEN", "adm-secret");
Deno.env.set("CRON_SECRET", "cron-secret");
Deno.env.set("SUPABASE_URL", "https://proj.example");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc");

const GOOD = "A".repeat(43), GOOD2 = "B".repeat(43), BAD = "C".repeat(43);
async function sha(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const goodHashes = new Set([await sha(GOOD), await sha(GOOD2)]);
let calls: string[] = [];
let mode: "ok" | "500" | "throw" = "ok";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = String(input);
  calls.push(u);
  if (mode === "throw") throw new TypeError("netwerk weg");
  if (mode === "500") return new Response("boom", { status: 500 });
  const h = new URL(u).searchParams.get("token_hash")!.replace(/^eq\./, "");
  if ((init?.headers as Record<string, string>)?.apikey !== "svc") throw new Error("geen apikey");
  return new Response(JSON.stringify(goodHashes.has(h) ? [{ id: 1 }] : []), { status: 200 });
}) as typeof fetch;

const req = (q = "", headers: Record<string, string> = {}) => new Request(`https://x/functions/v1/dashboard${q}`, { headers });
let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FOUT"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (verwacht ${JSON.stringify(want)})`}`);
};

eq("beheertoken", await deviceStatus(req("", { authorization: "Bearer adm-secret" })), "ok");
eq("fout beheertoken", await deviceStatus(req("", { authorization: "Bearer nee" })), "nee");
eq("cron", await deviceStatus(req("", { "x-cron-secret": "cron-secret" })), "ok");
eq("zonder sleutel", await deviceStatus(req()), "nee");
eq("rare sleutel", await deviceStatus(req("?device=kort")), "nee");
eq("rare tekens", await deviceStatus(req("?device=" + encodeURIComponent("A".repeat(30) + "'; drop"))), "nee");
calls = [];
eq("geldige sleutel (parameter)", await deviceStatus(req(`?ticker=X&device=${GOOD}`)), "ok");
eq("1 opvraging", calls.length, 1);
eq("vraagt id, hash en niet-ingetrokken", calls[0].includes("select=id") && calls[0].includes("revoked_at=is.null") && calls[0].includes(`token_hash=eq.${await sha(GOOD)}`), true);
eq("tweede keer uit het geheugen", await deviceStatus(req(`?device=${GOOD}`)), "ok");
eq("nog steeds 1 opvraging", calls.length, 1);
eq("geldige sleutel (kop)", await deviceStatus(req("", { "x-xinix-device": GOOD2 })), "ok");
eq("onbekende sleutel", await deviceStatus(req(`?device=${BAD}`)), "nee");
mode = "500";
eq("database 500", await deviceStatus(req(`?device=${BAD}`)), "storing");
mode = "throw";
eq("netwerkfout", await deviceStatus(req(`?device=${BAD}`)), "storing");
eq("bekende sleutel blijft werken bij storing (geheugen)", await deviceStatus(req(`?device=${GOOD}`)), "ok");
mode = "ok";
const cors = { "access-control-allow-origin": "https://constantdynamics.github.io", vary: "origin" };
const r401 = await requireDevice(req(`?device=${BAD}`), cors);
eq("401 status", r401?.status, 401);
eq("401 cors", r401?.headers.get("access-control-allow-origin"), "https://constantdynamics.github.io");
eq("401 tekst", (await r401!.json()).error, "Niet ingelogd: open Xinix en log in op dit apparaat.");
mode = "500";
const r503 = await requireDevice(req(`?device=${BAD}`), cors);
eq("503 status", r503?.status, 503);
mode = "ok";
eq("doorlaten", await requireDevice(req(`?device=${GOOD}`), cors), null);
Deno.env.delete("SUPABASE_URL");
eq("zonder env: storing", await deviceStatus(req(`?device=${BAD}`)), "storing");
if (fails) { console.log(`${fails} FOUT`); Deno.exit(1); }
console.log("alles ok");
