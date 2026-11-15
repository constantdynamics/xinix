"""Verliesrisico: welke meldingen eindigen fors lager, en is dat vooraf te zien? Keuzes op 2020–2024, 2025–2026 als controle.

  python3 ronde2_risico.py <map van reduce_open.py>      (leest eval_rows2.parquet van ronde2_regels.py)

1. Een tweede model voor "30% of meer lager na 10 handelsdagen" (open_loss): onderscheidt het binnen de kandidaten, elk jaar?
2. Kan één bestaand kenmerk hetzelfde? (de beweeglijkheid van de week: gemiddelde dagbeweging, hoogste tegen laagste koers)
3. De vier risicoklassen (tot 12%, tot 21%, tot 30%, daarboven) op de kandidaten en per jaar.
4. Meldingen per klasse, en de regel "geen melding boven X% per dag" bij een lat van 18, 20 en 22%; per jaar bij 20%.
5. Wie krijgt de weekplekken, wat zegt de opening van de volgende dag, en maakt de omzet nog uit?
6. Hoe ver komt een melding (hoogste en laagste slot binnen 10 handelsdagen)?
"""
import os, sys
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
sys.path.insert(0, os.path.dirname(__file__))
import feat
from lib import ALL

RED = sys.argv[1]
BOUNDS = [0.12, 0.21, 0.30]                       # kwartielen en de 90%-grens van de kandidaten in 2020–2024, afgerond
CLASSES = [("laag (≤ 12%)", -1, .12), ("gemiddeld (12–21%)", .12, .21), ("hoog (21–30%)", .21, .30), ("zeer hoog (> 30%)", .30, 99)]

e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"))
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y)]
C = e[(e.p_glob >= 15) & (e.dv >= 100_000)].copy().sort_values("day").reset_index(drop=True)
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
names = [f for f in feat.LITE if f != "t_p5d"]
idx = C.idx.to_numpy(); o = np.argsort(idx)
F = np.empty((len(C), len(names)), np.float32)
F[o] = np.asarray(X[idx[o]][:, [feat.FIDX[f] for f in names]])
for j, n in enumerate(names): C["f_" + n] = F[:, j]
C["vw"] = C.f_t_vw
C["bigloss"] = (C.r10o <= -0.3).astype(int)
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))
print("kandidaten (kans ≥ 15%, omzet ≥ $100k):", len(C))


def desc(g):
    if not len(g): return "—"
    return (f"n={len(g):5d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | houden {100 * g.r10o.mean():+6.1f}% (mediaan {100 * g.r10o.median():+6.1f}%)"
            f" | plus {100 * (g.r10o > 0).mean():3.0f}% | −30% {100 * (g.r10o <= -0.3).mean():4.1f}% | ooit ≤−30%: {100 * (g.mn10o <= -.3).mean():3.0f}%")


weeks = lambda d: max(1e-9, (d.day.max() - d.day.min() + 1) / 7)


def alerts(d, floor, per_week=3, realert_days=10, realert_gain=5.0, order=None, col="p_glob"):
    """Meldingen in tijdsvolgorde; `order` = kolom waarop de plekken van een dag verdeeld worden (oplopend), anders hoogste kans eerst."""
    c = d[d[col] >= floor]
    c = c.sort_values(["day", order or col], ascending=[True, order is not None])
    out, sent, last = [], [], {}
    for i, day, tid, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy()):
        while sent and sent[0] <= day - 7: sent.pop(0)
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        if len(sent) >= per_week: continue
        sent.append(day); last[tid] = (day, p); out.append(i)
    return d.loc[out]


print("\n== 1. Tweede model voor groot verlies: drie gelijke groepen per jaar ==")
for Y in range(2020, 2027):
    g = C[C.yr == Y]
    if len(g) < 60 or g.bigloss.nunique() < 2: continue
    q = g.s_loss.quantile([1 / 3, 2 / 3]).to_numpy()
    print(f"{Y}: n={len(g)} onderscheid (AUC) {roc_auc_score(g.bigloss, g.s_loss):.3f}")
    for nm, s in (("laag", g[g.s_loss <= q[0]]), ("midden", g[(g.s_loss > q[0]) & (g.s_loss <= q[1])]), ("hoog", g[g.s_loss > q[1]])):
        print(f"     {nm:6s} {desc(s)}")

print("\n== 2. Losse kenmerken: onderscheid voor groot verlies binnen de kandidaten (AUC; 0,5 = geen) ==")
rows = []
for n in ["s_loss"] + ["f_" + x for x in names]:
    r = {"kenmerk": n}
    for lab_, m in (("dev", DEV), ("chk", CHK)):
        g = C[m & np.isfinite(C[n])]
        r["verlies_" + lab_] = roc_auc_score(g.bigloss, g[n]); r["raak_" + lab_] = roc_auc_score(g.yo.astype(int), g[n])
    rows.append(r)
T = pd.DataFrame(rows).set_index("kenmerk")
T["d"] = (T.verlies_dev - 0.5).abs() + (T.verlies_chk - 0.5).abs()
print(T.sort_values("d", ascending=False).drop(columns="d").head(10).round(3).to_string())
print("per jaar (verliesmodel | beweeglijkheid week | maand | dag) en het aandeel groot verlies per klasse:")
for Y in range(2020, 2027):
    g = C[(C.yr == Y) & np.isfinite(C.vw) & np.isfinite(C.f_t_vm) & np.isfinite(C.f_t_vd)]
    if len(g) < 60 or g.bigloss.nunique() < 2: continue
    print(f"  {Y} n={len(g):5d} " + " ".join(f"{roc_auc_score(g.bigloss, g[n]):.3f}" for n in ("s_loss", "vw", "f_t_vm", "f_t_vd")) + " | "
          + " / ".join(f"{100 * g[(g.vw > a) & (g.vw <= b)].bigloss.mean():.0f}%" for _, a, b in CLASSES))

print("\n== 3. De vier risicoklassen (beweeglijkheid van de week) op alle kandidaten ==")
for lab_, m in PERIODS:
    for nm, a, b in CLASSES:
        print(f"  {lab_} {nm:19s} {desc(C[m & (C.vw > a) & (C.vw <= b)])}")
print("kandidaten vanaf 20%:")
for lab_, m in PERIODS:
    for nm, a, b in CLASSES:
        print(f"  {lab_} {nm:19s} {desc(C[m & (C.p_glob >= 20) & (C.vw > a) & (C.vw <= b)])}")

print("\n== 4. Meldingen (omzet ≥ $100k, hoogstens 3 per week) ==")
for floor in (18.0, 20.0, 22.0):
    print(f"-- lat {floor:.0f}% --")
    for lab_, m in PERIODS:
        a = alerts(C[m], floor)
        print(f"  {lab_} alle meldingen      {desc(a)}")
        for nm, lo, hi in CLASSES:
            print(f"  {lab_} {nm:19s} {desc(a[(a.vw > lo) & (a.vw <= hi)])}")
    for cap in (0.30, 0.25, 0.21):
        for lab_, m in PERIODS:
            a = alerts(C[m & (C.vw <= cap)], floor)
            print(f"  regel: geen melding boven {int(100 * cap)}% | {lab_} ({len(a) / weeks(C[m]):.2f}/wk) {desc(a)}")
print("-- per jaar bij lat 20%: nu, en met de grens van 30% --")
for Y in range(2020, 2027):
    g = C[C.yr == Y]
    print(f"  {Y} nu:        {desc(alerts(g, 20.0))}\n  {Y} met grens: {desc(alerts(g[g.vw <= .30], 20.0))}")
for nm, f in (("nu", lambda g: g), ("met grens 30%", lambda g: g[g.vw <= .30])):
    print(f"  2020–2026 [{nm}] {desc(pd.concat([alerts(f(C[m]), 20.0) for _, m in PERIODS]))}")

print("\n== 5a. Wie krijgt de weekplekken? (lat 20%) ==")
for nm, f, kw in (("nu: hoogste kans eerst", lambda g: g, {}), ("niet boven 30% per dag, hoogste kans eerst", lambda g: g[g.vw <= .30], {}),
                  ("niet boven 30% per dag, rustigste eerst", lambda g: g[g.vw <= .30], {"order": "vw"}), ("geen grens, rustigste eerst", lambda g: g, {"order": "vw"})):
    for lab_, m in PERIODS:
        a = alerts(f(C[m]), 20.0, **kw)
        print(f"[{nm}] {lab_} ({len(a) / weeks(C[m]):.2f}/wk) {desc(a)}")
print("\n== 5b. De opening van de volgende dag (kandidaten ≥ 20%, week ≤ 30%) ==")
for lab_, m in PERIODS:
    g = C[m & (C.p_glob >= 20) & (C.vw <= .30)]
    for a, b, nm in ((-9, -.15, "≤ −15%"), (-.15, -.05, "−15 tot −5%"), (-.05, .05, "−5 tot +5%"), (.05, .15, "+5 tot +15%"), (.15, .30, "+15 tot +30%"), (.30, 99, "> +30%")):
        print(f"  {lab_} opening {nm:12s} {desc(g[(g.gap1 > a) & (g.gap1 <= b)])}")
print("\n== 5c. Omzet (kandidaten ≥ 20%, week ≤ 30%) ==")
for lab_, m in PERIODS:
    g = C[m & (C.p_glob >= 20) & (C.vw <= .30)]
    for a, b, nm in ((1e5, 2.5e5, "$100k–250k"), (2.5e5, 1e6, "$250k–1 mln"), (1e6, 1e7, "$1–10 mln"), (1e7, 1e99, "> $10 mln")):
        print(f"  {lab_} {nm:12s} {desc(g[(g.dv >= a) & (g.dv < b)])}")

print("\n== 6. Hoe ver komt een melding? (lat 20%, met de grens van 30%; sloten binnen 10 handelsdagen, vanaf de opening) ==")
for lab_, m in PERIODS:
    a = alerts(C[m & (C.vw <= .30)], 20.0)
    up = " ".join(f"≥+{int(100 * x)}%: {100 * (a.mx10o >= x).mean():.0f}%" for x in (0.1, 0.2, 0.3, 0.5, 1.0))
    dn = " ".join(f"≤−{int(100 * x)}%: {100 * (a.mn10o <= -x).mean():.0f}%" for x in (0.1, 0.2, 0.3, 0.5))
    print(f"  {lab_} n={len(a)} | hoogste slot {up} | laagste slot {dn} | laagste koers binnen de dag ≤−20%: {100 * (a.mnl10o <= -0.2).mean():.0f}%")
