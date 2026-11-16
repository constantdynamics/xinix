// Droogloop van een hele ronde tegen het echte TradingView en Yahoo, met een nagebootste database:
//   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/supersprinters/smoke.ts <ronde> <datum> <fx.json> [alerts]
// Er wordt niets weggeschreven en niets gemeld; het script laat zien wát er geschreven zou worden.
// Met "alerts" volgt het meldmoment tegen een nagebootste ntfy-server. QUIET=0 zet de stille uren
// uit, NTFY=down maakt de server onbereikbaar, PRE='[…]' zet eerdere meldingen klaar (weekplafond, herhaling).
// MIN_PROB, MIN_DVOL en MAX_VOLW zetten de meldgrens (standaard 15), de omzeteis voor meldingen (standaard
// 100000) en de grens op de beweeglijkheid van de week (standaard 30, 0 = uit); MAX_WEEK het weekplafond
// (standaard 3, 0 = geen) en REGIONS de regio's die mogen melden (bv. "0,1,3"; standaard alle).
// MIN_AGE en MAX_TOP zetten de eisen aan de lijst: niet korter dan zoveel jaar genoteerd (standaard 2) en niet
// boven zoveel procent van de hoogste koers ooit (standaard 95); 0 = uit. MIN_AGE_FLUSH en MAX_TOP_FLUSH
// scherpen ze aan tussen de ronde en het meldmoment (dan moet het meldmoment ze tegenhouden).
import * as fs from "node:fs";
import * as C from "../../supabase/functions/xinix-supersprint/core.ts";
import * as R from "../../supabase/functions/xinix-supersprint/run.ts";

const [region, date, fxPath, alertsFlag] = process.argv.slice(2);
C.setModel(C.parseModel(fs.readFileSync(new URL("../../public/ss-model.json", import.meta.url), "utf8")));
const seed = JSON.parse(fs.readFileSync(new URL("../../public/ss-breadth-seed.json", import.meta.url), "utf8"));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  signal_settings: [{ id: 1, ntfy_topic: "test", ntfy_server: "http://127.0.0.1:9/nergens", quiet_hours_start: process.env.QUIET === "0" ? null : 21, quiet_hours_end: process.env.QUIET === "0" ? null : 4,
    ss_enabled: true, ss_alerts: alertsFlag === "alerts", ss_alert_min_prob: Number(process.env.MIN_PROB ?? 15), ss_override_min_prob: 15, ss_alert_min_dvol: Number(process.env.MIN_DVOL ?? 100000),
    ss_alert_max_volw: Number(process.env.MAX_VOLW ?? 30), ss_alert_max_per_week: Number(process.env.MAX_WEEK ?? 3),
    ss_alert_regions: process.env.REGIONS ? process.env.REGIONS.split(",").map(Number) : null,
    ss_min_age_years: Number(process.env.MIN_AGE ?? 2), ss_max_top_pct: Number(process.env.MAX_TOP ?? 95) }],
  xinix_fx_rates: JSON.parse(fs.readFileSync(fxPath, "utf8")),
  xinix_ss_state: [], xinix_ss_budget: [], xinix_ss_scores: [], xinix_ss_predictions: [], xinix_notify_mute: [], xinix_seen: [],
  xinix_ss_breadth: seed.map((s: Row) => ({ ...s, n: 0 })),
};
const writes: Array<{ table?: string; op?: string; n?: number; rpc?: string; sample?: unknown }> = [];
const resolved: Row[] = [];

function sb() {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let op = "select", payload: unknown = null, single = false, count = false;
    const filters: Array<(r: Row) => boolean> = [];
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select(_c?: string, o?: { count?: string; head?: boolean }) { if (o?.count) count = true; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      in(k: string, vs: unknown[]) { filters.push((r) => vs.includes(r[k])); return b; },
      gte(k: string, v: string | number) { filters.push((r) => (r[k] as string | number) >= v); return b; },
      gt(k: string, v: string | number) { filters.push((r) => (r[k] as string | number) > v); return b; },
      lte(k: string, v: string | number) { filters.push((r) => (r[k] as string | number) <= v); return b; },
      is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return b; },
      not(k: string, _op: string, v: unknown) { filters.push((r) => (r[k] ?? null) !== v); return b; },
      order(k: string, o?: { ascending?: boolean }) { rows.sort((a, c) => (String(a[k]) < String(c[k]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return b; },
      limit(n: number) { rows = rows.slice(0, n); return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      upsert(p: unknown) { op = "upsert"; payload = p; return b; },
      insert(p: unknown) { op = "insert"; payload = p; return b; },
      update(p: unknown) { op = "update"; payload = p; return b; },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        if (op !== "select") {
          const list = Array.isArray(payload) ? (payload as Row[]) : [payload as Row];
          writes.push({ table, op, n: list.length, sample: list[0] });
          if (op === "update") {
            for (const r of tables[table] ?? []) if (filters.every((f) => f(r))) Object.assign(r, payload as Row);
          }
          if (op === "upsert" || op === "insert") {
            const key = table === "xinix_ss_state" ? "key" : table === "xinix_ss_scores" ? "ticker" : null;
            for (const r of list) {
              const i = key ? (tables[table] ?? []).findIndex((x) => x[key] === r[key]) : -1;
              if (i >= 0) tables[table][i] = { ...tables[table][i], ...r }; else (tables[table] ??= []).push(r);
            }
          }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        }
        const out = rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: single ? (out[0] ?? null) : out, error: null, count: count ? out.length : null }).then(res, rej);
      },
    };
    return b;
  };
  return {
    from,
    rpc: (name: string, args: Row) => {
      writes.push({ rpc: name, sample: name === "xinix_ss_budget_add" ? args : undefined });
      if (name === "xinix_ss_resolve") { resolved.push(...(args.p_rows as Row[])); return Promise.resolve({ data: (args.p_rows as Row[]).length, error: null }); }
      return Promise.resolve({ data: name === "xinix_ss_calib_refresh" ? { mult: 1.02, hits: 0, expected: 0, n: 0 } : 0, error: null });
    },
  };
}

const t0 = performance.now();
// Afrekenen van het track record tegen echte Yahoo-koersen:
//   … smoke.ts resolve <open.json> <fx.json>      open.json = [{ticker, made_on, y?, yo?, r10o?, gap1?}]
// y = de bekende uitkomst vanaf het slot; yo, r10o en gap1 = de bekende uitkomsten vanaf de opening
// (treffer, rendement na 10 handelsdagen en de opening t.o.v. het slot, als breuk).
if (region === "resolve") {
  const open = JSON.parse(fs.readFileSync(date, "utf8")) as Array<{ ticker: string; made_on: string; y?: number; yo?: number; r10o?: number; gap1?: number }>;
  tables.xinix_ss_predictions = open.map((o) => ({ ticker: o.ticker, made_on: o.made_on, resolved_at: null }));
  const r = await R.guarded(sb(), (ctx) => R.resolve(ctx));
  console.log(r.message, JSON.stringify(r.metrics), `| looptijd ${Math.round(performance.now() - t0)} ms`);
  const want = new Map(open.filter((o) => o.y != null).map((o) => [`${o.ticker}|${o.made_on}`, o.y === 1]));
  let same = 0, diff = 0, err = 0;
  for (const u of resolved) {
    const w = want.get(`${u.ticker}|${u.made_on}`);
    if (u.error) { err++; console.log(`  fout ${u.ticker} ${u.made_on}: ${u.error}`); continue; }
    if (w == null) continue;
    if (w === u.hit) same++; else { diff++; console.log(`  anders ${u.ticker} ${u.made_on}: afgerekend ${u.hit}, verwacht ${w}`); }
  }
  console.log(`vergeleken met de bekende uitkomst: ${same} gelijk, ${diff} anders, ${err} met een fout, ${open.length - resolved.length} niet afgerekend`);
  // Vanaf de opening: de treffer moet gelijk zijn, rendement en opening binnen 1 procentpunt.
  const byKey = new Map(open.map((o) => [`${o.ticker}|${o.made_on}`, o]));
  let oSame = 0, oDiff = 0, oNone = 0, rOk = 0, rOff = 0;
  for (const u of resolved) {
    const w = byKey.get(`${u.ticker}|${u.made_on}`);
    if (!w || w.yo == null || u.error) continue;
    if (u.hit_open == null) { oNone++; console.log(`  geen opening ${u.ticker} ${u.made_on}`); continue; }
    if ((w.yo === 1) === u.hit_open) oSame++; else { oDiff++; console.log(`  anders vanaf de opening ${u.ticker} ${u.made_on}: afgerekend ${u.hit_open}, verwacht ${w.yo === 1}`); }
    if (w.r10o != null && w.gap1 != null) {
      const d1 = Math.abs(Number(u.ret10_open) - 100 * w.r10o), d2 = Math.abs(Number(u.gap_open) - 100 * w.gap1);
      if (d1 <= 1 && d2 <= 1) rOk++; else { rOff++; console.log(`  rendement wijkt af ${u.ticker} ${u.made_on}: na 10 dagen ${u.ret10_open}% tegen ${(100 * w.r10o).toFixed(2)}%, opening ${u.gap_open}% tegen ${(100 * w.gap1).toFixed(2)}%`); }
    }
  }
  if (oSame + oDiff + oNone) console.log(`vanaf de opening: treffer ${oSame} gelijk, ${oDiff} anders, ${oNone} zonder opening; rendement en opening ${rOk} binnen 1 punt, ${rOff} daarbuiten`);
  process.exit(0);
}
const res = await R.guarded(sb(), (ctx) => R.round(ctx, region, date));
// Daarna het meldmoment, tegen een nagebootste ntfy-server (of een onbereikbare, met NTFY=down).
// PRE zet eerdere meldingen klaar; een lijst van lijsten draait meerdere gevallen na elkaar op dezelfde ronde:
//   PRE='[[],[{"ticker":"X","made_on":"2026-11-07","alerted_prob":20}]]'
if (alertsFlag === "alerts") {
  const http = await import("node:http");
  const parsed = JSON.parse(process.env.PRE ?? "[[]]") as Row[] | Row[][];
  const scenarios = (Array.isArray(parsed[0]) || parsed.length === 0 ? parsed : [parsed]) as Row[][];
  const snap = structuredClone(tables);
  for (const pre of scenarios.length ? scenarios : [[]]) {
    for (const k of Object.keys(tables)) tables[k] = structuredClone(snap[k]);
    const got: string[] = [];
    const server = http.createServer((req, rs) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(b); rs.writeHead(200); rs.end("{}"); }); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    tables.signal_settings[0].ntfy_server = process.env.NTFY === "down" ? "http://127.0.0.1:9/nergens" : `http://127.0.0.1:${port}/`;
    // MIN_AGE_FLUSH en MAX_TOP_FLUSH: de eisen aan de lijst aanscherpen tussen de ronde en het meldmoment.
    if (process.env.MIN_AGE_FLUSH != null) tables.signal_settings[0].ss_min_age_years = Number(process.env.MIN_AGE_FLUSH);
    if (process.env.MAX_TOP_FLUSH != null) tables.signal_settings[0].ss_max_top_pct = Number(process.env.MAX_TOP_FLUSH);
    for (const p of pre) tables.xinix_ss_predictions.push({ ...p, alerted_at: `${p.made_on}T04:12:05Z` });
    const fl = await R.guarded(sb(), (ctx) => R.flush(ctx));
    console.log(`\nMELDMOMENT (eerdere meldingen: ${pre.length ? pre.map((p) => `${p.ticker} ${p.made_on} ${p.alerted_prob}%`).join(", ") : "geen"}):`, fl.message, JSON.stringify(fl.metrics));
    for (const g of got) {
      const j = JSON.parse(g);
      if (scenarios.length > 1) console.log("  gemeld: " + j.title);
      else console.log("--- melding ---\n" + j.title + "\n" + j.message + "\nklik: " + j.click + "\nknop: " + JSON.stringify(j.actions));
    }
    server.close();
    const sc = tables.xinix_ss_scores as Row[];
    const notes = new Map<string, number>();
    for (const r of sc) if (r.alert_note) notes.set(String(r.alert_note), (notes.get(String(r.alert_note)) ?? 0) + 1);
    console.log("notities:", JSON.stringify([...notes]), "| nog wachtend:", sc.filter((r) => r.alert_pending).length, "| gemeld:", sc.filter((r) => r.alerted_at).length);
  }
}
console.log(`looptijd ${Math.round(performance.now() - t0)} ms`);
console.log(res.message);
console.log(JSON.stringify(res.metrics));
for (const w of writes) console.log(w.rpc ? `rpc ${w.rpc} ${w.sample ? JSON.stringify(w.sample) : ""}` : `${w.op} ${w.table}: ${w.n} rij(en)`);
const scores = tables.xinix_ss_scores as Row[];
console.log("\nkopgroep:");
for (const r of scores.slice(0, 12)) {
  const reasons = (r.reasons as Array<{ label: string; f: number; t: string }>).slice(0, 2).map((x) => `×${x.f} ${x.label} (${x.t})`).join("; ");
  console.log(`${String(r.rank).padStart(3)} ${String(r.ticker).padEnd(9)} ${String(r.prob).padStart(5)}% (basis ${r.prob_base}%) ${String(r.exchange).padEnd(8)} slot ${r.close} ${r.currency} = $${r.close_usd}  1d ${r.change_1d}%  1m ${r.perf_1m}%  omzet $${r.dvol_usd}  genoteerd sinds ${r.listed_since}  ${r.top_pct}% van de top  | ${reasons}${(r.news as unknown[] | null)?.length ? `  | nieuws: ${(r.news as Array<{ t: string; g: string }>)[0].g}: ${(r.news as Array<{ t: string }>)[0].t.slice(0, 60)}` : ""}`);
}
const probs = scores.map((r) => Number(r.prob));
console.log(`\n${scores.length} bewaard; kans: max ${Math.max(...probs)}%, mediaan ${probs.sort((a, b) => a - b)[probs.length >> 1]}%, ≥15%: ${probs.filter((p) => p >= 15).length}, ≥5%: ${probs.filter((p) => p >= 5).length}`);
const jongste = scores.map((r) => String(r.listed_since ?? "")).filter(Boolean).sort().pop();
const hoogste = Math.max(...scores.map((r) => Number(r.top_pct ?? NaN)).filter(Number.isFinite));
console.log(`eisen aan de lijst: jongste notering in de lijst ${jongste}, hoogste stand ten opzichte van de top ${hoogste}%, zonder datum ${scores.filter((r) => !r.listed_since).length}, zonder top ${scores.filter((r) => r.top_pct == null).length}`);
const sample = JSON.stringify(scores[0]);
console.log(`grootte van één score-rij als JSON: ${sample.length} bytes`);
