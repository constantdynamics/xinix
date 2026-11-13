"""Eind-tot-eind: kenmerken uit TradingView (TypeScript, productie) tegen kenmerken uit verse Yahoo-dagkoersen (Python, training)."""
import sys, os, json, random, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, requests
import feat
from clean import clean
TS, N = sys.argv[1], int(sys.argv[2])
ts = json.load(open(TS))
random.seed(4)
# liquide aandelen met handel vandaag, zodat beide bronnen een verse dagbar hebben
cand = [t for t, v in ts.items() if (v["tv"]["volume"] or 0) > 0 and (v["tv"]["av30"] or 0) * v["tv"]["close"] > 50000]
pick = random.sample(cand, min(N, len(cand)))
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (compatible; XinixEngine/1.0; +https://github.com)"
keys = [k for k in feat.LITE if k not in ("t_p5d", "lpx", "t_ldv30", "t_ldv1")]
diffs = {k: [] for k in keys}; used = 0; skipped = 0
for t in pick:
    r = S.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?range=2y&interval=1d&events=split", timeout=30)
    if r.status_code != 200:
        skipped += 1; continue
    res = r.json()["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    f = lambda a: np.array([np.nan if x is None else x for x in a], dtype=np.float64)
    sp = (res.get("events") or {}).get("splits") or {}
    raw = {"ts": np.array(res["timestamp"], dtype=np.int64), "open": f(q["open"]), "high": f(q["high"]), "low": f(q["low"]), "close": f(q["close"]),
           "adj": f(res["indicators"]["adjclose"][0]["adjclose"]), "vol": f(q["volume"]),
           "splits": np.array(sorted([(int(s["date"]), float(s["numerator"]), float(s["denominator"])) for s in sp.values()]), dtype=np.float64).reshape(-1, 3)}
    c = clean(raw, res["meta"], t)          # meta bevat gmtoffset: datums in de tijdzone van de beurs
    if c is None or c["n"] < 260:
        skipped += 1; continue
    c["splits"] = raw["splits"]
    for k in ("open", "high", "low"):
        c[k] = c[k].astype(np.float32) / c["adj"].astype(np.float32)
    X, e = feat.features(c, np.ones(c["n"]))
    tv = ts[t]["tv"]
    if abs(c["close"][-1] / tv["close"] - 1) > 0.002:      # andere laatste dag in de twee bronnen
        skipped += 1; continue
    used += 1
    for k in keys:
        a = float(X[-1, feat.FIDX[k]]); b = ts[t]["f"][k]
        if b is not None and np.isfinite(a):
            diffs[k].append(abs(a - b))
    time.sleep(0.05)
print(f"{used} aandelen vergeleken ({skipped} overgeslagen)")
for k in keys:
    d = np.array(diffs[k])
    print(f"  {k:9s} n={len(d):3d}  mediaan |verschil| {np.median(d):.5f}  p90 {np.percentile(d, 90):.5f}  max {d.max():.4f}")
