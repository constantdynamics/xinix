"""Beoordeling van modellen op dezelfde aandelen en dagen: vier maatstaven uit de opdracht.

  1. gesimuleerde meldingen met de echte regels (≥ 15%, hoogstens 3 per week, herhaalregel)
  2. hoeveel handelsdagen vóór de eerste grote sprongdag het aandeel al bovenaan stond
  3. trefkans van de top 5 en top 10 per dag
  4. kalibratie (voorspeld tegen werkelijk), Brier en log loss
"""
import os, sys, json
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score
sys.path.insert(0, os.path.dirname(__file__))
from ds import *

BANDS = [0, 0.5, 1, 2, 5, 10, 15, 25, 100]
ALERT_MIN, ALERT_WEEK, REALERT_DAYS, REALERT_GAIN = 15.0, 3, 10, 5.0


def frame(D, idx, scores):
    """scores: dict naam -> (kans in %, volgorde-score). Geeft DataFrame per rij met rang per dag."""
    df = pd.DataFrame({"idx": idx, "day": D.day[idx], "tid": D.tid[idx], "tix": D.tix[idx], "y": D.y[idx], "eid": D.eid[idx]})
    for name, (p, order) in scores.items():
        df[f"p_{name}"] = np.asarray(p, np.float64)
        df[f"o_{name}"] = np.asarray(order, np.float64)
        df[f"rk_{name}"] = df.groupby("day")[f"o_{name}"].rank(ascending=False, method="first")
    return df


def calib_table(p, y):
    rows = []
    for lo, hi in zip(BANDS[:-1], BANDS[1:]):
        m = (p >= lo) & (p < hi)
        rows.append({"band": f"{lo:g}–{hi:g}%", "n": int(m.sum()), "pred": float(p[m].mean()) if m.any() else None,
                     "real": float(100 * y[m].mean()) if m.any() else None, "hits": int(y[m].sum())})
    return rows


def simulate_alerts(df, name, min_prob=ALERT_MIN, per_week=ALERT_WEEK):
    """Echte regels: vanaf min_prob, hoogste eerst, hoogstens per_week per 7 dagen, per aandeel 1× per 10 dagen tenzij +5 punten."""
    c = df[df[f"p_{name}"] >= min_prob].sort_values(["day", f"o_{name}"], ascending=[True, False])
    sent_days = []; last = {}; out = []
    for day, tid, p, y, eid, idx in zip(c["day"].to_numpy(), c["tid"].to_numpy(), c[f"p_{name}"].to_numpy(), c["y"].to_numpy(), c["eid"].to_numpy(), c["idx"].to_numpy()):
        while sent_days and sent_days[0] <= day - 7:
            sent_days.pop(0)
        if len(sent_days) >= per_week:
            continue
        lp = last.get(tid)
        if lp is not None and day - lp[0] < REALERT_DAYS and not (p >= lp[1] + REALERT_GAIN):
            continue
        sent_days.append(day); last[tid] = (day, p)
        out.append((day, tid, p, y, eid, idx))
    a = pd.DataFrame(out, columns=["day", "tid", "p", "y", "eid", "idx"])
    res = a[np.isfinite(a.y)] if len(a) else a
    weeks = max(1e-9, (df["day"].max() - df["day"].min() + 1) / 7)
    return {"alerts": int(len(a)), "resolved": int(len(res)), "hits": int(res.y.sum()) if len(res) else 0,
            "hit_pct": float(100 * res.y.mean()) if len(res) else None, "avg_prob": float(res.p.mean()) if len(res) else None,
            "per_week": float(len(a) / weeks), "stocks": int(a.tid.nunique()) if len(a) else 0,
            "candidates": int(len(c)), "explosions": int(res[res.y == 1].eid.nunique()) if len(res) else 0}, a


def top_k(df, name, ks=(5, 10)):
    d = df[np.isfinite(df.y)]
    out = {}
    for k in ks:
        t = d[d[f"rk_{name}"] <= k]
        out[f"top{k}"] = {"n": int(len(t)), "hit_pct": float(100 * t.y.mean()), "explosions": int(t[t.y == 1].eid.nunique()),
                          "stocks": int(t.tid.nunique()), "avg_prob": float(t[f"p_{name}"].mean())}
    return out


def lead_time(df, expl, name, ns=(10, 20, 50), back=10):
    """Per explosie: stond het aandeel vóór de eerste grote sprongdag al in de top-N van de dag?"""
    key = df["tid"].to_numpy().astype(np.int64) * 100000 + df["tix"].to_numpy()
    rk = pd.Series(df[f"rk_{name}"].to_numpy(), index=key)
    rk = rk[~rk.index.duplicated()]
    d0, d1 = df["day"].min(), df["day"].max()
    ex = expl[(expl.day_J >= d0) & (expl.day_J <= d1) & (expl.n_pos_elig > 0)]
    kk = (ex["tid"].to_numpy().astype(np.int64)[:, None] * 100000 + (ex["J"].to_numpy()[:, None] - np.arange(1, back + 1)[None, :]))
    R = rk.reindex(kk.ravel()).to_numpy().reshape(kk.shape)            # rang op J-1 … J-back (NaN = deed niet mee)
    have = np.isfinite(R[:, 0])
    R = R[have]
    out = {"explosions": int(have.sum())}
    for n in ns:
        inn = R <= n
        run = np.zeros(len(R), int)
        alive = np.ones(len(R), bool)
        for k in range(back):
            alive &= inn[:, k]
            run += alive
        out[f"top{n}"] = {"day_before_pct": float(100 * inn[:, 0].mean()), "any5_pct": float(100 * inn[:, :5].any(axis=1).mean()),
                          "mean_days_in_top": float(inn.sum(axis=1).mean()), "mean_run": float(run.mean()), "run3_pct": float(100 * (run >= 3).mean()),
                          "n_day_before": int(inn[:, 0].sum())}
    out["median_rank_day_before"] = float(np.median(R[:, 0]))
    out["median_rank_3_before"] = float(np.nanmedian(R[:, 2]))
    out["median_rank_5_before"] = float(np.nanmedian(R[:, 4]))
    return out


def evaluate(D, idx, scores, expl):
    df = frame(D, idx, scores)
    res = {}
    d = df[np.isfinite(df.y)]
    y = d.y.to_numpy()
    for name in scores:
        p = d[f"p_{name}"].to_numpy(); o = d[f"o_{name}"].to_numpy()
        pc = np.clip(p / 100, 1e-6, 1 - 1e-6)
        r = {"n": int(len(d)), "base_pct": float(100 * y.mean()), "auc": float(roc_auc_score(y, o)), "ap": float(average_precision_score(y, o)),
             "brier": float(np.mean((pc - y) ** 2)), "logloss": float(-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc))),
             "calib": calib_table(p, y), "top": top_k(df, name), "lead": lead_time(df, expl, name)}
        r["alerts"], _ = simulate_alerts(df, name)
        r["alerts10"], _ = simulate_alerts(df, name, min_prob=10.0)
        res[name] = r
    return res, df


def fmt(res, title=""):
    L = [f"=== {title} ==="]
    for name, r in res.items():
        a = r["alerts"]; t5, t10 = r["top"]["top5"], r["top"]["top10"]; ld = r["lead"]
        L.append(f"[{name}] n={r['n']} basis {r['base_pct']:.3f}%  AUC {r['auc']:.4f}  AP {r['ap']:.4f}  Brier {r['brier'] * 1e4:.3f}e-4  logloss {r['logloss']:.5f}")
        L.append(f"   meldingen ≥15%: {a['alerts']} ({a['per_week']:.2f}/week), raak {a['hits']}/{a['resolved']}" + (f" = {a['hit_pct']:.1f}% (voorspeld {a['avg_prob']:.1f}%)" if a['resolved'] else "") + f", {a['stocks']} aandelen, {a['explosions']} explosies; kandidaten {a['candidates']}")
        L.append(f"   top5: {t5['hit_pct']:.2f}% ({t5['explosions']} explosies)  top10: {t10['hit_pct']:.2f}% ({t10['explosions']} explosies)")
        L.append(f"   vóór de sprong ({ld['explosions']} explosies): top10 dag ervoor {ld['top10']['day_before_pct']:.1f}%, top20 {ld['top20']['day_before_pct']:.1f}%, top50 {ld['top50']['day_before_pct']:.1f}%; top50 ergens in 5 dagen ervoor {ld['top50']['any5_pct']:.1f}%; mediane rang dag ervoor {ld['median_rank_day_before']:.0f}, 3 dagen {ld['median_rank_3_before']:.0f}, 5 dagen {ld['median_rank_5_before']:.0f}")
        L.append("   kalibratie: " + "  ".join(f"{c['band']}: {c['pred']:.2f}→{c['real']:.2f} (n={c['n']})" for c in r["calib"] if c["n"] > 0))
    return "\n".join(L)
