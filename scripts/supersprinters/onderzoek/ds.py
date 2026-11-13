"""Dataset voor het onderzoek: kolommen, marktklimaat (breedte), oude model."""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from lib import *
import feat

EXCLUDE_EXCH = {"CSE", "NEO"}          # niet in Saxo's overzicht
EMBARGO = 16                           # kalenderdagen: 10 handelsdagen + controle-dag


class DS:
    def __init__(self):
        c = load_cols()
        self.tid = np.asarray(c["tid"]); self.day = np.asarray(c["day"]); self.tix = np.asarray(c["tix"])
        self.y = np.asarray(c["y"]); self.px = np.asarray(c["px"]); self.dv = np.asarray(c["dv"]); self.eid = np.asarray(c["eid"])
        self.X = load_X()
        self.N = len(self.tid)
        self.meta = load_meta()
        self.region = self.meta["region"].to_numpy()[self.tid].astype(np.int8)
        exch = self.meta["exchange"].fillna("?").to_numpy()
        self.exch_names = sorted(set(exch))
        self.exch = np.array([self.exch_names.index(e) for e in exch], np.int16)[self.tid]
        sec = self.meta["sector"].fillna("?").to_numpy()
        self.sector_names = sorted(set(sec))
        self.sector = np.array([self.sector_names.index(e) for e in sec], np.int16)[self.tid]
        self.evalid = np.load(os.path.join(ALL, "evalid.npy"))
        excl = np.array([e in EXCLUDE_EXCH for e in self.exch_names])[self.exch]
        self.ok = self.evalid & ~excl                      # doet mee (uitkomst hoeft nog niet bekend te zijn)
        self.res = self.ok & np.isfinite(self.y)           # en de uitkomst is bekend
        self.year = year_of(self.day)
        self._breadth = None

    def col(self, name):
        return np.asarray(self.X[:, feat.FIDX[name]])

    # ── marktklimaat: aandeel van de aandelen in een regio dat vandaag/deze maand hard gaat ──
    def breadth(self):
        if self._breadth is not None:
            return self._breadth
        r1, pm, vw = self.col("r1"), self.col("t_p1m"), self.col("t_vw")
        df = pd.DataFrame({"day": self.day[self.ok], "reg": self.region[self.ok],
                           "a": (r1[self.ok] >= 0.20), "b": (r1[self.ok] >= 0.10), "c": (pm[self.ok] >= 0.50),
                           "d": (pm[self.ok] >= 1.0), "e": (vw[self.ok] >= 0.15)})
        g = df.groupby(["reg", "day"]).agg(n=("a", "size"), b1_20=("a", "mean"), b1_10=("b", "mean"), bm_50=("c", "mean"), bm_100=("d", "mean"), bvw_15=("e", "mean")).reset_index()
        out = {}
        names = ["b1_20", "b1_10", "bm_50", "bm_100", "bvw_15", "b1_20_m5", "b1_10_m5", "b1_20_m22"]
        for reg in range(4):
            t = g[(g.reg == reg) & (g.n >= 200)].sort_values("day").reset_index(drop=True)
            t["b1_20_m5"] = t.b1_20.rolling(5, min_periods=1).mean()
            t["b1_10_m5"] = t.b1_10.rolling(5, min_periods=1).mean()
            t["b1_20_m22"] = t.b1_20.rolling(22, min_periods=5).mean()
            out[reg] = (t["day"].to_numpy(), t[names].to_numpy(np.float32))
        B = np.full((self.N, 2 * len(names)), np.nan, np.float32)
        for reg in range(4):
            m = np.where(self.region == reg)[0]
            d = self.day[m]
            days, vals = out[reg]
            i = np.searchsorted(days, d, side="right") - 1          # eigen regio: zelfde dag
            good = i >= 0
            B[m[good], :len(names)] = vals[i[good]]
            # VS-klimaat: voor VS/Canada dezelfde dag, voor Europa/Azië de laatste VS-sessie ervóór
            udays, uvals = out[0]
            j = np.searchsorted(udays, d, side="right" if reg <= 1 else "left") - 1
            good = j >= 0
            B[m[good], len(names):] = uvals[j[good]]
        self._breadth = (B, names + ["us_" + x for x in names])
        self._breadth_tables = out
        return self._breadth


# ── het oude h14-model (zelfde wiskunde als engine.ts) ──
K_BUCKET, K_OWN, K_CALIB = 300, 750, 100
LIFT_MIN, LIFT_MAX, PROB_CAP, DAMP = 0.2, 5.0, 90.0, 0.35
SEL_LIFT, SEL_MIN_N, SEL_MIN_H = 1.5, 3000, 20
CALIB_EDGES = np.array([1, 2, 3, 5, 8, 12, 20, 30, 50], float)
NF_OLD, SLOTS = 19, 10


def old_from_counts(bn, bh):
    """bn, bh: (19, 10) dagen en treffers per kenmerk × bucket."""
    n = bn[0].sum(); hits = bh[0].sum(); p0 = hits / n
    rate = (bh + K_BUCKET * p0) / (bn + K_BUCKET)
    lift = np.clip(rate / p0, LIFT_MIN, LIFT_MAX)
    sel = np.zeros(NF_OLD, bool)
    for f in range(NF_OLD):
        mx, mn = 0.0, np.inf
        for s in range(SLOTS):
            if bn[f, s] >= SEL_MIN_N and bh[f, s] >= SEL_MIN_H:
                r = bh[f, s] / bn[f, s] / p0; mx = max(mx, r); mn = min(mn, r)
            elif bn[f, s] >= SEL_MIN_N * 3 and bh[f, s] < SEL_MIN_H:
                r = (bh[f, s] + 1) / bn[f, s] / p0; mn = min(mn, r)
        sel[f] = mx >= SEL_LIFT or (np.isfinite(mn) and 0 < mn <= 1 / SEL_LIFT)
    loglift = np.where(sel[:, None], np.log(lift), 0.0)
    return {"p0": p0, "loglift": loglift, "sel": sel, "calib": None}


def old_prod():
    j = json.load(open(os.path.join(ROOT, "event_scores.json")))["models"]["h14"]
    bn = np.zeros((NF_OLD, SLOTS)); bh = np.zeros((NF_OLD, SLOTS))
    for f, fd in enumerate(j["features"]):
        for b in fd["buckets"]:
            bn[f, b["slot"]] = b["n"]; bh[f, b["slot"]] = b["hits"]
    m = old_from_counts(bn, bh)
    assert all(bool(fd["used"]) == bool(m["sel"][f]) for f, fd in enumerate(j["features"])), "kenmerkselectie wijkt af"
    m["calib"] = np.array([[c["n"], c["hits"]] for c in j["calib"]], float)
    return m


def old_raw(m, slots, own_h, own_n):
    own = np.clip(((own_h + K_OWN * m["p0"]) / (own_n + K_OWN)) / m["p0"], LIFT_MIN, LIFT_MAX)
    acc = np.log(own)
    for f in range(NF_OLD):
        acc = acc + m["loglift"][f][slots[:, f]]
    odds = np.exp(np.log(m["p0"] / (1 - m["p0"])) + DAMP * acc)
    return np.minimum(PROB_CAP, odds / (1 + odds) * 100)


def old_fit_calib(m, raw, y):
    b = np.searchsorted(CALIB_EDGES, raw, side="right")
    m["calib"] = np.array([[np.sum(b == k), np.sum(y[b == k])] for k in range(len(CALIB_EDGES) + 1)], float)
    return m


def old_cal(m, raw):
    b = np.searchsorted(CALIB_EDGES, raw, side="right")
    cn, ch = m["calib"][b, 0], m["calib"][b, 1]
    return np.where(cn > 0, np.minimum(PROB_CAP, (100 * ch + K_CALIB * raw) / (cn + K_CALIB)), raw)


def old_fit(slots, y):
    bn = np.zeros((NF_OLD, SLOTS)); bh = np.zeros((NF_OLD, SLOTS))
    yy = y.astype(np.float64)
    for f in range(NF_OLD):
        bn[f] = np.bincount(slots[:, f], minlength=SLOTS)[:SLOTS]
        bh[f] = np.bincount(slots[:, f], weights=yy, minlength=SLOTS)[:SLOTS]
    return old_from_counts(bn, bh)
