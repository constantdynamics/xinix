// Meldingenlog + demping per aandeel. Voedt het Meldingen-tabblad.
//
// GET    → { rows: [...], mutes: [...], cooldown_days }
//          rows = verstuurde ntfy-meldingen (nieuwste eerst), verrijkt met
//          bedrijfsnaam/beurs zodat de tabel niet alleen tickers toont.
// PUT    { ticker, months }  → demp dit aandeel; months = 3 | 6 | 12, of
//                              null/0 = voorgoed. Zet een bestaande demping over.
// DELETE { ticker }          → demping opheffen
//
// Auth via ADMIN_TOKEN (Bearer), net als /api/marks.

import { getServiceClient } from "../_shared/supabase.ts";
import { checkAuth } from "../_shared/auth.ts";
import { handlePreflight, jsonResponse, textResponse } from "../_shared/cors.ts";

// Het log houdt 365 dagen (zie xinix_notify_record). Meer dan dat hoeft de
// tabel niet te tonen; de cap voorkomt dat één ontspoorde meldingsbron de
// pagina onbruikbaar maakt.
const MAX_ROWS = 2000;

const ALLOWED_MONTHS = new Set([3, 6, 12]);

Deno.serve(async (req) => {
  const pf = handlePreflight(req);
  if (pf) return pf;
  if (!checkAuth(req)) return textResponse(req, "Unauthorized", { status: 401 });

  const sb = getServiceClient();

  if (req.method === "GET") {
    const [logRes, muteRes, cfgRes] = await Promise.all([
      sb
        .from("xinix_notify_log")
        .select("id, ticker, source, alert_key, priority, sent_at")
        .order("sent_at", { ascending: false })
        .limit(MAX_ROWS),
      sb.from("xinix_notify_mute").select("ticker, muted_until, created_at"),
      sb.from("signal_settings").select("notify_cooldown_days").eq("id", 1).maybeSingle(),
    ]);
    if (logRes.error) return textResponse(req, logRes.error.message, { status: 500 });
    if (muteRes.error) return textResponse(req, muteRes.error.message, { status: 500 });

    const rows = (logRes.data ?? []) as Array<{ ticker: string }>;

    // Bedrijfsnaam + beurs erbij halen voor de tickers die in beeld komen.
    // Alleen die tickers, niet de hele watchlist van 3800 rijen.
    const tickers = [...new Set(rows.map((r) => r.ticker.toUpperCase()))];
    const meta = new Map<string, { company: string | null; exchange: string | null }>();
    if (tickers.length > 0) {
      const { data: tk } = await sb
        .from("signal_tickers")
        .select("ticker, company, exchange")
        .in("ticker", tickers);
      for (const t of (tk ?? []) as Array<{ ticker: string; company: string | null; exchange: string | null }>) {
        meta.set(t.ticker.toUpperCase(), { company: t.company, exchange: t.exchange });
      }
    }

    return jsonResponse(req, {
      rows: rows.map((r) => {
        const m = meta.get(r.ticker.toUpperCase());
        return { ...r, company: m?.company ?? null, exchange: m?.exchange ?? null };
      }),
      mutes: muteRes.data ?? [],
      cooldown_days: (cfgRes.data as { notify_cooldown_days?: number } | null)?.notify_cooldown_days ?? 14,
    });
  }

  if (req.method === "PUT" || req.method === "DELETE") {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return textResponse(req, "Invalid JSON body", { status: 400 });
    }
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : "";
    if (!ticker) return textResponse(req, "Missing ticker", { status: 400 });

    if (req.method === "DELETE") {
      const { error } = await sb.from("xinix_notify_mute").delete().eq("ticker", ticker);
      if (error) return textResponse(req, error.message, { status: 500 });
      return jsonResponse(req, { ok: true, ticker, action: "unmuted" });
    }

    // months afwezig/null/0 = voorgoed dempen (muted_until blijft NULL).
    const raw = body.months;
    let mutedUntil: string | null = null;
    if (raw != null && raw !== 0) {
      if (typeof raw !== "number" || !ALLOWED_MONTHS.has(raw)) {
        return textResponse(req, "Invalid months (3, 6, 12 of null voor voorgoed)", { status: 400 });
      }
      const until = new Date();
      until.setMonth(until.getMonth() + raw);
      mutedUntil = until.toISOString();
    }

    const { error } = await sb
      .from("xinix_notify_mute")
      .upsert({ ticker, muted_until: mutedUntil }, { onConflict: "ticker" });
    if (error) return textResponse(req, error.message, { status: 500 });
    return jsonResponse(req, { ok: true, ticker, muted_until: mutedUntil, action: "muted" });
  }

  return textResponse(req, "Method not allowed", { status: 405 });
});
