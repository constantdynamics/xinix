// ui-settings — single-row config voor UI-aanpassingen (tab-volgorde, labels, verborgen tabs).
// GET = openbaar (frontend leest bij elke load). POST/PUT = vereist admin-token.

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

interface UiSettings {
  id: number;
  tab_order: string[];
  tab_labels: Record<string, string>;
  tab_hidden: string[];
  updated_at: string;
}

function defaults(): UiSettings {
  return {
    id: 1,
    tab_order: [],
    tab_labels: {},
    tab_hidden: [],
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  const sb = getServiceClient();

  if (req.method === "GET") {
    const { data, error } = await sb
      .from("xinix_ui_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, data ?? defaults());
  }

  if (req.method !== "POST" && req.method !== "PUT") {
    return textResponse(req, "Method not allowed", { status: 405 });
  }

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Partial<UiSettings>;

  // Whitelist + validatie. Onbekende velden negeren we.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Array.isArray(body.tab_order)) {
    update.tab_order = body.tab_order.filter((x): x is string => typeof x === "string").slice(0, 64);
  }
  if (body.tab_labels && typeof body.tab_labels === "object" && !Array.isArray(body.tab_labels)) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.tab_labels)) {
      if (typeof k === "string" && typeof v === "string" && v.length <= 60) clean[k] = v;
    }
    update.tab_labels = clean;
  }
  if (Array.isArray(body.tab_hidden)) {
    update.tab_hidden = body.tab_hidden.filter((x): x is string => typeof x === "string").slice(0, 64);
  }

  const { data, error } = await sb
    .from("xinix_ui_settings")
    .upsert({ id: 1, ...update }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) return textResponse(req, error.message, { status: 500 });
  return jsonResponse(req, data);
});
