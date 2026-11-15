"""Uitkomsten gerekend vanaf de opening van de dag ná de voorspeldag, voor elke rij van de dataset.

  python3 labels_open.py <ssdata>

Schrijft all/lab_<naam>.npy (float32, NaN = onbekend):
  gap1    opening van dag t+1 t.o.v. het slot van dag t
  lo1r    laagste koers van dag t+1 t.o.v. het slot van dag t   (wordt een limietorder gevuld?)
  hi1r    hoogste koers van dag t+1 t.o.v. het slot van dag t
  yo      1 als binnen 10 handelsdagen een slot >= +50% boven die opening ligt en de dag erna nog >= +20%
  to      1 als een slot binnen 10 handelsdagen >= +50% boven die opening ligt (aanraken, zonder standhouden)
  r10o    slot van dag t+10 t.o.v. die opening
  r5o     slot van dag t+5 t.o.v. die opening
  mx10o   hoogste slot in t+1..t+10 t.o.v. die opening
  mn10o   laagste slot in t+1..t+10 t.o.v. die opening
  mnl10o  laagste koers binnen de dag in t+1..t+10 t.o.v. die opening (voor een stop)
  tp50o   rendement als je verkoopt op het eerste slot >= +50%, anders op dag t+10
"""
import os, sys, pickle, time
import numpy as np, pandas as pd
from numpy.lib.stride_tricks import sliding_window_view as swv

ROOT = sys.argv[1]; ALL = os.path.join(ROOT, "all")
tid = np.load(os.path.join(ALL, "tid.npy")); tix = np.load(os.path.join(ALL, "tix.npy"))
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk"])
N = len(tid)
NAMES = ["gap1", "lo1r", "hi1r", "yo", "to", "r10o", "r5o", "mx10o", "mn10o", "mnl10o", "tp50o"]
out = {k: np.full(N, np.nan, np.float32) for k in NAMES}
order = np.argsort(tid, kind="stable"); st = tid[order]
b = np.flatnonzero(np.diff(st)) + 1
starts = np.r_[0, b]; ends = np.r_[b, N]
rows_of = {int(st[s]): order[s:e] for s, e in zip(starts, ends)}
t0 = time.time(); done = 0
for ch, g in meta.groupby("chunk"):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for r in g.itertuples():
        rows = rows_of.get(int(r.tid))
        c = items.get(r.ticker)
        if rows is None or c is None or "adj" not in c:
            continue
        A = c["adj"].astype(np.float64); n = len(A)
        if n < 13:
            continue
        O = c["open"].astype(np.float64) * A; L = c["low"].astype(np.float64) * A; H = c["high"].astype(np.float64) * A
        W = swv(A, 11)                      # W[i] = A[i..i+10]
        Lw = swv(L, 10)                     # Lw[i] = L[i..i+9]
        m = n - 12                          # geldig voor t = 0..m-1 (t+11 <= n-1)
        t = np.arange(m)
        o1 = O[t + 1]; c0 = A[t]
        Wt = W[t + 1]                       # sloten t+1..t+11
        ok = (o1 > 0) & (c0 > 0) & np.isfinite(o1)
        with np.errstate(divide="ignore", invalid="ignore"):
            touch = Wt[:, :10] >= 1.5 * o1[:, None]
            hold = Wt[:, 1:11] >= 1.2 * o1[:, None]
            yo = (touch & hold).any(axis=1)
            to = touch.any(axis=1)
            first = np.argmax(touch, axis=1)
            tp = np.where(to, Wt[t, first] / o1 - 1, Wt[:, 9] / o1 - 1)
            vals = {
                "gap1": o1 / c0 - 1, "lo1r": L[t + 1] / c0 - 1, "hi1r": H[t + 1] / c0 - 1,
                "yo": yo.astype(np.float64), "to": to.astype(np.float64),
                "r10o": Wt[:, 9] / o1 - 1, "r5o": Wt[:, 4] / o1 - 1,
                "mx10o": Wt[:, :10].max(axis=1) / o1 - 1, "mn10o": Wt[:, :10].min(axis=1) / o1 - 1,
                "mnl10o": Lw[t + 1].min(axis=1) / o1 - 1, "tp50o": tp,
            }
        ti = tix[rows].astype(np.int64)
        good = ti < m
        gi = ti[good]; gr = rows[good]
        keep = ok[gi]
        for k in NAMES:
            v = vals[k][gi].astype(np.float32); v[~keep] = np.nan
            out[k][gr] = v
        done += 1
    print(f"portie {int(ch)}: {done} aandelen, {time.time() - t0:.0f}s", flush=True)
for k in NAMES:
    np.save(os.path.join(ALL, f"lab_{k}.npy"), out[k])
y = np.load(os.path.join(ALL, "y.npy"))
both = np.isfinite(y) & np.isfinite(out["yo"])
print("rijen", N, "| met uitkomst vanaf de opening", int(np.isfinite(out["yo"]).sum()), "| beide bekend", int(both.sum()))
print("basiskans vanaf het slot %.3f%%, vanaf de opening %.3f%%, aanraken vanaf de opening %.3f%%" % (100 * y[both].mean(), 100 * out["yo"][both].mean(), 100 * out["to"][both].mean()))
print("overlap: van de treffers vanaf het slot is %.1f%% ook raak vanaf de opening; van de treffers vanaf de opening %.1f%% ook vanaf het slot" % (100 * out["yo"][both][y[both] == 1].mean(), 100 * y[both][out["yo"][both] == 1].mean()))
print("opening t.o.v. slot: gemiddeld %+.2f%%, mediaan %+.2f%%" % (100 * np.nanmean(out["gap1"]), 100 * np.nanmedian(out["gap1"])))
