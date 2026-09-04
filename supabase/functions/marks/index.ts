// Markeringen per ticker: favorieten (hartje) en gezien (verrekijker).
// GET    → { favorites, seen, ratings, favorited_at }
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
      supabase.from("xinix_favorites").select("ticker, rating, created_at"),
      supabase.from("xinix_seen").select("ticker"),
    ]);
    if (fav.error) return textResponse(req, fav.error.message, { status: 500 });
    if (seen.error) return textResponse(req, seen.error.message, { status: 500 });
    const favList = (fav.data ?? []) as Array<{
      ticker: string;
      rating: number | null;
      created_at: string | null;
    }>;
    const ratings: Record<string, number> = {};
    const favoritedAt: Record<string, string> = {};
    for (const r of favList) {
      if (r.rating != null) ratings[r.ticker] = r.rating;
      if (r.created_at) favoritedAt[r.ticker] = r.created_at;
    }
    return jsonResponse(req, {
      favorites: favList.map((r) => r.ticker),
      seen: (seen.data ?? []).map((r) => r.ticker as string),
      ratings,
      favorited_at: favoritedAt,
    });
  }

  if (req.method === "PATCH") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return textResponse(req, "Invalid JSON body", { status: 400 });
    }
    const kind = parseKind(body.kind);
    if (kind !== "favorite") {
      return textResponse(req, "PATCH alleen ondersteund voor kind=favorite (rating-update)", { status: 400 });
    }
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (!ticker) return textResponse(req, "Missing ticker", { status: 400 });
    const ratingRaw = body.rating;
    let rating: number | null;
    if (ratingRaw === null) {
      rating = null;
    } else if (typeof ratingRaw === "number" && Number.isFinite(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5) {
      rating = Math.round(ratingRaw);
    } else {
      return textResponse(req, "Invalid rating (must be 1..5 or null)", { status: 400 });
    }
    const { error } = await supabase
      .from("xinix_favorites")
      .upsert({ ticker, rating }, { onConflict: "ticker" });
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true, kind, ticker, rating, action: "rated" });
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

    // Zorg dat een favoriet-ticker ook in de watchlist actief staat. Anders
    // verschijnt hij wel in de favorieten-set maar zonder data — een rij met
    // alleen streepjes. Insert ontbrekende rijen met minimale info; activeer
    // bestaande inactieve rijen. Faalt deze stap → favoriet-actie blijft
    // doorgaan (best-effort).
    async function ensureInWatchlist(tickers: string[]): Promise<void> {
      if (tickers.length === 0) return;
      try {
        const existing = await supabase
          .from("signal_tickers")
          .select("ticker, active")
          .in("ticker", tickers);
        const seen = new Map<string, boolean>(
          (existing.data ?? []).map((r: { ticker: string; active: boolean }) => [r.ticker, r.active]),
        );
        const toInsert = tickers.filter((t) => !seen.has(t)).map((t) => ({ ticker: t, active: true }));
        const toReactivate = tickers.filter((t) => seen.has(t) && seen.get(t) === false);
        if (toInsert.length > 0) {
          await supabase.from("signal_tickers").insert(toInsert);
        }
        if (toReactivate.length > 0) {
          await supabase.from("signal_tickers").update({ active: true }).in("ticker", toReactivate);
        }
      } catch (err) {
        console.error("marks: ensureInWatchlist faalde:", err);
      }
    }

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
        if (kind === "favorite") await ensureInWatchlist(tickers);
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
      if (kind === "favorite") await ensureInWatchlist([ticker]);
      return jsonResponse(req, { ok: true, kind, ticker, action: "added" });
    }

    const { error } = await supabase.from(table).delete().eq("ticker", ticker);
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true, kind, ticker, action: "removed" });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
