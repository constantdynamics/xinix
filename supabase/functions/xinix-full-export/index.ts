// xinix-full-export — wekelijkse, volledige, zelf-beschrijvende data-export.
//
// Doel: kennisbehoud. Als Supabase of de website ooit verdwijnt, moet de
// opgebouwde data + het idee erachter behouden blijven, zodat een
// vervangende website meteen verder kan zonder de jaren leerwerk te verliezen.
//
// Elke run:
//   1. Dumpt de waardevolle tabellen — de onvervangbare gecureerde data
//      volledig, de bulkige her-afleidbare tabellen ingekort.
//   2. Voegt een uitgebreide UITLEG toe (concept + per-tabel veld-glossarium).
//   3. Commit het geheel naar de Git-repo (docs/data-export/) — die staat los
//      van Supabase en overleeft dus een verdwijnende site.
//   4. Bewaart de laatste export in xinix_data_exports voor download via het
//      dashboard.
//
// GET  → laatste export downloaden (JSON)
// POST → nieuwe export maken (wekelijkse cron of admin)
//
// Geheugen: de export-JSON wordt incrementeel als string opgebouwd (tabel voor
// tabel) en als tekst opgeslagen. Zo staat nooit alle data tegelijk geparsed
// in het geheugen — een eerdere versie laadde alles dubbel en crashte op de
// geheugenlimiet van de edge runtime.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function getServiceClient() {
  const u = Deno.env.get("SUPABASE_URL");
  const k = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!u || !k) throw new Error("env");
  return createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = new Set(["https://constantdynamics.github.io", "http://localhost:5173", "http://localhost:4173"]);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "access-control-allow-origin": ALLOWED.has(o) ? o : "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-cron-secret, apikey",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}
function checkAuth(req: Request): boolean {
  const t = Deno.env.get("ADMIN_TOKEN");
  if (!t) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${t}`;
}
function checkCron(req: Request): boolean {
  const t = Deno.env.get("CRON_SECRET");
  if (!t) return false;
  return (req.headers.get("x-cron-secret") ?? "") === t;
}

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GITHUB_REPO = "constantdynamics/xinix";
const GITHUB_BRANCH = "claude/poll-fundamentals-background-5TjhG";

// Commit één of meer bestanden in één commit naar de repo, via de Git Data API.
// De Contents API werkt slecht voor grote bestanden (base64-payload, ~1 MB-
// advieslimiet); de Git Data API verwerkt grote blobs en stuurt de inhoud
// rechtstreeks als UTF-8 — geen base64, dus ook geen extra geheugenpieken.
async function commitToGitHub(files: { path: string; content: string }[], message: string): Promise<boolean> {
  if (!GITHUB_TOKEN) return false;
  const api = `https://api.github.com/repos/${GITHUB_REPO}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "xinix-full-export",
    "Content-Type": "application/json",
  };
  const gh = async (path: string, init?: RequestInit): Promise<Record<string, unknown>> => {
    const res = await fetch(`${api}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
    return await res.json();
  };

  // 1. Huidige branch-tip + bijbehorende boom.
  const ref = await gh(`/git/ref/heads/${GITHUB_BRANCH}`);
  const parentSha = (ref.object as { sha: string }).sha;
  const parentCommit = await gh(`/git/commits/${parentSha}`);
  const baseTree = (parentCommit.tree as { sha: string }).sha;

  // 2. Een blob per bestand (UTF-8, geen base64).
  const tree: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const f of files) {
    const blob = await gh(`/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: f.content, encoding: "utf-8" }),
    });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha as string });
  }

  // 3. Nieuwe boom, commit en branch-update.
  const newTree = await gh(`/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree }),
  });
  const commit = await gh(`/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
  });
  await gh(`/git/refs/heads/${GITHUB_BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  return true;
}

type SB = ReturnType<typeof getServiceClient>;

// Gepagineerde fetch — Supabase geeft max 1000 rijen per request. Met `cap`
// (+ aflopende sortering) pak je alleen de N meest recente rijen.
async function fetchRows(
  db: SB,
  table: string,
  select: string,
  opts?: { orderCol?: string; ascending?: boolean; cap?: number },
): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(select).range(from, from + PAGE - 1);
    if (opts?.orderCol) q = q.order(opts.orderCol, { ascending: opts.ascending ?? true });
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    if (opts?.cap && out.length >= opts.cap) break;
  }
  return opts?.cap ? out.slice(0, opts.cap) : out;
}

// ── De uitleg ────────────────────────────────────────────────────────────────
// Zelf-beschrijvend: wie dit bestand opent, begrijpt het idee én de tabellen
// zonder de originele code of website nodig te hebben.
const DOCUMENTATION = {
  _lees_dit_eerst:
    "Dit is een volledige, zelf-beschrijvende export van het Xinix-systeem. " +
    "Het bevat alle opgebouwde data PLUS de uitleg eronder, zodat het idee en " +
    "de jarenlange leerdata niet verloren gaan als de originele website verdwijnt. " +
    "Om een vervangende site te bouwen: lees 'concept' en 'architectuur', en " +
    "gebruik 'tabellen' als databaseschema. De ruwe rijen staan onder de sleutel 'data'.",

  concept:
    "Xinix is een fictieve belegger die leert beleggen door te experimenteren. " +
    "Het systeem onderhoudt een watchlist van 3700+ aandelen (biotech + mining), " +
    "detecteert koers- en nieuwssignalen, en test beleggingsstrategieën op " +
    "papier (geen echt geld). Er zijn twee gesimuleerde portefeuilles: " +
    "(1) een 200-strategie-simulatie — 200 parallelle papieren portefeuilles van " +
    "$10.000, elk met andere parameters, die wekelijks evolueren (slechtste 5% " +
    "gepensioneerd, beste 5% gemuteerd); en (2) één gecureerde 'single paper " +
    "portfolio' die het beste leert beleggen. Het doel: ontdekken welke " +
    "selectie- en exit-regels historisch het beste werken.",

  architectuur:
    "Frontend: React + TypeScript op GitHub Pages. Backend: Supabase Edge " +
    "Functions (Deno/TypeScript) + PostgreSQL. Scheduling via pg_cron. " +
    "Dagelijks na de Amerikaanse beurssluiting draaien de simulaties; wekelijks " +
    "de evolutie; periodiek de kennis-exports. Koersen komen van Yahoo Finance, " +
    "nieuws/catalysts van Google News RSS en ClinicalTrials.gov/openFDA.",

  belangrijke_concepten: {
    transactiekosten:
      "TX_COST = 0,1% per transactie. Kopen: cash -= qty×prijs×(1+0,001). " +
      "Verkopen: cash += qty×prijs×(1-0,001). Geldt bij elke koop, exit en deelverkoop.",
    slimme_exits:
      "Elke open positie wordt dagelijks getoetst aan vier exit-regels: " +
      "(a) trailing stop — stop schuift mee omhoog met de koers, nooit omlaag; " +
      "(b) deelwinst — verkoop de helft halverwege het take-profit-doel; " +
      "(c) signaalverval — sluit bij verlies als alle entry-signalen verlopen zijn; " +
      "(d) kansrotatie — vervang de slechtste positie door een betere kandidaat.",
    signalen_en_scores:
      "signal_events = gedetecteerde gebeurtenissen (koersuitbraken, nieuws-catalysts). " +
      "signal_catalysts = aankomende/recente fundamentele gebeurtenissen. " +
      "signal_scores = per ticker een driedimensionale score (structureel × catalyst × " +
      "timing) met een eindoordeel: STRONG_BUY / BUY / WATCH / HOLD / AVOID.",
    medailles:
      "Tickers krijgen goud/zilver/brons-medailles op basis van historische " +
      "koers-runs (5 jaar). Meer/hoger = sterker track record.",
    aankooplimiet:
      "buy_limit = de prijs waaronder de belegger het aandeel wil kopen. " +
      "'above_limit_pct' geeft aan hoeveel % de koers daar nu boven of onder zit.",
  },

  tabellen: {
    signal_tickers:
      "De watchlist — de meest waardevolle, met de hand gecureerde data. Eén rij " +
      "per aandeel. Alle kolommen behalve phoenix_loose_data en poefie_loose_data " +
      "(ruwe, her-afleidbare caches die compute-phoenix/compute-poefies opnieuw " +
      "kunnen genereren). De gedistilleerde samenvattingen (is_phoenix, " +
      "poefie_count_*, phoenix_incident_count, ...) blijven wél behouden. " +
      "Sleutelvelden: ticker, company, sector (biotech/mining), goud_score, " +
      "medal_gold/silver/bronze, buy_limit, is_phoenix/is_poefie/is_hikkertje " +
      "(speciale koerspatroon-classificaties), active.",
    signal_price_summary:
      "Laatste bekende slotkoers per ticker. Volledig. Sleutelvelden: ticker, last_close.",
    signal_events:
      "Gedetecteerde gebeurtenissen — ingekort tot de recentste ~2000 (bulkig en " +
      "deels her-afleidbaar). Sleutelvelden: ticker, signal_type, severity " +
      "(yellow/orange/red), title, detail, detected_at, payload.",
    signal_catalysts:
      "Aankomende/recente fundamentele catalysts (resource estimate, PFS, FDA-" +
      "besluit, ...). Volledig. Sleutelvelden: ticker, catalyst_type, expected_date, status.",
    signal_scores:
      "Berekende scores per ticker — ingekort tot de recentste ~2000 (bulkig en " +
      "her-afleidbaar uit de signalen). Sleutelvelden: ticker, scan_date, structural, " +
      "catalyst, timing, final_score, action.",
    xinix_strategies:
      "Config van alle ~200 simulatie-strategieën. Volledig. Sleutelvelden: id, slug, " +
      "name, grp (groep), config (JSON met parameters), generation, active, parent_id.",
    xinix_strategy_state:
      "Kas + kapitaal per strategie. Volledig. Sleutelvelden: strategy_id, cash, " +
      "initial_capital, max_equity, max_drawdown_pct.",
    xinix_strategy_positions:
      "Alle open + gesloten posities van de 200 strategieën. Volledig. Sleutelvelden: " +
      "strategy_id, ticker, qty, avg_price, opened_at, closed_at, return_pct, " +
      "partial_exits (JSON met deelverkopen).",
    xinix_paper_positions:
      "Posities van de single gecureerde papieren portefeuille. Volledig. Zelfde " +
      "structuur als xinix_strategy_positions.",
    xinix_paper_config:
      "Configuratie van de single paper portfolio (stop-loss, positiegrootte, ...). Volledig.",
    market_regime:
      "Huidige marktfase op basis van de S&P 500 (SPY) en VIX. Volledig. Velden: regime " +
      "(strong_bull/weak_bull/bear), spy_close, ma_50, ma_200, vix_close.",
    xinix_knowledge_exports:
      "Maandelijkse kennis-snapshots (samenvatting + markdown). Hier zonder het " +
      "volledige export_data-blob om dubbele nesting te voorkomen.",
    signal_runs:
      "Log van edge-function-runs (recentste ~1000). Operationeel, geen kennis — " +
      "ingekort. Velden: job, ok, message, metrics, started_at/finished_at.",
  },

  hoe_te_gebruiken:
    "Een vervangende website bouwen: (1) maak een PostgreSQL-database met de " +
    "tabellen uit 'tabellen' als schema; (2) importeer de rijen uit 'data'; " +
    "(3) de watchlist (signal_tickers) en de strategie-resultaten " +
    "(xinix_strategies + _state + _positions) zijn de kern — daarmee weet je " +
    "welke parameters historisch werkten; (4) koersen en nieuws kun je opnieuw " +
    "ophalen, maar de gecureerde watchlist en de leerresultaten zijn " +
    "onvervangbaar. Dit bestand alleen al is genoeg voor een vliegende start.",
} as const;

function buildReadme(meta: { exported_at: string; total_rows: number; row_counts: Record<string, number> }): string {
  const L: string[] = [];
  L.push("# Xinix — Volledige data-export");
  L.push("");
  L.push("> Automatisch wekelijks gegenereerd. Dit is een **kennisbehoud-archief**:");
  L.push("> als de Xinix-website ooit verdwijnt, bevat dit bestand alle opgebouwde");
  L.push("> data én de uitleg om er meteen mee verder te kunnen.");
  L.push("");
  L.push(`**Laatste export:** ${meta.exported_at}`);
  L.push(`**Totaal rijen:** ${meta.total_rows.toLocaleString("nl-NL")}`);
  L.push("");
  L.push("## Bestanden");
  L.push("");
  L.push("- `xinix-data-export.json` — de volledige export: uitleg + alle data.");
  L.push("- `README.md` — dit bestand.");
  L.push("");
  L.push("## Wat is Xinix?");
  L.push("");
  L.push(DOCUMENTATION.concept);
  L.push("");
  L.push("## Architectuur");
  L.push("");
  L.push(DOCUMENTATION.architectuur);
  L.push("");
  L.push("## Inhoud van de export (rijen per tabel)");
  L.push("");
  L.push("| Tabel | Rijen | Beschrijving |");
  L.push("|---|---:|---|");
  for (const [tbl, desc] of Object.entries(DOCUMENTATION.tabellen)) {
    const n = meta.row_counts[tbl] ?? 0;
    L.push(`| \`${tbl}\` | ${n.toLocaleString("nl-NL")} | ${desc} |`);
  }
  L.push("");
  L.push("## Een vervangende site bouwen");
  L.push("");
  L.push(DOCUMENTATION.hoe_te_gebruiken);
  L.push("");
  L.push("---");
  L.push("");
  L.push("De volledige veld-uitleg en concepten staan ook in `xinix-data-export.json` onder de sleutel `documentation`.");
  L.push("");
  return L.join("\n");
}

async function logRun(db: SB, ok: boolean, message: string, metrics?: Record<string, unknown>) {
  try {
    await db.from("signal_runs").insert({ job: "xinix-full-export", ok, message, metrics: metrics ?? null });
  } catch { /* logging mag de run niet laten falen */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  const db = getServiceClient();

  // ── GET: laatste export downloaden ──────────────────────────────────────────
  // export_data is een kant-en-klare JSON-string (text-kolom) — direct teruggeven.
  if (req.method === "GET") {
    const { data, error } = await db.from("xinix_data_exports").select("exported_at, export_data").eq("id", 1).maybeSingle();
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors(req), "content-type": "application/json" } });
    const exportData = (data as Record<string, unknown> | null)?.export_data as string | null | undefined;
    if (!exportData) return new Response(JSON.stringify({ error: "nog geen export beschikbaar" }), { status: 404, headers: { ...cors(req), "content-type": "application/json" } });
    const day = String((data as Record<string, unknown>).exported_at ?? "").slice(0, 10);
    return new Response(exportData, {
      status: 200,
      headers: {
        ...cors(req),
        "content-type": "application/json",
        "content-disposition": `attachment; filename="xinix-data-export-${day}.json"`,
      },
    });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors(req) });
  if (!checkAuth(req) && !checkCron(req)) return new Response("Unauthorized", { status: 401, headers: cors(req) });

  const startMs = Date.now();
  try {
    const now = new Date();

    // ── Tabellen ophalen ──────────────────────────────────────────────────────
    // Onvervangbaar (volledig): watchlist, strategieën, posities, catalysts, config.
    // Ingekort (recent): signalen, scores, run-log — bulkig en deels her-afleidbaar.
    const KNOWLEDGE_COLS =
      "id, exported_at, period_start, period_end, type, strategy_count, ticker_count, " +
      "closed_positions_count, open_positions_count, best_strategy_name, best_strategy_return, " +
      "worst_strategy_name, worst_strategy_return, avg_portfolio_return, strategies_in_profit, " +
      "evolution_cycles, summary";

    // `exclude`: kolommen die uit `select *` worden gestript — ruwe, her-
    // afleidbare caches (geen gecureerde kennis) die alleen ruimte kosten.
    const specs: {
      table: string;
      select: string;
      exclude?: string[];
      opts?: { orderCol: string; ascending: boolean; cap: number };
    }[] = [
      { table: "signal_tickers", select: "*", exclude: ["phoenix_loose_data", "poefie_loose_data"] },
      { table: "signal_price_summary", select: "*" },
      { table: "xinix_strategies", select: "*" },
      { table: "xinix_strategy_state", select: "*" },
      { table: "xinix_strategy_positions", select: "*" },
      { table: "xinix_paper_positions", select: "*" },
      { table: "xinix_paper_config", select: "*" },
      { table: "signal_catalysts", select: "*" },
      { table: "market_regime", select: "*" },
      { table: "xinix_knowledge_exports", select: KNOWLEDGE_COLS },
      { table: "signal_events", select: "*", opts: { orderCol: "detected_at", ascending: false, cap: 2000 } },
      { table: "signal_scores", select: "*", opts: { orderCol: "scan_date", ascending: false, cap: 2000 } },
      { table: "signal_runs", select: "*", opts: { orderCol: "id", ascending: false, cap: 1000 } },
    ];

    // Incrementeel opbouwen: per tabel ophalen → meteen naar een JSON-fragment →
    // de geparseerde rij-objecten loslaten. Zo staat nooit alle data tegelijk
    // als objectgraaf in het geheugen.
    const dataParts: string[] = [];
    const rowCounts: Record<string, number> = {};
    const tableErrors: Record<string, string> = {};
    for (const s of specs) {
      try {
        const rows = await fetchRows(db, s.table, s.select, s.opts);
        if (s.exclude) {
          for (const r of rows) for (const c of s.exclude) delete r[c];
        }
        rowCounts[s.table] = rows.length;
        dataParts.push(JSON.stringify(s.table) + ":" + JSON.stringify(rows));
      } catch (e) {
        tableErrors[s.table] = e instanceof Error ? e.message : String(e);
        rowCounts[s.table] = 0;
        dataParts.push(JSON.stringify(s.table) + ":[]");
      }
    }
    let dataJson: string | null = "{" + dataParts.join(",") + "}";
    dataParts.length = 0;

    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
    const exportMeta = {
      generated_at: now.toISOString(),
      format_version: 1,
      project: "Xinix — gesimuleerde belegger",
      source_repo: GITHUB_REPO,
      table_count: specs.length,
      total_rows: totalRows,
      row_counts: rowCounts,
      table_errors: Object.keys(tableErrors).length ? tableErrors : undefined,
      note:
        "Compacte export: de onvervangbare gecureerde data (watchlist, strategieën, " +
        "posities, portfolio, catalysts) is volledig. Signalen en scores zijn " +
        "ingekort tot de recentste rijen — zie documentation.tabellen.",
    };

    // Eindbestand als string samenstellen — geen tweede objectgraaf, geen
    // dubbele serialisatie.
    let json: string | null =
      '{"export_meta":' + JSON.stringify(exportMeta) +
      ',"documentation":' + JSON.stringify(DOCUMENTATION) +
      ',"data":' + dataJson + "}";
    dataJson = null;

    const readme = buildReadme({ exported_at: now.toISOString(), total_rows: totalRows, row_counts: rowCounts });

    // ── Naar de Git-repo committen (overleeft een verdwijnende site) ──────────
    const day = now.toISOString().slice(0, 10);
    let githubCommitted = false;
    let githubError: string | null = null;
    try {
      githubCommitted = await commitToGitHub(
        [
          { path: "docs/data-export/xinix-data-export.json", content: json },
          { path: "docs/data-export/README.md", content: readme },
        ],
        `chore: wekelijkse data-export ${day} (${totalRows} rijen)`,
      );
    } catch (e) {
      githubError = e instanceof Error ? e.message : String(e);
    }

    // ── Laatste export bewaren voor download via het dashboard ────────────────
    const { error: upsertError } = await db.from("xinix_data_exports").upsert({
      id: 1,
      exported_at: now.toISOString(),
      table_count: specs.length,
      total_rows: totalRows,
      row_counts: rowCounts,
      github_committed: githubCommitted,
      export_data: json,
    });
    json = null;
    if (upsertError) throw new Error(`opslaan in xinix_data_exports mislukt: ${upsertError.message}`);

    const githubStatus = githubCommitted ? "ok" : githubError ? "fout" : "geen token";
    const msg =
      `Export: ${totalRows} rijen, ${specs.length} tabellen, github=${githubStatus}` +
      (githubError ? ` (${githubError})` : "") +
      (Object.keys(tableErrors).length ? `, tabelfouten: ${Object.keys(tableErrors).join(", ")}` : "");
    await logRun(db, true, msg, {
      total_rows: totalRows,
      row_counts: rowCounts,
      github_committed: githubCommitted,
      github_error: githubError,
      ms: Date.now() - startMs,
    });

    return new Response(
      JSON.stringify({ ok: true, total_rows: totalRows, row_counts: rowCounts, github_committed: githubCommitted }),
      { status: 200, headers: { ...cors(req), "content-type": "application/json" } },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logRun(db, false, message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...cors(req), "content-type": "application/json" },
    });
  }
});
