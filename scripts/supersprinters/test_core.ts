// Controle van de rekenkern van SUPERsprinters:
//   node --experimental-strip-types scripts/supersprinters/test_core.ts <testvectors.json> [markt] [uit.json]
// 1. het model in TypeScript geeft exact dezelfde uitkomst als LightGBM (testvectoren uit de training);
// 2. optioneel: haalt één markt bij TradingView op en schrijft de kenmerken weg, zodat ze met de
//    kenmerken uit de dagkoersen (Python, feat.py) vergeleken kunnen worden.
import * as fs from "node:fs";
import * as C from "../../supabase/functions/xinix-supersprint/core.ts";

const [vecPath, market, outPath] = process.argv.slice(2);
const text = fs.readFileSync(new URL("../../public/ss-model.json", import.meta.url), "utf8");
const sha = await C.sha256Hex(text);
if (sha !== C.MODEL_SHA256) throw new Error(`controlegetal van public/ss-model.json (${sha}) hoort niet bij core.ts`);
const m = C.parseModel(text);
const tv = JSON.parse(fs.readFileSync(vecPath, "utf8"));
if (tv.sha256 !== sha) throw new Error("testvectoren horen bij een ander model");
if (JSON.stringify(tv.features) !== JSON.stringify(m.features)) throw new Error("kenmerken in andere volgorde");
let maxRaw = 0, maxCal = 0;
const t0 = performance.now();
for (const v of tv.vectors) {
  const x = Float64Array.from(v.x.map((q: number | null) => (q == null ? NaN : q)));
  const raw = C.rawScore(m, x);
  maxRaw = Math.max(maxRaw, Math.abs(raw - v.raw));
  maxCal = Math.max(maxCal, Math.abs(C.curveProb(m, raw) - v.cal));
}
const ms = (performance.now() - t0) / tv.vectors.length;
console.log(`model ${m.version}: ${m.trees.length} bomen; ${tv.vectors.length} testvectoren; grootste verschil modeluitkomst ${maxRaw.toExponential(2)}, ijklijn ${maxCal.toExponential(2)}; ${ms.toFixed(3)} ms per aandeel`);
if (maxRaw > 1e-9 || maxCal > 1e-9) { console.error("NIET GELIJK"); process.exit(1); }

// 3. De eisen aan de lijst (16 november 2026): niet korter dan 2 jaar genoteerd, niet boven 95% van de top.
{
  const asOf = Date.parse("2026-11-16T23:59:59Z");
  const sec = (iso: string) => Date.parse(iso + "T00:00:00Z") / 1000;
  const row = (ipo: string | null, first: string | null, close: number, hiAll: number) =>
    ({ ipoDate: ipo ? sec(ipo) : NaN, firstBar: first ? sec(first) : NaN, close, hiAll }) as unknown as C.TvRow;
  const cases: Array<[string, C.TvRow, number, number, C.ListBar]> = [
    ["beursgang een jaar geleden", row("2025-10-31", "2025-10-31", 1, 50), 2, 95, "jong"],
    ["jaren buiten de beurs verhandeld, half jaar op de beurs", row("2026-05-15", "2017-06-26", 2, 400), 2, 95, "jong"],
    ["oude beursgang, nieuwe koersreeks (opnieuw genoteerd)", row("2004-02-19", "2025-12-17", 10, 40), 2, 95, null],
    ["beursgang onbekend, eerste koers jong (afsplitsing)", row(null, "2025-02-13", 10, 40), 2, 95, "jong"],
    ["beursgang onbekend, eerste koers oud", row(null, "2013-04-09", 1, 100000), 2, 95, null],
    ["net geen twee jaar", row("2024-11-18", "2024-11-18", 1, 10), 2, 95, "jong"],
    ["ruim twee jaar", row("2024-09-05", "2024-09-05", 1, 10), 2, 95, null],
    ["datum en eerste koers onbekend", row(null, null, 1, 10), 2, 95, null],
    ["op 96% van de top", row("2010-01-04", "2010-01-04", 96, 100), 2, 95, "top"],
    ["precies 95% van de top", row("2010-01-04", "2010-01-04", 95, 100), 2, 95, null],
    ["op de top, eis uit", row("2010-01-04", "2010-01-04", 100, 100), 2, 0, null],
    ["jong, eis uit", row("2026-01-05", "2026-01-05", 1, 10), 0, 95, null],
    ["top onbekend", row("2010-01-04", "2010-01-04", 5, NaN), 2, 95, null],
    ["jong én op de top: leeftijd gaat voor", row("2026-01-05", "2026-01-05", 10, 10), 2, 95, "jong"],
    ["strengere leeftijd", row("2023-06-01", "2023-06-01", 1, 10), 5, 95, "jong"],
  ];
  let bad = 0;
  for (const [what, r, age, top, want] of cases) {
    const got = C.listBar(r, asOf, age, top);
    if (got !== want) { bad++; console.error(`  eisen aan de lijst: ${what}: ${got} in plaats van ${want}`); }
  }
  // De drie nieuwe velden staan achteraan, zodat de plaatsen van de bestaande velden gelijk blijven.
  const cols = C.TV_COLS;
  if (cols[27] !== "exchange" || cols[28] !== "first_bar_time" || cols[29] !== "ipo_offer_date" || cols[30] !== "High.All") { bad++; console.error("  volgorde van de velden klopt niet"); }
  const d: unknown[] = new Array(cols.length).fill(null);
  d[0] = "TEST"; d[2] = 2; d[27] = "NASDAQ"; d[28] = sec("2017-06-26"); d[29] = sec("2026-05-15"); d[30] = 400;
  const p = C.parseTvRow("america", { s: "NASDAQ:TEST", d });
  if (!p || p.firstBar !== sec("2017-06-26") || p.ipoDate !== sec("2026-05-15") || p.hiAll !== 400 || C.topPct(p) !== 0.5
    || new Date(C.listedSinceMs(p)).toISOString().slice(0, 10) !== "2026-05-15") { bad++; console.error("  inlezen van de nieuwe velden klopt niet"); }
  console.log(`eisen aan de lijst: ${cases.length + 2 - bad} van de ${cases.length + 2} gevallen goed`);
  if (bad) process.exit(1);
}

if (market) {
  const { rows, requests } = await C.tvMarket(market);
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.ticker] = { tv: r, f: C.stockFeatures(r, 1) };
  console.log(`${market}: ${rows.length} aandelen in ${requests} verzoek(en)`);
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(out));
}
