"""Het huidige model, per regio en per omzetklasse, gemeten vanaf de opening."""
import os, sys
import numpy as np, pandas as pd, pyarrow.dataset as pads
sys.path.insert(0, os.path.dirname(__file__))
from lib import ROOT, ALL
t = pads.dataset(sys.argv[1]).to_table(columns=["yr", "idx", "day", "tid", "p_new", "y"], filter=(pads.field("yr") >= 2020)).to_pandas()
idx = t.idx.to_numpy()
for n in ("yo", "r10o", "tp50o", "gap1"):
    t[n] = np.asarray(np.load(os.path.join(ALL, f"lab_{n}.npy"), mmap_mode="r")[idx])
t["dv"] = np.asarray(np.load(os.path.join(ALL, "dv.npy"), mmap_mode="r")[idx])
t["px"] = np.asarray(np.load(os.path.join(ALL, "px.npy"), mmap_mode="r")[idx])
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "region"])
reg = np.zeros(int(meta.tid.max()) + 1, np.int8); reg[meta.tid.to_numpy()] = meta.region.to_numpy()
t["region"] = reg[t.tid.to_numpy()]
c = t[(t.p_new >= 15) & np.isfinite(t.yo) & np.isfinite(t.r10o)]
RN = ["VS", "Canada", "Europa", "Azië-Pacific"]
def line(g):
    return f"n={len(g):5d} voorspeld {g.p_new.mean():4.1f}% raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%) | −30% of lager {100 * (g.r10o <= -0.3).mean():3.0f}%"
for lab, m in (("2020–2024", c.yr <= 2024), ("2025–2026", c.yr >= 2025)):
    d = c[m]; print(f"\n{lab} kandidaat-dagen ≥ 15%")
    for r in range(4):
        g = d[d.region == r]
        if len(g): print(f"  {RN[r]:13s} {line(g)}")
    for lo, hi, nm in ((0, 5e4, "omzet < $50k"), (5e4, 1e5, "$50–100k"), (1e5, 2.5e5, "$100–250k"), (2.5e5, 1e6, "$250k–1 mln"), (1e6, 1e7, "$1–10 mln"), (1e7, 1e15, "> $10 mln")):
        g = d[(d.dv >= lo) & (d.dv < hi)]
        if len(g): print(f"  {nm:13s} {line(g)}")
    for lo, hi, nm in ((0.5, 1, "koers $0,50–1"), (1, 2, "$1–2"), (2, 5, "$2–5"), (5, 20, "$5–20"), (20, 1e9, "> $20")):
        g = d[(d.px >= lo) & (d.px < hi)]
        if len(g): print(f"  {nm:13s} {line(g)}")
    for lo, hi in ((15, 18), (18, 20), (20, 22), (22, 25), (25, 100)):
        g = d[(d.p_new >= lo) & (d.p_new < hi)]
        if len(g): print(f"  kans {lo}–{hi}%   {line(g)}")
