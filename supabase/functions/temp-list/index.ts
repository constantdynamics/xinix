// Tijdelijk lijstje (Favorieten → 🗂️ Tijdelijk): aandelen die apart gezet zijn
// in plaats van weggegooid, nu de 100 die de explosie-motor op 25 september
// automatisch toevoegde.
//
// GET                          → { rows: [...] } verrijkt met huidige koers,
//                                status op de watchlist en open sim-posities
// POST { ticker, action }      → action = "restore": terug op de watchlist
//                                (active = true) en van de lijst af;
//                                action = "remove": alleen van de lijst af
//                                (blijft inactief).
//
// Auth via ADMIN_TOKEN (Bearer), net als /api/marks.

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });

  const sb = getServiceClient();

  if (req.method === "GET") {
    const { data: list, error } = await sb.from("xinix_temp_list").select("*").order("added_at", { ascending: true });
    if (error) return textResponse(req, error.message, { status: 500 });
    const rows = (list ?? []) as Array<Record<string, unknown> & { ticker: string }>;
    const tickers = rows.map((r) => r.ticker);
    const [tk, ps, pos] = tickers.length
      ? await Promise.all([
        sb.from("signal_tickers").select("ticker, active").in("ticker", tickers),
        sb.from("signal_price_summary").select("ticker, last_close, pct_change_22d, updated_at").in("ticker", tickers),
        sb.from("xinix_strategy_positions").select("ticker").in("ticker", tickers).is("closed_at", null),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    const active = new Map(((tk.data ?? []) as Array<{ ticker: string; active: boolean }>).map((r) => [r.ticker, r.active]));
    const price = new Map(((ps.data ?? []) as Array<{ ticker: string }>).map((r) => [r.ticker, r]));
    const openPos = new Map<string, number>();
    for (const r of (pos.data ?? []) as Array<{ ticker: string }>) openPos.set(r.ticker, (openPos.get(r.ticker) ?? 0) + 1);
    return jsonResponse(req, {
      rows: rows.map((r) => {
        const p = price.get(r.ticker) as { last_close?: number; pct_change_22d?: number; updated_at?: string } | undefined;
        return {
          ...r,
          active: active.get(r.ticker) ?? false,
          last_close: p?.last_close ?? null,
          pct_change_22d: p?.pct_change_22d ?? null,
          price_at: p?.updated_at ?? null,
          open_sim_positions: openPos.get(r.ticker) ?? 0,
        };
      }),
    });
  }

  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return textResponse(req, "Invalid JSON body", { status: 400 });
    }
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    const action = body.action;
    if (!ticker) return textResponse(req, "Missing ticker", { status: 400 });
    if (action !== "restore" && action !== "remove") return textResponse(req, "action moet restore of remove zijn", { status: 400 });

    if (action === "restore") {
      const { error } = await sb.from("signal_tickers").update({ active: true }).eq("ticker", ticker);
      if (error) return textResponse(req, error.message, { status: 500 });
    }
    const { error } = await sb.from("xinix_temp_list").delete().eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true, ticker, action });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
