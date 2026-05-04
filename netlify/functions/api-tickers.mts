import type { Config } from "@netlify/functions";
import { getServiceClient } from "./_lib/supabase.mts";

function checkAuth(req: Request): boolean {
  const required = Netlify.env.get("ADMIN_TOKEN");
  if (!required) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${required}`;
}

type Sector = "biotech" | "mining";

function normalizeSector(v: unknown): Sector {
  const s = String(v ?? "").toLowerCase();
  return s === "mining" ? "mining" : "biotech";
}

function buildRow(input: Record<string, unknown>) {
  return {
    ticker: String(input.ticker ?? "").toUpperCase().trim(),
    company: String(input.company ?? "").trim(),
    sector: normalizeSector(input.sector),
    goud_score: input.goud_score == null || input.goud_score === "" ? null : Number(input.goud_score),
    goud_type: (input.goud_type as string) || null,
    trigger_event: (input.trigger_event as string) || null,
    trigger_date: (input.trigger_date as string) || null,
    modality: (input.modality as string) || null,
    disease_area: (input.disease_area as string) || null,
    phase: (input.phase as string) || null,
    commodity: (input.commodity as string) || null,
    jurisdiction: (input.jurisdiction as string) || null,
    deposit_type: (input.deposit_type as string) || null,
    share_count_millions:
      input.share_count_millions == null || input.share_count_millions === ""
        ? null
        : Number(input.share_count_millions),
    active: true,
    updated_at: new Date().toISOString(),
  };
}

export default async (req: Request) => {
  if (!checkAuth(req)) return new Response("Unauthorized", { status: 401 });
  const supabase = getServiceClient();

  if (req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;

    // Batch path: { rows: [{ticker, company, sector, ...}] }
    if (Array.isArray(body.rows)) {
      const rows = (body.rows as Record<string, unknown>[])
        .map(buildRow)
        .filter((r) => r.ticker && r.company);
      if (rows.length === 0)
        return new Response("no valid rows", { status: 400 });
      const { error, data } = await supabase
        .from("signal_tickers")
        .upsert(rows, { onConflict: "ticker" })
        .select("ticker");
      if (error) return new Response(error.message, { status: 500 });
      return new Response(
        JSON.stringify({ ok: true, inserted: (data ?? []).length }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Single path
    if (!body.ticker || !body.company)
      return new Response("ticker and company required", { status: 400 });
    const { error } = await supabase
      .from("signal_tickers")
      .upsert(buildRow(body), { onConflict: "ticker" });
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
      .from("signal_tickers")
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
