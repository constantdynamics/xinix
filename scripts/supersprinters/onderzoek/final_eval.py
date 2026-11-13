"""Eindvergelijking oud tegen nieuw op dezelfde aandelen en dagen, met het bevroren ontwerp.

  python3 final_eval.py <run> <uit.json>

Nieuw = model + ijklijn uit eerdere testjaren + dagelijkse bijsturing + demping boven 15%.
Oud A = het h14-model zoals het nu in productie staat (heeft de testjaren al gezien).
Oud B = dezelfde methode, opnieuw gemeten op alleen eerdere jaren.
"""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from ds import *
import evalu, policy

RUN, OUTJ = sys.argv[1], sys.argv[2]
YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
SHRINK_FROM, SHRINK = 0.15, 0.75
D = DS()
df = policy.load(RUN, YEARS)
curves = policy.calibrate(df, YEARS)
mult = policy.online(df)
p = df["p"].to_numpy()
df["p_new"] = np.where(p > SHRINK_FROM, SHRINK_FROM + SHRINK * (p - SHRINK_FROM), p) * 100
df["o_new"] = df["raw"]

slots = np.load(os.path.join(ALL, "slots.npy"), mmap_mode="r")
own_n = D.col("own_n").astype(np.float64)
own_h = np.round(D.col("own_rate").astype(np.float64) * (own_n + 250) - 1.0)
prodm = old_prod()
pa = np.zeros(len(df)); oa = np.zeros(len(df)); pb = np.zeros(len(df)); ob = np.zeros(len(df))
for Y in YEARS:
    m = (df.yr == Y).to_numpy()
    idx = df.idx.to_numpy()[m]
    sl = np.asarray(slots[idx])
    rawA = old_raw(prodm, sl, own_h[idx], own_n[idx])
    pa[m] = old_cal(prodm, rawA); oa[m] = rawA
    t0 = s2d(f"{Y}-01-01")
    tr = np.where(D.res & (D.day >= s2d("2017-01-01")) & (D.day < t0 - EMBARGO))[0]
    slt = np.asarray(slots[tr])
    mB = old_fit(slt, D.y[tr])
    old_fit_calib(mB, old_raw(mB, slt, own_h[tr], own_n[tr]), D.y[tr])
    rawB = old_raw(mB, sl, own_h[idx], own_n[idx])
    pb[m] = old_cal(mB, rawB); ob[m] = rawB
    print("oud model klaar voor", Y, flush=True)
df["p_oudA"], df["o_oudA"], df["p_oudB"], df["o_oudB"] = pa, oa, pb, ob
df["tix"] = D.tix[df.idx.to_numpy()]
for nm in ("new", "oudA", "oudB"):
    df[f"rk_{nm}"] = df.groupby("day")[f"o_{nm}"].rank(ascending=False, method="first")
expl = pd.read_parquet(os.path.join(ALL, "expl.parquet"))
df.to_parquet(OUTJ.replace(".json", "_rows.parquet"))


def block(d, label):
    out = {}
    dd = d[np.isfinite(d.y)]
    y = dd.y.to_numpy()
    from sklearn.metrics import roc_auc_score, average_precision_score
    for nm in ("oudA", "oudB", "new"):
        pp = dd[f"p_{nm}"].to_numpy(); oo = dd[f"o_{nm}"].to_numpy(); pc = np.clip(pp / 100, 1e-6, 1 - 1e-6)
        r = {"n": int(len(dd)), "days": int(dd.day.nunique()), "base_pct": float(100 * y.mean()), "hit_days": int(y.sum()), "explosions_total": int(dd[dd.y == 1].eid.nunique()),
             "auc": float(roc_auc_score(y, oo)), "ap": float(average_precision_score(y, oo)),
             "brier": float(np.mean((pc - y) ** 2)), "logloss": float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc))),
             "calib": evalu.calib_table(pp, y), "top": evalu.top_k(d, nm), "lead": evalu.lead_time(d, expl, nm)}
        r["alerts"], al = evalu.simulate_alerts(d, nm)
        r["alert_rows"] = [(d2s(a), int(t), round(float(q), 1), None if not np.isfinite(yy) else int(yy)) for a, t, q, yy in zip(al.day, al.tid, al.p, al.y)] if len(al) else []
        out[nm] = r
    print(evalu.fmt({k: v for k, v in out.items()}, label), flush=True)
    return out


res = {}
res["ontwikkeljaren 2020–2024"] = block(df[(df.yr >= 2020) & (df.yr <= 2024)], "ontwikkeljaren 2020–2024")
res["eindtest 2025–2026"] = block(df[df.yr >= 2025], "EINDTEST 2025–2026 (achtergehouden)")
res["eindtest 2025"] = block(df[df.yr == 2025], "eindtest 2025")
res["eindtest 2026"] = block(df[df.yr == 2026], "eindtest 2026")

# onzekerheid: weken opnieuw trekken (blok-bootstrap) voor de eindtest
h = df[(df.yr >= 2025) & np.isfinite(df.y)].copy()
h["wk"] = h.day // 7
rng = np.random.default_rng(3)
stat = {}
for nm in ("oudA", "oudB", "new"):
    t5 = h[h[f"rk_{nm}"] <= 5].groupby("wk").y.agg(["sum", "size"])
    stat[nm] = t5.reindex(sorted(h.wk.unique()), fill_value=0)
wks = np.array(sorted(h.wk.unique()))
boot = {"new-oudA": [], "new-oudB": []}
for _ in range(2000):
    pick = rng.integers(0, len(wks), len(wks))
    rate = {nm: stat[nm]["sum"].to_numpy()[pick].sum() / max(1, stat[nm]["size"].to_numpy()[pick].sum()) for nm in stat}
    boot["new-oudA"].append(rate["new"] - rate["oudA"]); boot["new-oudB"].append(rate["new"] - rate["oudB"])
res["bootstrap_top5"] = {k: {"mean_pp": float(100 * np.mean(v)), "p2.5": float(100 * np.percentile(v, 2.5)), "p97.5": float(100 * np.percentile(v, 97.5)), "share_positive": float(np.mean(np.array(v) > 0))} for k, v in boot.items()}
print("bootstrap top-5 (eindtest), verschil in procentpunten:", json.dumps(res["bootstrap_top5"]))
res["curves"] = {str(k): v for k, v in curves.items()}
res["mult_last"] = float(df.mult.iloc[-1])
res["mult_by_year"] = {str(y): float(df[df.yr == y].mult.mean()) for y in YEARS}
json.dump(res, open(OUTJ, "w"))
print("klaar")
