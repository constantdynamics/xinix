"""IJk-varianten voor de modeluitkomst, steeds alleen met gegevens van vóór het testjaar."""
import os, sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression
RUN = sys.argv[1]; YEARS = [int(x) for x in sys.argv[2].split(",")]
y_all = np.load(os.path.join(ALL, "y.npy"), mmap_mode="r"); day_all = np.load(os.path.join(ALL, "day.npy"), mmap_mode="r")
P = {}
for Y in YEARS:
    z = np.load(os.path.join(ROOT, "runs", RUN, f"pred_{Y}.npz"))
    idx = z["idx"]; y = np.asarray(y_all[idx]); m = np.isfinite(y)
    P[Y] = dict(raw1=z["raw1"][m], raw2=z["raw2"][m], p1=z["p1"][m], p2=z["p2"][m], y=y[m], day=np.asarray(day_all[idx])[m])
lg = lambda p: np.log(np.clip(p, 1e-7, 1 - 1e-7) / (1 - np.clip(p, 1e-7, 1 - 1e-7)))
BANDS = [0, 0.5, 1, 2, 5, 10, 15, 25, 100]
def table(p, y, label):
    pc = np.clip(p, 1e-6, 1 - 1e-6)
    out = [f"{label:28s} Brier {np.mean((pc - y) ** 2) * 1e4:.3f}e-4 logloss {-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)):.5f} |"]
    for lo, hi in zip(BANDS[:-1], BANDS[1:]):
        mm = (p * 100 >= lo) & (p * 100 < hi)
        if mm.sum(): out.append(f"{lo:g}-{hi:g}: {100 * p[mm].mean():.1f}→{100 * y[mm].mean():.1f} ({mm.sum()})")
    print("  ".join(out), flush=True)
def platt(raw, y):
    lr = LogisticRegression(C=1e6, max_iter=300).fit(lg(raw).reshape(-1, 1), y); return lambda r: lr.predict_proba(lg(r).reshape(-1, 1))[:, 1]
def platt2(raw, y):      # met een knik: aparte helling boven een logit-grens
    z = lg(raw); k = np.maximum(z - lg(np.array([0.05]))[0], 0)
    lr = LogisticRegression(C=1e6, max_iter=300).fit(np.c_[z, k], y)
    return lambda r: lr.predict_proba(np.c_[lg(r), np.maximum(lg(r) - lg(np.array([0.05]))[0], 0)])[:, 1]
def iso(raw, y):
    ir = IsotonicRegression(out_of_bounds="clip", y_min=1e-6, y_max=0.9).fit(raw, y); return lambda r: ir.predict(r)
res = {k: [] for k in ("S0 ijkjaar (p2)", "S0b ijkjaar model1 (p1)", "S1 platt op eerdere testjaren", "S1b platt met knik", "S2 isotoon op eerdere testjaren", "S1c platt laatste 2 jaar")}
ys = []
for i, Y in enumerate(YEARS[1:], 1):
    prev = YEARS[:i]
    r_prev = np.concatenate([P[q]["raw2"] for q in prev]); y_prev = np.concatenate([P[q]["y"] for q in prev])
    r = P[Y]["raw2"]; ys.append(P[Y]["y"])
    res["S0 ijkjaar (p2)"].append(P[Y]["p2"]); res["S0b ijkjaar model1 (p1)"].append(P[Y]["p1"])
    res["S1 platt op eerdere testjaren"].append(platt(r_prev, y_prev)(r))
    res["S1b platt met knik"].append(platt2(r_prev, y_prev)(r))
    res["S2 isotoon op eerdere testjaren"].append(iso(r_prev, y_prev)(r))
    p2 = prev[-2:]
    res["S1c platt laatste 2 jaar"].append(platt(np.concatenate([P[q]["raw2"] for q in p2]), np.concatenate([P[q]["y"] for q in p2]))(r))
y = np.concatenate(ys)
print(f"testjaren {YEARS[1]}–{YEARS[-1]} samen, n={len(y)}")
for k, v in res.items():
    table(np.concatenate(v), y, k)
print("per jaar, S1:")
for i, Y in enumerate(YEARS[1:]):
    table(res["S1 platt op eerdere testjaren"][i], ys[i], f"  {Y}")
