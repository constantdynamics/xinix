// Markeringen per ticker: favorieten (hartje) en gezien (verrekijker).
// GET    → { favorites: string[], seen: string[] }
// POST   { kind: "favorite" | "seen", ticker: string }   → toevoegen
// DELETE { kind: "favorite" | "seen", ticker: string }   → verwijderen
//
// Auth via ADMIN_TOKEN (Bearer). Eén set markeringen voor de admin-gebruiker.

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import {
  handlePreflight,
  jsonResponse,
  textResponse,
} from "../_shared/cors.ts";

type Kind = "favorite" | "seen";

function tableFor(kind: Kind): string {
  return kind === "favorite" ? "xinix_favorites" : "xinix_seen";
}

function parseKind(v: unknown): Kind | null {
  return v === "favorite" || v === "seen" ? v : null;
}

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;

  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });
  const supabase = getServiceClient();

  if (req.method === "GET") {
    const [fav, seen] = await Promise.all([
      supabase.from("xinix_favorites").select("ticker"),
      supabase.from("xinix_seen").select("ticker"),
    ]);
    if (fav.error) return textResponse(req, fav.error.message, { status: 500 });
    if (seen.error) return textResponse(req, seen.error.message, { status: 500 });
    return jsonResponse(req, {
      favorites: (fav.data ?? []).map((r) => r.ticker as string),
      seen: (seen.data ?? []).map((r) => r.ticker as string),
    });
  }

  if (req.method === "POST" || req.method === "DELETE") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return textResponse(req, "Invalid JSON body", { status: 400 });
    }
    const kind = parseKind(body.kind);
    if (!kind) {
      return textResponse(req, "Missing or invalid kind", { status: 400 });
    }
    const table = tableFor(kind);

    // Bulk-variant: body.tickers = string[] — voor "alles aanvinken" knop bij gezien-kolom
    if (Array.isArray(body.tickers)) {
      const tickers = body.tickers
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => t.length > 0);
      if (tickers.length === 0) return jsonResponse(req, { ok: true, kind, action: "noop", count: 0 });

      if (req.method === "POST") {
        const rows = tickers.map((t) => ({ ticker: t }));
        const { error } = await supabase.from(table).upsert(rows, { onConflict: "ticker" });
        if (error) return textResponse(req, error.message, { status: 500 });
        return jsonResponse(req, { ok: true, kind, action: "added", count: tickers.length });
      }
      const { error } = await supabase.from(table).delete().in("ticker", tickers);
      if (error) return textResponse(req, error.message, { status: 500 });
      return jsonResponse(req, { ok: true, kind, action: "removed", count: tickers.length });
    }

    // Single ticker
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (!ticker) {
      return textResponse(req, "Missing ticker or tickers", { status: 400 });
    }

    if (req.method === "POST") {
      const { error } = await supabase.from(table).upsert({ ticker }, { onConflict: "ticker" });
      if (error) return textResponse(req, error.message, { status: 500 });
      return jsonResponse(req, { ok: true, kind, ticker, action: "added" });
    }

    const { error } = await supabase.from(table).delete().eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true, kind, ticker, action: "removed" });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
