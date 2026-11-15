"""Wat zegt de opening zelf? En wat levert een limietorder op? Op de kandidaten van het huidige model."""
import os, sys
import numpy as np, pandas as pd, pyarrow.dataset as pads
sys.path.insert(0, os.path.dirname(__file__))
from lib import ROOT, ALL
t = pads.dataset(sys.argv[1]).to_table(columns=["yr", "idx", "day", "tid", "p_new", "rk_new", "y"], filter=(pads.field("yr") >= 2020)).to_pandas()
idx = t.idx.to_numpy()
for n in ("yo", "r10o", "tp50o", "gap1", "lo1r", "hi1r", "mx10o", "mn10o", "mnl10o"):
    t[n] = np.asarray(np.load(os.path.join(ALL, f"lab_{n}.npy"), mmap_mode="r")[idx])
t["dv"] = np.asarray(np.load(os.path.join(ALL, "dv.npy"), mmap_mode="r")[idx])
c = t[(t.p_new >= 15) & np.isfinite(t.yo) & np.isfinite(t.r10o)]
print("kandidaat-dagen (kans >= 15%):", len(c))
bins = [-9, -0.15, -0.05, -0.01, 0.01, 0.05, 0.15, 0.30, 99]
names = ["opent ≤ −15%", "−15 tot −5%", "−5 tot −1%", "rond het slot", "+1 tot +5%", "+5 tot +15%", "+15 tot +30%", "> +30%"]
for lab, m in (("2020–2024", c.yr <= 2024), ("2025–2026", c.yr >= 2025)):
    d = c[m]
    print(f"\n{lab}: {len(d)} kandidaat-dagen; raak vanaf het slot {100 * d.y.mean():.1f}%, vanaf de opening {100 * d.yo.mean():.1f}%, 10 dagen houden {100 * d.r10o.mean():+.1f}% (mediaan {100 * d.r10o.median():+.1f}%)")
    d = d.assign(b=pd.cut(d.gap1, bins, labels=names))
    g = d.groupby("b", observed=True).agg(n=("y", "size"), raak_slot=("y", "mean"), raak_open=("yo", "mean"), houden=("r10o", "mean"), mediaan=("r10o", "median"), tp50=("tp50o", "mean"), verlies30=("r10o", lambda x: (x <= -0.3).mean()))
    for k, r in g.iterrows():
        print(f"  {k:14s} n={int(r.n):5d} ({100 * r.n / len(d):4.1f}%)  raak slot {100 * r.raak_slot:4.1f}%  raak opening {100 * r.raak_open:4.1f}%  houden {100 * r.houden:+6.1f}% (mediaan {100 * r.mediaan:+6.1f}%)  +50%-regel {100 * r.tp50:+6.1f}%  −30% of lager {100 * r.verlies30:3.0f}%")
    # limietorders op dag 1: gevuld als de laagste koers van die dag de limiet raakt; instap = min(opening, limiet)
    for off, nm in ((0.0, "limiet op het slot"), (-0.05, "limiet 5% onder het slot"), (-0.10, "limiet 10% onder het slot")):
        lim = 1 + off
        filled = (1 + d.lo1r) <= lim
        entry = np.minimum(1 + d.gap1, lim)                        # t.o.v. het slot
        f = d[filled]; e = entry[filled]
        r10 = (1 + f.r10o) * (1 + f.gap1) / e - 1
        mx = (1 + f.mx10o) * (1 + f.gap1) / e - 1
        print(f"  {nm}: gevuld {100 * filled.mean():.0f}% (n={len(f)}); daarna 10 dagen houden {100 * r10.mean():+.1f}% (mediaan {100 * r10.median():+.1f}%), slot ooit ≥ +50% boven de instap {100 * (mx >= 0.5).mean():.1f}%, −30% of lager {100 * (r10 <= -0.3).mean():.0f}%; niet gevuld: {100 * (~filled).mean():.0f}%, daarvan raak vanaf het slot {100 * d[~filled].y.mean():.1f}%")
