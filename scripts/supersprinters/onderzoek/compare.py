"""Vergelijk oud (productie-lifts en opnieuw gemeten) met nieuw op dezelfde aandelen en dagen.

  python3 compare.py <run[,run2…]> <jaren> [variant p1|p2] [uitvoer.json]
"""
import os, sys, json, time
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from ds import *
import evalu

RUNS = sys.argv[1].split(",")
YEARS = [int(x) for x in sys.argv[2].split(",")]
VAR = sys.argv[3] if len(sys.argv) > 3 else "p2"
OUTJ = sys.argv[4] if len(sys.argv) > 4 else None
D = DS()
slots = np.load(os.path.join(ALL, "slots.npy"), mmap_mode="r")
own_n = D.col("own_n").astype(np.float64)
own_h = np.round(D.col("own_rate").astype(np.float64) * (own_n + 250) - 1.0)
expl = pd.read_parquet(os.path.join(ALL, "expl.parquet"))
prodm = old_prod()
frames = []
allres = {}
for Y in YEARS:
    t0 = s2d(f"{Y}-01-01"); t1 = s2d(f"{Y + 1}-01-01")
    preds = {r: np.load(os.path.join(ROOT, "runs", r, f"pred_{Y}.npz")) for r in RUNS}
    idx = preds[RUNS[0]]["idx"]
    sl = np.asarray(slots[idx])
    scores = {}
    rawA = old_raw(prodm, sl, own_h[idx], own_n[idx])
    scores["oudA"] = (old_cal(prodm, rawA), rawA)
    tr = np.where(D.res & (D.day >= s2d("2017-01-01")) & (D.day < t0 - EMBARGO))[0]
    slt = np.asarray(slots[tr])
    mB = old_fit(slt, D.y[tr])
    rawT = old_raw(mB, slt, own_h[tr], own_n[tr])
    old_fit_calib(mB, rawT, D.y[tr])
    rawB = old_raw(mB, sl, own_h[idx], own_n[idx])
    scores["oudB"] = (old_cal(mB, rawB), rawB)
    for r in RUNS:
        assert np.array_equal(preds[r]["idx"], idx)
        v = VAR
        scores[r] = (preds[r][v] * 100, preds[r]["raw" + v[1]])
    res, df = evalu.evaluate(D, idx, scores, expl)
    allres[str(Y)] = res
    print(evalu.fmt(res, f"testjaar {Y}"), flush=True)
    frames.append(df)
df = pd.concat(frames, ignore_index=True)
# alle jaren samen: zelfde rijen, rang per dag blijft
res = {}
d = df[np.isfinite(df.y)]
y = d.y.to_numpy()
from sklearn.metrics import roc_auc_score, average_precision_score
for name in [c[2:] for c in df.columns if c.startswith("p_")]:
    p = d[f"p_{name}"].to_numpy(); o = d[f"o_{name}"].to_numpy(); pc = np.clip(p / 100, 1e-6, 1 - 1e-6)
    r = {"n": int(len(d)), "base_pct": float(100 * y.mean()), "auc": float(roc_auc_score(y, o)), "ap": float(average_precision_score(y, o)),
         "brier": float(np.mean((pc - y) ** 2)), "logloss": float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc))),
         "calib": evalu.calib_table(p, y), "top": evalu.top_k(df, name), "lead": evalu.lead_time(df, expl, name)}
    r["alerts"], al = evalu.simulate_alerts(df, name)
    r["alerts10"], _ = evalu.simulate_alerts(df, name, min_prob=10.0)
    res[name] = r
allres["samen"] = res
print(evalu.fmt(res, f"alle testjaren samen {YEARS[0]}–{YEARS[-1]}"), flush=True)
if OUTJ:
    json.dump(allres, open(OUTJ, "w"))
    df.to_parquet(OUTJ.replace(".json", "_rows.parquet"))
