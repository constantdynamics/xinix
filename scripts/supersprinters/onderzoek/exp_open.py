"""Walk-forward voor uitkomsten gerekend vanaf de opening van de volgende dag.

  python3 exp_open.py <naam> <label> <testjaren> [opties als key=value]

  label     naam van all/lab_<label>.npy (bv. yo: raak vanaf de opening; of een regel als 'r10o>0.2', 'r10o<-0.3')
  obj=binary|huber    binary (standaard) of regressie op het label, begrensd met clip=lo,hi
  extra=gap1,...      extra kenmerken uit all/lab_<naam>.npy (bv. de opening t.o.v. het slot, voor een oordeel vlak voor de opening)

Zelfde kenmerken, steekproef en instellingen als exp.py (lite_no5d+b+c); alleen de uitkomst verschilt.
"""
import os, sys, time, json, re
import numpy as np, pandas as pd
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(__file__))
from ds import *

NAME, LABEL, YEARS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
OPT = dict(kv.split("=") for kv in sys.argv[4:])
NEG_RATE = 0.2
OBJ = OPT.get("obj", "binary")
OUT = os.path.join(ROOT, "runs", NAME); os.makedirs(OUT, exist_ok=True)
CACHE = os.path.join(ROOT, "cache")
D = DS()
B, BNAMES = D.breadth()
t00 = time.time()
def log(*a): print(f"[{time.time() - t00:6.0f}s]", *a, flush=True)

def lab(name): return np.load(os.path.join(ALL, f"lab_{name}.npy"))
m_ = re.match(r"^(\w+)([<>])(-?[\d.]+)$", LABEL)
if m_:
    v = lab(m_.group(1)); thr = float(m_.group(3))
    Yall = np.where(np.isfinite(v), ((v > thr) if m_.group(2) == ">" else (v < thr)).astype(np.float32), np.nan).astype(np.float32)
else:
    Yall = lab(LABEL).astype(np.float32)
if OBJ != "binary" and OPT.get("clip"):
    lo, hi = [float(x) for x in OPT["clip"].split(",")]
    Yall = np.where(np.isfinite(Yall), np.clip(Yall, lo, hi), np.nan).astype(np.float32)

def rate_codes(codes, names):
    m = D.res & (D.year < 2019)
    n = np.bincount(codes[m], minlength=len(names)).astype(float)
    h = np.bincount(codes[m], weights=D.y[m], minlength=len(names))
    p0 = h.sum() / n.sum(); rate = (h + 2000 * p0) / (n + 2000)
    order = np.argsort(rate); rank = np.empty(len(names), np.float32); rank[order] = np.arange(len(names))
    return rank
EX_RANK = rate_codes(D.exch, D.exch_names); SEC_RANK = rate_codes(D.sector, D.sector_names)

base_feats = [f for f in feat.LITE if f != "t_p5d"]
fcols = np.array([feat.FIDX[f] for f in base_feats])
ENAMES = [x for x in OPT.get("extra", "").split(",") if x]
EXTRA = [lab(x) for x in ENAMES]
FNAMES = base_feats + BNAMES + ["region", "exch_rank", "sector_rank"] + [f"x_{e}" for e in ENAMES]
log("kenmerken", len(FNAMES), "| label", LABEL, "| doel", OBJ)

def matrix(idx):
    parts = [np.concatenate([np.asarray(D.X[idx[i:i + 1_000_000]][:, fcols]) for i in range(0, len(idx), 1_000_000)]), B[idx],
             np.stack([D.region[idx].astype(np.float32), EX_RANK[D.exch[idx]], SEC_RANK[D.sector[idx]]], axis=1)]
    if EXTRA: parts.append(np.stack([e[idx] for e in EXTRA], axis=1).astype(np.float32))
    return np.concatenate(parts, axis=1)

# dezelfde steekproef als exp.py (alle trefdagen vanaf het slot + 20% van de rest, met gewicht), zodat de bewaarde matrix bruikbaar is
rng = np.random.default_rng(7)
pick = D.res & ((D.y == 1) | (rng.random(D.N) < NEG_RATE))
tr_idx = np.where(pick)[0]
M0 = np.load(os.path.join(CACHE, "M_lite_no5dpbpc_0.2_43__.npy"), mmap_mode="r")
assert M0.shape == (len(tr_idx), 43), (M0.shape, len(tr_idx))
tr_day = D.day[tr_idx]; tr_y = Yall[tr_idx]
tr_w = np.where(D.y[tr_idx] == 1, 1.0, 1.0 / NEG_RATE).astype(np.float32)
tr_x = np.stack([e[tr_idx] for e in EXTRA], axis=1).astype(np.float32) if EXTRA else None
have = np.isfinite(tr_y)
if tr_x is not None: have &= np.isfinite(tr_x).all(axis=1)
log("steekproef", len(tr_idx), "met uitkomst", int(have.sum()), "| gewogen gemiddelde van het label %.5f" % (np.sum(tr_y[have] * tr_w[have]) / tr_w[have].sum()))

PARAMS = dict(objective=OBJ, learning_rate=0.05, num_leaves=63, min_data_in_leaf=300, feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1,
              lambda_l2=20, max_bin=127, num_threads=4, verbose=-1, seed=11, min_sum_hessian_in_leaf=1e-3)
if OBJ == "huber": PARAMS["alpha"] = float(OPT.get("alpha", 0.3))
MAX_ROUNDS = int(OPT.get("rounds", 1200)); FIRST_YEAR = 2017

def rows(mask):
    i = np.where(mask)[0]
    X = np.asarray(M0[i])
    return (np.concatenate([X, tr_x[i]], axis=1) if tr_x is not None else X), i

def platt_fit(raw, y, w):
    from sklearn.linear_model import LogisticRegression
    z = np.log(np.clip(raw, 1e-7, 1 - 1e-7) / (1 - np.clip(raw, 1e-7, 1 - 1e-7))).reshape(-1, 1)
    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=200).fit(z, y, sample_weight=w)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])
def platt_apply(ab, raw):
    z = np.log(np.clip(raw, 1e-7, 1 - 1e-7) / (1 - np.clip(raw, 1e-7, 1 - 1e-7)))
    return 1 / (1 + np.exp(-(ab[0] * z + ab[1])))

for Y in YEARS:
    if os.path.exists(os.path.join(OUT, f"pred_{Y}.npz")) and OPT.get("force", "0") != "1":
        log(f"jaar {Y}: al klaar"); continue
    t0 = s2d(f"{Y}-01-01"); t1 = s2d(f"{Y + 1}-01-01"); v0 = s2d(f"{Y - 1}-01-01"); start = s2d(f"{FIRST_YEAR}-01-01")
    fit_m = have & (tr_day >= start) & (tr_day < v0 - EMBARGO)
    val_m = have & (tr_day >= v0) & (tr_day < t0 - EMBARGO)
    Xf, fi = rows(fit_m); Xv, vi = rows(val_m)
    dtrain = lgb.Dataset(Xf, tr_y[fi], weight=tr_w[fi], feature_name=FNAMES, free_raw_data=True)
    dval = lgb.Dataset(Xv, tr_y[vi], weight=tr_w[vi], reference=dtrain)
    model = lgb.train(PARAMS, dtrain, MAX_ROUNDS, valid_sets=[dval], callbacks=[lgb.early_stopping(80, verbose=False), lgb.log_evaluation(0)])
    best = model.best_iteration
    ab = platt_fit(model.predict(Xv, num_iteration=best), tr_y[vi], tr_w[vi]) if OBJ == "binary" else (1.0, 0.0)
    all_m = have & (tr_day >= start) & (tr_day < t0 - EMBARGO)
    Xa, ai = rows(all_m)
    model2 = lgb.train(PARAMS, lgb.Dataset(Xa, tr_y[ai], weight=tr_w[ai], feature_name=FNAMES, free_raw_data=True), int(best * 1.1) + 1)
    te = np.where(D.ok & (D.day >= t0) & (D.day < t1))[0]
    raw2 = np.zeros(len(te), np.float32)
    for i in range(0, len(te), 1_000_000):
        raw2[i:i + 1_000_000] = model2.predict(matrix(te[i:i + 1_000_000]))
    p2 = platt_apply(ab, raw2).astype(np.float32) if OBJ == "binary" else raw2
    np.savez(os.path.join(OUT, f"pred_{Y}.npz"), idx=te, raw2=raw2, p2=p2, ab=np.array(ab))
    model2.save_model(os.path.join(OUT, f"model2_{Y}.txt"))
    imp = pd.Series(model2.feature_importance("gain"), index=FNAMES).sort_values(ascending=False)
    imp.to_csv(os.path.join(OUT, f"imp_{Y}.csv"))
    yy = Yall[te]; m = np.isfinite(yy) & np.isfinite(raw2)
    if OBJ == "binary":
        from sklearn.metrics import roc_auc_score, average_precision_score
        log(f"  {Y}: fit {len(fi)} + ijk {len(vi)}, {best} rondes; test n={m.sum()} basis {100 * yy[m].mean():.3f}%  AUC {roc_auc_score(yy[m], raw2[m]):.4f}  AP {average_precision_score(yy[m], raw2[m]):.4f}")
    else:
        top = np.argsort(-raw2[m])[: max(1, int(m.sum() * 0.001))]
        log(f"  {Y}: fit {len(fi)} + ijk {len(vi)}, {best} rondes; test n={m.sum()} gemiddeld {100 * yy[m].mean():+.3f}%, bovenste 0,1% op voorspelling: {100 * yy[m][top].mean():+.2f}%")
    log("  top kenmerken:", ", ".join(imp.index[:10]))
log("klaar")
