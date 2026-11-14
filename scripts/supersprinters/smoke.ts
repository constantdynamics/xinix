// Droogloop van een hele ronde tegen het echte TradingView en Yahoo, met een nagebootste database:
//   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/supersprinters/smoke.ts <ronde> <datum> <fx.json> [alerts]
// Er wordt niets weggeschreven en niets gemeld; het script laat zien wát er geschreven zou worden.
import * as fs from "node:fs";
import * as C from "../../supabase/functions/xinix-supersprint/core.ts";
import * as R from "../../supabase/functions/xinix-supersprint/run.ts";

const [region, date, fxPath, alertsFlag] = process.argv.slice(2);
C.setModel(C.parseModel(fs.readFileSync(new URL("../../public/ss-model.json", import.meta.url), "utf8")));
const seed = JSON.parse(fs.readFileSync(new URL("../../public/ss-breadth-seed.json", import.meta.url), "utf8"));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  signal_settings: [{ id: 1, ntfy_topic: "test", ntfy_server: "http://127.0.0.1:9/nergens", quiet_hours_start: process.env.QUIET === "0" ? null : 21, quiet_hours_end: process.env.QUIET === "0" ? null : 4,
    ss_enabled: true, ss_alerts: alertsFlag === "alerts", ss_alert_min_prob: 15, ss_alert_max_per_week: 3, ss_override_min_prob: 15 }],
  xinix_fx_rates: JSON.parse(fs.readFileSync(fxPath, "utf8")),
  xinix_ss_state: [], xinix_ss_budget: [], xinix_ss_scores: [], xinix_ss_predictions: [], xinix_notify_mute: [], xinix_seen: [],
  xinix_ss_breadth: seed.map((s: Row) => ({ ...s, n: 0 })),
};
const writes: Array<{ table?: string; op?: string; n?: number; rpc?: string; sample?: unknown }> = [];

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
      return Promise.resolve({ data: name === "xinix_ss_calib_refresh" ? { mult: 1.02, hits: 0, expected: 0, n: 0 } : 0, error: null });
    },
  };
}

const t0 = performance.now();
const res = await R.guarded(sb(), (ctx) => R.round(ctx, region, date));
// Daarna de ochtendmelding, tegen een nagebootste ntfy-server (of een onbereikbare, met NTFY=down).
if (alertsFlag === "alerts") {
  const http = await import("node:http");
  const got: string[] = [];
  const server = http.createServer((req, rs) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { got.push(b); rs.writeHead(200); rs.end("{}"); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  tables.signal_settings[0].ntfy_server = process.env.NTFY === "down" ? "http://127.0.0.1:9/nergens" : `http://127.0.0.1:${port}/`;
  const fl = await R.guarded(sb(), (ctx) => R.flush(ctx));
  console.log("OCHTENDMELDING:", fl.message, JSON.stringify(fl.metrics));
  for (const g of got) { const j = JSON.parse(g); console.log("--- melding ---\n" + j.title + "\n" + j.message + "\nklik: " + j.click + "\nknop: " + JSON.stringify(j.actions)); }
  server.close();
  const sc = tables.xinix_ss_scores as Row[];
  const notes = new Map<string, number>();
  for (const r of sc) if (r.alert_note) notes.set(String(r.alert_note), (notes.get(String(r.alert_note)) ?? 0) + 1);
  console.log("notities:", JSON.stringify([...notes]), "| nog wachtend:", sc.filter((r) => r.alert_pending).length, "| gemeld:", sc.filter((r) => r.alerted_at).length);
}
console.log(`looptijd ${Math.round(performance.now() - t0)} ms`);
console.log(res.message);
console.log(JSON.stringify(res.metrics));
for (const w of writes) console.log(w.rpc ? `rpc ${w.rpc} ${w.sample ? JSON.stringify(w.sample) : ""}` : `${w.op} ${w.table}: ${w.n} rij(en)`);
const scores = tables.xinix_ss_scores as Row[];
console.log("\nkopgroep:");
for (const r of scores.slice(0, 12)) {
  const reasons = (r.reasons as Array<{ label: string; f: number; t: string }>).slice(0, 2).map((x) => `×${x.f} ${x.label} (${x.t})`).join("; ");
  console.log(`${String(r.rank).padStart(3)} ${String(r.ticker).padEnd(9)} ${String(r.prob).padStart(5)}% (basis ${r.prob_base}%) ${String(r.exchange).padEnd(8)} slot ${r.close} ${r.currency} = $${r.close_usd}  1d ${r.change_1d}%  1m ${r.perf_1m}%  omzet $${r.dvol_usd}  | ${reasons}${(r.news as unknown[] | null)?.length ? `  | nieuws: ${(r.news as Array<{ t: string; g: string }>)[0].g}: ${(r.news as Array<{ t: string }>)[0].t.slice(0, 60)}` : ""}`);
}
const probs = scores.map((r) => Number(r.prob));
console.log(`\n${scores.length} bewaard; kans: max ${Math.max(...probs)}%, mediaan ${probs.sort((a, b) => a - b)[probs.length >> 1]}%, ≥15%: ${probs.filter((p) => p >= 15).length}, ≥5%: ${probs.filter((p) => p >= 5).length}`);
const sample = JSON.stringify(scores[0]);
console.log(`grootte van één score-rij als JSON: ${sample.length} bytes`);
