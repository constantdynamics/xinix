import type { Dashboard, Settings } from "./types";

const TOKEN_KEY = "biotech_admin_token";

// Frontend op GitHub Pages, backend op Supabase Edge Functions.
// `VITE_API_BASE_URL` op build-time = bv. https://<project>.supabase.co/functions/v1
// Supabase function paden hebben geen `/api` prefix; we strippen die hier
// automatisch zodat de call sites in de UI nog gewoon `/api/dashboard`
// kunnen schrijven (handig voor lokaal Netlify dev en herkenbaarheid).
//
// Leeg laten = same-origin met `/api/*` redirect (oude Netlify hosting).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export function apiUrl(path: string): string {
  if (path.startsWith("http")) return path;
  if (!API_BASE) return path;
  // Strip "/api" prefix wanneer we naar Supabase wijzen — daar zijn de
  // functies bv. https://x.supabase.co/functions/v1/dashboard zonder /api.
  const stripped = path.replace(/^\/api\//, "/");
  return `${API_BASE}${stripped}`;
}

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
  const res = await fetch(apiUrl("/api/dashboard"));
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return (await res.json()) as Dashboard;
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch(apiUrl("/api/settings"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return (await res.json()) as Settings;
}

export async function saveSettings(s: Partial<Settings>): Promise<void> {
  const res = await fetch(apiUrl("/api/settings"), {
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
  buy_limit?: number | null;
}

export async function addTicker(payload: TickerInput): Promise<void> {
  const res = await fetch(apiUrl("/api/tickers"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`add ticker ${res.status}: ${await res.text()}`);
}

export async function batchAddTickers(
  rows: TickerInput[]
): Promise<{ inserted: number }> {
  const res = await fetch(apiUrl("/api/tickers"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`batch add ${res.status}: ${await res.text()}`);
  return (await res.json()) as { inserted: number };
}

export async function patchTicker(
  ticker: string,
  patch: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/tickers?ticker=${encodeURIComponent(ticker)}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok)
    throw new Error(`patch ticker ${res.status}: ${await res.text()}`);
}

export async function removeTicker(ticker: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/tickers?ticker=${encodeURIComponent(ticker)}`),
    { method: "DELETE", headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`remove ticker ${res.status}`);
}

export async function batchRemoveTickers(
  tickers: string[]
): Promise<{ removed: string[]; failed: { ticker: string; error: string }[] }> {
  const removed: string[] = [];
  const failed: { ticker: string; error: string }[] = [];
  // Sequentieel om de admin endpoint niet te overspoelen — mutates 1 row each.
  for (const t of tickers) {
    try {
      await removeTicker(t);
      removed.push(t);
    } catch (e) {
      failed.push({ ticker: t, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { removed, failed };
}

export interface LookupResult {
  ticker: string;
  input_ticker?: string; // origineel zoals user 'm typte
  recognized: boolean;
  company: string | null;
  currency: string | null;
  exchange: string | null;
  error?: string;
}

export interface LookupHint {
  ticker: string;
  name?: string;
  currency?: string;
}

export async function lookupTickers(
  tickers: string[] | LookupHint[]
): Promise<LookupResult[]> {
  if (tickers.length === 0) return [];
  const res = await fetch(apiUrl("/api/ticker-lookup"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tickers }),
  });
  if (!res.ok) throw new Error(`lookup ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { results: LookupResult[] };
  return j.results;
}

export async function triggerJob(job: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/trigger?job=${encodeURIComponent(job)}`),
    {
      method: "POST",
      headers: authHeaders(),
    }
  );
  if (!res.ok) throw new Error(`trigger ${res.status}: ${await res.text()}`);
}
