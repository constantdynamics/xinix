import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  const supabase = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("signal_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, data);
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;
    const allowed = [
      "email",
      "ntfy_topic",
      "ntfy_server",
      "alert_email_threshold",
      "alert_ntfy_threshold",
      "quiet_hours_start",
      "quiet_hours_end",
      "alert_only_goud_events",
      "notify_cooldown_days",
      "limit_suggest_pct",
    ];
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const k of allowed) if (k in body) update[k] = body[k];
    // NOT NULL-kolom: leeg veld in de UI betekent "uit", niet "kapot".
    if ("notify_cooldown_days" in update) {
      const n = Number(update.notify_cooldown_days);
      update.notify_cooldown_days = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }
    // NOT NULL-kolom; leeg veld = "geen opslag boven de 5y-bodem".
    if ("limit_suggest_pct" in update) {
      const n = Number(update.limit_suggest_pct);
      update.limit_suggest_pct = Number.isFinite(n) ? Math.min(200, Math.max(0, n)) : 0;
    }
    const { error } = await supabase
      .from("signal_settings")
      .update(update)
      .eq("id", 1);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
