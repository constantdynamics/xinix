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

if (market) {
  const { rows, requests } = await C.tvMarket(market);
  const out: Record<string, unknown> = {};
  for (const r of rows) out[r.ticker] = { tv: r, f: C.stockFeatures(r, 1) };
  console.log(`${market}: ${rows.length} aandelen in ${requests} verzoek(en)`);
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(out));
}
