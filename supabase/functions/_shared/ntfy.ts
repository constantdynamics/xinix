// ntfy-meldingen versturen, ook als de daglimiet van ntfy.sh op is.
//
// ntfy.sh telt zijn limiet (250 berichten per dag) per IP-adres, en de edge
// functions delen hun uitgaande IP met andere Supabase-projecten. Dat limiet is
// daardoor vaak al halverwege de dag op (HTTP 429). De database heeft een eigen
// IP met een eigen limiet: lukt het direct niet, dan gaat de melding via pg_net
// (RPC xinix_ntfy_relay, migratie 2026-10-03_xinix_ntfy_relay.sql).

interface RpcClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Verstuurt een ntfy-bericht (JSON met `topic`). Geeft null terug als het verstuurd is, anders de fout. */
export async function publishNtfy(sb: RpcClient, server: string, payload: Record<string, unknown>): Promise<string | null> {
  let direct: string;
  try {
    const res = await fetch(server.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return null;
    direct = `ntfy ${res.status}: ${(await res.text()).slice(0, 160)}`;
    // Een fout in het bericht zelf lost een ander IP niet op.
    if (res.status !== 429 && res.status < 500) return direct;
  } catch (e) {
    direct = `ntfy: ${e instanceof Error ? e.message : String(e)}`;
  }

  const { data: id, error } = await sb.rpc("xinix_ntfy_relay", { p_payload: payload });
  if (error || id == null) return `${direct}; via database: ${error?.message ?? "geen verzoek-id"}`;
  // pg_net verstuurt na de commit, meestal binnen een seconde.
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    const { data: r } = await sb.rpc("xinix_ntfy_relay_status", { p_id: id });
    if (!r) continue;
    const status = Number(r.status ?? 0);
    if (status >= 200 && status < 300) return null;
    return `${direct}; via database: ${status || ""} ${r.error ?? r.body ?? ""}`.trim();
  }
  // Nog in de wachtrij van pg_net: die verstuurt hem alsnog.
  return null;
}
