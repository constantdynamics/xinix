"""Definitief model: zelfde recept als in de test, nu getraind op alle beoordeelbare dagen.

Schrijft:  model.json (bomen + ijklijn + codes), testvectors.json (controle voor de TypeScript-versie),
           breadth_seed.json (marktklimaat van de laatste weken, om de voortschrijdende gemiddelden te vullen).
"""
import os, sys, json, hashlib, time
import numpy as np, pandas as pd
import lightgbm as lgb
sys.path.insert(0, os.path.dirname(__file__))
from ds import *
import policy

OUT = sys.argv[1]
RUN = "lite_v3"
os.makedirs(OUT, exist_ok=True)
D = DS()
B, BNAMES = D.breadth()
codes = json.load(open(os.path.join(ROOT, "runs", RUN, "codes.json")))
EX_RANK = np.array([codes["exch"][e] for e in D.exch_names], np.float32)
SEC_RANK = np.array([codes["sector"][e] for e in D.sector_names], np.float32)
base_feats = [f for f in feat.LITE if f != "t_p5d"]
FNAMES = base_feats + BNAMES + ["region", "exch_rank", "sector_rank"]
fcols = np.array([feat.FIDX[f] for f in base_feats])
NEG = 0.2
rng = np.random.default_rng(7)
pick = D.res & ((D.y == 1) | (rng.random(D.N) < NEG))
tr_idx = np.where(pick)[0]
M = np.load(os.path.join(ROOT, "cache", "M_lite_no5dpbpc_0.2_43__.npy"), mmap_mode="r")
assert M.shape == (len(tr_idx), len(FNAMES)), (M.shape, len(tr_idx), len(FNAMES))
tr_day, tr_y = D.day[tr_idx], D.y[tr_idx]
tr_w = np.where(tr_y == 1, 1.0, 1.0 / NEG).astype(np.float32)
PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=63, min_data_in_leaf=300, feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1,
              lambda_l2=20, max_bin=127, num_threads=4, verbose=-1, seed=11, min_sum_hessian_in_leaf=1e-3)
start = s2d("2017-01-01"); v0 = s2d("2026-01-01")
fit_m = (tr_day >= start) & (tr_day < v0 - EMBARGO); val_m = tr_day >= v0
dtrain = lgb.Dataset(np.asarray(M[np.where(fit_m)[0]]), tr_y[fit_m], weight=tr_w[fit_m], feature_name=FNAMES)
dval = lgb.Dataset(np.asarray(M[np.where(val_m)[0]]), tr_y[val_m], weight=tr_w[val_m], reference=dtrain)
m1 = lgb.train(PARAMS, dtrain, 1200, valid_sets=[dval], callbacks=[lgb.early_stopping(80, verbose=False), lgb.log_evaluation(0)])
best = m1.best_iteration
rounds = int(best * 1.1) + 1
print("beste ronde", best, "→ definitief", rounds, flush=True)
all_m = tr_day >= start
model = lgb.train(PARAMS, lgb.Dataset(np.asarray(M[np.where(all_m)[0]]), tr_y[all_m], weight=tr_w[all_m], feature_name=FNAMES), rounds)
last_day = int(tr_day.max())
print("getraind t/m", d2s(last_day), "rijen", int(all_m.sum()), "treffers", int(tr_y[all_m].sum()), flush=True)

# ijklijn: op de voorspellingen van alle testjaren (elk door een model dat dat jaar niet zag)
YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
df = policy.load(RUN, YEARS)
d = df[np.isfinite(df.y)]
curve = policy.fit_curve(d.raw.to_numpy(), d.y.to_numpy())
print("ijklijn", curve)
final = json.load(open(os.path.join(ROOT, "runs", "final_lite_v3.json")))


# bomen plat maken
def flat(tree):
    F, T, L, R, DL, MT, V = [], [], [], [], [], [], []

    def rec(node):
        if "leaf_value" in node and "split_feature" not in node:
            V.append(float(node["leaf_value"])); return -len(V)          # blad: -(index+1)
        i = len(F)
        F.append(int(node["split_feature"])); T.append(float(node["threshold"])); L.append(0); R.append(0)
        DL.append(1 if node["default_left"] else 0)
        MT.append({"None": 0, "Zero": 1, "NaN": 2}[node["missing_type"]])
        assert node["decision_type"] == "<="
        l = rec(node["left_child"]); r = rec(node["right_child"])
        L[i] = l; R[i] = r
        return i
    root = rec(tree)
    if root < 0:                                   # boom met één blad
        return {"f": [], "t": [], "l": [], "r": [], "d": [], "m": [], "v": V}
    return {"f": F, "t": T, "l": L, "r": R, "d": DL, "m": MT, "v": V}


dump = model.dump_model()
trees = [flat(t["tree_structure"]) for t in dump["tree_info"]]
n_leaves = sum(len(t["v"]) for t in trees)
# marktklimaat: lange-termijnmediaan als vergelijkingspunt voor de uitleg ("redenen")
bmed = np.nanmedian(B[D.res][::50], axis=0)
fmed = np.nanmedian(np.asarray(M[::40]), axis=0)
out = {
    "version": "ss1-" + d2s(last_day),
    "trained_through": d2s(last_day), "rounds": rounds, "leaves": n_leaves,
    "features": FNAMES, "trees": trees,
    "curve": curve, "shrink_from": 0.15, "shrink": 0.75, "mult_seed": final["mult_last"],
    "codes": codes, "feature_median": {k: (None if not np.isfinite(v) else float(v)) for k, v in zip(FNAMES, fmed)},
    "base_rate_pct": float(100 * D.y[D.res & (D.year >= 2025)].mean()),
    "min_px_usd": feat.MIN_PX_USD, "min_dvol_usd": feat.MIN_DVOL_USD,
    "holdout": {k: {nm: {kk: final["eindtest 2025–2026"][nm][kk] for kk in ("n", "base_pct", "auc", "ap", "brier", "logloss", "calib", "top", "lead", "alerts")} for nm in ("oudA", "oudB", "new")} for k in ["eindtest"]},
}
body = json.dumps(out, separators=(",", ":"))
# afronden op 7 significante cijfers scheelt de helft in grootte
def rnd(o, key=None):
    # splitsgrenzen ("t") blijven op volle precisie: ze liggen precies tussen twee buurwaarden uit de training
    if isinstance(o, float):
        return o if key == "t" else float(f"{o:.8g}")
    if isinstance(o, list):
        return [rnd(x, key) for x in o]
    if isinstance(o, dict):
        return {k: rnd(v, k) for k, v in o.items()}
    return o
out = rnd(out)
body = json.dumps(out, separators=(",", ":"))
open(os.path.join(OUT, "ss-model.json"), "w").write(body)
sha = hashlib.sha256(body.encode()).hexdigest()
print("model", len(body) // 1024, "kB;", len(trees), "bomen,", n_leaves, "bladeren; sha256", sha, flush=True)


# controle: het afgeronde model in Python (zelfde regels als de TypeScript-versie) tegen LightGBM zelf
def py_score(row):
    s = 0.0
    for t in out["trees"]:
        if not t["f"]:
            s += t["v"][0]; continue
        i = 0
        while True:
            x = row[t["f"][i]]
            mt = t["m"][i]
            if x != x and mt != 2:
                x = 0.0
            if (mt == 1 and abs(x) <= 1e-35) or (mt == 2 and x != x):
                nxt = t["l"][i] if t["d"][i] else t["r"][i]
            else:
                nxt = t["l"][i] if x <= t["t"][i] else t["r"][i]
            if nxt < 0:
                s += t["v"][-nxt - 1]; break
            i = nxt
    return 1 / (1 + np.exp(-s))


rs = np.random.default_rng(5)
# 400 gewone rijen + 200 uit de kopgroep
rows_i = np.concatenate([rs.choice(len(tr_idx), 400, replace=False), np.argsort(-model.predict(np.asarray(M[-400000:])))[:200] + len(tr_idx) - 400000])
Xs = np.asarray(M[np.sort(rows_i)]).astype(np.float64)
ref = model.predict(Xs)
mine = np.array([py_score(r) for r in Xs])
print("controle afgerond model: max verschil", float(np.max(np.abs(ref - mine))), "kans max", float(ref.max()))
assert np.max(np.abs(ref - mine)) < 1e-6
cal = policy.apply_curve(out["curve"], mine)
vec = [{"x": [None if not np.isfinite(v) else float(v) for v in r], "raw": float(a), "cal": float(c)} for r, a, c in zip(Xs, mine, cal)]
json.dump({"sha256": sha, "features": FNAMES, "vectors": vec}, open(os.path.join(OUT, "testvectors.json"), "w"))

# marktklimaat van de laatste 45 sessies per regio
seed = []
for reg in range(4):
    days, vals = D._breadth_tables[reg]
    for dday, v in list(zip(days, vals))[-45:]:
        seed.append({"day": d2s(dday), "region": reg, "b1_20": float(v[0]), "b1_10": float(v[1]), "bm_50": float(v[2]), "bm_100": float(v[3]), "bvw_15": float(v[4])})
json.dump(seed, open(os.path.join(OUT, "breadth_seed.json"), "w"))
imp = pd.Series(model.feature_importance("gain"), index=FNAMES).sort_values(ascending=False)
imp.to_csv(os.path.join(OUT, "importance.csv"))
print("belangrijkste kenmerken:", ", ".join(f"{k} {100 * v / imp.sum():.1f}%" for k, v in imp.head(15).items()))
model.save_model(os.path.join(OUT, "model.txt"))
print("klaar")
