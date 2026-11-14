// xinix-supersprint — SUPERsprinters: aandelen op de Saxo-beurzen die binnen 10 handelsdagen +50%
// kunnen maken (Favorieten → SUPERsprinters).
//
//   GET  /xinix-supersprint                               ranglijst, track record, verbruik (publiek)
//   POST /xinix-supersprint?mode=round&region=apac        ronde na het slot (apac | europa | amerika)
//   POST /xinix-supersprint?mode=flush                    meldingen die in de stille uren wachtten
//   POST /xinix-supersprint?mode=resolve                  track record afrekenen, bijsturing, nieuwsmeting
//   POST /xinix-supersprint  { action: "adopt", ticker }  hartje: op de watchlist met no_sim
//   POST /xinix-supersprint  { action: "settings", … }    schakelaars (beheertoken)
//
// Hoe het werkt: per ronde haalt de functie alle aandelen van de regio in één keer bij de
// TradingView-scanner op (±25 verzoeken per dag voor ±20.000 aandelen), scoort ze in het geheugen met
// het model uit public/ss-model.json en schrijft alleen de kopgroep weg. Yahoo is alleen nodig voor
// nieuws bij de bovenste aandelen, een controle vóór een melding en het afrekenen van het track record.
// Uitzetten: signal_settings.ss_enabled = false. Zie docs/supersprinters-rapport.md.
//
// Uitrollen: alleen dit bestand gaat naar Supabase. Het eigenlijke werk (run.ts en core.ts) wordt bij
// het uitrollen opgehaald uit de openbare repository, vastgepind op één commit. Zo draait in productie
// precies wat in de repo staat. Na een wijziging in run.ts of core.ts: eerst mergen, dan hieronder de
// commit bijwerken en dit bestand opnieuw uitrollen (deploy_edge_function, verify_jwt uit).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import * as R from "https://raw.githubusercontent.com/constantdynamics/xinix/03452f3ee6fb1465e8fa476d91e15a0b7a7b5c03/supabase/functions/xinix-supersprint/run.ts";

const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-requested-with, apikey, x-cron-secret",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "content-type": "application/json" } });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function client(): R.SB {
  const u = Deno.env.get("SUPABASE_URL"), k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}
function isAdmin(req: Request): boolean {
  const t = Deno.env.get("ADMIN_TOKEN");
  return !!t && (req.headers.get("authorization") ?? "") === `Bearer ${t}`;
}
function isCron(req: Request): boolean {
  const t = Deno.env.get("CRON_SECRET");
  return !!t && (req.headers.get("x-cron-secret") ?? "") === t;
}

async function logged(sb: R.SB, job: string, fn: () => Promise<R.RunResult>): Promise<R.RunResult> {
  const { data: row } = await sb.from("signal_runs").insert({ job }).select("id").single();
  const id = row?.id as number | undefined;
  const done = (ok: boolean, message: string | null, metrics: unknown) =>
    id ? sb.from("signal_runs").update({ finished_at: new Date().toISOString(), ok, message, metrics }).eq("id", id) : Promise.resolve();
  try {
    const r = await fn();
    await done(r.ok, r.message ?? null, r.metrics ?? null);
    return r;
  } catch (e) {
    await done(false, msg(e), null);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  try {
    const sb = client();
    if (mode) {
      if (!isAdmin(req) && !isCron(req)) return json(req, { error: "Unauthorized" }, 401);
      if (!["round", "flush", "resolve"].includes(mode)) return json(req, { error: "mode moet round, flush of resolve zijn" }, 400);
      const region = url.searchParams.get("region") ?? "";
      const date = url.searchParams.get("date");
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(req, { error: "date moet JJJJ-MM-DD zijn" }, 400);
      const job = mode === "round" ? `xinix-ss-${region || "ronde"}` : `xinix-ss-${mode}`;
      const r = await logged(sb, job, () =>
        R.guarded(sb, (ctx) => (mode === "round" ? R.round(ctx, region, date) : mode === "flush" ? R.flush(ctx) : R.resolve(ctx))));
      return json(req, r, r.ok ? 200 : 500);
    }
    if (req.method === "GET") return json(req, await R.read(sb));
    if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
    if (!isAdmin(req)) return json(req, { error: "Unauthorized" }, 401);
    const body = (await req.json().catch(() => ({}))) as R.Json;
    if (body.action === "adopt") { const r = await R.adopt(sb, body.ticker); return json(req, r.body, r.status); }
    if (body.action === "settings") { const r = await R.saveSettings(sb, body); return json(req, r.body, r.status); }
    return json(req, { error: "onbekende actie" }, 400);
  } catch (e) {
    return json(req, { ok: false, error: msg(e) }, 500);
  }
});
