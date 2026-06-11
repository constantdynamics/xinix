// xinix-knowledge-export — Maandelijkse kenniscumulatie-snapshot
//
// Compileert een volledig beeld van:
//   - Alle 200 strategieën (config + performance + generatie-historie)
//   - Gepensioneerde strategieën
//   - Alle gesloten posities (uitgesplitst per signaal + sector)
//   - Huidige open posities
//   - Watchlist (alle tickers met limieten, medailles, sector, company, notes)
//   - Configuratie-inzichten (welke parameterwaarden presteren het best)
//   - Evolutie-log
//   - Automatisch gegenereerde samenvatting (markdown)
//
// GET  /xinix-knowledge-export            → lijst van eerdere exports
// GET  /xinix-knowledge-export?id=N       → JSON van een specifieke export
// POST /xinix-knowledge-export            → maak nieuwe export (cron of admin)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function sb() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set(["https://constantdynamics.github.io","http://localhost:5173","http://localhost:4173"]);
function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const NTFY_TOPIC   = Deno.env.get("NTFY_TOPIC")      ?? "";
const NTFY_BASE    = "https://ntfy.sh";
const RESEND_KEY   = Deno.env.get("RESEND_API_KEY")  ?? "";
const RESEND_FROM  = "Xinix <noreply@constantdynamics.nl>";
const NOTIFY_EMAIL = Deno.env.get("NOTIFY_EMAIL")    ?? "";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN")    ?? "";
const GITHUB_REPO  = "constantdynamics/xinix";
const GITHUB_BRANCH = "claude/poll-fundamentals-background-5TjhG";

async function sendNtfy(title: string, message: string, clickUrl?: string) {
  if (!NTFY_TOPIC) return;
  const payload: Record<string, unknown> = { topic: NTFY_TOPIC, title, message, priority: 3, tags: ["chart_with_upwards_trend"] };
  if (clickUrl) { payload.click = clickUrl; payload.actions = [{ action: "view", label: "Open dashboard", url: clickUrl, clear: false }]; }
  await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => {});
}

async function sendEmail(to: string, subject: string, text: string) {
  if (!RESEND_KEY || !to) return;
  function esc(s: string) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  const html = `<!DOCTYPE html><html><body style="font-family:monospace;font-size:13px;white-space:pre-wrap;max-width:720px">${
    esc(text).replace(/https?:\/\/[^\s<"]+/g, u => `<a href="${u}" style="color:#3b82f6">${u}</a>`)
  }</body></html>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, text, html }),
  }).catch(() => {});
}

// ── GitHub bestand pushen ──────────────────────────────────────────────────────

async function pushToGitHub(path: string, content: string, message: string) {
  if (!GITHUB_TOKEN) return;
  const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xinix-knowledge-export",
    "Content-Type": "application/json",
  };
  // Haal huidige SHA op (nodig voor update)
  let sha: string | undefined;
  try {
    const get = await fetch(`${base}?ref=${GITHUB_BRANCH}`, { headers });
    if (get.ok) { const j = await get.json(); sha = j.sha; }
  } catch { /* nieuw bestand */ }

  const body: Record<string, unknown> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  await fetch(base, { method: "PUT", headers, body: JSON.stringify(body) }).catch(() => {});
}

// ── Uitgebreide kennisbasis markdown ──────────────────────────────────────────

function buildKennisbasis(data: Record<string, unknown>, now: Date, exportId: number | null): string {
  const strategies = data.strategies as Record<string, unknown>;
  const active = (strategies.active as Array<Record<string, unknown>>) ?? [];
  const retired = (strategies.retired as unknown[]) ?? [];
  const evo = strategies.evolution as Record<string, unknown>;
  const positions = data.positions as Record<string, unknown>;
  const watchlist = data.watchlist as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown>;
  const insights = (data.config_insights as Array<Record<string, unknown>>) ?? [];
  const closedBySig = (positions.closed_by_signal as Record<string, Record<string, number>>) ?? {};
  const closedBySector = (positions.closed_by_sector as Record<string, Record<string, number>>) ?? {};
  const bestTrades = (positions.best_trades as Array<Record<string, unknown>>) ?? [];
  const worstTrades = (positions.worst_trades as Array<Record<string, unknown>>) ?? [];

  const dateStr = now.toLocaleDateString("nl-NL", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  lines.push(`# Xinix Kennisbasis — Automatisch gegenereerd`);
  lines.push(`> Bijgewerkt op **${dateStr}** · Export #${exportId ?? "?"}`);
  lines.push(`> Dit bestand wordt elke maand automatisch bijgewerkt door \`xinix-knowledge-export\`.`);
  lines.push(`> Gebruik dit als context voor Claude of als overzicht voor jezelf.`);
  lines.push("");

  // ── Samenvatting ─────────────────────────────────────────────────────────────
  lines.push("## Samenvatting");
  lines.push(`| Metric | Waarde |`);
  lines.push(`|--------|--------|`);
  lines.push(`| Actieve strategieën | ${active.length} |`);
  lines.push(`| Gepensioneerde strategieën | ${retired.length} |`);
  lines.push(`| Gesloten trades (totaal) | ${(summary.total_closed_trades as number) ?? 0} |`);
  lines.push(`| Open posities nu | ${(positions.open_count as number) ?? 0} |`);
  lines.push(`| Strategieën in winst | ${(summary.strategies_in_profit as number) ?? 0} van ${active.length} |`);
  lines.push(`| Mediaan portefeuille-rendement | ${((summary.median_return_pct as number) ?? 0).toFixed(2)}% |`);
  lines.push(`| Gemiddeld portefeuille-rendement | ${((summary.avg_portfolio_return as number) ?? 0).toFixed(2)}% |`);
  lines.push(`| Algehele hitrate | ${Math.round(((summary.overall_win_rate as number) ?? 0) * 100)}% |`);
  lines.push(`| Evolutie-cycli | ${(evo.cycles as number) ?? 0} · max Gen-${(evo.max_generation as number) ?? 1} |`);
  lines.push("");

  // ── Top 10 en bottom 10 strategieën ──────────────────────────────────────────
  const sorted = [...active].sort((a, b) => (b.total_return_pct as number) - (a.total_return_pct as number));
  lines.push("## Top 10 strategieën");
  lines.push("| # | Naam | Groep | Rendement | Hitrate | Trades |");
  lines.push("|---|------|-------|-----------|---------|--------|");
  for (const s of sorted.slice(0, 10)) {
    const ret = (s.total_return_pct as number).toFixed(2);
    const wr = Math.round((s.win_rate as number) * 100);
    lines.push(`| ${s.rank ?? "?"} | ${s.name} | ${s.grp} | **${ret}%** | ${wr}% | ${s.closed_count} |`);
  }
  lines.push("");

  lines.push("## Bottom 10 strategieën");
  lines.push("| # | Naam | Groep | Rendement | Hitrate | Trades |");
  lines.push("|---|------|-------|-----------|---------|--------|");
  for (const s of sorted.slice(-10).reverse()) {
    const ret = (s.total_return_pct as number).toFixed(2);
    const wr = Math.round((s.win_rate as number) * 100);
    lines.push(`| ${s.rank ?? "?"} | ${s.name} | ${s.grp} | **${ret}%** | ${wr}% | ${s.closed_count} |`);
  }
  lines.push("");

  // ── Configuratie-inzichten ───────────────────────────────────────────────────
  lines.push("## Configuratie-inzichten (wat werkt beter?)");
  if (insights.length === 0) {
    lines.push("_Nog onvoldoende data (< 3 trades per waarde) voor betrouwbare inzichten._");
  } else {
    lines.push("| Dimensie | Beste waarde | Slechtste waarde | Verschil |");
    lines.push("|----------|-------------|-----------------|---------|");
    for (const ins of insights) {
      lines.push(`| ${ins.dimension} | **${ins.best_value}** | ${ins.worst_value} | +${(ins.diff_pct as number).toFixed(1)}% |`);
    }
  }
  lines.push("");

  // ── Signaaltype performance ──────────────────────────────────────────────────
  lines.push("## Signaaltype performance");
  const sigRows = Object.entries(closedBySig)
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct);
  if (sigRows.length === 0) {
    lines.push("_Nog geen data._");
  } else {
    lines.push("| Signaaltype | Trades | Hitrate | Gem. rendement |");
    lines.push("|-------------|--------|---------|----------------|");
    for (const [sig, v] of sigRows) {
      const wr = Math.round((v.win_rate ?? 0) * 100);
      lines.push(`| ${sig} | ${v.count} | ${wr}% | ${(v.avg_return_pct ?? 0).toFixed(2)}% |`);
    }
  }
  lines.push("");

  // ── Sector performance ───────────────────────────────────────────────────────
  lines.push("## Sector performance");
  const sectRows = Object.entries(closedBySector)
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct);
  if (sectRows.length === 0) {
    lines.push("_Nog geen data._");
  } else {
    lines.push("| Sector | Trades | Hitrate | Gem. rendement |");
    lines.push("|--------|--------|---------|----------------|");
    for (const [sect, v] of sectRows) {
      const wr = Math.round((v.win_rate ?? 0) * 100);
      lines.push(`| ${sect} | ${v.count} | ${wr}% | ${(v.avg_return_pct ?? 0).toFixed(2)}% |`);
    }
  }
  lines.push("");

  // ── Beste en slechtste trades ────────────────────────────────────────────────
  if (bestTrades.length > 0) {
    lines.push("## Beste trades ooit");
    lines.push("| Ticker | Rendement | Entry | Exit | Signalen |");
    lines.push("|--------|-----------|-------|------|---------|");
    for (const t of bestTrades.slice(0, 5)) {
      const sigs = ((t.entry_signal_types as string[]) ?? []).join(", ") || "—";
      lines.push(`| ${t.ticker} | **+${(t.return_pct as number).toFixed(1)}%** | ${(t.entry_date as string)?.slice(0,10)} | ${(t.closed_at as string)?.slice(0,10)} | ${sigs} |`);
    }
    lines.push("");
  }

  if (worstTrades.length > 0) {
    lines.push("## Slechtste trades ooit");
    lines.push("| Ticker | Rendement | Entry | Exit | Reden |");
    lines.push("|--------|-----------|-------|------|-------|");
    for (const t of worstTrades.slice(0, 5)) {
      lines.push(`| ${t.ticker} | **${(t.return_pct as number).toFixed(1)}%** | ${(t.entry_date as string)?.slice(0,10)} | ${(t.closed_at as string)?.slice(0,10)} | ${t.closed_reason ?? "—"} |`);
    }
    lines.push("");
  }

  // ── Aanbevelingen voor de volgende periode ───────────────────────────────────
  lines.push("## Aanbevelingen voor de volgende periode");
  const recs: string[] = [];

  // Op basis van top config-insight
  if (insights.length > 0) {
    const top = insights[0];
    recs.push(`**${top.dimension}**: Overweeg nieuwe strategieën met waarde "${top.best_value}" — scoort ${(top.diff_pct as number).toFixed(1)}% beter dan "${top.worst_value}".`);
  }

  // Op basis van beste sector
  if (sectRows.length > 0 && (sectRows[0][1].avg_return_pct ?? 0) > 5) {
    recs.push(`**Sector ${sectRows[0][0]}** presteert sterk (gem. ${sectRows[0][1].avg_return_pct.toFixed(1)}%). Overweeg meer gewicht in deze sector.`);
  }
  // Op basis van slechtste sector
  if (sectRows.length > 1 && (sectRows[sectRows.length-1][1].avg_return_pct ?? 0) < -5) {
    const worst = sectRows[sectRows.length-1];
    recs.push(`**Sector ${worst[0]}** presteert slecht (gem. ${worst[1].avg_return_pct.toFixed(1)}%). Overweeg exposure te verminderen.`);
  }
  // Op basis van top signaal
  if (sigRows.length > 0 && (sigRows[0][1].avg_return_pct ?? 0) > 10) {
    recs.push(`**Signaal "${sigRows[0][0]}"** levert sterk rendement (gem. ${sigRows[0][1].avg_return_pct.toFixed(1)}%, ${sigRows[0][1].count} trades). Prioriteer dit signaal.`);
  }

  if (recs.length === 0) {
    lines.push("_Onvoldoende data voor aanbevelingen. Wacht op meer gesloten trades._");
  } else {
    for (const r of recs) lines.push(`- ${r}`);
  }
  lines.push("");

  // ── Watchlist stats ──────────────────────────────────────────────────────────
  lines.push("## Watchlist");
  lines.push(`${(watchlist.total as number) ?? 0} tickers · ${(watchlist.active as number) ?? 0} actief · ${(watchlist.benched as number) ?? 0} op de bank · ${(watchlist.with_buy_limit as number) ?? 0} met buy-limit`);
  const bySect = (watchlist.by_sector as Record<string, number>) ?? {};
  lines.push("");
  for (const [sector, count] of Object.entries(bySect).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${sector}**: ${count} tickers`);
  }
  lines.push("");

  lines.push("---");
  lines.push(`_Volledig JSON-archief: dashboard → 200 Strategieën → Evolutie → Kennis-export_`);

  return lines.join("\n");
}

// ── Samenvatting genereren ─────────────────────────────────────────────────────

function buildSummary(data: Record<string, unknown>, now: Date): string {
  const strategies = data.strategies as Record<string, unknown>;
  const active = (strategies.active as unknown[]) ?? [];
  const retired = (strategies.retired as unknown[]) ?? [];
  const evo = strategies.evolution as Record<string, unknown>;
  const positions = data.positions as Record<string, unknown>;
  const watchlist = data.watchlist as Record<string, unknown>;
  const summary = data.summary as Record<string, unknown>;
  const insights = (data.config_insights as unknown[]) ?? [];

  const dateStr = now.toLocaleDateString("nl-NL", { year: "numeric", month: "long", day: "numeric" });
  const lines: string[] = [];

  lines.push(`# Xinix Kennisexport — ${dateStr}`);
  lines.push(`Gegenereerd: ${now.toISOString()}`);
  lines.push("");

  lines.push("## Strategieën");
  lines.push(`- **${active.length} actieve strategieën** in simulatie`);
  lines.push(`- ${(summary.strategies_in_profit as number) ?? 0} in winst (${Math.round(((summary.strategies_in_profit as number) ?? 0) / Math.max(1, active.length) * 100)}%), ${(summary.strategies_at_loss as number) ?? 0} in verlies`);
  lines.push(`- Mediaan rendement: ${((summary.median_return_pct as number) ?? 0).toFixed(2)}%`);
  lines.push(`- Beste: **${summary.best_strategy_name ?? "—"}** (+${((summary.best_strategy_return as number) ?? 0).toFixed(2)}%)`);
  lines.push(`- Slechtste: **${summary.worst_strategy_name ?? "—"}** (${((summary.worst_strategy_return as number) ?? 0).toFixed(2)}%)`);
  if ((evo.cycles as number) > 0) {
    lines.push(`- Evolutie: ${evo.cycles} cycli, max generatie Gen-${evo.max_generation}, ${retired.length} gepensioneerd`);
  }
  lines.push("");

  lines.push("## Posities");
  lines.push(`- ${(positions.closed_count as number) ?? 0} gesloten trades in totaal`);
  lines.push(`- ${(positions.open_count as number) ?? 0} open posities nu`);
  if ((positions.closed_count as number) > 0) {
    lines.push(`- Algehele hitrate: ${Math.round(((summary.overall_win_rate as number) ?? 0) * 100)}%`);
    const bySig = (positions.closed_by_signal as Record<string, Record<string, number>>) ?? {};
    const topSigs = Object.entries(bySig)
      .filter(([,v]) => v.count >= 3)
      .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct)
      .slice(0, 3);
    if (topSigs.length > 0) {
      lines.push(`- Beste signaaltype: **${topSigs[0][0]}** — gem. +${(topSigs[0][1].avg_return_pct ?? 0).toFixed(1)}%, ${topSigs[0][1].count} trades`);
    }
    const bySector = (positions.closed_by_sector as Record<string, Record<string, number>>) ?? {};
    const topSectors = Object.entries(bySector)
      .filter(([,v]) => v.count >= 3)
      .sort((a, b) => b[1].avg_return_pct - a[1].avg_return_pct)
      .slice(0, 2);
    if (topSectors.length > 0) {
      lines.push(`- Beste sector: **${topSectors[0][0]}** — gem. +${(topSectors[0][1].avg_return_pct ?? 0).toFixed(1)}%`);
    }
  }
  lines.push("");

  lines.push("## Configuratie-inzichten");
  if (insights.length === 0) {
    lines.push("Nog onvoldoende data voor configuratie-inzichten.");
  } else {
    for (const ins of insights.slice(0, 5)) {
      const i = ins as Record<string, unknown>;
      lines.push(`- **${i.dimension}**: "${i.best_value}" scoort +${((i.diff_pct as number) ?? 0).toFixed(1)}% beter dan "${i.worst_value}"`);
    }
  }
  lines.push("");

  lines.push("## Watchlist");
  lines.push(`- ${(watchlist.total as number) ?? 0} tickers (${(watchlist.active as number) ?? 0} actief, ${(watchlist.benched as number) ?? 0} op de bank)`);
  lines.push(`- ${(watchlist.with_buy_limit as number) ?? 0} tickers met een buy-limit ingesteld`);
  const bySect = (watchlist.by_sector as Record<string, number>) ?? {};
  for (const [sector, count] of Object.entries(bySect)) {
    lines.push(`  - ${sector}: ${count} tickers`);
  }
  lines.push("");

  lines.push("---");
  lines.push("Download de volledige JSON via het dashboard > 200 Strategieën > Evolutie > Kennis-export.");

  return lines.join("\n");
}

// ── Dimsnion insight helper (same as in sim-results but returns simple object) ─

function dimensionInsight(
  results: Array<{ config: Record<string, unknown>; total_return_pct: number }>,
  dim: string,
  getValue: (cfg: Record<string, unknown>) => string | null,
) {
  const vals = new Map<string, { sumRet: number; cnt: number }>();
  for (const r of results) {
    const v = getValue(r.config);
    if (v == null) continue;
    const cur = vals.get(v) ?? { sumRet: 0, cnt: 0 };
    cur.sumRet += r.total_return_pct; cur.cnt++;
    vals.set(v, cur);
  }
  const entries = [...vals.entries()]
    .map(([k, v]) => ({ value: k, avgRet: v.cnt > 0 ? v.sumRet / v.cnt : 0 }))
    .sort((a, b) => b.avgRet - a.avgRet);
  if (entries.length < 2) return null;
  const best = entries[0]; const worst = entries[entries.length - 1];
  const diff = best.avgRet - worst.avgRet;
  if (Math.abs(diff) < 0.5) return null;
  return { dimension: dim, best_value: best.value, worst_value: worst.value, diff_pct: +diff.toFixed(2) };
}

// ── Paginering ────────────────────────────────────────────────────────────────
// De Data API kapt elke request af op max-rows (hier 10k). Gesloten posities
// groeien onbeperkt en de watchlist telt 3700+ tickers — zonder paginering
// raakt de export stilletjes onvolledig.
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; from < 200_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}

// POST muteert (DB-insert, paper-config-update, GitHub-push) en vereist daarom
// admin-token of cron-secret — net als de andere schrijvende functies. GET
// (lijst/download) blijft open voor het dashboard.
function checkAdminOrCron(req: Request): boolean {
  const adminToken = Deno.env.get("ADMIN_TOKEN") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const isAdmin = adminToken !== "" && (req.headers.get("authorization") ?? "") === `Bearer ${adminToken}`;
  const isCron  = cronSecret !== "" && (req.headers.get("x-cron-secret") ?? "") === cronSecret;
  return isAdmin || isCron;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  const db = sb();
  const url = new URL(req.url);

  try {
    // GET: lijst of download
    if (req.method === "GET") {
      const id = url.searchParams.get("id");

      if (id) {
        // Download specifieke export
        const { data, error } = await db.from("xinix_knowledge_exports")
          .select("*").eq("id", parseInt(id)).single();
        if (error || !data) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...cors(req), "content-type": "application/json" } });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: {
            ...cors(req),
            "content-type": "application/json",
            "content-disposition": `attachment; filename="xinix-export-${id}-${new Date((data as Record<string, unknown>).exported_at as string).toISOString().slice(0,10)}.json"`,
          },
        });
      }

      // Lijst van exports (zonder export_data om bandbreedte te sparen)
      const { data, error } = await db.from("xinix_knowledge_exports")
        .select("id, exported_at, period_start, period_end, type, strategy_count, ticker_count, closed_positions_count, open_positions_count, best_strategy_name, best_strategy_return, worst_strategy_name, worst_strategy_return, avg_portfolio_return, strategies_in_profit, evolution_cycles, summary")
        .order("exported_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      return new Response(JSON.stringify({ exports: data ?? [] }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
    }

    // POST: maak nieuwe export
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!checkAdminOrCron(req)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors(req), "content-type": "application/json" } });
    }

    // Mini-modus: alleen config + CLAUDE.md bijwerken, geen volledige DB snapshot
    let isMini = false;
    try {
      const body = await req.json().catch(() => ({}));
      isMini = body?.mini === true;
    } catch { /* geen body */ }

    const now = new Date();

    // ── Parallel queries ────────────────────────────────────────────────────────
    const [
      stratRes, stateRes, closedRes, openRes,
      retiredRes, evolveRes, tickerRes, priceRes,
    ] = await Promise.all([
      db.from("xinix_strategies")
        .select("id, slug, name, grp, config, generation, protected, parent_id, active")
        .eq("active", true),
      fetchAllPages((f, t) => db.from("xinix_strategy_state")
        .select("strategy_id, cash, initial_capital, started_at, last_run_at")
        .order("strategy_id").range(f, t)),
      fetchAllPages((f, t) => db.from("xinix_strategy_positions")
        .select("strategy_id, ticker, return_usd, return_pct, entry_signal_types, entry_sector, entry_date, closed_at, entry_reason, closed_reason")
        .not("closed_at", "is", null)
        .order("closed_at", { ascending: false }).order("id").range(f, t)),
      fetchAllPages((f, t) => db.from("xinix_strategy_positions")
        .select("strategy_id, ticker, qty, avg_price, entry_date, entry_signal_types, entry_sector")
        .is("closed_at", null).order("id").range(f, t)),
      db.from("xinix_strategies")
        .select("id, name, grp, generation, retired_at, config")
        .eq("active", false)
        .order("retired_at", { ascending: false })
        .limit(100),
      // NB: signal_runs heeft geen kolom `ran_at` — de oude query daarop faalde
      // stilletjes, waardoor de evolutie-sectie in elke export leeg bleef.
      db.from("signal_runs")
        .select("finished_at, message")
        .eq("job", "xinix-evolve").eq("ok", true)
        .order("finished_at", { ascending: false, nullsFirst: false }).limit(20),
      fetchAllPages((f, t) => db.from("signal_tickers")
        .select("ticker, company, sector, buy_limit, medal_gold, medal_silver, medal_bronze, goud_score, active, price_benched, notes, exchange, goud_type, trigger_event, trigger_date, market_cap_bucket, phase, disease_area, modality, commodity, jurisdiction")
        .order("id").range(f, t)),
      fetchAllPages((f, t) => db.from("signal_price_summary")
        .select("ticker, last_close").order("ticker").range(f, t)),
    ]);

    // ── Price map ────────────────────────────────────────────────────────────────
    const priceMap = new Map<string, number>();
    for (const r of (priceRes.data ?? [])) {
      if (r.last_close != null) priceMap.set(r.ticker as string, Number(r.last_close));
    }

    // ── State map ───────────────────────────────────────────────────────────────
    const stateMap = new Map<number, Record<string, unknown>>();
    for (const s of (stateRes.data ?? [])) stateMap.set(s.strategy_id as number, s as Record<string, unknown>);

    // ── Open positions per strategy ─────────────────────────────────────────────
    const openByStrat = new Map<number, { val: number; cnt: number }>();
    const openList: unknown[] = [];
    for (const p of (openRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const px = priceMap.get(p.ticker as string) ?? Number(p.avg_price);
      const cur = openByStrat.get(sid) ?? { val: 0, cnt: 0 };
      cur.val += Number(p.qty) * px; cur.cnt++;
      openByStrat.set(sid, cur);
      openList.push({ strategy_id: sid, ticker: p.ticker, qty: p.qty, avg_price: p.avg_price, entry_date: p.entry_date, entry_signal_types: p.entry_signal_types, entry_sector: p.entry_sector });
    }

    // ── Closed positions aggregation ─────────────────────────────────────────────
    const closedBySig = new Map<string, { cnt: number; wins: number; sumRet: number }>();
    const closedBySector = new Map<string, { cnt: number; wins: number; sumRet: number }>();
    const closedByStrat = new Map<number, { cnt: number; wins: number; sumRet: number; totalRetUsd: number }>();
    const allClosed: unknown[] = [];

    for (const p of (closedRes.data ?? [])) {
      const sid = p.strategy_id as number;
      const ret = Number(p.return_pct ?? 0);
      const retUsd = Number(p.return_usd ?? 0);
      const win = ret > 0;

      // by strategy
      const sc = closedByStrat.get(sid) ?? { cnt: 0, wins: 0, sumRet: 0, totalRetUsd: 0 };
      sc.cnt++; if (win) sc.wins++; sc.sumRet += ret; sc.totalRetUsd += retUsd;
      closedByStrat.set(sid, sc);

      // by signal
      for (const sig of ((p.entry_signal_types as string[]) ?? [])) {
        const s = closedBySig.get(sig) ?? { cnt: 0, wins: 0, sumRet: 0 };
        s.cnt++; if (win) s.wins++; s.sumRet += ret;
        closedBySig.set(sig, s);
      }

      // by sector
      const sect = (p.entry_sector as string) || "other";
      const ss = closedBySector.get(sect) ?? { cnt: 0, wins: 0, sumRet: 0 };
      ss.cnt++; if (win) ss.wins++; ss.sumRet += ret;
      closedBySector.set(sect, ss);

      allClosed.push({
        strategy_id: sid, ticker: p.ticker,
        return_pct: ret, return_usd: retUsd,
        entry_date: p.entry_date, closed_at: p.closed_at,
        entry_signal_types: p.entry_signal_types,
        entry_reason: p.entry_reason, closed_reason: p.closed_reason,
      });
    }

    // sort: best trades + worst trades
    const sortedClosed = [...allClosed].sort((a, b) => (b as Record<string,number>).return_pct - (a as Record<string,number>).return_pct);
    const bestTrades  = sortedClosed.slice(0, 10);
    const worstTrades = sortedClosed.slice(-10).reverse();

    // ── Strategy performance ─────────────────────────────────────────────────────
    type StratPerf = {
      id: number; slug: string; name: string; grp: string;
      generation: number; protected: boolean; config: unknown;
      total_equity: number; total_return_pct: number;
      open_count: number; closed_count: number;
      win_rate: number; avg_return_pct: number;
      started_at: string | null; last_run_at: string | null;
    };

    const activeStrategies: StratPerf[] = [];
    for (const strat of (stratRes.data ?? [])) {
      const sid = strat.id as number;
      const state = stateMap.get(sid);
      if (!state) continue;
      const cash = Number(state.cash);
      const initial = Number(state.initial_capital ?? 10000);
      const ov = openByStrat.get(sid);
      const totalEquity = cash + (ov?.val ?? 0);
      const cStat = closedByStrat.get(sid) ?? { cnt: 0, wins: 0, sumRet: 0, totalRetUsd: 0 };
      activeStrategies.push({
        id: sid, slug: strat.slug as string, name: strat.name as string,
        grp: strat.grp as string, generation: (strat.generation as number) ?? 1,
        protected: (strat.protected as boolean) ?? false,
        config: strat.config,
        total_equity: +totalEquity.toFixed(2),
        total_return_pct: +((totalEquity - initial) / initial * 100).toFixed(4),
        open_count: ov?.cnt ?? 0,
        closed_count: cStat.cnt,
        win_rate: cStat.cnt > 0 ? +(cStat.wins / cStat.cnt).toFixed(4) : 0,
        avg_return_pct: cStat.cnt > 0 ? +(cStat.sumRet / cStat.cnt).toFixed(4) : 0,
        started_at: (state.started_at as string) ?? null,
        last_run_at: (state.last_run_at as string) ?? null,
      });
    }
    activeStrategies.sort((a, b) => b.total_return_pct - a.total_return_pct);
    activeStrategies.forEach((s, i) => { (s as Record<string,unknown>).rank = i + 1; });

    // ── Portfolio summary stats ──────────────────────────────────────────────────
    const returns = activeStrategies.map(s => s.total_return_pct).sort((a, b) => a - b);
    const median = returns.length > 0 ? returns[Math.floor(returns.length / 2)] : 0;
    const inProfit = returns.filter(r => r > 0).length;
    const inLoss   = returns.filter(r => r < 0).length;
    const totalClosed = allClosed.length;
    const totalWins = (closedRes.data ?? []).filter(p => Number(p.return_pct ?? 0) > 0).length;
    const overallWinRate = totalClosed > 0 ? totalWins / totalClosed : 0;
    const avgPortfolioReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;

    // ── Watchlist ────────────────────────────────────────────────────────────────
    const tickers = (tickerRes.data ?? []).map(t => ({
      ticker: t.ticker,
      company: t.company,
      sector: t.sector,
      exchange: t.exchange,
      buy_limit: t.buy_limit,
      medal_gold: t.medal_gold,
      medal_silver: t.medal_silver,
      medal_bronze: t.medal_bronze,
      goud_score: t.goud_score,
      goud_type: t.goud_type,
      active: t.active,
      benched: t.price_benched,
      notes: t.notes,
      last_close: priceMap.get(t.ticker as string) ?? null,
      // Biotech-specifiek
      phase: t.phase,
      disease_area: t.disease_area,
      modality: t.modality,
      trigger_event: t.trigger_event,
      trigger_date: t.trigger_date,
      market_cap_bucket: t.market_cap_bucket,
      // Mining-specifiek
      commodity: t.commodity,
      jurisdiction: t.jurisdiction,
    }));

    const watchlistBySector: Record<string, number> = {};
    for (const t of tickers) {
      const s = (t.sector as string) || "other";
      watchlistBySector[s] = (watchlistBySector[s] ?? 0) + 1;
    }

    // ── Config insights ──────────────────────────────────────────────────────────
    const cfgInsights = [
      dimensionInsight(activeStrategies, "Score-drempel",     cfg => cfg.minScore != null ? `≥${cfg.minScore}` : null),
      dimensionInsight(activeStrategies, "Tijdvenster (hold)", cfg => cfg.holdDays != null ? `${cfg.holdDays}d` : null),
      dimensionInsight(activeStrategies, "Stop-loss",          cfg => cfg.stop != null ? `-${(Number(cfg.stop)*100).toFixed(0)}%` : "geen stop"),
      dimensionInsight(activeStrategies, "Take-profit",        cfg => cfg.tp != null ? `+${(Number(cfg.tp)*100).toFixed(0)}%` : "geen TP"),
      dimensionInsight(activeStrategies, "Sector",             cfg => (cfg.sector as string) || "all"),
      dimensionInsight(activeStrategies, "Max posities",       cfg => cfg.maxPos != null ? `${cfg.maxPos} pos` : null),
      dimensionInsight(activeStrategies, "Positiegrootte",     cfg => cfg.posSize != null ? `$${cfg.posSize}` : null),
      dimensionInsight(activeStrategies, "Rood-signaal vereist", cfg => cfg.redReq ? "Rood vereist" : "Rood optioneel"),
      dimensionInsight(activeStrategies, "Limiet-buffer",       cfg => cfg.limitBuf != null ? `+${(Number(cfg.limitBuf)*100).toFixed(0)}%` : "geen limiet"),
      dimensionInsight(activeStrategies, "Min goud-medailles",  cfg => cfg.minGold != null ? `≥${cfg.minGold} goud` : null),
    ].filter(Boolean);

    // ── Paper portfolio config bijwerken op basis van top-strategie inzichten ────
    // Alleen als er voldoende data is (≥ 5 actieve strategieën met gesloten trades).
    const configUpdateLog = await (async () => {
      if (activeStrategies.length < 5) return "te weinig strategieën";
      const updates: Record<string, unknown> = { updated_at: now.toISOString(), updated_by: "knowledge-export" };
      const changes: string[] = [];

      for (const ins of (cfgInsights as Array<Record<string, unknown>>)) {
        if ((ins.diff_pct as number) < 5) continue; // alleen bij >5% verschil
        const best = ins.best_value as string;

        if (ins.dimension === "Score-drempel") {
          const m = best.match(/≥(\d+)/);
          if (m) { const v = parseInt(m[1]); if (v >= 50 && v <= 80) { updates.entry_min_score = v; changes.push(`entry_min_score≥${v}`); } }
        }
        if (ins.dimension === "Tijdvenster (hold)") {
          const m = best.match(/(\d+)d/);
          if (m) { const v = parseInt(m[1]); if (v >= 20 && v <= 180) { updates.hold_days = v; changes.push(`hold_days=${v}d`); } }
        }
        if (ins.dimension === "Limiet-buffer") {
          const m = best.match(/\+(\d+)%/);
          if (m) { const v = parseFloat(m[1]) / 100; if (v >= 0 && v <= 0.25) { updates.entry_limit_buffer = v; changes.push(`entry_limit_buffer=+${m[1]}%`); } }
        }
        if (ins.dimension === "Stop-loss") {
          const m = best.match(/-(\d+(?:\.\d+)?)%/);
          if (m) { const v = parseFloat(m[1]) / 100; if (v >= 0.05 && v <= 0.30) { updates.stop_loss = v; changes.push(`stop_loss=-${m[1]}%`); } }
        }
      }

      if (changes.length > 0) {
        await db.from("xinix_paper_config").update(updates).eq("id", 1);
        return `Paper config bijgewerkt: ${changes.join(", ")}`;
      }
      return "Paper config ongewijzigd";
    })();

    // ── Evolutie ─────────────────────────────────────────────────────────────────
    const evolveRuns = evolveRes.data ?? [];
    const maxGen = Math.max(...activeStrategies.map(s => s.generation), 1);
    const protectedCount = activeStrategies.filter(s => s.protected).length;

    // ── Samenvoegen tot export ───────────────────────────────────────────────────
    const exportData = {
      meta: {
        exported_at: now.toISOString(),
        period_start: null as string | null,
        period_end: now.toISOString(),
        type: "manual",
        version: 1,
      },
      strategies: {
        active: activeStrategies,
        retired: (retiredRes.data ?? []).map(r => ({
          id: r.id, name: r.name, grp: r.grp, generation: r.generation ?? 1,
          retired_at: r.retired_at, config: r.config,
        })),
        evolution: {
          cycles: evolveRuns.length,
          max_generation: maxGen,
          protected_count: protectedCount,
          last_evolved_at: evolveRuns[0]?.finished_at ?? null,
          run_log: evolveRuns.map(r => ({ at: r.finished_at, message: r.message })),
        },
      },
      positions: {
        open_count: openList.length,
        open_positions: openList,
        closed_count: totalClosed,
        closed_by_strategy: Object.fromEntries(
          [...closedByStrat.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            total_return_usd: +v.totalRetUsd.toFixed(2),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        closed_by_signal: Object.fromEntries(
          [...closedBySig.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        closed_by_sector: Object.fromEntries(
          [...closedBySector.entries()].map(([k, v]) => [k, {
            count: v.cnt, wins: v.wins,
            win_rate: +(v.cnt > 0 ? v.wins / v.cnt : 0).toFixed(4),
            avg_return_pct: +(v.cnt > 0 ? v.sumRet / v.cnt : 0).toFixed(4),
          }])
        ),
        best_trades: bestTrades,
        worst_trades: worstTrades,
      },
      watchlist: {
        total: tickers.length,
        active: tickers.filter(t => t.active).length,
        benched: tickers.filter(t => t.benched).length,
        with_buy_limit: tickers.filter(t => t.buy_limit != null).length,
        by_sector: watchlistBySector,
        tickers,
      },
      config_insights: cfgInsights,
      summary: {
        best_strategy_name: activeStrategies[0]?.name ?? null,
        best_strategy_return: activeStrategies[0]?.total_return_pct ?? null,
        worst_strategy_name: activeStrategies[activeStrategies.length - 1]?.name ?? null,
        worst_strategy_return: activeStrategies[activeStrategies.length - 1]?.total_return_pct ?? null,
        median_return_pct: +median.toFixed(4),
        avg_portfolio_return: +avgPortfolioReturn.toFixed(4),
        strategies_in_profit: inProfit,
        strategies_at_loss: inLoss,
        total_closed_trades: totalClosed,
        overall_win_rate: +overallWinRate.toFixed(4),
      },
    };

    // Bereken period_start: vorige maand 1e dag
    const ps = new Date(now);
    ps.setDate(1); ps.setMonth(ps.getMonth() - 1); ps.setHours(0,0,0,0);
    exportData.meta.period_start = ps.toISOString();

    // ── Markdown samenvatting ────────────────────────────────────────────────────
    const summaryText = buildSummary(exportData as unknown as Record<string, unknown>, now);

    // ── Mini-modus: sla DB-insert en email over ───────────────────────────────────
    if (isMini) {
      const kennisbasisMini = buildKennisbasis(exportData as unknown as Record<string, unknown>, now, null);
      await pushToGitHub(
        "docs/kennisbasis.md",
        kennisbasisMini,
        `chore: kennisbasis wekelijks bijgewerkt ${now.toISOString().slice(0,10)}`,
      );
      // CLAUDE.md update
      const miniClaudeSection = [
        `_Wekelijkse update: **${now.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}**_`,
        "",
        `**Beste strategie**: ${exportData.summary.best_strategy_name} (+${(exportData.summary.best_strategy_return ?? 0).toFixed(2)}%)`,
        `**Mediaan rendement**: ${((exportData.summary.median_return_pct as number) ?? 0).toFixed(2)}%`,
        `**Hitrate**: ${Math.round(((exportData.summary.overall_win_rate as number) ?? 0) * 100)}% over ${(exportData.summary.total_closed_trades as number) ?? 0} gesloten trades`,
        `**Paper config**: ${configUpdateLog}`,
        "",
        ...((() => {
          const ins = (exportData.config_insights as Array<Record<string, unknown>>) ?? [];
          if (ins.length === 0) return ["_Nog geen configuratie-inzichten._"];
          return ["**Top configuratie-inzichten:**", ...ins.slice(0,3).map(i => `- ${i.dimension}: "${i.best_value}" scoort +${(i.diff_pct as number).toFixed(1)}% beter dan "${i.worst_value}"`)];
        })()),
        "",
        `Zie \`docs/kennisbasis.md\` voor de volledige tabel met alle strategieën, signalen en aanbevelingen.`,
      ].join("\n");
      try {
        const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/CLAUDE.md`;
        const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "xinix-knowledge-export", "Content-Type": "application/json" };
        if (GITHUB_TOKEN) {
          const getRes = await fetch(`${base}?ref=${GITHUB_BRANCH}`, { headers });
          if (getRes.ok) {
            const j = await getRes.json();
            const currentContent = new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
            const m1 = "<!-- KENNISBASIS_START -->"; const m2 = "<!-- KENNISBASIS_END -->";
            const i1 = currentContent.indexOf(m1); const i2 = currentContent.indexOf(m2);
            if (i1 >= 0 && i2 > i1) {
              const updated = currentContent.slice(0, i1 + m1.length) + "\n" + miniClaudeSection + "\n" + currentContent.slice(i2);
              await fetch(base, { method: "PUT", headers, body: JSON.stringify({ message: `chore: CLAUDE.md wekelijks bijgewerkt ${now.toISOString().slice(0,10)}`, content: btoa(unescape(encodeURIComponent(updated))), sha: j.sha, branch: GITHUB_BRANCH }) }).catch(() => {});
            }
          }
        }
      } catch { /* non-fatal */ }

      await db.from("signal_runs").insert({ job: "xinix-knowledge-export", ok: true, finished_at: now.toISOString(), message: `Mini-export: ${activeStrategies.length} strategieën, ${configUpdateLog}` });
      return new Response(JSON.stringify({ ok: true, mini: true, config_update: configUpdateLog, strategy_count: activeStrategies.length }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });
    }

    // ── Opslaan in DB ─────────────────────────────────────────────────────────────
    const { data: savedRow, error: saveErr } = await db.from("xinix_knowledge_exports").insert({
      exported_at: now.toISOString(),
      period_start: exportData.meta.period_start,
      period_end: now.toISOString(),
      type: "monthly_auto",
      strategy_count: activeStrategies.length,
      ticker_count: tickers.length,
      closed_positions_count: totalClosed,
      open_positions_count: openList.length,
      best_strategy_name: exportData.summary.best_strategy_name,
      best_strategy_return: exportData.summary.best_strategy_return,
      worst_strategy_name: exportData.summary.worst_strategy_name,
      worst_strategy_return: exportData.summary.worst_strategy_return,
      avg_portfolio_return: exportData.summary.avg_portfolio_return,
      strategies_in_profit: inProfit,
      evolution_cycles: evolveRuns.length,
      export_data: exportData,
      summary: summaryText,
    }).select("id").single();

    // Mislukte opslag is een mislukte export: log ok:false en stop — anders
    // meldt de run "ok" terwijl de maandsnapshot ontbreekt en niemand het merkt.
    if (saveErr) {
      console.error("save error:", saveErr.message);
      await db.from("signal_runs").insert({
        job: "xinix-knowledge-export", ok: false,
        finished_at: now.toISOString(),
        message: `Export-opslag faalde: ${saveErr.message}`,
      });
      return new Response(JSON.stringify({ ok: false, error: `opslag faalde: ${saveErr.message}` }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
    }
    const savedId = (savedRow as Record<string,unknown> | null)?.id as number | null;

    // ── Log in signal_runs ────────────────────────────────────────────────────────
    await db.from("signal_runs").insert({
      job: "xinix-knowledge-export", ok: true,
      finished_at: now.toISOString(),
      message: `Export #${savedId ?? "?"}: ${activeStrategies.length} strategieën, ${totalClosed} gesloten trades, ${tickers.length} tickers`,
    });

    // ── Kennisbasis naar GitHub pushen ────────────────────────────────────────────
    const kennisbasis = buildKennisbasis(exportData as unknown as Record<string, unknown>, now, savedId);
    const monthLabel = now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

    // docs/kennisbasis.md — uitgebreide versie
    await pushToGitHub(
      "docs/kennisbasis.md",
      kennisbasis,
      `chore: kennisbasis bijgewerkt ${now.toISOString().slice(0,10)} (export #${savedId ?? "?"})`,
    );

    // CLAUDE.md — update KENNISBASIS_START...KENNISBASIS_END sectie
    const claudeSection = [
      `_Laatste export: **${monthLabel}** (export #${savedId ?? "?"})_`,
      "",
      `**Beste strategie**: ${exportData.summary.best_strategy_name} (+${(exportData.summary.best_strategy_return ?? 0).toFixed(2)}%)`,
      `**Paper config update**: ${configUpdateLog}`,
      `**Slechtste strategie**: ${exportData.summary.worst_strategy_name} (${(exportData.summary.worst_strategy_return ?? 0).toFixed(2)}%)`,
      `**Mediaan rendement**: ${((exportData.summary.median_return_pct as number) ?? 0).toFixed(2)}%`,
      `**Hitrate**: ${Math.round(((exportData.summary.overall_win_rate as number) ?? 0) * 100)}% over ${(exportData.summary.total_closed_trades as number) ?? 0} gesloten trades`,
      "",
      ...((() => {
        const insights = (exportData.config_insights as Array<Record<string, unknown>>) ?? [];
        if (insights.length === 0) return ["_Nog geen configuratie-inzichten._"];
        return ["**Top configuratie-inzichten:**", ...insights.slice(0,3).map(i => `- ${i.dimension}: "${i.best_value}" scoort +${(i.diff_pct as number).toFixed(1)}% beter dan "${i.worst_value}"`)];
      })()),
      "",
      `Zie \`docs/kennisbasis.md\` voor de volledige tabel met alle strategieën, signalen en aanbevelingen.`,
    ].join("\n");

    // Fetch CLAUDE.md, replace sectie tussen markers
    try {
      const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/CLAUDE.md`;
      const headers = {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "xinix-knowledge-export",
        "Content-Type": "application/json",
      };
      if (GITHUB_TOKEN) {
        const getRes = await fetch(`${base}?ref=${GITHUB_BRANCH}`, { headers });
        if (getRes.ok) {
          const j = await getRes.json();
          const currentContent = new TextDecoder().decode(
            Uint8Array.from(atob(j.content.replace(/\n/g, "")), c => c.charCodeAt(0))
          );
          const marker1 = "<!-- KENNISBASIS_START -->";
          const marker2 = "<!-- KENNISBASIS_END -->";
          const i1 = currentContent.indexOf(marker1);
          const i2 = currentContent.indexOf(marker2);
          if (i1 >= 0 && i2 > i1) {
            const updated = currentContent.slice(0, i1 + marker1.length) + "\n" + claudeSection + "\n" + currentContent.slice(i2);
            await fetch(base, {
              method: "PUT", headers,
              body: JSON.stringify({
                message: `chore: CLAUDE.md kennisbasis bijgewerkt ${now.toISOString().slice(0,10)}`,
                content: btoa(unescape(encodeURIComponent(updated))),
                sha: j.sha,
                branch: GITHUB_BRANCH,
              }),
            }).catch(() => {});
          }
        }
      }
    } catch { /* non-fatal */ }

    // ── Notificaties ─────────────────────────────────────────────────────────────
    const best = exportData.summary;
    const notifMsg = `${activeStrategies.length} strategieën · ${totalClosed} gesloten trades · beste: ${best.best_strategy_name} +${(best.best_strategy_return ?? 0).toFixed(1)}% · mediaan: ${median.toFixed(1)}% · ${configUpdateLog}`;
    await Promise.all([
      sendNtfy("📊 Xinix maandelijkse kennisexport", notifMsg),
      sendEmail(NOTIFY_EMAIL, `📊 Xinix kennisexport — ${now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" })}`, summaryText),
    ]);

    return new Response(JSON.stringify({
      ok: true,
      export_id: savedId,
      strategy_count: activeStrategies.length,
      ticker_count: tickers.length,
      closed_positions_count: totalClosed,
      best_strategy: { name: best.best_strategy_name, return_pct: best.best_strategy_return },
    }), { status: 200, headers: { ...cors(req), "content-type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("knowledge-export error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
  }
});
