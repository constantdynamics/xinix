"""Twee eisen van de gebruiker (16 november 2026) nagerekend op de opgeslagen testvoorspellingen:
geen aandelen die korter dan twee jaar genoteerd zijn, en geen aandelen die op meer dan 95% van hun hoogste koers ooit staan.

  python3 leeftijd_top_test.py <ssdata> <map van reduce_open.py>      (leest eval_rows2.parquet van ronde2_regels.py)

Leeftijd   kalenderdagen sinds de eerste dagkoers van het aandeel in de dataset. De dataset begint in november 2016, dus
           voor de testjaren 2020–2026 is "korter dan twee jaar" (730 dagen) altijd te zien.
Top        slot gedeeld door de hoogste koers binnen de dag tot en met die dag (gecorrigeerd voor splits). De dataset
           kent alleen koersen sinds november 2016: een top van vóór die tijd telt hier niet mee, dus de verhouding
           valt hier voor oude aandelen eerder te hoog dan te laag uit. In productie komt de top van TradingView
           (hele geschiedenis).

1. Kandidaten (kans vanaf 15%, omzet vanaf $100.000): hoe vaak komt het voor, en wat deden ze?
2. De meldingen volgens de regels van nu (lat 26%, dagbeweging tot 30%, zonder Europa), met en zonder de twee eisen.
3. Hetzelfde bij een lat van 20%, om meer gevallen te hebben.
4. Andere grenzen (1, 2, 3 jaar; 90%, 95%, 98% van de top), om te zien hoe gevoelig het is.
"""
import os, sys, pickle
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import feat

ROOT, RED = sys.argv[1], sys.argv[2]
ALL = os.path.join(ROOT, "all")
e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"), columns=["idx", "day", "tid", "y", "yo", "r10o", "dv", "region", "yr", "p_glob"])
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y)]
C = e[(e.p_glob >= 15) & (e.dv >= 100_000)].copy().sort_values("day").reset_index(drop=True)
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
idx = C.idx.to_numpy(); o = np.argsort(idx)
vw = np.empty(len(C), np.float32); vw[o] = np.asarray(X[idx[o]][:, feat.FIDX["t_vw"]])
C["vw"] = vw
tix = np.load(os.path.join(ALL, "tix.npy"))
C["t"] = tix[idx].astype(np.int64)
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk", "first_day"]).set_index("tid")
C["age"] = C.day.to_numpy() - meta.first_day.reindex(C.tid).to_numpy()
C["chunk"] = meta.chunk.reindex(C.tid).to_numpy()
ath = np.full(len(C), np.nan); age_bar = np.full(len(C), np.nan)
for ch, g in C.groupby("chunk"):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for tid, gg in g.groupby("tid"):
        c = items.get(meta.ticker[tid])
        if c is None: continue
        A = c["adj"].astype(np.float64); H = np.fmax.accumulate(np.maximum(c["high"].astype(np.float64), 1.0) * A)
        t = gg.t.to_numpy(); ok = t < len(A)
        ath[gg.index.to_numpy()[ok]] = A[t[ok]] / H[t[ok]]
        age_bar[gg.index.to_numpy()[ok]] = gg.day.to_numpy()[ok] - int(c["day"][0])
C["top"] = ath
C["age"] = np.where(np.isfinite(age_bar), age_bar, C.age)
C["bl"] = (C.r10o <= -0.3).astype(int)
C["jong"] = C.age < 730
C["bijtop"] = C.top >= 0.95
PER = (("2020–2024", C.yr <= 2024), ("2025–2026", C.yr >= 2025))
RN = ["VS", "Canada", "Europa", "Azië-Pacific"]


def desc(g):
    if len(g) < 5: return f"n={len(g)}"
    return f"n={len(g):5d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | −30% {100 * g.bl.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}% (middelste {100 * g.r10o.median():+5.1f}%)"


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    keep, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); keep.append(i)
    return d.loc[keep]


print(f"kandidaten: {len(C)} | leeftijd bekend {100 * np.isfinite(C.age).mean():.1f}% | top bekend {100 * np.isfinite(C.top).mean():.1f}%")
print("leeftijd in jaren, kwantielen:", (C.age / 365.25).quantile([.05, .1, .25, .5, .75]).round(1).to_dict())
print("slot als deel van de top, kwantielen:", C.top.quantile([.1, .25, .5, .75, .9, .95, .99]).round(3).to_dict())

print("\n== 1. Kandidaten (kans ≥ 15%, omzet ≥ $100k), alle regio's ==")
for lab, m in PER:
    g = C[m]
    print(f"-- {lab}: {len(g)} kandidaat-dagen | korter dan 2 jaar genoteerd {100 * g.jong.mean():.1f}% | op ≥ 95% van de top {100 * g.bijtop.mean():.1f}% | een van beide {100 * (g.jong | g.bijtop).mean():.1f}% | allebei {100 * (g.jong & g.bijtop).mean():.1f}%")
    for nm, sel in (("korter dan 2 jaar genoteerd", g.jong), ("2 jaar of langer", ~g.jong), ("op ≥ 95% van de top", g.bijtop), ("onder 95% van de top", ~g.bijtop),
                    ("≥ 95% van de top én ≥ 2 jaar oud", g.bijtop & ~g.jong), ("blijft over (≥ 2 jaar en onder 95%)", ~g.jong & ~g.bijtop)):
        print(f"   {nm:38s} {desc(g[sel])}")
    for r in range(4):
        gr = g[g.region == r]
        if len(gr) >= 30: print(f"   {RN[r]:14s} n={len(gr):5d} jong {100 * gr.jong.mean():4.1f}% bij de top {100 * gr.bijtop.mean():4.1f}%")

for floor in (26.0, 20.0):
    print(f"\n== Meldingen: lat {floor:.0f}%, dagbeweging ≤ 30%, zonder Europa ==")
    for lab, m in PER:
        base = C[m & (C.vw <= 0.30) & (C.region != 2)]
        a = alerts(base, floor)                                    # regels van nu
        b = alerts(base[~base.jong & ~base.bijtop], floor)         # de twee eisen gelden al voor de lijst
        print(f"-- {lab}")
        print(f"   nu:                 {desc(a)}")
        print(f"     waarvan jong:        {desc(a[a.jong])}")
        print(f"     waarvan bij de top:  {desc(a[a.bijtop])}")
        print(f"     waarvan geen van beide: {desc(a[~a.jong & ~a.bijtop])}")
        print(f"   met de twee eisen:  {desc(b)}")
        print(f"   alleen de leeftijd: {desc(alerts(base[~base.jong], floor))}")
        print(f"   alleen de top:      {desc(alerts(base[~base.bijtop], floor))}")
        if floor == 26.0:
            print("   per jaar (nu → met de twee eisen): " + ", ".join(f"{Y}: {int((a.yr == Y).sum())}→{int((b.yr == Y).sum())}" for Y in sorted(a.yr.unique())))

print("\n== 4. Andere grenzen (kandidaten met dagbeweging ≤ 30%, zonder Europa) ==")
for lab, m in PER:
    g = C[m & (C.vw <= 0.30) & (C.region != 2)]
    print(f"-- {lab}: {desc(g)}")
    for yrs in (1, 2, 3, 5):
        s = g[g.age < 365.25 * yrs]
        print(f"   korter dan {yrs} jaar genoteerd:   {desc(s)}")
    for lo, hi in ((0.98, 9), (0.95, 0.98), (0.90, 0.95), (0.75, 0.90), (0.5, 0.75), (0.25, 0.5), (0.1, 0.25), (0, 0.1)):
        s = g[(g.top >= lo) & (g.top < hi)]
        print(f"   slot op {int(100 * lo):3d}–{'100' if hi > 1 else int(100 * hi):>3}% van de top: {desc(s)}")
C.drop(columns=["chunk"]).to_parquet(os.path.join(RED, "leeftijd_top.parquet"))
