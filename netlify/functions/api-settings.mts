import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

function checkAuth(req: Request): boolean {
  const required = Netlify.env.get("ADMIN_TOKEN");
  if (!required) return true; // no auth configured
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

export default async (req: Request) => {
  if (!checkAuth(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const supabase = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("signal_settings")
      .select("*")
      .eq("id", 1)
      .single();
    if (error) return new Response(error.message, { status: 500 });
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
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
    ];
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in body) update[k] = body[k];
    const { error } = await supabase
      .from("signal_settings")
      .update(update)
      .eq("id", 1);
    if (error) return new Response(error.message, { status: 500 });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/settings",
};
