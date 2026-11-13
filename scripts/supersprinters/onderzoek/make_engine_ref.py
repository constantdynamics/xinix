"""Maakt engine_ref.ts: de bestaande rekenkern (_shared/engine.ts), ongewijzigd op een uitvoer-haak na,
zodat harness.ts per handelsdag de 19 kenmerk-buckets en uitkomsten van het oude model kan wegschrijven."""
import os
here = os.path.dirname(os.path.abspath(__file__))
s = open(os.path.join(here, "..", "..", "..", "supabase", "functions", "_shared", "engine.ts")).read()


def rep(old, new):
    global s
    assert old in s, old[:60]
    s = s.replace(old, new)


rep("export function analyze(f: Fetched, opts: { nowMs: number; fx: number; mcapNow: number | null; regime: Regime | null; models: Array<Model | null> | null }): Analysis {",
    "export function analyze(f: Fetched, opts: { nowMs: number; fx: number; mcapNow: number | null; regime: Regime | null; models: Array<Model | null> | null; dump?: (slots: Uint8Array, inS: Uint8Array, hitBits: Uint8Array, valid: Uint8Array) => void }): Analysis {")
rep("  const inS = new Uint8Array(n), inL = new Uint8Array(n);", "  const inS = new Uint8Array(n), inL = new Uint8Array(n), validDay = new Uint8Array(n);")
rep("      const reg = opts.regime;\n      const o = t * NF;", "      const reg = opts.regime;\n      const o = t * NF;\n      validDay[t] = 1;")
rep("    if (t >= 30 && v * fx >= MIN_PRICE_USD && (fwdS || t === n - 1)) {", "    if (t >= 30 && v * fx >= MIN_PRICE_USD && (fwdS || t === n - 1 || !!opts.dump)) {")
rep("  // Kalibratie: wat zei het model (met de lifts van vóór deze scan) op elke",
    "  if (opts.dump) opts.dump(slots, inS, hitBits, validDay);\n  // Kalibratie: wat zei het model (met de lifts van vóór deze scan) op elke")
open(os.path.join(here, "engine_ref.ts"), "w").write(s)
print("engine_ref.ts geschreven")
