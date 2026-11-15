"""Gemiste omgekeerde splits opsporen in de opgeschoonde reeksen en per rij markeren.

  python3 rsplit.py <ssdata>

Een omgekeerde split die de bron niet meldt, ziet eruit als een koerssprong (x2 of meer) op een dag waarop het
aantal verhandelde aandelen juist inzakt en de omzet in geld gewoon blijft. Een echte sprong door nieuws heeft
een veelvoud aan volume.
Schrijft all/rs_days.parquet (ticker, dag, factor) en all/lab_rswin.npy (1 = zo'n dag valt in het uitkomstvenster
van de rij: t+1..t+11) en all/lab_rsfeat.npy (1 = zo'n dag valt in het jaar vóór de rij: kenmerken kloppen niet).
"""
import os, sys, pickle, time
import numpy as np, pandas as pd

ROOT = sys.argv[1]; ALL = os.path.join(ROOT, "all")
tid = np.load(os.path.join(ALL, "tid.npy")); tix = np.load(os.path.join(ALL, "tix.npy"))
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk", "market"])
N = len(tid)
rswin = np.zeros(N, np.int8); rsfeat = np.zeros(N, np.int8)
order = np.argsort(tid, kind="stable"); st = tid[order]
b = np.flatnonzero(np.diff(st)) + 1
rows_of = {int(st[s]): order[s:e] for s, e in zip(np.r_[0, b], np.r_[b, N])}
found = []
for ch, g in meta.groupby("chunk"):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for r in g.itertuples():
        c = items.get(r.ticker)
        if c is None or "adj" not in c:
            continue
        A = c["adj"].astype(np.float64); V = c["vol"].astype(np.float64); n = len(A)
        if n < 30:
            continue
        ratio = np.ones(n); ratio[1:] = A[1:] / np.maximum(A[:-1], 1e-12)
        # mediaan van het volume en van de omzet over de 20 dagen ervoor
        vs = pd.Series(V); ds_ = pd.Series(V * A)
        mv = vs.rolling(20, min_periods=5).median().shift(1).to_numpy()
        md = ds_.rolling(20, min_periods=5).median().shift(1).to_numpy()
        with np.errstate(divide="ignore", invalid="ignore"):
            vr = V / mv; dr = (V * A) / md
        sus = (ratio >= 1.8) & (vr <= 0.6) & (dr <= 4.0) & np.isfinite(vr) & np.isfinite(dr)
        js = np.flatnonzero(sus)
        if not len(js):
            continue
        for j in js:
            found.append((r.ticker, r.market, int(c["day"][j]), float(ratio[j]), float(vr[j]), float(dr[j])))
        rows = rows_of.get(int(r.tid))
        if rows is None:
            continue
        ti = tix[rows].astype(np.int64)
        w = np.zeros(len(ti), bool); f = np.zeros(len(ti), bool)
        for j in js:
            w |= (ti < j) & (ti >= j - 11)
            f |= (ti >= j) & (ti < j + 252)
        rswin[rows[w]] = 1; rsfeat[rows[f]] = 1
np.save(os.path.join(ALL, "lab_rswin.npy"), rswin); np.save(os.path.join(ALL, "lab_rsfeat.npy"), rsfeat)
d = pd.DataFrame(found, columns=["ticker", "market", "day", "factor", "vol_ratio", "dvol_ratio"])
d.to_parquet(os.path.join(ALL, "rs_days.parquet"))
y = np.load(os.path.join(ALL, "y.npy")); day = np.load(os.path.join(ALL, "day.npy"))
yr = (day.astype("datetime64[D]").astype("datetime64[Y]").astype(int) + 1970)
print("verdachte dagen:", len(d), "bij", d.ticker.nunique(), "aandelen; per markt:", d.groupby("market").size().sort_values(ascending=False).head(8).to_dict())
print("factor: mediaan %.1f; verdeling" % d.factor.median(), np.round(np.percentile(d.factor, [10, 25, 50, 75, 90]), 1))
ok = np.isfinite(y)
print("rijen met zo'n dag in het uitkomstvenster: %d (%.3f%%); daarvan telde als treffer: %d" % (int(rswin.sum()), 100 * rswin.mean(), int(((rswin == 1) & ok & (y == 1)).sum())))
print("alle treffers: %d; daarvan in zo'n venster: %d (%.1f%%)" % (int((ok & (y == 1)).sum()), int(((rswin == 1) & ok & (y == 1)).sum()), 100 * ((rswin == 1) & ok & (y == 1)).sum() / (ok & (y == 1)).sum()))
for Y in range(2018, 2027):
    m = ok & (yr == Y)
    print(" ", Y, "treffers", int((m & (y == 1)).sum()), "waarvan verdacht", int((m & (y == 1) & (rswin == 1)).sum()), "(%.1f%%)" % (100 * (m & (y == 1) & (rswin == 1)).sum() / max(1, (m & (y == 1)).sum())))
print("rijen waarvan de kenmerken een jaar lang op een verkeerde reeks rusten: %d (%.2f%%)" % (int(rsfeat.sum()), 100 * rsfeat.mean()))
print(d.sort_values("day").tail(12).assign(day=lambda x: pd.to_datetime(x.day, unit="D").dt.date).to_string())
