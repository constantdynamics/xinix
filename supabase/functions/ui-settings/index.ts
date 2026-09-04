// ui-settings — single-row config voor UI-aanpassingen (tab-volgorde, labels, verborgen tabs).
// GET = openbaar (frontend leest bij elke load). POST/PUT = vereist admin-token.

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

interface TableColumnPref {
  order: string[];
  hidden: string[];
}

interface UiSettings {
  id: number;
  tab_order: string[];
  tab_labels: Record<string, string>;
  tab_hidden: string[];
  table_columns: Record<string, TableColumnPref>;
  tab_width: Record<string, string>;
  updated_at: string;
}

function defaults(): UiSettings {
  return {
    id: 1,
    tab_order: [],
    tab_labels: {},
    tab_hidden: [],
    table_columns: {},
    tab_width: {},
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
  if (body.table_columns && typeof body.table_columns === "object" && !Array.isArray(body.table_columns)) {
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 128) : [];
    const clean: Record<string, TableColumnPref> = {};
    for (const [tab, pref] of Object.entries(body.table_columns).slice(0, 64)) {
      if (typeof tab !== "string" || tab.length > 64) continue;
      if (!pref || typeof pref !== "object" || Array.isArray(pref)) continue;
      const p = pref as Record<string, unknown>;
      clean[tab] = { order: strings(p.order), hidden: strings(p.hidden) };
    }
    update.table_columns = clean;
  }
  if (body.tab_width && typeof body.tab_width === "object" && !Array.isArray(body.tab_width)) {
    const clean: Record<string, string> = {};
    for (const [tab, w] of Object.entries(body.tab_width).slice(0, 64)) {
      if (typeof tab !== "string" || tab.length > 64) continue;
      if (w === "normaal" || w === "breed" || w === "vol") clean[tab] = w;
    }
    update.tab_width = clean;
  }

  const { data, error } = await sb
    .from("xinix_ui_settings")
    .upsert({ id: 1, ...update }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) return textResponse(req, error.message, { status: 500 });
  return jsonResponse(req, data);
});
