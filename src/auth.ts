// Inlogpagina: een apparaat is bekend zolang het een apparaatsleutel heeft die
// de server (edge function xinix-auth) nog niet heeft ingetrokken. Los van het
// beheertoken: dat blijft nodig om te bewerken.
import { apiUrl, getToken } from "./api";

const DEVICE_KEY = "xinix_device_token_v1";
const DEVICE_ID_KEY = "xinix_device_id_v1";

export function getDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
export function getDeviceId(): number | null {
  try { const v = localStorage.getItem(DEVICE_ID_KEY); return v ? Number(v) : null; } catch { return null; }
}
function remember(token: string | null, id: number | null) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token); else localStorage.removeItem(DEVICE_KEY);
    if (id != null) localStorage.setItem(DEVICE_ID_KEY, String(id)); else localStorage.removeItem(DEVICE_ID_KEY);
  } catch { /* privémodus: dan vraagt hij steeds opnieuw */ }
}

async function call(body: Record<string, unknown>, admin = false): Promise<{ status: number; data: Record<string, unknown> }> {
  const t = admin ? getToken() : null;
  const res = await fetch(apiUrl("/api/xinix-auth"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked"; lockedUntil: string }
  | { ok: false; reason: "error"; message: string };

function stored(data: Record<string, unknown>): boolean {
  const token = data.token as string | undefined;
  const id = Number((data.device as { id?: number } | undefined)?.id);
  if (!token) return false;
  remember(token, Number.isFinite(id) ? id : null);
  return true;
}

export async function login(password: string): Promise<LoginResult> {
  try {
    const { status, data } = await call({ action: "login", password });
    if (status === 200 && stored(data)) return { ok: true };
    if (data.error === "wrong") return { ok: false, reason: "wrong", attemptsLeft: Number(data.attempts_left ?? 0) };
    if (data.error === "locked") return { ok: false, reason: "locked", lockedUntil: String(data.locked_until) };
    return { ok: false, reason: "error", message: String(data.error ?? `fout ${status}`) };
  } catch {
    return { ok: false, reason: "error", message: "De server is niet bereikbaar. Controleer je internetverbinding." };
  }
}

/** "invalid" = ingetrokken of onbekend; "unknown" = server niet bereikbaar (dan niet buitensluiten). */
export async function checkDevice(): Promise<"ok" | "invalid" | "unknown"> {
  const token = getDeviceToken();
  if (!token) return "invalid";
  try {
    const { status, data } = await call({ action: "check", token });
    if (status === 200 && data.ok) {
      const id = Number((data.device as { id?: number } | undefined)?.id);
      if (Number.isFinite(id)) remember(token, id);
      return "ok";
    }
    if (status === 401) { remember(null, null); return "invalid"; }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function logout(): Promise<void> {
  const token = getDeviceToken();
  remember(null, null);
  if (token) await call({ action: "logout", token }).catch(() => undefined);
}

export async function requestReset(): Promise<{ channel: "email" | "push"; to: string | null; emailProblem: string | null }> {
  const { status, data } = await call({ action: "reset_request" });
  if (status !== 200) throw new Error(String(data.error ?? `mislukt (${status})`));
  return { channel: data.channel as "email" | "push", to: (data.to as string) ?? null, emailProblem: (data.email_problem as string) ?? null };
}

export async function resetPassword(resetToken: string, password: string): Promise<void> {
  const { status, data } = await call({ action: "reset", reset_token: resetToken, password });
  if (status !== 200 || !stored(data)) throw new Error(String(data.error ?? `mislukt (${status})`));
}

export interface AuthDevice {
  id: number; name: string; user_agent: string | null; ip: string | null;
  created_at: string; last_seen_at: string; revoked_at: string | null;
}
export interface AuthFailure { at: string; ip: string | null; device: string | null }

export async function fetchDevices(): Promise<{ devices: AuthDevice[]; failures: AuthFailure[] }> {
  const { status, data } = await call({ action: "devices" }, true);
  if (status !== 200) throw new Error(String(data.error ?? `mislukt (${status})`));
  return { devices: (data.devices as AuthDevice[]) ?? [], failures: (data.failures as AuthFailure[]) ?? [] };
}

export async function revokeDevice(id: number): Promise<void> {
  const { status, data } = await call({ action: "revoke", id }, true);
  if (status !== 200) throw new Error(String(data.error ?? `mislukt (${status})`));
}
