"""Stap 3: alles in één geheugenkaart (X) + kolommen, en de buckets van het oude model erbij."""
import os, sys, pickle, struct
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import feat

PREP, FEAT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
NF_OLD = 19
chunks = sorted(int(f[5:8]) for f in os.listdir(FEAT) if f.startswith("feat_") and f.endswith(".npz"))
meta = pd.read_parquet(os.path.join(FEAT, "meta.parquet"))
tid_of = dict(zip(meta["ticker"], meta["tid"]))

# eerste ronde: aantallen
sizes = []
for k in chunks:
    with np.load(os.path.join(FEAT, f"feat_{k:03d}.npz")) as z:
        sizes.append(len(z["tid"]))
N = int(sum(sizes))
print("rijen", N, flush=True)
X = np.lib.format.open_memmap(os.path.join(OUT, "X.npy"), mode="w+", dtype=np.float32, shape=(N, feat.NFEAT))
cols = {"tid": np.zeros(N, np.int32), "day": np.zeros(N, np.int32), "tix": np.zeros(N, np.int32), "y": np.zeros(N, np.float32),
        "px": np.zeros(N, np.float32), "dv": np.zeros(N, np.float32), "eid": np.zeros(N, np.int64)}
slots = np.zeros((N, NF_OLD), np.uint8)
evalid = np.zeros(N, bool)
ehit = np.zeros(N, np.uint8)
off = 0
mism = 0; cmp_n = 0
for k, sz in zip(chunks, sizes):
    with np.load(os.path.join(FEAT, f"feat_{k:03d}.npz")) as z:
        X[off:off + sz] = z["X"]
        for c in cols:
            cols[c][off:off + sz] = z[c]
        tid, tix = z["tid"], z["tix"]
    # motor-uitvoer van deze portie: zelfde volgorde als het pickle-bestand
    items = pickle.load(open(os.path.join(PREP, f"clean_{k:03d}.pkl"), "rb"))
    buf = open(os.path.join(PREP, f"eng_{k:03d}.bin"), "rb").read()
    cnt = struct.unpack_from("<i", buf, 0)[0]
    assert cnt == len(items), (cnt, len(items))
    p = 4
    eng = {}
    for t, c in items:
        n, ok = struct.unpack_from("<ii", buf, p); p += 8
        assert n == c["n"]
        if ok:
            eng[tid_of[t]] = np.frombuffer(buf, np.uint8, n * (NF_OLD + 3), p).reshape(n, NF_OLD + 3)
            p += n * (NF_OLD + 3)
    # rijen staan per aandeel gegroepeerd
    if sz:
        bounds = np.flatnonzero(np.diff(tid)) + 1
        starts = np.concatenate([[0], bounds]); ends = np.concatenate([bounds, [sz]])
        for s, e in zip(starts, ends):
            arr = eng.get(int(tid[s]))
            if arr is None:
                continue
            rows = arr[tix[s:e]]
            slots[off + s:off + e] = rows[:, :NF_OLD]
            evalid[off + s:off + e] = rows[:, NF_OLD + 2] == 1
            ehit[off + s:off + e] = (rows[:, NF_OLD + 1] >> 1) & 1
            ins = rows[:, NF_OLD] == 1
            yy = cols["y"][off + s:off + e]
            m = ins & np.isfinite(yy)
            cmp_n += int(m.sum()); mism += int((ehit[off + s:off + e][m] != yy[m].astype(np.uint8)).sum())
    off += sz
    os.remove(os.path.join(FEAT, f"feat_{k:03d}.npz"))       # schijfruimte: de portie staat nu in X.npy
    print(k, off, flush=True)
X.flush()
for c, v in cols.items():
    np.save(os.path.join(OUT, f"{c}.npy"), v)
np.save(os.path.join(OUT, "slots.npy"), slots)
np.save(os.path.join(OUT, "evalid.npy"), evalid)
np.save(os.path.join(OUT, "ehit.npy"), ehit)
meta.to_parquet(os.path.join(OUT, "meta.parquet"))
pd.concat([pd.read_parquet(os.path.join(FEAT, f"expl_{k:03d}.parquet")) for k in chunks if os.path.exists(os.path.join(FEAT, f"expl_{k:03d}.parquet"))]).to_parquet(os.path.join(OUT, "expl.parquet"))
print("vergelijking uitkomst motor vs. eigen:", cmp_n, "dagen,", mism, "verschillen", flush=True)
print("motor-geldig", int(evalid.sum()), "van", N)
