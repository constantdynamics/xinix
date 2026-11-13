"""Short interest (FINRA) als extra kenmerken voor Amerikaanse aandelen, met de publicatievertraging erin."""
import os, sys, glob, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from ds import *
LAG = 11            # kalenderdagen tussen peildatum en publicatie (FINRA: 7 à 8 werkdagen)
D = DS()
fs = sorted(glob.glob(os.path.join(ROOT, "finra", "*.parquet")))
fr = []
for f in fs:
    d = pd.read_parquet(f)
    d = d[d.mkt != "OTC"]
    d["sday"] = (pd.to_datetime(d.settle) - pd.Timestamp("1970-01-01")).dt.days
    fr.append(d[["sym", "sday", "si", "dtc", "chg"]])
si = pd.concat(fr, ignore_index=True).dropna(subset=["sday", "si"])
si["ticker"] = si.sym.str.replace(r"[./ ]", "-", regex=True)
print("short-interestregels", len(si), "symbolen", si.ticker.nunique(), "peildata", si.sday.nunique())
meta = D.meta
us = meta[meta.region == 0]
tid_of = dict(zip(us.ticker, us.tid))
si = si[si.ticker.isin(tid_of)]
si["tid"] = si.ticker.map(tid_of)
si = si.sort_values(["tid", "sday"])
print("gekoppeld aan", si.tid.nunique(), "van", len(us), "Amerikaanse aandelen")
E = np.full((D.N, 4), np.nan, np.float32)
grp = {t: g for t, g in si.groupby("tid")}
# rijen staan per aandeel gegroepeerd
bounds = np.flatnonzero(np.diff(D.tid)) + 1
starts = np.concatenate([[0], bounds]); ends = np.concatenate([bounds, [D.N]])
px = D.px.astype(np.float64); dv = D.dv.astype(np.float64)
for s, e in zip(starts, ends):
    g = grp.get(int(D.tid[s]))
    if g is None:
        continue
    sd = g.sday.to_numpy(); d = D.day[s:e]
    i = np.searchsorted(sd + LAG, d, side="right") - 1
    ok = (i >= 0)
    ii = np.clip(i, 0, len(sd) - 1)
    fresh = ok & (d - sd[ii] <= 45)                 # ouder dan anderhalve maand telt niet meer
    siv = g.si.to_numpy()[ii]
    E[s:e, 0] = np.where(fresh, g.dtc.to_numpy()[ii], np.nan)
    E[s:e, 1] = np.where(fresh, g.chg.to_numpy()[ii], np.nan)
    E[s:e, 2] = np.where(fresh, np.log10(np.maximum(siv * px[s:e], 1.0)), np.nan)
    E[s:e, 3] = np.where(fresh & (dv[s:e] > 0), siv * px[s:e] / np.maximum(dv[s:e], 1.0), np.nan)
np.save(os.path.join(ALL, "extra_si.npy"), E)
json.dump(["si_dtc", "si_chg", "si_lval", "si_rel"], open(os.path.join(ALL, "extra_si.json"), "w"))
m = (D.region == 0) & D.res
print("dekking Amerikaanse dagen: %.1f%%" % (100 * np.isfinite(E[m, 0]).mean()), "vanaf", d2s(D.day[m][np.isfinite(E[m, 0])].min()))
# eerste blik: trefkans naar short interest t.o.v. omzet (dagen om te dekken bij de huidige omzet)
y = D.y[m]; r = E[m, 3]; yr = D.year[m]
sel = np.isfinite(r) & (yr >= 2019) & (yr <= 2024)
q = pd.qcut(r[sel], [0, .5, .8, .9, .95, .99, 1.0])
print(pd.DataFrame({"q": q, "y": y[sel]}).groupby("q", observed=True).y.agg(["size", "mean"]).assign(pct=lambda t: (100 * t["mean"]).round(3)).drop(columns="mean").to_string())
