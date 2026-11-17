// Leestoegang tot de API: alleen apparaten die via het inlogscherm (xinix-auth) zijn ingelogd en
// niet zijn ingetrokken, plus het beheertoken en pg_cron. Het inlogscherm hield vreemden al buiten
// de site; dit houdt ze ook buiten de functies erachter, zodat de koersen en scores van Yahoo en
// TradingView niet openbaar op te vragen zijn.
//
// De site stuurt de apparaatsleutel mee als ?device=… (src/api.ts → apiUrl). Een parameter in plaats
// van een header, omdat een eigen header bij elke functie een CORS-wijziging zou vragen; de kop
// x-xinix-device mag ook. Opgeslagen staat alleen de sha256 van de sleutel (xinix_auth_devices).

const enc = new TextEncoder();
const TTL_MS = 5 * 60_000; // een ingetrokken apparaat is hoogstens 5 minuten later buitengesloten
const known = new Map<string, number>(); // sha256 → geldig tot

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function adminOrCron(req: Request): boolean {
  const admin = Deno.env.get("ADMIN_TOKEN"), cron = Deno.env.get("CRON_SECRET");
  return (!!admin && (req.headers.get("authorization") ?? "") === `Bearer ${admin}`) ||
    (!!cron && (req.headers.get("x-cron-secret") ?? "") === cron);
}

export function deviceToken(req: Request): string {
  return req.headers.get("x-xinix-device") ?? new URL(req.url).searchParams.get("device") ?? "";
}

/** "ok" = ingelogd apparaat, beheertoken of cron; "nee" = onbekend of ingetrokken; "storing" = niet na te gaan. */
export async function deviceStatus(req: Request): Promise<"ok" | "nee" | "storing"> {
  if (adminOrCron(req)) return "ok";
  const token = deviceToken(req);
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return "nee";
  const hash = await sha256Hex(token);
  if ((known.get(hash) ?? 0) > Date.now()) return "ok";
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "storing";
  try {
    const res = await fetch(`${url}/rest/v1/xinix_auth_devices?select=id&token_hash=eq.${hash}&revoked_at=is.null&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "storing";
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      known.set(hash, Date.now() + TTL_MS);
      return "ok";
    }
    known.delete(hash);
    return "nee";
  } catch {
    return "storing";
  }
}

/** null = doorgaan; anders het antwoord dat de functie meteen teruggeeft (met de CORS-koppen van die functie). */
export async function requireDevice(req: Request, cors: Record<string, string>): Promise<Response | null> {
  const s = await deviceStatus(req);
  if (s === "ok") return null;
  const body = s === "nee"
    ? { error: "Niet ingelogd: open Xinix en log in op dit apparaat." }
    : { error: "Het apparaat kon even niet worden gecontroleerd. Probeer het zo opnieuw." };
  return new Response(JSON.stringify(body), {
    status: s === "nee" ? 401 : 503,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
}
