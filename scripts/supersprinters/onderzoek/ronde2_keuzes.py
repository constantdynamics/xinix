"""De meldregels doorgerekend op de keuzes van de gebruiker (15 november 2026). Keuzes op 2020–2024, 2025–2026 als controle.

  python3 ronde2_keuzes.py <ssdata> <map van reduce_open.py>      (leest eval_rows2.parquet van ronde2_regels.py)

Keuzes: betrouwbaar = vaak +50% én weinig grote verliezers; liever één heel goede melding per maand; geen weekplafond
maar een hoge lat; alleen regio's waar de kansen aantoonbaar kloppen; kopen met een limietorder rond het vorige slot;
verkopen rond +50%.

1. Lat × grens op de beweeglijkheid, zonder weekplafond: aantal per week, raak, grote verliezers.
2. Per regio: komt uit wat voorspeld is, binnen de groep die een melding kan krijgen?
3. Kopen en verkopen zoals de gebruiker het doet, nagespeeld op de dagkoersen (opening, hoogste, laagste, slot):
   marktorder bij de opening tegenover een limietorder op of rond het vorige slot; verkopen met een limiet op +50%,
   anders na 10 handelsdagen.
"""
import os, sys, pickle
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import feat

ROOT, RED = sys.argv[1], sys.argv[2]
ALL = os.path.join(ROOT, "all")
RN = ["VS", "Canada", "Europa", "Azië-Pacific"]
e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"))
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y)]
C = e[(e.p_glob >= 15) & (e.dv >= 100_000)].copy().sort_values("day").reset_index(drop=True)
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
idx = C.idx.to_numpy(); o = np.argsort(idx)
vw = np.empty(len(C), np.float32); vw[o] = np.asarray(X[idx[o]][:, feat.FIDX["t_vw"]])
C["vw"] = vw
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))
weeks = lambda d: max(1e-9, (d.day.max() - d.day.min() + 1) / 7)
W = {k: weeks(C[m]) for k, m in PERIODS}


def desc(g, wk=None):
    if not len(g): return "—"
    s = f"n={len(g):4d}" + (f" ({len(g) / wk:4.2f}/wk)" if wk else "")
    hit, loss = 100 * g.yo.mean(), 100 * (g.r10o <= -0.3).mean()
    return (s + f" raak slot {100 * g.y.mean():4.1f}% opening {hit:4.1f}% | −30% {loss:4.1f}% | raak min verlies {hit - loss:+5.1f} | houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%)")


def alerts(d, floor, per_week=None, realert_days=10, realert_gain=5.0, col="p_glob"):
    c = d[d[col] >= floor].sort_values(["day", col], ascending=[True, False])
    out, sent, last = [], [], {}
    for i, day, tid, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy()):
        while sent and sent[0] <= day - 7: sent.pop(0)
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        if per_week is not None and len(sent) >= per_week: continue
        sent.append(day); last[tid] = (day, p); out.append(i)
    return d.loc[out]


print("== 1. Lat × grens op de beweeglijkheid, zonder weekplafond (omzet ≥ $100k; herhaalregel 10 dagen) ==")
for V, vn in ((99, "geen grens"), (.30, "week ≤ 30%"), (.21, "week ≤ 21%")):
    print(f"-- {vn} --")
    for B in (20, 22, 24, 26, 28, 30):
        for lab_, m in PERIODS:
            print(f"  lat {B}% {lab_}: {desc(alerts(C[m & (C.vw <= V)], float(B)), W[lab_])}")
print("-- ter vergelijking, met het weekplafond van 3 (week ≤ 30%) --")
for B in (20, 22, 24, 26):
    for lab_, m in PERIODS:
        print(f"  lat {B}% {lab_}: {desc(alerts(C[m & (C.vw <= .30)], float(B), per_week=3), W[lab_])}")
print("-- meldingen per jaar zonder weekplafond (week ≤ 30%) --")
for B in (20, 22, 24, 26, 28):
    a = pd.concat([alerts(C[m & (C.vw <= .30)], float(B)) for _, m in PERIODS])
    print(f"  lat {B}%: " + " ".join(f"{Y}: {int((a.yr == Y).sum())}" for Y in range(2020, 2027)) + f" | drukste week: {a.groupby(a.day // 7).size().max()} meldingen")

print("\n== 2. Per regio: voorspeld tegen werkelijk, binnen wat een melding kan krijgen (omzet ≥ $100k, week ≤ 30%) ==")
for B in (15, 20, 24):
    for lab_, m in PERIODS:
        parts = []
        for r in range(4):
            g = C[m & (C.p_glob >= B) & (C.vw <= .30) & (C.region == r)]
            parts.append(f"{RN[r]} n={len(g)} {g.p_glob.mean():.1f}→{100 * g.y.mean():.1f} (opening {100 * g.yo.mean():.1f}, −30% {100 * (g.r10o <= -.3).mean():.0f}%)" if len(g) >= 10 else f"{RN[r]} n={len(g)}")
        print(f"  kandidaten ≥ {B}% {lab_}: " + " | ".join(parts))
print("-- verschillende aandelen per regio onder de kandidaten ≥ 20% (elk aandeel telt één keer per 10 dagen) --")
for lab_, m in PERIODS:
    a = alerts(C[m & (C.vw <= .30)], 20.0)
    print(f"  {lab_}: " + " | ".join(f"{RN[r]} {desc(a[a.region == r])}" for r in range(4) if (a.region == r).sum() >= 5))

# ── 3. Kopen en verkopen nagespeeld op dagkoersen ───────────────────────────
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk"])
tix_a = np.load(os.path.join(ALL, "tix.npy"), mmap_mode="r")
S = C[(C.p_glob >= 20) & (C.vw <= .30)].merge(meta, on="tid", how="left")
S["tix"] = np.asarray(tix_a[S.idx.to_numpy()]).astype(np.int64)
ENTRY = [("marktorder bij de opening", ("open",)), ("limiet op het slot, één dag", ("limit", 0.0, 1)), ("limiet op het slot, 3 dagen", ("limit", 0.0, 3)),
         ("limiet op het slot, 5 dagen", ("limit", 0.0, 5)), ("limiet 3% boven het slot, één dag", ("limit", 0.03, 1)),
         ("limiet 5% boven het slot, één dag", ("limit", 0.05, 1)), ("limiet 10% boven het slot, één dag", ("limit", 0.10, 1)),
         ("limiet 5% onder het slot, 3 dagen", ("limit", -0.05, 3))]
TP, HOLD = 0.5, 10
res = {nm: np.full((len(S), 4), np.nan) for nm, _ in ENTRY}      # gevuld (0/1), resultaat, +50% gehaald, laagste slot onderweg


def sim(Cl, O, H, L, t, rule):
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
    target = price * (1 + TP)
    # Op de instapdag telt de top alleen als er bij de opening gekocht is: anders kan de top vóór de aankoop liggen.
    for k in range(d if at_open else d + 1, d + HOLD + 1):
        if k > d and O[k] >= target: return 1.0, O[k] / price - 1, 1.0, Cl[d:k].min() / price - 1
        if H[k] >= target: return 1.0, TP, 1.0, (Cl[d:k].min() / price - 1 if k > d else 0.0)
    return 1.0, Cl[d + HOLD] / price - 1, 0.0, Cl[d:d + HOLD + 1].min() / price - 1


pos = {(tk, ch): g.index.to_numpy() for (tk, ch), g in S.groupby(["ticker", "chunk"])}
for ch in sorted(S.chunk.dropna().unique()):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for (tk, c2), rows in pos.items():
        if c2 != ch or tk not in items or "adj" not in items[tk]: continue
        c = items[tk]; A = c["adj"].astype(np.float64)
        O, H, L = c["open"].astype(np.float64) * A, c["high"].astype(np.float64) * A, c["low"].astype(np.float64) * A
        for i in rows:
            t = int(S.tix.iat[i])
            if t + 5 + HOLD + 1 >= len(A): continue
            for nm, rule in ENTRY:
                res[nm][i] = sim(A, O, H, L, t, rule)
    del items
ok = np.isfinite(res[ENTRY[0][0]][:, 1])
print(f"\n== 3. Kopen en verkopen nagespeeld (verkopen met een limiet op +{int(100 * TP)}%, anders na {HOLD} handelsdagen) ==")
print(f"kandidaat-dagen ≥ 20% met week ≤ 30%: {len(S)}, met volledige koersen {int(ok.sum())}")


def show(sel, title):
    print(f"-- {title} --")
    for lab_, m in (("2020–2024", (S.yr <= 2024).to_numpy()), ("2025–2026", (S.yr >= 2025).to_numpy())):
        mm = m & sel & ok
        if mm.sum() < 5: continue
        for nm, _ in ENTRY:
            r = res[nm][mm]; f = r[:, 0] == 1; rr = r[f]
            if not len(rr): continue
            # wat deden de meldingen waar de order niet gevuld werd? (gerekend vanaf het slot)
            miss = S.y.to_numpy()[mm][~f]
            print(f"  {lab_} {nm:34s} gevuld {100 * f.mean():3.0f}% (n={len(rr):4d}) | +50% gehaald {100 * rr[:, 2].mean():4.1f}% | resultaat {100 * rr[:, 1].mean():+5.1f}% (mediaan {100 * np.median(rr[:, 1]):+5.1f}%)"
                  f" | in de plus {100 * (rr[:, 1] > 0).mean():3.0f}% | −30% of lager {100 * (rr[:, 1] <= -0.3).mean():3.0f}%" + (f" | niet gevuld: {100 * miss.mean():.0f}% was raak" if len(miss) >= 5 else ""))


show(np.ones(len(S), bool), "alle kandidaat-dagen ≥ 20% (week ≤ 30%)")
for B, cap in ((20, 3), (22, None), (24, None), (26, None)):
    a_idx = set()
    for _, m in PERIODS:
        a = alerts(C[m & (C.vw <= .30)], float(B), per_week=cap)
        a_idx |= set(zip(a.tid.to_numpy(), a.day.to_numpy()))
    sel = np.array([(t_, d_) in a_idx for t_, d_ in zip(S.tid.to_numpy(), S.day.to_numpy())])
    show(sel, f"meldingen bij lat {B}%" + (f", weekplafond {cap}" if cap else ", zonder weekplafond"))
