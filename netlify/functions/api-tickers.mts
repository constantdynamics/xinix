import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

function checkAuth(req: Request): boolean {
  const required = Netlify.env.get("ADMIN_TOKEN");
  if (!required) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

export default async (req: Request) => {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
  const supabase = getServiceClient();

  if (req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;
    if (!body.ticker || !body.company)
      return new Response("ticker and company required", { status: 400 });
    const { error } = await supabase.from("biotech_tickers").upsert(
      {
        ticker: String(body.ticker).toUpperCase(),
        company: String(body.company),
        goud_score: body.goud_score ?? null,
        goud_type: body.goud_type ?? null,
        trigger_event: body.trigger_event ?? null,
        trigger_date: body.trigger_date ?? null,
        modality: body.modality ?? null,
        disease_area: body.disease_area ?? null,
        phase: body.phase ?? null,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ticker" }
    );
    if (error) return new Response(error.message, { status: 500 });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) return new Response("ticker required", { status: 400 });
    const { error } = await supabase
      .from("biotech_tickers")
      .update({ active: false })
      .eq("ticker", ticker);
    if (error) return new Response(error.message, { status: 500 });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config: Config = {
  path: "/api/tickers",
};
