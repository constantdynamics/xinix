"""Walk-forward: per testjaar een model dat alleen eerdere jaren zag. Schrijft voorspellingen per testjaar weg.

  python3 exp.py <naam> <kenmerkenset> <testjaren> [opties als key=value]
"""
import os, sys, time, json
import numpy as np, pandas as pd
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(__file__))
from ds import *

NAME, FSET, YEARS = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
OPT = dict(kv.split("=") for kv in sys.argv[4:])
NEG_RATE = float(OPT.get("neg", 0.2))
OUT = os.path.join(ROOT, "runs", NAME)
os.makedirs(OUT, exist_ok=True)
CACHE = os.path.join(ROOT, "cache")
os.makedirs(CACHE, exist_ok=True)

D = DS()
B, BNAMES = D.breadth()
t00 = time.time()


def log(*a):
    print(f"[{time.time() - t00:6.0f}s]", *a, flush=True)


# ordinale codes voor beurs en sector: volgorde naar trefkans vóór 2019 (ligt dus vast vóór elk testjaar)
def rate_codes(codes, names):
    m = D.res & (D.year < 2019)
    n = np.bincount(codes[m], minlength=len(names)).astype(float)
    h = np.bincount(codes[m], weights=D.y[m], minlength=len(names))
    p0 = h.sum() / n.sum()
    rate = (h + 2000 * p0) / (n + 2000)
    order = np.argsort(rate)
    rank = np.empty(len(names), np.float32); rank[order] = np.arange(len(names))
    return rank


EX_RANK = rate_codes(D.exch, D.exch_names)
SEC_RANK = rate_codes(D.sector, D.sector_names)
json.dump({"exch": dict(zip(D.exch_names, EX_RANK.tolist())), "sector": dict(zip(D.sector_names, SEC_RANK.tolist()))}, open(os.path.join(OUT, "codes.json"), "w"))

SETS = {
    "full": [f for f in feat.FEATURES if f not in ("t_p3m", "t_p6m", "t_p5d")],
    "lite": list(feat.LITE),
    "lite_no5d": [f for f in feat.LITE if f != "t_p5d"],
}
base_feats = SETS[FSET.split("+")[0]]
use_breadth = "+b" in FSET
use_codes = "+c" in FSET
drop = set(OPT.get("drop", "").split(",")) - {""}
base_feats = [f for f in base_feats if f not in drop]
EXTRA = None; ENAMES = []
if OPT.get("extra"):
    EXTRA = np.load(os.path.join(ALL, f"extra_{OPT['extra']}.npy"), mmap_mode="r")
    ENAMES = json.load(open(os.path.join(ALL, f"extra_{OPT['extra']}.json")))
FNAMES = base_feats + (BNAMES if use_breadth else []) + (["region", "exch_rank", "sector_rank"] if use_codes else []) + ENAMES
fcols = np.array([feat.FIDX[f] for f in base_feats])
log("kenmerken", len(FNAMES))


def matrix(idx):
    """idx gesorteerd. Geeft float32-matrix in de volgorde van FNAMES."""
    parts = [np.asarray(D.X[idx][:, fcols])] if len(idx) < 3_000_000 else None
    if parts is None:
        parts = [np.concatenate([np.asarray(D.X[idx[i:i + 1_000_000]][:, fcols]) for i in range(0, len(idx), 1_000_000)])]
    if use_breadth:
        parts.append(B[idx])
    if use_codes:
        parts.append(np.stack([D.region[idx].astype(np.float32), EX_RANK[D.exch[idx]], SEC_RANK[D.sector[idx]]], axis=1))
    if EXTRA is not None:
        parts.append(np.asarray(EXTRA[idx]))
    return np.concatenate(parts, axis=1) if len(parts) > 1 else parts[0]


# steekproef voor training: alle trefdagen + een vast deel van de rest (met gewicht)
rng = np.random.default_rng(7)
pick = D.res & ((D.y == 1) | (rng.random(D.N) < NEG_RATE))
tr_idx = np.where(pick)[0]
log("trainingssteekproef", len(tr_idx), "waarvan treffers", int(D.y[tr_idx].sum()))
cache_key = f"{FSET}_{NEG_RATE}_{len(FNAMES)}_{'-'.join(sorted(drop))}_{OPT.get('extra', '')}".replace("+", "p")
cpath = os.path.join(CACHE, f"M_{cache_key}.npy")
if os.path.exists(cpath):
    M = np.load(cpath, mmap_mode="r")
else:
    M = matrix(tr_idx)
    np.save(cpath, M)
    M = np.load(cpath, mmap_mode="r")
log("matrix", M.shape)
tr_day, tr_y = D.day[tr_idx], D.y[tr_idx]
tr_w = np.where(tr_y == 1, 1.0, 1.0 / NEG_RATE).astype(np.float32)

PARAMS = dict(objective="binary", learning_rate=float(OPT.get("lr", 0.05)), num_leaves=int(OPT.get("leaves", 63)),
              min_data_in_leaf=int(OPT.get("minleaf", 300)), feature_fraction=float(OPT.get("ff", 0.6)), bagging_fraction=0.8, bagging_freq=1,
              lambda_l2=float(OPT.get("l2", 20)), max_bin=int(OPT.get("bins", 127)), num_threads=4, verbose=-1, seed=11,
              min_sum_hessian_in_leaf=1e-3)
MAX_ROUNDS = int(OPT.get("rounds", 1200))
FIRST_YEAR = int(OPT.get("first", 2017))


def platt_fit(raw, y, w=None):
    """Logistische ijking op de logit van de modeluitkomst: p = sigmoid(a·logit(raw) + b)."""
    from sklearn.linear_model import LogisticRegression
    z = np.log(np.clip(raw, 1e-7, 1 - 1e-7) / (1 - np.clip(raw, 1e-7, 1 - 1e-7))).reshape(-1, 1)
    lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=200)
    lr.fit(z, y, sample_weight=w)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def platt_apply(ab, raw):
    z = np.log(np.clip(raw, 1e-7, 1 - 1e-7) / (1 - np.clip(raw, 1e-7, 1 - 1e-7)))
    return 1 / (1 + np.exp(-(ab[0] * z + ab[1])))


for Y in YEARS:
    if os.path.exists(os.path.join(OUT, f"pred_{Y}.npz")) and OPT.get("force", "0") != "1":
        log(f"jaar {Y}: al klaar, overgeslagen"); continue
    t0 = s2d(f"{Y}-01-01"); t1 = s2d(f"{Y + 1}-01-01")
    v0 = s2d(f"{Y - 1}-01-01")
    start = s2d(f"{FIRST_YEAR}-01-01")
    fit_m = (tr_day >= start) & (tr_day < v0 - EMBARGO)
    val_m = (tr_day >= v0) & (tr_day < t0 - EMBARGO)
    log(f"jaar {Y}: fit {fit_m.sum()} rijen ({int(tr_y[fit_m].sum())} treffers), ijkjaar {val_m.sum()} ({int(tr_y[val_m].sum())})")
    Xf = np.asarray(M[np.where(fit_m)[0]]); Xv = np.asarray(M[np.where(val_m)[0]])
    dtrain = lgb.Dataset(Xf, tr_y[fit_m], weight=tr_w[fit_m], feature_name=FNAMES, free_raw_data=True)
    dval = lgb.Dataset(Xv, tr_y[val_m], weight=tr_w[val_m], reference=dtrain)
    model = lgb.train(PARAMS, dtrain, MAX_ROUNDS, valid_sets=[dval], callbacks=[lgb.early_stopping(80, verbose=False), lgb.log_evaluation(0)])
    best = model.best_iteration
    pv = model.predict(Xv, num_iteration=best)
    ab = platt_fit(pv, tr_y[val_m], tr_w[val_m])
    log(f"  beste ronde {best}, ijking a={ab[0]:.3f} b={ab[1]:.3f}")
    # tweede variant: opnieuw trainen op alles t/m het ijkjaar met hetzelfde aantal rondes (ijking blijft die van hierboven)
    model2 = None
    if OPT.get("refit", "1") == "1":
        all_m = (tr_day >= start) & (tr_day < t0 - EMBARGO)
        d2 = lgb.Dataset(np.asarray(M[np.where(all_m)[0]]), tr_y[all_m], weight=tr_w[all_m], feature_name=FNAMES, free_raw_data=True)
        model2 = lgb.train(PARAMS, d2, int(best * 1.1) + 1)
        log("  opnieuw getraind op alles vóór het testjaar")
    # testjaar: alle dagen die meedoen (ook met nog onbekende uitkomst in het laatste jaar)
    te = np.where(D.ok & (D.day >= t0) & (D.day < t1))[0]
    raw1 = np.zeros(len(te), np.float32); raw2 = np.zeros(len(te), np.float32)
    for i in range(0, len(te), 1_000_000):
        Xt = matrix(te[i:i + 1_000_000])
        raw1[i:i + 1_000_000] = model.predict(Xt, num_iteration=best)
        if model2 is not None:
            raw2[i:i + 1_000_000] = model2.predict(Xt)
    np.savez(os.path.join(OUT, f"pred_{Y}.npz"), idx=te, raw1=raw1, p1=platt_apply(ab, raw1).astype(np.float32), raw2=raw2, p2=platt_apply(ab, raw2).astype(np.float32), ab=np.array(ab))
    model.save_model(os.path.join(OUT, f"model_{Y}.txt"), num_iteration=best)
    if model2 is not None:
        model2.save_model(os.path.join(OUT, f"model2_{Y}.txt"))
    imp = pd.Series(model.feature_importance("gain", iteration=best), index=FNAMES).sort_values(ascending=False)
    imp.to_csv(os.path.join(OUT, f"imp_{Y}.csv"))
    yy = D.y[te]; m = np.isfinite(yy)
    from sklearn.metrics import roc_auc_score, average_precision_score
    log(f"  test {Y}: n={m.sum()} basis {100 * yy[m].mean():.3f}%  AUC {roc_auc_score(yy[m], raw1[m]):.4f}  AP {average_precision_score(yy[m], raw1[m]):.4f}" +
        (f"  | opnieuw getraind: AUC {roc_auc_score(yy[m], raw2[m]):.4f} AP {average_precision_score(yy[m], raw2[m]):.4f}" if model2 is not None else ""))
    log("  top kenmerken:", ", ".join(f"{k}" for k in imp.index[:12]))
log("klaar")
