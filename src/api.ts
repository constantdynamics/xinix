import type { Dashboard, Settings, Health } from "./types";

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

// `fresh` omzeilt de browser-cache (voor de handmatige "vernieuw"-knop);
// een gewone pagina-load gebruikt de cache zodat herladen snel is.
export async function fetchDashboard(fresh = false): Promise<Dashboard> {
  const res = await fetch(apiUrl("/api/dashboard"), fresh ? { cache: "reload" } : undefined);
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return (await res.json()) as Dashboard;
}

export type PriceRange = "1d" | "5d" | "1mo" | "1y" | "5y" | "max";
export interface PricePoint { t: number; c: number; }
export interface PriceHistory {
  ticker: string;
  range: PriceRange;
  currency: string | null;
  exchange: string | null;
  previous_close: number | null;
  market_price: number | null;
  points: PricePoint[];
}
export async function fetchPriceHistory(ticker: string, range: PriceRange): Promise<PriceHistory> {
  const res = await fetch(apiUrl(`/api/price-history?ticker=${encodeURIComponent(ticker)}&range=${range}`));
  if (!res.ok) throw new Error(`price-history ${res.status}`);
  return (await res.json()) as PriceHistory;
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
  sector?: "biotech" | "mining" | "other";
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

// Bench-beheer (round-robin price-poll). Een ticker die 3x faalt bij
// het scannen gaat 'op de bank'; deze functies halen 'm er weer af.
export async function unbenchTicker(ticker: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/api/tickers?ticker=${encodeURIComponent(ticker)}`),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ unbench: true }),
    }
  );
  if (!res.ok) throw new Error(`unbench ${res.status}: ${await res.text()}`);
}

export async function unbenchAll(): Promise<{ unbenched: number }> {
  const res = await fetch(apiUrl("/api/tickers?action=unbench-all"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: "{}",
  });
  if (!res.ok) throw new Error(`unbench-all ${res.status}: ${await res.text()}`);
  return (await res.json()) as { unbenched: number };
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

export async function fetchHealth(): Promise<Health> {
  const res = await fetch(apiUrl("/api/health"));
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

export interface SignalEpisode {
  ticker: string;
  sector: string;
  peak_action: "STRONG_BUY" | "BUY";
  start_date: string;
  end_date: string;
  is_active: boolean;
  signal_days: number;
  peak_score: number;
  entry_price: number | null;
  current_price: number | null;
  return_pct: number | null;
}

export interface SignalLog {
  episodes: SignalEpisode[];
  as_of: string;
  days_back: number;
}

export async function fetchSignalLog(days = 180): Promise<SignalLog> {
  const res = await fetch(apiUrl(`/api/signal-log?days=${days}`));
  if (!res.ok) throw new Error(`signal-log ${res.status}`);
  return (await res.json()) as SignalLog;
}

export interface ScanTicker {
  ticker: string;
  company: string | null;
  sector: string | null;
  medal_gold: number | null;
  medal_silver: number | null;
  medal_bronze: number | null;
  notes: string | null;
  created_at: string;
  exchange: string | null;
  active: boolean | null;
  buy_limit: number | null;
  last_close: number | null;
  is_phoenix: boolean | null;
  source: "losers" | "bottoms" | "unknown";
}

export interface PhoenixRankEntry {
  ticker: string;
  company: string | null;
  sector: string | null;
  medal_gold: number | null;
  medal_silver: number | null;
  medal_bronze: number | null;
  buy_limit: number | null;
  last_close: number | null;
  exchange: string | null;
  above_limit_pct: number | null;
  phoenix_50x_date: string | null;
  phoenix_incident_count: number | null;
  phoenix_median_date: string | null;
  phoenix_max_growth_180d_pct: number | null;
  phoenix_days_to_50x: number | null;
}

export interface ScanRun {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  message: string | null;
  metrics: Record<string, unknown> | null;
}

export interface PoefieRankEntry {
  ticker: string;
  company: string | null;
  sector: string | null;
  medal_gold: number | null;
  medal_silver: number | null;
  medal_bronze: number | null;
  buy_limit: number | null;
  last_close: number | null;
  exchange: string | null;
  above_limit_pct: number | null;
  poefie_last_date: string | null;
  poefie_incident_count: number | null;
  poefie_median_date: string | null;
  poefie_max_growth_pct: number | null;
  poefie_days_to_peak: number | null;
  poefie_count_6m: number | null;
  poefie_count_1y: number | null;
  poefie_count_2y: number | null;
  poefie_count_5y: number | null;
}

export interface HikkertjeRankEntry {
  ticker: string;
  company: string | null;
  sector: string | null;
  medal_gold: number | null;
  medal_silver: number | null;
  medal_bronze: number | null;
  buy_limit: number | null;
  last_close: number | null;
  exchange: string | null;
  hikkertje_spikes: number | null;
  above_limit_pct: number | null;
}

export interface ScanResults {
  tickers: ScanTicker[];
  runs: { "scan-losers": ScanRun[]; "scan-bottoms": ScanRun[] };
  phoenix_ranking: PhoenixRankEntry[];
  phoenix_count: number;
  phoenix_unscanned: number;
  hikkertje_ranking: HikkertjeRankEntry[];
  hikkertje_count: number;
  hikkertje_unscanned: number;
  poefie_ranking: PoefieRankEntry[];
  poefie_count: number;
  poefie_unscanned: number;
}

export async function fetchScanResults(): Promise<ScanResults> {
  const res = await fetch(apiUrl("/api/scan-results"));
  if (!res.ok) throw new Error(`scan-results ${res.status}`);
  return (await res.json()) as ScanResults;
}

export interface ZwitserlevenStock {
  ticker: string;
  company: string | null;
  exchange: string | null;
  country: string | null;
  sector: string | null;
  last_close: number | null;
  currency: string | null;
  dividend_yield_pct: number | null;
  annual_dividend: number | null;
  high_5y: number | null;
  pct_under_5y_high: number | null;
  max_annual_gain_5y: number | null;
  years_5pct_growth_5y: number | null;
  payout_ratio: number | null;
  dividend_cuts_5y: number | null;
  risk_label: string | null;
  meets_criteria: boolean | null;
  scanned_at: string | null;
  div_yield_y1: number | null;
  div_yield_y2: number | null;
  div_yield_y3: number | null;
  div_yield_y4: number | null;
  div_yield_y5: number | null;
  is_manual: boolean | null;
}

export interface ZwitserlevenResults {
  stocks: ZwitserlevenStock[];
  total_scanned: number;
  meets_criteria_count: number;
  manual_count?: number;
  unscanned_count: number;
  universe_size?: number;
  universe_scanned?: number;
}

export async function fetchZwitserlevenResults(): Promise<ZwitserlevenResults> {
  const res = await fetch(apiUrl("/api/zwitserleven-results"));
  if (!res.ok) throw new Error(`zwitserleven-results ${res.status}`);
  return (await res.json()) as ZwitserlevenResults;
}

// Handmatig toevoegen + force-scan van één ticker.
// Vereist admin-token. Voegt ticker toe aan watchlist als hij nog niet bestaat.
export async function addZwitserlevenManual(ticker: string): Promise<{ ok: boolean; message?: string }> {
  const t = ticker.trim().toUpperCase();
  if (!t) throw new Error("Ticker vereist");
  const res = await fetch(
    apiUrl(`/api/compute-zwitserleven-background?ticker=${encodeURIComponent(t)}&manual=1`),
    { method: "POST", headers: authHeaders() }
  );
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return { ok: json.ok === true, message: json.message };
}

// Verwijder een Zwitserleven-rij uit de tabel (handig voor foutieve handmatige toevoegingen).
// Vereist admin-token.
export async function removeZwitserlevenStock(ticker: string): Promise<{ ok: boolean; message?: string }> {
  const t = ticker.trim().toUpperCase();
  if (!t) throw new Error("Ticker vereist");
  const res = await fetch(
    apiUrl(`/api/compute-zwitserleven-background?ticker=${encodeURIComponent(t)}&delete=1`),
    { method: "POST", headers: authHeaders() }
  );
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return { ok: json.ok === true, message: json.message };
}

// ── UI settings (tab-aanpassingen) ───────────────────────────────────────────
// Per-tab kolominstelling: volgorde van kolom-keys + welke verborgen zijn.
export interface TableColumnPref {
  order: string[];
  hidden: string[];
}

export interface UiSettings {
  id: number;
  tab_order: string[];
  tab_labels: Record<string, string>;
  tab_hidden: string[];
  table_columns: Record<string, TableColumnPref>;
  updated_at: string;
}

export async function fetchUiSettings(): Promise<UiSettings> {
  const res = await fetch(apiUrl("/api/ui-settings"));
  if (!res.ok) throw new Error(`ui-settings ${res.status}`);
  return (await res.json()) as UiSettings;
}

export async function saveUiSettings(s: Partial<UiSettings>): Promise<UiSettings> {
  const res = await fetch(apiUrl("/api/ui-settings"), {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error(`ui-settings save ${res.status}: ${await res.text()}`);
  return (await res.json()) as UiSettings;
}

// ── Xinix paper portfolio ──
export interface XinixOpenPosition {
  id: number;
  ticker: string;
  company: string | null;
  exchange: string | null;
  sector: string | null;
  qty: number;
  avg_price: number;
  current_price: number | null;
  cost_basis: number;
  market_value: number | null;
  unrealized_usd: number | null;
  unrealized_pct: number | null;
  entry_date: string;
  scheduled_exit_date: string;
  days_remaining: number;
  stop_loss_price: number | null;
  entry_reason: string;
  entry_signal_types: string[];
  entry_score: number | null;
}

export interface XinixClosedPosition {
  id: number;
  ticker: string;
  company: string | null;
  qty: number;
  avg_price: number;
  closed_price: number;
  return_usd: number;
  return_pct: number;
  entry_date: string;
  closed_at: string;
  hold_days: number;
  entry_reason: string;
  closed_reason: string;
  entry_signal_types: string[];
  entry_sector: string | null;
}

export interface XinixSignalInsight {
  signal_type: string;
  closed_count: number;
  wins: number;
  win_rate: number;
  avg_return_pct: number;
  total_return_usd: number;
}

export interface XinixSectorInsight {
  sector: string;
  closed_count: number;
  wins: number;
  win_rate: number;
  avg_return_pct: number;
  total_return_usd: number;
}

export interface XinixEquityPoint {
  date: string;
  cash: number;
  positions_value: number;
  total_equity: number;
  positions_count: number;
}

export interface XinixPortfolio {
  state: {
    cash: number;
    initial_capital: number;
    started_at: string;
    last_run_at: string | null;
    total_equity: number;
    positions_value: number;
    total_return_usd: number;
    total_return_pct: number;
    realized_usd: number;
    unrealized_usd: number;
    open_count: number;
    closed_count: number;
  };
  open_positions: XinixOpenPosition[];
  closed_positions: XinixClosedPosition[];
  equity_history: XinixEquityPoint[];
  signal_insights: XinixSignalInsight[];
  sector_insights: XinixSectorInsight[];
  recommendations: string[];
}

export async function fetchXinixPortfolio(): Promise<XinixPortfolio> {
  const res = await fetch(apiUrl("/api/xinix-portfolio"));
  if (!res.ok) throw new Error(`xinix-portfolio ${res.status}`);
  return (await res.json()) as XinixPortfolio;
}

// ── Xinix strategie-simulatie (Potje) ──
export interface SimPosDetail {
  ticker: string;
  entry_signal_types: string[];
  entry_sector: string | null;
  entry_date: string;
  entry_reason: string;
  return_pct?: number;
  closed_at?: string;
  closed_reason?: string;
}

export interface SimStrategyConfig {
  minScore: number;
  redReq: boolean;
  sector: "all" | "biotech" | "mining";
  maxPos: number;
  posSize: number;
  holdDays: number;
  stop: number | null;
  tp: number | null;
  limitBuf: number | null;
  minGold: number;
}

export interface SimStrategy {
  id: number;
  slug: string;
  name: string;
  grp: string;
  config: SimStrategyConfig;
  generation: number;
  protected: boolean;
  parent_id: number | null;
  rank: number;
  medal: string | null;
  total_equity: number;
  total_return_pct: number;
  total_return_usd: number;
  realized_usd: number;
  open_count: number;
  closed_count: number;
  win_rate: number;
  avg_return_pct: number;
  // Aandeel gesloten posities met return ≥ N% (0..1). Optioneel — oude
  // edge functions sturen ze nog niet, frontend valt dan terug op 0.
  win_rate_5pct?: number;
  win_rate_10pct?: number;
  win_rate_25pct?: number;
  win_rate_50pct?: number;
  win_rate_100pct?: number;
  // Aandeel equity-snapshots waarop de portefeuille positief stond (0..1).
  positive_days_pct?: number;
  total_days?: number;
  // Distributie-metrics
  median_return_pct?: number;
  best_trade_pct?: number;
  worst_trade_pct?: number;
  profit_factor?: number;
  expectancy_pct?: number;
  // Universum & capture
  unique_tickers?: number;
  phoenix_captured?: number;
  hikkertje_captured?: number;
  poefie_captured?: number;
  // Medaille-trades (huidige medaille-stand op gesloten ticker als proxy)
  gold_trades?: number;
  silver_trades?: number;
  bronze_trades?: number;
  // Exit-strategie breakdown
  exit_reasons?: SimExitReason[];
  partial_count?: number;
  partial_avg_qty_pct?: number;
  partial_total_usd?: number;
  last_run_at: string | null;
  open_pos_detail: SimPosDetail[];
  closed_pos_detail: SimPosDetail[];
}

export interface SimExitReason {
  reason: string;
  count: number;
  avg_return_pct: number;
  sum_usd: number;
}

export interface SimDimensionEntry {
  value: string;
  count: number;
  avgRet: number;
}

export interface SimInsight {
  dimension: string;
  best: string;
  worst: string;
  diff: number;
  entries: SimDimensionEntry[];
}

export interface SimSignalTypeStat {
  signal_type: string;
  count: number;
  win_rate: number;
  avg_return_pct: number;
}

export interface SimRetired {
  id: number;
  slug: string;
  name: string;
  grp: string;
  generation: number;
  retired_at: string;
  holdDays: number;
  sector: string;
}

export interface SimEvolution {
  cycles: number;
  max_generation: number;
  protected_count: number;
  last_at: string | null;
  cycle_start: string | null;
  next_approx: string | null;
  retired: SimRetired[];
  run_log: { at: string; message: string }[];
}

export interface SimFamilyPoint {
  date: string;
  avg_return_pct: number | null;
  n: number;
}
export interface SimFamily {
  grp: string;
  n: number;
  avg_return_pct: number;
  best_return_pct: number | null;
  best_slug: string | null;
  worst_return_pct: number | null;
  worst_slug: string | null;
  series: SimFamilyPoint[];
}
export interface SimResults {
  strategies: SimStrategy[];
  insights: SimInsight[];
  recommendations: string[];
  signal_type_stats?: SimSignalTypeStat[];
  families?: { groups: SimFamily[]; dates: string[] };
  meta: {
    total: number;
    last_run_at: string | null;
    strategies_with_closed_positions: number;
  };
  evolution: SimEvolution;
}

export async function fetchSimResults(): Promise<SimResults> {
  const res = await fetch(apiUrl("/api/xinix-sim-results"));
  if (!res.ok) throw new Error(`xinix-sim-results ${res.status}`);
  return (await res.json()) as SimResults;
}

// ── Xinix kennisexport ──

export interface KnowledgeExportSummary {
  id: number;
  exported_at: string;
  period_start: string | null;
  period_end: string | null;
  type: string;
  strategy_count: number | null;
  ticker_count: number | null;
  closed_positions_count: number | null;
  open_positions_count: number | null;
  best_strategy_name: string | null;
  best_strategy_return: number | null;
  worst_strategy_name: string | null;
  worst_strategy_return: number | null;
  avg_portfolio_return: number | null;
  strategies_in_profit: number | null;
  evolution_cycles: number | null;
  summary: string | null;
}

export interface KnowledgeExportList {
  exports: KnowledgeExportSummary[];
}

export async function fetchKnowledgeExports(): Promise<KnowledgeExportList> {
  const res = await fetch(apiUrl("/api/xinix-knowledge-export"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`knowledge-export list ${res.status}`);
  return (await res.json()) as KnowledgeExportList;
}

export async function triggerKnowledgeExport(): Promise<{ ok: boolean; export_id: number | null; strategy_count: number; ticker_count: number; closed_positions_count: number }> {
  const res = await fetch(apiUrl("/api/xinix-knowledge-export"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: "{}",
  });
  if (!res.ok) throw new Error(`knowledge-export ${res.status}: ${await res.text()}`);
  return res.json();
}

export function knowledgeExportDownloadUrl(id: number): string {
  return apiUrl(`/api/xinix-knowledge-export?id=${id}`);
}

export async function triggerEvolve(force = false): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
  if (force) headers["x-force-evolve"] = "1";
  const res = await fetch(apiUrl("/api/xinix-evolve-background"), { method: "POST", headers, body: "{}" });
  if (!res.ok) throw new Error(`evolve ${res.status}`);
  return res.json();
}

// Markeringen per ticker: favoriet (hartje) en gezien (verrekijker).
// Bewaard in de DB (xinix_favorites / xinix_seen) zodat ze cross-device zijn.
export type MarkKind = "favorite" | "seen";

export interface MarksResponse {
  favorites: string[];
  seen: string[];
  ratings?: Record<string, number>;
}

export async function fetchMarks(): Promise<MarksResponse> {
  const res = await fetch(apiUrl("/api/marks"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`marks ${res.status}`);
  return (await res.json()) as MarksResponse;
}

export async function addMark(kind: MarkKind, ticker: string): Promise<void> {
  const res = await fetch(apiUrl("/api/marks"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ kind, ticker }),
  });
  if (!res.ok) throw new Error(`add mark ${res.status}: ${await res.text()}`);
}

export async function removeMark(kind: MarkKind, ticker: string): Promise<void> {
  const res = await fetch(apiUrl("/api/marks"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ kind, ticker }),
  });
  if (!res.ok) throw new Error(`remove mark ${res.status}: ${await res.text()}`);
}

export async function addMarksBulk(kind: MarkKind, tickers: string[]): Promise<void> {
  if (tickers.length === 0) return;
  const res = await fetch(apiUrl("/api/marks"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ kind, tickers }),
  });
  if (!res.ok) throw new Error(`bulk add mark ${res.status}: ${await res.text()}`);
}

// ── Apparaat-koppeling ───────────────────────────────────────────────
// Favorieten/markeringen staan server-side, maar een apparaat ziet ze
// pas na invoer van het admin-token. Een koppelcode laat de telefoon
// het token ophalen zonder het over te typen.
export interface PairingCode { code: string; expires_at: string; ttl_minutes: number }

// Laptop-kant: genereer een kortlevende koppelcode (vereist admin-token).
export async function createPairingCode(): Promise<PairingCode> {
  const res = await fetch(apiUrl("/api/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ action: "create" }),
  });
  if (!res.ok) throw new Error(`koppelcode aanmaken mislukt (${res.status})`);
  return (await res.json()) as PairingCode;
}

// Telefoon-kant: wissel een koppelcode in voor het admin-token.
export async function redeemPairingCode(code: string): Promise<string> {
  const res = await fetch(apiUrl("/api/pair"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "redeem", code }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 404 || res.status === 400
        ? "Code ongeldig of verlopen"
        : `koppelen mislukt (${res.status})`,
    );
  }
  return ((await res.json()) as { token: string }).token;
}

export async function setFavoriteRating(ticker: string, rating: number | null): Promise<void> {
  const res = await fetch(apiUrl("/api/marks"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ kind: "favorite", ticker, rating }),
  });
  if (!res.ok) throw new Error(`rate favorite ${res.status}: ${await res.text()}`);
}

// ── Volledige data-export ────────────────────────────────────────────
// Wekelijkse, zelf-beschrijvende export van alle waardevolle data — voor
// kennisbehoud als de site ooit verdwijnt.
export interface DataExportResult { ok: boolean; total_rows: number; github_committed: boolean }

// Maak nu een nieuwe export (vereist admin-token).
export async function runDataExport(): Promise<DataExportResult> {
  const res = await fetch(apiUrl("/api/xinix-full-export"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  if (!res.ok) throw new Error(`export starten mislukt (${res.status})`);
  return (await res.json()) as DataExportResult;
}

// Download de laatste export als JSON-bestand.
export async function downloadDataExport(): Promise<void> {
  const res = await fetch(apiUrl("/api/xinix-full-export"), { headers: authHeaders() });
  if (res.status === 404) throw new Error("Er is nog geen export beschikbaar — klik eerst op 'Export nu'.");
  if (!res.ok) throw new Error(`export ophalen mislukt (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `xinix-data-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
