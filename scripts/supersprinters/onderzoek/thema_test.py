"""Themakoorts: springt een aandeel vaker als zijn bedrijfstak al in beweging is? Keuzes op 2020–2024, 2025–2026 als controle.

  python3 thema_test.py <ssdata> <map van reduce_open.py>      (leest eval_rows2.parquet van ronde2_regels.py)

Het model kent het marktklimaat per regio al (welk deel van alle aandelen vandaag of deze maand hard steeg). Wat het
niet kent is het klimaat binnen de eigen bedrijfstak. Hier wordt per aandeel per dag geteld welk deel van de andere
aandelen in dezelfde bedrijfstak (130 soorten volgens TradingView) of sector (21) hard steeg:
  j10/j20   vandaag ≥ +10% / ≥ +20%
  w30       in vijf handelsdagen ≥ +30%
  m50/m100  in een maand ≥ +50% / ≥ +100%
binnen de eigen regio op dezelfde dag, en wereldwijd. Wereldwijd telt van een andere regio alleen de laatste sessie
die al gesloten was (Azië ziet de VS en Europa van de dag ervoor, Europa ziet Azië van dezelfde dag en de VS van de
dag ervoor, de VS ziet Azië en Europa van dezelfde dag). Het aandeel zelf telt niet mee.

1. Losse kenmerken: onderscheiden ze binnen de kandidaten treffers of grote verliezers, in beide perioden?
2. De sterkste kenmerken in drie gelijke groepen, per periode en per jaar.
3. Voegt het iets toe aan de kans van het model? Een tweede, klein model (kans + themakenmerken), gekozen op de jaren
   vóór het testjaar, vergeleken met de kans alleen.
4. De meldregels van 15 november met en zonder themakoorts.
"""
import os, sys
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.linear_model import LogisticRegression
sys.path.insert(0, os.path.dirname(__file__))
import feat

ROOT, RED = sys.argv[1], sys.argv[2]
ALL = os.path.join(ROOT, "all")
SIG = ["j10", "j20", "w30", "m50", "m100"]
MIN_GROUP = 10                                    # een aandeel van een groep kleiner dan dit zegt niets

meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "sector", "industry", "region"])
nt = int(meta.tid.max()) + 1
codes = {}
for lvl in ("industry", "sector"):
    c = np.full(nt, -1, np.int32)
    c[meta.tid.to_numpy()] = pd.Categorical(meta[lvl]).codes
    codes[lvl] = c
codes["markt"] = np.zeros(nt, np.int32)
reg_of = np.full(nt, -1, np.int8); reg_of[meta.tid.to_numpy()] = meta.region.to_numpy()

day = np.load(os.path.join(ALL, "day.npy")); tid = np.load(os.path.join(ALL, "tid.npy"))
px = np.load(os.path.join(ALL, "px.npy")); dv = np.load(os.path.join(ALL, "dv.npy"))
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
cols = [feat.FIDX[f] for f in ("r1", "t_p5d", "t_p1m")]
N = len(day); V = np.empty((N, 3), np.float32)
for a in range(0, N, 1_000_000):
    V[a:a + 1_000_000] = np.asarray(X[a:a + 1_000_000])[:, cols]
r1, p5, p1m = V[:, 0], V[:, 1], V[:, 2]
reg = reg_of[tid]
base = (px >= 0.5) & (dv >= 10_000) & (reg >= 0) & np.isfinite(r1)
sig = {"j10": r1 >= 0.10, "j20": r1 >= 0.20, "w30": p5 >= 0.30, "m50": p1m >= 0.50, "m100": p1m >= 1.0}
d0 = int(day.min()); ND = int(day.max()) - d0 + 1
di = (day - d0).astype(np.int64)
print(f"aandeel-dagen {N:,}, doen mee {int(base.sum()):,}; " + ", ".join(f"{k} {100 * (sig[k] & base).sum() / base.sum():.2f}%" for k in SIG))


def dense(code, ng, m):
    out = np.zeros((4, ND, ng), np.float32)
    for r in range(4):
        mm = m & (reg == r) & (code >= 0)
        out[r] = np.bincount(di[mm] * ng + code[mm], minlength=ND * ng).reshape(ND, ng)
    return out


# Laatste sessie tot en met dag d, per regio (voor de regio's die op het moment van de voorspelling al dicht waren).
sess = dense(codes["markt"][tid], 1, base)[:, :, 0] > 0
last_le = np.full((4, ND), -1, np.int64)
for r in range(4):
    cur = -1
    for d in range(ND):
        if sess[r, d]: cur = d
        last_le[r, d] = cur
last_lt = np.concatenate([np.full((4, 1), -1, np.int64), last_le[:, :-1]], axis=1)
# VIEW[R][r] = hoe een aandeel uit regio R de sessie van regio r ziet: 0 dezelfde dag, 1 tot en met vandaag, 2 vóór vandaag.
VIEW = {0: {0: 0, 1: 1, 2: 1, 3: 1}, 1: {0: 1, 1: 0, 2: 1, 3: 1}, 2: {0: 2, 1: 2, 2: 0, 3: 1}, 3: {0: 2, 1: 2, 2: 2, 3: 0}}

e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"))
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y) & (e.dv >= 100_000) & (e.p_glob >= 5)].copy().reset_index(drop=True)
idx = e.idx.to_numpy(); e_di = di[idx]; e_reg = e.region.to_numpy().astype(int); e_tid = tid[idx]
e["vw"] = np.asarray(X[np.sort(idx)][:, feat.FIDX["t_vw"]])[np.argsort(np.argsort(idx))]
e["bigloss"] = (e.r10o <= -0.3).astype(int)
names = []
for lvl in ("industry", "sector", "markt"):
    code_t = codes[lvl]; ng = int(code_t.max()) + 1; code = code_t[tid]
    g = code_t[e_tid]; ok = g >= 0; gg = np.where(ok, g, 0)
    cnt = {k: dense(code, ng, base & sig[k]) for k in SIG}; cnt["n"] = dense(code, ng, base)
    for k in ["n"] + SIG:
        own = np.zeros(len(e), np.float32); glob = np.zeros(len(e), np.float32)
        for R in range(4):
            m = e_reg == R
            for r in range(4):
                v = VIEW[R][r]
                d = e_di[m] if v == 0 else (last_le[r] if v == 1 else last_lt[r])[e_di[m]]
                val = np.where(d >= 0, cnt[k][r][np.maximum(d, 0), gg[m]], 0.0)
                glob[m] += val
                if r == R: own[m] += val
        self_ = (base[idx] & (sig[k][idx] if k != "n" else True)).astype(np.float32)
        e[f"{lvl}_reg_{k}"] = np.where(ok, own - self_, np.nan); e[f"{lvl}_glob_{k}"] = np.where(ok, glob - self_, np.nan)
    for scope in ("reg", "glob"):
        n = e[f"{lvl}_{scope}_n"]
        for k in SIG:
            e[f"{lvl}_{scope}_{k}_deel"] = np.where(n >= MIN_GROUP, e[f"{lvl}_{scope}_{k}"] / n.clip(lower=1), np.nan)
            if lvl != "markt": names += [f"{lvl}_{scope}_{k}", f"{lvl}_{scope}_{k}_deel"]
# Bovenop het marktklimaat: het aandeel in de bedrijfstak min het aandeel in de hele markt (zelfde regio of wereldwijd).
for lvl in ("industry", "sector"):
    for scope in ("reg", "glob"):
        for k in SIG:
            e[f"{lvl}_{scope}_{k}_extra"] = e[f"{lvl}_{scope}_{k}_deel"] - e[f"markt_{scope}_{k}_deel"]
            names.append(f"{lvl}_{scope}_{k}_extra")
e.to_parquet(os.path.join(RED, "thema_rows.parquet"))

C = e[e.p_glob >= 15]
DEV = C.yr <= 2024; CHK = C.yr >= 2025
print(f"kandidaten (kans ≥ 15%, omzet ≥ $100k): {len(C)} ({int(DEV.sum())} in 2020–2024, {int(CHK.sum())} in 2025–2026); zonder bedrijfstak: {int(C.industry_reg_n.isna().sum())}")
print("andere aandelen in dezelfde bedrijfstak en regio: mediaan", int(C.industry_reg_n.median()), "| wereldwijd", int(C.industry_glob_n.median()),
      "| sector en regio", int(C.sector_reg_n.median()))


def auc(g, col, target):
    g = g[np.isfinite(g[col])]
    return roc_auc_score(g[target], g[col]) if len(g) > 50 and g[target].nunique() == 2 else np.nan


print("\n== 1. Losse kenmerken binnen de kandidaten (AUC; 0,5 = geen onderscheid) ==")
rows = []
for n in names + ["p_glob", "vw"]:
    r = {"kenmerk": n}
    for lab_, m in (("dev", DEV), ("chk", CHK)):
        r["raak_" + lab_] = auc(C[m], n, "y"); r["open_" + lab_] = auc(C[m], n, "yo"); r["verlies_" + lab_] = auc(C[m], n, "bigloss")
    rows.append(r)
T = pd.DataFrame(rows).set_index("kenmerk")
T["zelfde_kant"] = np.sign(T.raak_dev - .5) == np.sign(T.raak_chk - .5)
T["min_afstand"] = np.minimum((T.raak_dev - .5).abs(), (T.raak_chk - .5).abs()) * T.zelfde_kant
print("-- gesorteerd op het kleinste verschil met 0,5 in de twee perioden, treffers vanaf het slot --")
print(T.sort_values("min_afstand", ascending=False).drop(columns=["zelfde_kant", "min_afstand"]).head(16).round(3).to_string())
T["v_kant"] = np.sign(T.verlies_dev - .5) == np.sign(T.verlies_chk - .5)
T["v_afst"] = np.minimum((T.verlies_dev - .5).abs(), (T.verlies_chk - .5).abs()) * T.v_kant
print("-- hetzelfde voor grote verliezers (30% of meer lager na 10 handelsdagen, vanaf de opening) --")
print(T.sort_values("v_afst", ascending=False)[["verlies_dev", "verlies_chk", "raak_dev", "raak_chk"]].head(10).round(3).to_string())
best = [n for n in T.sort_values("min_afstand", ascending=False).index if n not in ("p_glob", "vw")][:4]


def desc(g):
    if len(g) < 5: return f"n={len(g)}"
    return (f"n={len(g):5d} voorspeld {g.p_glob.mean():4.1f}% | raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | −30% {100 * g.bigloss.mean():4.1f}%"
            f" | houden {100 * g.r10o.mean():+5.1f}%")


print("\n== 2. De sterkste kenmerken in drie gelijke groepen ==")
for n in best + ["industry_reg_m50", "industry_glob_j20_deel"]:
    print(f"-- {n} --")
    for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
        g = C[m & np.isfinite(C[n])]
        q = g[n].quantile([1 / 3, 2 / 3]).to_numpy()
        for nm, s in (("laag", g[g[n] <= q[0]]), ("midden", g[(g[n] > q[0]) & (g[n] <= q[1])]), ("hoog", g[g[n] > q[1]])):
            print(f"  {lab_} {nm:6s} (tot {s[n].max():.3f}) {desc(s)}")
    per_year = []
    for Y in range(2020, 2027):
        g = C[(C.yr == Y) & np.isfinite(C[n])]
        per_year.append(f"{Y}: {auc(g, n, 'y'):.2f}")
    print("  per jaar (AUC treffers): " + " ".join(per_year))

print("\n== 3. Voegt het iets toe aan de kans van het model? ==")
print("Tweede model = kans + themakenmerken, geleerd op alle jaren vóór het testjaar (rijen met kans ≥ 5%), getest op de kandidaten ≥ 15%.")
lg = lambda p: np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
SETS = {"bedrijfstak, eigen regio": ["industry_reg_j20_deel", "industry_reg_w30_deel", "industry_reg_m50_deel", "industry_reg_m50"],
        "bedrijfstak, wereldwijd": ["industry_glob_j20_deel", "industry_glob_w30_deel", "industry_glob_m50_deel", "industry_glob_m50"],
        "bovenop het marktklimaat": ["industry_reg_j20_extra", "industry_reg_m50_extra", "industry_glob_j20_extra", "industry_glob_m50_extra"],
        "sector": ["sector_reg_j20_deel", "sector_reg_m50_deel", "sector_glob_j20_deel", "sector_glob_m50_deel"]}
e["lp"] = lg(e.p_glob.to_numpy() / 100)
for target, tn in (("y", "treffers vanaf het slot"), ("yo", "treffers vanaf de opening"), ("bigloss", "grote verliezers")):
    print(f"-- {tn} --")
    for sn, fs in SETS.items():
        out = []
        tot = {"dev": [[], [], []], "chk": [[], [], []]}
        for Y in range(2021, 2027):
            tr = e[(e.yr < Y)].dropna(subset=fs); te = e[(e.yr == Y) & (e.p_glob >= 15)].dropna(subset=fs)
            if len(te) < 50 or te[target].nunique() < 2: continue
            mu, sd = tr[fs].mean(), tr[fs].std().replace(0, 1)
            m = LogisticRegression(C=0.3, max_iter=500).fit(np.c_[tr.lp, (tr[fs] - mu) / sd], tr[target].astype(int))
            s2 = m.predict_proba(np.c_[te.lp, (te[fs] - mu) / sd])[:, 1]
            a0, a1 = roc_auc_score(te[target], te.p_glob), roc_auc_score(te[target], s2)
            k = max(10, len(te) // 5)                                   # de beste vijfde volgens elk van de twee
            t0 = te[target].to_numpy()[np.argsort(-te.p_glob.to_numpy())[:k]].mean(); t1 = te[target].to_numpy()[np.argsort(-s2)[:k]].mean()
            out.append(f"{Y}: {a0:.3f}→{a1:.3f} (top {100 * t0:.0f}%→{100 * t1:.0f}%)")
            b = tot["dev" if Y <= 2024 else "chk"]; b[0].append(te[target].to_numpy()); b[1].append(te.p_glob.to_numpy()); b[2].append(s2)
        summ = []
        for lab_ in ("dev", "chk"):
            if tot[lab_][0]:
                yv, pv, sv = (np.concatenate(x) for x in tot[lab_])
                summ.append(f"{'2021–2024' if lab_ == 'dev' else '2025–2026'}: {roc_auc_score(yv, pv):.3f}→{roc_auc_score(yv, sv):.3f}")
        print(f"  [{sn}] " + " | ".join(summ) + "\n      " + " ".join(out))

print("\n== 4. De meldregels van 15 november (lat 26%, week ≤ 30%, zonder Europa), en bij lat 20% ==")


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    out, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); out.append(i)
    return d.loc[out]


A = e[(e.vw <= 0.30) & (e.region != 2)]
for floor in (26.0, 20.0):
    for lab_, m in (("2020–2024", A.yr <= 2024), ("2025–2026", A.yr >= 2025)):
        a = alerts(A[m], floor)
        print(f"lat {floor:.0f}% {lab_}: alle meldingen {desc(a)}")
        for n in ("industry_reg_m50", "industry_glob_j20_deel", best[0]):
            g = a[np.isfinite(a[n])]
            if len(g) < 10: continue
            cut = A.loc[(A.yr <= 2024) & (A.p_glob >= 15), n].median()      # grens gekozen op 2020–2024
            print(f"     {n} ≤ {cut:.3f}: {desc(g[g[n] <= cut])}\n     {n} > {cut:.3f}: {desc(g[g[n] > cut])}")
