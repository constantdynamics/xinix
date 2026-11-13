"""IJking en meldregels op opgeslagen voorspellingen, steeds alleen met kennis van vóór de dag zelf.

  python3 policy.py <run> <jaren> [uit.json]

1. IJklijn: stuksgewijs lineair in de logit (knikken bij 1%, 5% en 15%), geleerd op de voorspellingen van
   eerdere testjaren (elk gemaakt door een model dat dat jaar niet zag).
2. Bijsturing: elke dag wordt het niveau bijgesteld met de eigen uitkomsten van de afgelopen maanden
   (alleen wat op die dag al afgerekend kon zijn), begrensd op ×0,5 … ×2.
3. Meldregels: vanaf 15%, hoogstens 3 per week, herhaalregel; met en zonder een lat die na elke melding
   omhoog gaat en daarna terugzakt.
"""
import os, sys, json
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
sys.path.insert(0, os.path.dirname(__file__))
from lib import *

KNOTS = [0.01, 0.05, 0.15]
TOPK = 300
lg = lambda p: np.log(np.clip(p, 1e-7, 1 - 1e-7) / (1 - np.clip(p, 1e-7, 1 - 1e-7)))
BANDS = [0, 0.5, 1, 2, 5, 10, 15, 20, 30, 100]


def basis(raw, knots=KNOTS):
    z = lg(raw)
    return np.column_stack([z] + [np.maximum(z - lg(np.array([k]))[0], 0) for k in knots])


def fit_curve(raw, y, w=None, knots=KNOTS):
    """Geeft (intercept, hellingen) van een stijgende stuksgewijs-lineaire logit-lijn."""
    kn = list(knots)
    while True:
        lr = LogisticRegression(C=1e6, max_iter=500).fit(basis(raw, kn), y, sample_weight=w)
        slopes = np.cumsum(lr.coef_[0])
        if (slopes > 0.05).all() or not kn:
            return {"b": float(lr.intercept_[0]), "coef": [float(c) for c in lr.coef_[0]], "knots": kn}
        kn = kn[:-1]                       # laatste knik weglaten als de lijn daar zou dalen


def apply_curve(cv, raw):
    z = basis(raw, cv["knots"]) @ np.array(cv["coef"]) + cv["b"]
    return 1 / (1 + np.exp(-z))


def load(run, years):
    y_all = np.load(os.path.join(ALL, "y.npy"), mmap_mode="r"); day_all = np.load(os.path.join(ALL, "day.npy"), mmap_mode="r")
    tid_all = np.load(os.path.join(ALL, "tid.npy"), mmap_mode="r"); eid_all = np.load(os.path.join(ALL, "eid.npy"), mmap_mode="r")
    fr = []
    for Y in years:
        z = np.load(os.path.join(ROOT, "runs", run, f"pred_{Y}.npz"))
        idx = z["idx"]
        fr.append(pd.DataFrame({"yr": Y, "idx": idx, "day": np.asarray(day_all[idx]), "tid": np.asarray(tid_all[idx]), "y": np.asarray(y_all[idx]),
                                "eid": np.asarray(eid_all[idx]), "raw": z["raw2"].astype(np.float64), "p_val": z["p2"].astype(np.float64)}))
    return pd.concat(fr, ignore_index=True)


def calibrate(df, years, min_prev=1):
    """Per testjaar de ijklijn uit eerdere testjaren; het eerste jaar houdt de ijking van zijn ijkjaar."""
    df["p0"] = df["p_val"]
    curves = {}
    for i, Y in enumerate(years):
        if i < min_prev:
            continue
        prev = df[(df.yr < Y) & np.isfinite(df.y)]
        cv = fit_curve(prev.raw.to_numpy(), prev.y.to_numpy())
        curves[Y] = cv
        m = df.yr == Y
        df.loc[m, "p0"] = apply_curve(cv, df.loc[m, "raw"].to_numpy())
    return curves


def online(df, window=120, lag=16, k=15.0, lo=0.5, hi=2.0, topk=TOPK, power=1.0):
    """Niveau-bijsturing per dag uit de eigen, al afgerekende voorspellingen (top `topk` per dag)."""
    df["rk"] = df.groupby("day")["raw"].rank(ascending=False, method="first")
    t = df[(df.rk <= topk) & np.isfinite(df.y)]
    wgt = t.p0 ** (power - 1)
    agg = pd.DataFrame({"day": t.day, "sp": t.p0 * wgt, "sy": t.y * wgt}).groupby("day").sum().sort_index()
    days = np.sort(df.day.unique())
    ad = agg.index.to_numpy(); csp = np.concatenate([[0], np.cumsum(agg.sp.to_numpy())]); csy = np.concatenate([[0], np.cumsum(agg.sy.to_numpy())])
    mult = {}
    for d in days:
        a = np.searchsorted(ad, d - lag - window, side="right"); b = np.searchsorted(ad, d - lag, side="right")
        sp, sy = csp[b] - csp[a], csy[b] - csy[a]
        mult[d] = float(np.clip((sy + k) / (sp + k), lo, hi)) if sp > 0 else 1.0
    m = df.day.map(mult).to_numpy()
    o = df.p0 / (1 - df.p0) * m
    df["mult"] = m
    df["p"] = o / (1 + o)
    return mult


def table(p, y, label=""):
    ok = np.isfinite(y); p = p[ok]; y = y[ok]
    pc = np.clip(p, 1e-6, 1 - 1e-6)
    parts = [f"{label:26s} Brier {np.mean((pc - y) ** 2) * 1e4:.3f}e-4 logloss {-np.mean(y * np.log(pc) + (1 - y) * np.log(1 - pc)):.5f} |"]
    rows = []
    for a, b in zip(BANDS[:-1], BANDS[1:]):
        m = (p * 100 >= a) & (p * 100 < b)
        if m.sum():
            parts.append(f"{a:g}-{b:g}: {100 * p[m].mean():.1f}→{100 * y[m].mean():.1f} ({m.sum()})")
            rows.append({"band": f"{a:g}–{b:g}%", "n": int(m.sum()), "pred": float(100 * p[m].mean()), "real": float(100 * y[m].mean()), "hits": int(y[m].sum())})
    return "  ".join(parts), rows


def alerts(df, col="p", floor=15.0, per_week=3, step=0.0, decay=1.0, realert_days=10, realert_gain=5.0, cap_mult=None):
    """Meldingen in tijdsvolgorde. Lat = floor + opslag; opslag += step na elke melding en × decay per dag."""
    c = df[df[col] * 100 >= floor].sort_values(["day", col], ascending=[True, False])
    out = []; sent = []; last = {}; extra = 0.0; prev_day = None
    for day, tid, p, y, eid in zip(c.day.to_numpy(), c.tid.to_numpy(), (c[col] * 100).to_numpy(), c.y.to_numpy(), c.eid.to_numpy()):
        if prev_day is not None and day != prev_day:
            extra *= decay ** (day - prev_day)
        prev_day = day
        while sent and sent[0] <= day - 7:
            sent.pop(0)
        if len(sent) >= per_week or p < floor + extra:
            continue
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain):
            continue
        sent.append(day); last[tid] = (day, p); extra += step
        out.append((day, tid, p, y, eid))
    a = pd.DataFrame(out, columns=["day", "tid", "p", "y", "eid"])
    r = a[np.isfinite(a.y)]
    weeks = max(1e-9, (df.day.max() - df.day.min() + 1) / 7)
    return {"alerts": len(a), "resolved": len(r), "hits": int(r.y.sum()), "hit_pct": float(100 * r.y.mean()) if len(r) else None,
            "avg_prob": float(r.p.mean()) if len(r) else None, "per_week": len(a) / weeks, "stocks": int(a.tid.nunique()),
            "explosions": int(r[r.y == 1].eid.nunique()), "weeks_with": int((a.day // 7).nunique())}, a


def show_alerts(name, r):
    hp = f"{r['hit_pct']:.1f}%" if r["hit_pct"] is not None else "—"
    ap = f"{r['avg_prob']:.1f}%" if r["avg_prob"] is not None else "—"
    return f"{name:34s} {r['alerts']:4d} meldingen ({r['per_week']:.2f}/week)  raak {r['hits']}/{r['resolved']} = {hp}  voorspeld {ap}  aandelen {r['stocks']}  explosies {r['explosions']}"


if __name__ == "__main__":
    RUN = sys.argv[1]; YEARS = [int(x) for x in sys.argv[2].split(",")]
    df = load(RUN, YEARS)
    calibrate(df, YEARS)
    online(df)
    ev = df[df.yr > YEARS[0]]
    print(f"testjaren {YEARS[1]}–{YEARS[-1]}: {len(ev)} rijen")
    for col, lab in (("p_val", "ijking op het ijkjaar"), ("p0", "ijklijn eerdere testjaren"), ("p", "ijklijn + bijsturing")):
        print(table(ev[col].to_numpy(), ev.y.to_numpy(), lab)[0][:520])
    print("bijsturing: gemiddeld ×%.2f, bereik ×%.2f–×%.2f" % (ev.mult.mean(), ev.mult.min(), ev.mult.max()))
    for Y in YEARS[1:]:
        e = ev[ev.yr == Y]
        print(table(e.p.to_numpy(), e.y.to_numpy(), f"  {Y} (×{e.mult.mean():.2f})")[0][:520])
    print("meldingen (alle testjaren na het eerste):")
    for nm, kw in (("vaste lat 15%", {}), ("lat +3 na melding, ×0,85/dag", dict(step=3, decay=0.85)), ("lat +5 na melding, ×0,85/dag", dict(step=5, decay=0.85)),
                   ("lat +5 na melding, ×0,9/dag", dict(step=5, decay=0.9)), ("lat +8 na melding, ×0,9/dag", dict(step=8, decay=0.9)), ("vaste lat 20%", dict(floor=20.0)), ("vaste lat 25%", dict(floor=25.0))):
        print(show_alerts(nm, alerts(ev, **kw)[0]))
    for nm, colx in (("zonder bijsturing, vaste lat 15%", "p0"), ("ijking ijkjaar, vaste lat 15%", "p_val")):
        print(show_alerts(nm, alerts(ev, col=colx)[0]))
