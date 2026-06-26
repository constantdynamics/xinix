// xinix-doubling-research-background — research-verrijking voor het
// Verdubbelaars-tabblad. Vat de dagelijks-bijgewerkte research-data per favoriet
// samen (geplande katalysatoren + trial-readouts, materiële SEC-8K-meldingen,
// strategische deals, EDGAR-filings, cash runway / verwatering) tot een
// "research-overlay": een ×-factor op de prijs-gedreven verdubbelkans, een
// betrouwbaarheids-bonus, transparante factoren en een bull/bear-these.
//
// De zware aggregatie gebeurt in de SQL-functie xinix_doubling_research_inputs();
// deze functie rekent er alleen de overlay-logica overheen en slaat het op.
//
// GET  /xinix-doubling-research-background  → alle overlays (publiek, voor de UI)
// POST /xinix-doubling-research-background  → herbereken (cron of admin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function sb() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey, x-cron-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function json(req: Request, body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...cors(req), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}

function isAuthed(req: Request): boolean {
  const adminToken = Deno.env.get("ADMIN_TOKEN") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const isAdmin = adminToken !== "" && (req.headers.get("authorization") ?? "") === `Bearer ${adminToken}`;
  const isCron = cronSecret !== "" && (req.headers.get("x-cron-secret") ?? "") === cronSecret;
  return isAdmin || isCron;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface Input {
  ticker: string;
  company: string | null;
  sector: string | null;
  market_cap_usd: number | null;
  share_count_millions: number | null;
  cash_runway_months: number | null;
  insider_ownership_pct: number | null;
  dividend_yield: number | null;
  material_news_90d: number;
  material_news_30d: number;
  jv_recent: boolean;
  last_material_title: string | null;
  last_material_at: string | null;
  filings_120d: number;
  latest_filing_form: string | null;
  latest_filing_at: string | null;
  next_catalyst_date: string | null;
  next_catalyst_type: string | null;
  next_catalyst_source: string | null;
  next_trial_date: string | null;
  next_trial_title: string | null;
  events_120d: number;
}

interface Factor { label: string; detail: string; impact: "up" | "down" | "neutral"; weight: number }

// Let op: de katalysator-bijdrage (×-factor, confidence, bull-tekst, chip) wordt
// NIET hier berekend maar live in de frontend uit next_catalyst_date /
// next_trial_date. Anders zou een bevroren dag-teller na de readout nog ~15
// dagen een verlopen katalysator als "over 4d" tonen en de score opblazen.
function buildOverlay(r: Input) {
  let mult = 1;
  let confBonus = 0;
  const factors: Factor[] = [];
  const bull: string[] = [];
  const bear: string[] = [];

  // Materiële nieuws-momentum: recente materiële 8-K-meldingen / strategische deals.
  if (r.material_news_90d > 0) {
    const f = r.material_news_90d >= 3 ? 1.12 : 1.05;
    mult *= f;
    confBonus += 0.5;
    factors.push({
      label: "Nieuws-momentum",
      detail: `${r.material_news_90d} materiële SEC-melding(en) in 90d${r.jv_recent ? " incl. strategische deal" : ""}`,
      impact: "up",
      weight: (f - 1) * 5,
    });
    bull.push(`${r.material_news_90d} materiële SEC-8K-melding(en) in 90d — actief`);
    if (r.jv_recent) {
      mult *= 1.06;
      bull.push("Strategische deal/JV gemeld (90d)");
    }
  } else {
    mult *= 0.97;
    bear.push("Geen recente materiële meldingen — weinig nieuws-momentum");
  }

  // 3) EDGAR-filing-transparantie (US-genoteerd, recent gerapporteerd).
  if (r.filings_120d > 0) confBonus += 0.4;

  // 4) Verwateringsrisico: lage cash runway bij een speculatieve naam.
  if (r.cash_runway_months != null) {
    confBonus += 0.3;
    if (r.cash_runway_months < 6) {
      mult *= 0.82;
      factors.push({ label: "Verwatering", detail: `cash runway ~${r.cash_runway_months} mnd — hoog verwateringsrisico`, impact: "down", weight: 0.6 });
      bear.push(`Cash runway ~${r.cash_runway_months} mnd — hoog verwateringsrisico`);
    } else if (r.cash_runway_months < 12) {
      mult *= 0.9;
      factors.push({ label: "Verwatering", detail: `cash runway ~${r.cash_runway_months} mnd`, impact: "down", weight: 0.3 });
      bear.push(`Cash runway ~${r.cash_runway_months} mnd — mogelijke financieringsbehoefte`);
    } else {
      bull.push(`Cash runway ~${r.cash_runway_months} mnd — voldoende kaspositie`);
    }
  }

  mult = clamp(mult, 0.7, 1.45);
  confBonus = Math.min(confBonus, 1.8);

  // Korte research-these uit de feitelijke datapunten (katalysator-zin voegt de
  // frontend live toe op basis van de datum).
  const parts: string[] = [];
  if (r.material_news_90d > 0) parts.push(`${r.material_news_90d} materiële SEC-melding(en) in 90d${r.jv_recent ? ", incl. strategische deal" : ""}.`);
  if (r.filings_120d > 0 && r.latest_filing_form) parts.push(`Laatste filing: ${r.latest_filing_form}.`);
  if (r.cash_runway_months != null) parts.push(`Cash runway ~${r.cash_runway_months} mnd.`);
  if (parts.length === 0) parts.push("Weinig recente research-signalen — schatting leunt op koersgedrag.");
  const summary = parts.join(" ");

  return {
    ticker: r.ticker,
    company: r.company,
    sector: r.sector,
    research_multiplier: Number(mult.toFixed(4)),
    conf_bonus: Number(confBonus.toFixed(2)),
    factors,
    bull,
    bear,
    summary,
    data: {
      next_catalyst_date: r.next_catalyst_date,
      next_catalyst_type: r.next_catalyst_type,
      next_catalyst_source: r.next_catalyst_source,
      next_trial_date: r.next_trial_date,
      next_trial_title: r.next_trial_title,
      material_news_90d: r.material_news_90d,
      material_news_30d: r.material_news_30d,
      jv_recent: r.jv_recent,
      last_material_title: r.last_material_title,
      last_material_at: r.last_material_at,
      filings_120d: r.filings_120d,
      latest_filing_form: r.latest_filing_form,
      latest_filing_at: r.latest_filing_at,
      cash_runway_months: r.cash_runway_months,
      market_cap_usd: r.market_cap_usd,
      events_120d: r.events_120d,
    },
  };
}

async function recompute(): Promise<{ ok: boolean; message: string; metrics: Record<string, unknown> }> {
  const supabase = sb();
  const { data: inputs, error } = await supabase.rpc("xinix_doubling_research_inputs");
  if (error) throw new Error(`rpc: ${error.message}`);
  const rows = (inputs ?? []) as Input[];
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const overlays = rows.map((r) => ({ ...buildOverlay(r), computed_at: nowIso }));

  // Upsert in batches.
  let upserted = 0;
  for (let i = 0; i < overlays.length; i += 100) {
    const batch = overlays.slice(i, i + 100);
    const { error: upErr } = await supabase.from("xinix_doubling_research").upsert(batch, { onConflict: "ticker" });
    if (upErr) throw new Error(`upsert: ${upErr.message}`);
    upserted += batch.length;
  }

  // Verwijder overlays van tickers die geen favoriet meer zijn: alles wat deze
  // run niet is bijgewerkt (computed_at ouder dan nu) is een verwijderde favoriet.
  if (overlays.length > 0) {
    const { error: delErr } = await supabase.from("xinix_doubling_research").delete().lt("computed_at", nowIso);
    if (delErr) console.error("cleanup delete failed:", delErr.message);
  }

  const withCatalyst = overlays.filter((o) => o.data.next_catalyst_date != null || o.data.next_trial_date != null).length;
  const withNews = overlays.filter((o) => o.data.material_news_90d > 0).length;
  return {
    ok: true,
    message: `verrijkt: ${upserted} favorieten (${withCatalyst} met katalysator, ${withNews} met nieuws-momentum)`,
    metrics: { upserted, with_catalyst: withCatalyst, with_news: withNews },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  if (req.method === "GET") {
    try {
      const supabase = sb();
      const { data, error } = await supabase
        .from("xinix_doubling_research")
        .select("*")
        .order("computed_at", { ascending: false });
      if (error) throw error;
      const items = data ?? [];
      const computed_at = items.length > 0 ? (items[0] as { computed_at: string }).computed_at : null;
      return json(req, { items, computed_at, count: items.length });
    } catch (err) {
      return json(req, { error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  if (req.method !== "POST") return json(req, { error: "method not allowed" }, { status: 405 });
  if (!isAuthed(req)) return json(req, { error: "unauthorized" }, { status: 401 });

  const supabase = sb();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : null;

  // Handmatig bevestigde katalysator toevoegen (admin) → betrouwbare bron voor
  // o.a. mining-favorieten waarvoor geen gestructureerde feed bestaat.
  if (action === "add_catalyst") {
    const ticker = String(body.ticker ?? "").toUpperCase().trim();
    const date = String(body.expected_date ?? "").trim();
    const type = String(body.catalyst_type ?? "katalysator").trim().slice(0, 40) || "katalysator";
    const note = body.note ? String(body.note).slice(0, 200) : null;
    if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker)) return json(req, { error: "ongeldige ticker" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00Z")))
      return json(req, { error: "ongeldige datum (YYYY-MM-DD)" }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    if (date < today) return json(req, { error: "datum ligt in het verleden" }, { status: 400 });
    const { data: tk } = await supabase.from("signal_tickers").select("sector").eq("ticker", ticker).maybeSingle();
    // Eén handmatige toekomstige katalysator per ticker: vervang de bestaande.
    await supabase.from("signal_catalysts").delete().eq("ticker", ticker).eq("source", "manual").gte("expected_date", today);
    const { error: insErr } = await supabase.from("signal_catalysts").insert({
      ticker, sector: (tk as { sector?: string } | null)?.sector ?? null,
      catalyst_type: type, description: note, expected_date: date, source: "manual", status: "pending",
    });
    if (insErr) return json(req, { ok: false, message: insErr.message }, { status: 500 });
    await recompute();
    return json(req, { ok: true, message: `katalysator (${type}, ${date}) toegevoegd voor ${ticker}` });
  }

  if (action === "remove_catalyst") {
    const ticker = String(body.ticker ?? "").toUpperCase().trim();
    if (!/^[A-Z0-9.\-]{1,15}$/.test(ticker)) return json(req, { error: "ongeldige ticker" }, { status: 400 });
    const { error: delErr } = await supabase.from("signal_catalysts").delete().eq("ticker", ticker).eq("source", "manual");
    if (delErr) return json(req, { ok: false, message: delErr.message }, { status: 500 });
    await recompute();
    return json(req, { ok: true, message: `handmatige katalysator verwijderd voor ${ticker}` });
  }

  const { data: runRow } = await supabase.from("signal_runs").insert({ job: "xinix-doubling-research" }).select("id").single();
  const runId = runRow?.id as number | undefined;
  try {
    const result = await recompute();
    if (runId) {
      await supabase.from("signal_runs").update({
        finished_at: new Date().toISOString(),
        ok: result.ok,
        message: result.message,
        metrics: result.metrics,
      }).eq("id", runId);
    }
    return json(req, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("signal_runs").update({ finished_at: new Date().toISOString(), ok: false, message: msg }).eq("id", runId);
    }
    return json(req, { ok: false, message: msg }, { status: 500 });
  }
});
