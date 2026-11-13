"""Stap 2: kenmerken + uitkomsten voor alle aandelen. Per portie een npz met alleen de dagen die meedoen
(koers ≥ $0,50, omzet ≥ $10.000 per dag, ≥ 30 dagen historie)."""
import os, sys, pickle, time
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
from clean import Fx
import feat

PREP, BARS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
EUROPE = {"uk", "germany", "france", "netherlands", "belgium", "italy", "spain", "portugal", "poland", "switzerland", "sweden", "norway", "denmark", "finland"}
APAC = {"japan", "hongkong", "singapore", "australia"}
GAP_BARS = 3          # trefdagen met hoogstens zoveel bars ertussen horen bij dezelfde explosie

uni = pd.read_parquet(os.path.join(os.path.dirname(PREP.rstrip("/")), "universe.parquet"))
index = pd.read_parquet(os.path.join(PREP, "index.parquet"))
tick_id = {t: i for i, t in enumerate(index["ticker"])}
fx = None


def region_of(market):
    return 0 if market == "america" else 1 if market == "canada" else 2 if market in EUROPE else 3


def do_chunk(k):
    global fx
    if fx is None:
        fx = Fx(BARS)
    items = pickle.load(open(os.path.join(PREP, f"clean_{k:03d}.pkl"), "rb"))
    Xs, tid, day, tix, ys, bad, px, dv, expl_id, r1s = [], [], [], [], [], [], [], [], [], []
    expl = []                                # (ticker_id, t0_bar, J_bar, t1_bar, n_pos, n_pos_elig, day_t0, day_J)
    for t, c in items:
        usd = fx.usd(c["currency"], c["day"])
        X, e = feat.features(c, usd)
        n = c["n"]
        y = e["y"].copy()
        y[e["bad"]] = np.nan                 # trefdag zonder handel: uitkomst telt niet
        ti = tick_id[t]
        # explosies: aaneengesloten trefdagen (alle dagen, ook buiten het filter)
        eid = np.full(n, -1, np.int64)
        pos = np.where(y == 1)[0]
        if len(pos):
            groups = np.split(pos, np.where(np.diff(pos) > GAP_BARS + 1)[0] + 1)
            for g in groups:
                t0, t1 = int(g[0]), int(g[-1])
                jh = int(e["jhit"][t0])
                J = jh
                for j in range(t0 + 1, jh + 1):
                    if e["r1"][j] >= 0.20:
                        J = j; break
                gid = (ti << 16) | (len(expl) & 0xFFFF)
                gid = ti * 100000 + t0
                eid[g] = gid
                expl.append((ti, t0, J, t1, len(g), int(e["elig"][g].sum()), int(c["day"][t0]), int(c["day"][J]), gid))
        m = e["elig"]
        if not m.any():
            continue
        idx = np.where(m)[0]
        Xs.append(X[idx]); tid.append(np.full(len(idx), ti, np.int32)); day.append(c["day"][idx]); tix.append(idx.astype(np.int32))
        ys.append(y[idx].astype(np.float32)); px.append(e["px_usd"][idx].astype(np.float32)); dv.append(e["dv30"][idx].astype(np.float32))
        expl_id.append(eid[idx]); r1s.append(e["r1"][idx].astype(np.float32))
    if not Xs:
        return k, 0, 0
    np.savez(os.path.join(OUT, f"feat_{k:03d}.npz"), X=np.concatenate(Xs), tid=np.concatenate(tid), day=np.concatenate(day), tix=np.concatenate(tix),
             y=np.concatenate(ys), px=np.concatenate(px), dv=np.concatenate(dv), eid=np.concatenate(expl_id))
    pd.DataFrame(expl, columns=["tid", "t0", "J", "t1", "n_pos", "n_pos_elig", "day_t0", "day_J", "eid"]).to_parquet(os.path.join(OUT, f"expl_{k:03d}.parquet"))
    return k, sum(len(x) for x in Xs), len(expl)


if __name__ == "__main__":
    t0 = time.time()
    chunks = sorted(int(f[6:9]) for f in os.listdir(PREP) if f.startswith("clean_"))
    only = [int(x) for x in sys.argv[4].split(",")] if len(sys.argv) > 4 else chunks
    with Pool(4) as pool:
        tot = 0
        for k, rows, ne in pool.imap_unordered(do_chunk, only):
            tot += rows
            print(k, rows, ne, f"{time.time() - t0:.0f}s", flush=True)
    meta = index.merge(uni[["ticker", "market", "exchange", "sector", "industry", "name", "description", "market_cap_basic", "fundamental_currency_code", "float_shares_outstanding"]], on="ticker", how="left")
    meta["region"] = meta["market"].map(region_of)
    meta["tid"] = np.arange(len(meta))
    meta.to_parquet(os.path.join(OUT, "meta.parquet"))
    print("klaar", tot, "rijen", f"{time.time() - t0:.0f}s")
