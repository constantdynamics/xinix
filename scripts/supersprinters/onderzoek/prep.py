"""Stap 1: alle reeksen opschonen en per portie wegschrijven (pickle voor Python, binair pakket voor de Node-proef)."""
import os, sys, pickle, struct, json, time
import numpy as np, pandas as pd
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(__file__))
from clean import load_raw, clean

BARS, OUT = sys.argv[1], sys.argv[2]
CHUNK = 500
os.makedirs(OUT, exist_ok=True)
uni = pd.read_parquet(os.path.join(os.path.dirname(BARS.rstrip("/")), "universe.parquet"))
REGIME = ["IWM", "SPY", "QQQ", "XBI", "GDXJ", "ARKK", "BTC-USD"]


def one(t):
    p = os.path.join(BARS, t + ".npz")
    if not os.path.exists(p):
        return t, None
    try:
        raw, meta = load_raw(p)
        c = clean(raw, meta, t)
    except Exception as e:
        return t, {"error": repr(e)}
    if c is None:
        return t, None
    c["splits"] = raw["splits"]
    c["yahoo_exchange"] = meta.get("exchangeName")
    c["instrument"] = meta.get("instrumentType")
    for k in ("open", "high", "low"):
        c[k] = c[k].astype(np.float32) / c["adj"].astype(np.float32)   # verhouding t.o.v. het slot
    return t, c


def write_pack(path, items, mcap):
    with open(path, "wb") as f:
        f.write(struct.pack("<i", len(items)))
        for t, c in items:
            n = c["n"]
            cur = (c["currency"] or "").encode()
            f.write(struct.pack("<i", n)); f.write(struct.pack("<d", mcap.get(t, float("nan"))))
            f.write(struct.pack("<i", len(cur))); f.write(cur)
            f.write(c["day"].astype("<i4").tobytes())
            for k in ("adj", "close"):
                f.write(c[k].astype("<f8").tobytes())
            f.write((c["high"].astype(np.float64) * c["adj"]).astype("<f8").tobytes())
            f.write((c["low"].astype(np.float64) * c["adj"]).astype("<f8").tobytes())
            f.write(c["vol"].astype("<f8").tobytes())
            sp = c["splits"]
            f.write(struct.pack("<i", len(sp)))
            for s in sp:
                ratio = s[1] / s[2] if s[2] > 0 else 1.0
                f.write(struct.pack("<dd", float(s[0]) * 1000.0, ratio))


if __name__ == "__main__":
    tickers = uni["ticker"].tolist()
    mcap = dict(zip(uni["ticker"], uni["market_cap_basic"]))     # zoals de motor het opslaat (lokale munt, zie rapport)
    t0 = time.time()
    index = []
    with Pool(4) as pool:
        for ci in range(0, len(tickers), CHUNK):
            part = tickers[ci:ci + CHUNK]
            res = pool.map(one, part, chunksize=25)
            items = [(t, c) for t, c in res if c is not None and "error" not in c and c["n"] >= 40]
            errs = [(t, c["error"]) for t, c in res if c is not None and "error" in c]
            if errs:
                print("fouten", errs[:3], flush=True)
            k = ci // CHUNK
            pickle.dump(items, open(os.path.join(OUT, f"clean_{k:03d}.pkl"), "wb"), protocol=4)
            write_pack(os.path.join(OUT, f"pack_{k:03d}.bin"), items, mcap)
            for t, c in items:
                index.append({"ticker": t, "chunk": k, "n": c["n"], "currency": c["currency"], "unit_fix": c["flags"]["unit_fix"],
                              "split_fix": c["flags"]["split_fix"], "blips": c["flags"]["blips"], "first_day": int(c["day"][0]), "last_day": int(c["day"][-1]),
                              "yahoo_exchange": c["yahoo_exchange"], "instrument": c["instrument"]})
            print(k, len(items), f"{time.time() - t0:.0f}s", flush=True)
        reg = [one(t) for t in REGIME]
        reg = [(t, c) for t, c in reg if c is not None]
        pickle.dump(reg, open(os.path.join(OUT, "regime.pkl"), "wb"), protocol=4)
        write_pack(os.path.join(OUT, "pack_regime.bin"), reg[:1], {})
    pd.DataFrame(index).to_parquet(os.path.join(OUT, "index.parquet"))
    print("klaar", len(index), "aandelen", f"{time.time() - t0:.0f}s")
