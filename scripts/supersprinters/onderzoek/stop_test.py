"""Helpt een vaste stop-order tegen grote verliezers? Nagespeeld op dagkoersen. Keuzes op 2020–2024, 2025–2026 als controle.

  python3 stop_test.py <ssdata> <map van reduce_open.py>      (leest eval_rows2.parquet van ronde2_regels.py)

De gebruiker koopt met een limietorder rond het vorige slot en verkoopt rond +50%. Hier komt daar een stop-order bij:
verkopen zodra de koers X% onder de aankoopprijs komt. Per melding: kopen (marktorder bij de opening, of limiet op het
slot die één dag staat), verkooplimiet op +50%, stop op −X%, anders verkopen op het slot na 10 handelsdagen.

Voorzichtig gerekend: raakt de koers op één dag zowel de stop als de verkooplimiet, dan telt de stop. Opent het aandeel
onder de stop, dan telt de opening. Bij een limietorder die in de loop van de dag gevuld wordt telt de top van die dag
niet (die kan vóór de aankoop liggen), de bodem wel (die ligt op of na de aankoop). Een stop-order glijdt in dunne
handel vaak door; daarom ook een variant waarin de verkoop 3% onder de stop uitkomt.
"""
import os, sys, pickle
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import feat

ROOT, RED = sys.argv[1], sys.argv[2]
ALL = os.path.join(ROOT, "all")
TP, HOLD = 0.5, 10
STOPS = [None, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40]
ENTRY = [("marktorder bij de opening", ("open",)), ("limiet op het slot, één dag", ("limit", 0.0, 1))]

e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"))
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y) & (e.dv >= 100_000) & (e.p_glob >= 15)].copy().sort_values("day").reset_index(drop=True)
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
idx = e.idx.to_numpy(); o = np.argsort(idx)
vw = np.empty(len(e), np.float32); vw[o] = np.asarray(X[idx[o]][:, feat.FIDX["t_vw"]])
e["vw"] = vw
C = e[(e.vw <= 0.30) & (e.region != 2)].copy()          # de meldregels van 15 november: niet boven 30% per dag, zonder Europa


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    out, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); out.append(i)
    return d.loc[out]


def sim(Cl, O, H, L, t, rule, stop, slip=0.0):
    """→ (gevuld, resultaat, uitgang: 0 tijd, 1 verkooplimiet, 2 stop, zonder stop later +50% gehaald?)"""
    c0 = Cl[t]
    if rule[0] == "open":
        d, price, at_open = t + 1, O[t + 1], True
    else:
        limit, d, price, at_open = c0 * (1 + rule[1]), -1, np.nan, False
        for k in range(t + 1, t + 1 + rule[2]):
            if O[k] <= limit: d, price, at_open = k, O[k], True; break
            if L[k] <= limit: d, price = k, limit; break
        if d < 0: return 0.0, np.nan, np.nan, np.nan
    if not (price > 0): return np.nan, np.nan, np.nan, np.nan
    target = price * (1 + TP); st = price * (1 - stop) if stop else -1.0
    later = 0.0
    for k in range(d, d + HOLD + 1):                      # zou de verkooplimiet zonder stop gehaald zijn?
        if (k > d or at_open) and H[k] >= target: later = 1.0; break
    for k in range(d, d + HOLD + 1):
        if k > d:
            if O[k] <= st: return 1.0, O[k] * (1 - slip) / price - 1, 2.0, later
            if O[k] >= target: return 1.0, O[k] / price - 1, 1.0, later
        if L[k] <= st: return 1.0, st * (1 - slip) / price - 1, 2.0, later
        if (k > d or at_open) and H[k] >= target: return 1.0, TP, 1.0, later
    return 1.0, Cl[d + HOLD] / price - 1, 0.0, later


meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk"])
tix_a = np.load(os.path.join(ALL, "tix.npy"), mmap_mode="r")
S = C[C.p_glob >= 20].merge(meta, on="tid", how="left").reset_index(drop=True)
S["tix"] = np.asarray(tix_a[S.idx.to_numpy()]).astype(np.int64)
keys = [(en, st, sl) for en, _ in ENTRY for st in STOPS for sl in ((0.0, 0.03) if st else (0.0,))]
res = {k: np.full((len(S), 4), np.nan) for k in keys}
rules = dict(ENTRY)
pos = {(tk, ch): g.index.to_numpy() for (tk, ch), g in S.groupby(["ticker", "chunk"])}
for ch in sorted(S.chunk.dropna().unique()):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for (tk, c2), rows in pos.items():
        if c2 != ch or tk not in items or "adj" not in items[tk]: continue
        c = items[tk]; A = c["adj"].astype(np.float64)
        O, H, L = c["open"].astype(np.float64) * A, c["high"].astype(np.float64) * A, c["low"].astype(np.float64) * A
        for i in rows:
            t = int(S.tix.iat[i])
            if t + 2 + HOLD + 1 >= len(A): continue
            for (en, st, sl) in keys:
                res[(en, st, sl)][i] = sim(A, O, H, L, t, rules[en], st, sl)
    del items
ok = np.isfinite(res[(ENTRY[0][0], None, 0.0)][:, 1])
print(f"kandidaat-dagen ≥ 20% (week ≤ 30%, zonder Europa): {len(S)}, met volledige koersen {int(ok.sum())}")
key_of = {(t_, d_): i for i, (t_, d_) in enumerate(zip(S.tid.to_numpy(), S.day.to_numpy()))}
for floor in (26.0, 20.0):
    for lab_, m in (("2020–2024", C.yr <= 2024), ("2025–2026", C.yr >= 2025)):
        a = alerts(C[m], floor)
        sel = np.array([key_of[(t_, d_)] for t_, d_ in zip(a.tid.to_numpy(), a.day.to_numpy()) if (t_, d_) in key_of])
        sel = sel[ok[sel]]
        print(f"\n== meldingen bij lat {floor:.0f}% in {lab_}: {len(a)}, met volledige koersen {len(sel)} ==")
        for en, _ in ENTRY:
            print(f"-- {en} --")
            for st in STOPS:
                for sl in ((0.0, 0.03) if st else (0.0,)):
                    r = res[(en, st, sl)][sel]; f = r[:, 0] == 1; rr = r[f]
                    if len(rr) < 5: continue
                    stopped = rr[:, 2] == 2
                    nm = "zonder stop" if not st else f"stop −{int(100 * st)}%" + (" (3% uitglijden)" if sl else "")
                    print(f"  {nm:28s} n={len(rr):4d} | +50% verkocht {100 * (rr[:, 2] == 1).mean():4.1f}% | gestopt {100 * stopped.mean():4.1f}%"
                          f" | resultaat {100 * rr[:, 1].mean():+5.1f}% (mediaan {100 * np.median(rr[:, 1]):+5.1f}%) | −30% of lager {100 * (rr[:, 1] <= -0.3).mean():4.1f}%"
                          f" | −20% of lager {100 * (rr[:, 1] <= -0.2).mean():4.1f}%"
                          + (f" | van de gestopte had {100 * rr[stopped, 3].mean():.0f}% later nog +50% gehaald" if stopped.sum() >= 5 else ""))
