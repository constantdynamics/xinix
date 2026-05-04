import type { Dashboard, Settings } from "./types";

const TOKEN_KEY = "biotech_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function fetchDashboard(): Promise<Dashboard> {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return (await res.json()) as Dashboard;
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch("/api/settings", { headers: authHeaders() });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return (await res.json()) as Settings;
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error(`settings save ${res.status}`);
}

export interface TickerInput {
  ticker: string;
  company: string;
  sector?: "biotech" | "mining";
  goud_score?: number;
  goud_type?: string;
  trigger_event?: string;
  trigger_date?: string;
  modality?: string;
  disease_area?: string;
  phase?: string;
  commodity?: string;
  jurisdiction?: string;
  deposit_type?: string;
  share_count_millions?: number;
}

export async function addTicker(payload: TickerInput): Promise<void> {
  const res = await fetch("/api/tickers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`add ticker ${res.status}: ${await res.text()}`);
}

export async function batchAddTickers(rows: TickerInput[]): Promise<{ inserted: number }> {
  const res = await fetch("/api/tickers", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`batch add ${res.status}: ${await res.text()}`);
  return (await res.json()) as { inserted: number };
}

export async function removeTicker(ticker: string): Promise<void> {
  const res = await fetch(
    `/api/tickers?ticker=${encodeURIComponent(ticker)}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`remove ticker ${res.status}`);
}

export async function triggerJob(job: string): Promise<void> {
  const res = await fetch(`/api/trigger?job=${encodeURIComponent(job)}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`trigger ${res.status}: ${await res.text()}`);
}
