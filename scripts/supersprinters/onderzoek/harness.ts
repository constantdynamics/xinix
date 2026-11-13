// Laat de bestaande rekenkern (engine.ts, ongewijzigd op een uitvoer-haak na) op de opgeschoonde reeksen
// lopen en schrijft per handelsdag de 19 kenmerk-buckets en de uitkomsten weg.
//   node --experimental-strip-types harness.ts <map> <van> <tot>
import * as fs from "node:fs";
import * as E from "./engine_ref.ts";   // maak hem met make_engine_ref.py

const [dir, fromS, toS] = process.argv.slice(2);

function readPack(path: string) {
  const buf = fs.readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const count = dv.getInt32(o, true); o += 4;
  const out: Array<{ bars: E.Bars; mcap: number | null }> = [];
  for (let k = 0; k < count; k++) {
    const n = dv.getInt32(o, true); o += 4;
    const mcap = dv.getFloat64(o, true); o += 8;
    const cl = dv.getInt32(o, true); o += 4;
    const currency = cl ? buf.subarray(o, o + cl).toString() : null; o += cl;
    const day = new Int32Array(n);
    for (let i = 0; i < n; i++) day[i] = dv.getInt32(o + 4 * i, true);
    o += 4 * n;
    const f64 = () => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = dv.getFloat64(o + 8 * i, true); o += 8 * n; return a; };
    const close = f64(), raw = f64(), high = f64(), low = f64(), vol = f64();
    const ns = dv.getInt32(o, true); o += 4;
    const splits: E.Split[] = [];
    for (let i = 0; i < ns; i++) { splits.push({ ms: dv.getFloat64(o, true), ratio: dv.getFloat64(o + 8, true) }); o += 16; }
    const ms = new Float64Array(n);
    for (let i = 0; i < n; i++) ms[i] = day[i] * E.DAY + 14.5 * 3600_000;
    out.push({ bars: { n, ms, day, close, raw, high, low, vol, splits, currency }, mcap: Number.isFinite(mcap) ? mcap : null });
  }
  return out;
}

const regimeBars = readPack(`${dir}/pack_regime.bin`)[0].bars;
const regime = E.regimeFrom(regimeBars);
const nowMs = Date.now();

for (let k = Number(fromS); k < Number(toS); k++) {
  const name = String(k).padStart(3, "0");
  const path = `${dir}/pack_${name}.bin`;
  if (!fs.existsSync(path)) continue;
  const items = readPack(path);
  const chunks: Buffer[] = [];
  const head = Buffer.alloc(4); head.writeInt32LE(items.length); chunks.push(head);
  let t0 = performance.now();
  for (const it of items) {
    const b = it.bars;
    const fx = E.fxUsd(b.currency);
    let got: Buffer | null = null;
    const a = E.analyze({ all: b, clean: b }, {
      nowMs, fx, mcapNow: it.mcap, regime, models: null,
      dump: (slots, inS, hitBits, valid) => {
        const out = Buffer.alloc(b.n * (E.NF + 3));
        for (let t = 0; t < b.n; t++) {
          const base = t * (E.NF + 3);
          for (let f = 0; f < E.NF; f++) out[base + f] = slots[t * E.NF + f];
          out[base + E.NF] = inS[t]; out[base + E.NF + 1] = hitBits[t]; out[base + E.NF + 2] = valid[t];
        }
        got = out;
      },
    });
    const h = Buffer.alloc(8);
    h.writeInt32LE(b.n, 0); h.writeInt32LE(a.ok && got ? 1 : 0, 4);
    chunks.push(h);
    if (a.ok && got) chunks.push(got);
  }
  fs.writeFileSync(`${dir}/eng_${name}.bin`, Buffer.concat(chunks));
  console.log(name, items.length, Math.round(performance.now() - t0), "ms");
}
