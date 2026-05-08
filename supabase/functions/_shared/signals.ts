import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type Severity = "yellow" | "orange" | "red";

export const SEVERITY_RANK: Record<Severity, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
};

export interface SignalInput {
  ticker: string;
  signal_type: string;
  severity: Severity;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  expires_at?: string | null;
  dedup_key?: string;
}

/**
 * Insert a signal but skip if an identical (ticker, signal_type, payload->dedup_key) signal
 * exists in the last 24h. Returns the inserted signal id (or null if deduped).
 */
export async function insertSignal(
  supabase: SupabaseClient,
  s: SignalInput
): Promise<number | null> {
  const dedup = s.dedup_key ?? `${s.signal_type}:${s.ticker}`;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: existing } = await supabase
    .from("signal_events")
    .select("id")
    .eq("ticker", s.ticker)
    .eq("signal_type", s.signal_type)
    .gte("detected_at", since)
    .contains("payload", { dedup_key: dedup })
    .limit(1);

  if (existing && existing.length > 0) return null;

  const payload = { ...(s.payload ?? {}), dedup_key: dedup };
  const { data, error } = await supabase
    .from("signal_events")
    .insert({
      ticker: s.ticker,
      signal_type: s.signal_type,
      severity: s.severity,
      title: s.title,
      detail: s.detail ?? null,
      payload,
      expires_at: s.expires_at ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("insertSignal error", error);
    return null;
  }
  return data.id;
}
