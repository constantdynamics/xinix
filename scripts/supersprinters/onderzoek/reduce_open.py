"""Maakt per testjaar een kleine tabel met alleen de rijen die ertoe doen: per dag de 40 hoogste van elke rangschikking
en alles vanaf 8% kans, plus een steekproef om de ijklijnen op te passen. Zuinig met geheugen: één jaar tegelijk.

  python3 reduce_open.py <rijen.parquet> <uit-map>
"""
import os, sys
import numpy as np, pandas as pd, pyarrow.dataset as pads
sys.path.insert(0, os.path.dirname(__file__))
from lib import ROOT, ALL

ROWS, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
RUNS = {"s_close": "lite_v3", "s_yo": "open_yo", "s_gap": "open_yo_gap", "s_loss": "open_loss", "s_win": "open_win", "s_ret": "open_ret"}
LABS = ["yo", "to", "r10o", "r5o", "tp50o", "mx10o", "mn10o", "mnl10o", "gap1", "lo1r", "hi1r"]
mm = lambda n: np.load(os.path.join(ALL, n), mmap_mode="r")
day_a, tid_a, y_a, dv_a, px_a, eid_a = mm("day.npy"), mm("tid.npy"), mm("y.npy"), mm("dv.npy"), mm("px.npy"), mm("eid.npy")
labs = {n: mm(f"lab_{n}.npy") for n in LABS}
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "region"])
reg = np.zeros(int(meta.tid.max()) + 1, np.int8); reg[meta.tid.to_numpy()] = meta.region.to_numpy()
rng = np.random.default_rng(3)
TOPN = 40
for Y in range(2019, 2027):
    base = os.path.join(ROOT, "runs", "lite_v3", f"pred_{Y}.npz")
    if not os.path.exists(base): continue
    z = np.load(base); idx = z["idx"]
    cols = {"idx": idx, "day": np.asarray(day_a[idx]), "tid": np.asarray(tid_a[idx]), "y": np.asarray(y_a[idx]), "dv": np.asarray(dv_a[idx]),
            "px": np.asarray(px_a[idx]), "eid": np.asarray(eid_a[idx])}
    cols["region"] = reg[cols["tid"]]
    for n in LABS: cols[n] = np.asarray(labs[n][idx])
    have = []
    for c, r in RUNS.items():
        p = os.path.join(ROOT, "runs", r, f"pred_{Y}.npz")
        if not os.path.exists(p): continue
        zz = np.load(p)
        assert np.array_equal(zz["idx"], idx), (c, Y)
        cols[c] = zz["raw2"].astype(np.float32); have.append(c)
    pq = pads.dataset(ROWS).to_table(columns=["idx", "p_new", "mult", "p0"], filter=(pads.field("yr") == Y)).to_pandas()
    assert np.array_equal(pq.idx.to_numpy(), idx), Y
    cols["p_new"] = pq.p_new.to_numpy(np.float32); cols["mult"] = pq["mult"].to_numpy(np.float32); cols["p0"] = pq.p0.to_numpy(np.float32)
    del pq
    n = len(idx)
    keep = cols["p_new"] >= 8
    order_day = np.argsort(cols["day"], kind="stable")
    for c in have + ["p_new"]:
        # rang per dag (1 = hoogste)
        o = np.lexsort((-cols[c], cols["day"]))
        d = cols["day"][o]
        start = np.r_[0, np.flatnonzero(np.diff(d)) + 1]
        rk = np.arange(n) - np.repeat(start, np.diff(np.r_[start, n]))
        rank = np.empty(n, np.int32); rank[o] = rk + 1
        cols["rk_" + c] = rank
        keep |= rank <= TOPN
        # hetzelfde met een omzeteis van $100.000 (rang binnen de aandelen die daaraan voldoen)
        liq = cols["dv"] >= 100_000
        s2 = np.where(liq, cols[c], -np.inf)
        o = np.lexsort((-s2, cols["day"])); d = cols["day"][o]
        start = np.r_[0, np.flatnonzero(np.diff(d)) + 1]
        rk = np.arange(n) - np.repeat(start, np.diff(np.r_[start, n]))
        rank = np.empty(n, np.int32); rank[o] = rk + 1
        rank[~liq] = 10**6
        cols["rkl_" + c] = rank
        keep |= rank <= TOPN
    samp = rng.random(n) < 0.03
    df = pd.DataFrame({k: v[keep] for k, v in cols.items()}); df["yr"] = Y
    df.to_parquet(os.path.join(OUT, f"top_{Y}.parquet"))
    cal = pd.DataFrame({k: v[samp | keep] for k, v in cols.items() if k in ("y", "yo", "r10o", "region", "dv", "day") or k.startswith("s_")})
    cal["w"] = np.where(keep[samp | keep], 1.0, 1 / 0.03).astype(np.float32); cal["yr"] = Y
    cal.to_parquet(os.path.join(OUT, f"cal_{Y}.parquet"))
    print(Y, "rijen", n, "bewaard", int(keep.sum()), "ijksteekproef", len(cal), "scores", have, flush=True)
