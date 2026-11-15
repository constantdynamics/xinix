"""Zeggen de stukken die een bedrijf bij de SEC indient iets over treffers en grote verliezers? Alleen Amerikaanse aandelen.

  python3 sec_test.py <ssdata> <map van reduce_open.py>      (na sec_fetch.py; leest eval_rows2.parquet van ronde2_regels.py)

Per kandidaat-dag tellen alleen stukken die op het slot van die dag al bekend waren (ontvangen vóór 16:00 uur New York).
Keuzes op 2020–2024, 2025–2026 als controle.

1. Losse kenmerken: recente uitgifte (prospectus 424B), registratie (S-1, S-3), 8-K's en hun onderdelen, te late
   cijfers, noteringsbrief, handel van bestuurders. Per kenmerk: raak vanaf de opening en aandeel grote verliezers,
   met en zonder.
2. Samen: voegt een model op deze kenmerken iets toe aan de kans die er al is?
3. Als regel op de meldingen.
"""
import os, sys, json, glob
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import feat

ROOT, RED = sys.argv[1], sys.argv[2]
ALL = os.path.join(ROOT, "all"); D = os.path.join(ROOT, "sec")
EPOCH = pd.Timestamp("1970-01-01")

# ── stukken per CIK, met de dag waarop ze op het slot bekend waren ──────────
cmap = json.load(open(os.path.join(D, "cik_map.json")))
info, fil = {}, {}
for p in sorted(glob.glob(os.path.join(D, "part_*.json"))):
    for cik, v in json.load(open(p)).items():
        if not isinstance(v, dict) or "f" not in v: continue
        info[int(cik)] = {k: v.get(k) for k in ("name", "sic", "cat", "oldest")}
        f = pd.DataFrame(v["f"], columns=["date", "form", "items", "acc"])
        if not len(f):
            fil[int(cik)] = f.assign(known=np.array([], np.int64)); continue
        acc = pd.to_datetime(f.acc, errors="coerce", utc=True).dt.tz_convert("America/New_York")
        fd = (pd.to_datetime(f.date) - EPOCH).dt.days.to_numpy()
        ad = ((acc.dt.tz_localize(None).dt.normalize() - EPOCH).dt.days).to_numpy(np.float64)
        late = (acc.dt.hour * 60 + acc.dt.minute > 16 * 60).to_numpy()
        known = np.where(np.isfinite(ad), ad + late, fd + 1).astype(np.int64)      # zonder ontvangsttijd: pas de dag erna
        f["known"] = known
        fil[int(cik)] = f.sort_values("known").reset_index(drop=True)
print("bedrijven met stukken:", len(fil), "| stukken:", sum(len(f) for f in fil.values()))

GROUPS = {
    "p424": r"^424B", "s1": r"^(S-1|F-1)(/A)?$", "s3": r"^(S-3|F-3)", "effect": r"^EFFECT", "k8": r"^(8-K|6-K)", "nt": r"^NT ",
    "formd": r"^D(/A)?$", "f4": r"^4(/A)?$", "f144": r"^144", "per": r"^(10-Q|10-K|20-F|40-F)", "proxy": r"^(PRE|DEF) 14A", "h13": r"^(SC 13|SCHEDULE 13)",
    "s8": r"^S-8", "d25": r"^25", "posam": r"^POS AM", "rw": r"^RW",
}
ITEMS = ["1.01", "1.03", "2.02", "2.04", "3.01", "3.02", "4.01", "4.02", "5.02", "5.03", "5.07", "7.01", "8.01"]
arr = {}
for cik, f in fil.items():
    a = {g: f.known[f.form.str.match(rx)].to_numpy() for g, rx in GROUPS.items()}
    k = f[f.form.str.match(r"^8-K")]
    for it in ITEMS:
        a["i" + it] = k.known[k["items"].str.contains(it, regex=False)].to_numpy()
    a["fpi"] = bool(f.form.str.match(r"^(20-F|6-K|40-F)").any())
    arr[cik] = a

# ── kandidaten ──────────────────────────────────────────────────────────────
e = pd.read_parquet(os.path.join(RED, "eval_rows2.parquet"))
e = e[np.isfinite(e.r10o) & np.isfinite(e.yo) & np.isfinite(e.y) & (e.region == 0) & (e.p_glob >= 15) & (e.dv >= 100_000)]
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker"])
C = e.merge(meta, on="tid").sort_values("day").reset_index(drop=True)
C["cik"] = C.ticker.map(cmap)
X = np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")
idx = C.idx.to_numpy(); o = np.argsort(idx)
vw = np.empty(len(C), np.float32); vw[o] = np.asarray(X[idx[o]][:, feat.FIDX["t_vw"]]); C["vw"] = vw
C = C[C.cik.notna() & C.cik.isin(list(arr))].copy(); C["cik"] = C.cik.astype(int)
print("Amerikaanse kandidaat-dagen (kans ≥ 15%, omzet ≥ $100k) met SEC-gegevens:", len(C), "| aandelen:", C.cik.nunique())


def since(a, d):
    """Dagen sinds het laatste stuk dat op dag d bekend was (inf = nooit)."""
    i = np.searchsorted(a, d, side="right") - 1
    return float(d - a[i]) if i >= 0 else np.inf


def count(a, d, w):
    return int(np.searchsorted(a, d, side="right") - np.searchsorted(a, d - w, side="right"))


F = {}
days = C.day.to_numpy(); ciks = C.cik.to_numpy()
cols = ["d_424", "n424_365", "d_s1", "d_s3", "d_eff", "k8_1", "k8_3", "k8_10", "k8_90", "d_nt", "d_formd", "n4_30", "n144_30", "d_per", "d_proxy", "d_13", "d_s8", "d_25", "d_posam"] + ["d_i" + it for it in ITEMS]
M = np.full((len(C), len(cols)), np.nan)
fpi = np.zeros(len(C), bool); sic = np.zeros(len(C), np.int64)
for n, (cik, d) in enumerate(zip(ciks, days)):
    a = arr[cik]
    row = [since(a["p424"], d), count(a["p424"], d, 365), since(a["s1"], d), since(a["s3"], d), since(a["effect"], d),
           count(a["k8"], d, 1), count(a["k8"], d, 3), count(a["k8"], d, 10), count(a["k8"], d, 90), since(a["nt"], d), since(a["formd"], d),
           count(a["f4"], d, 30), count(a["f144"], d, 30), since(a["per"], d), since(a["proxy"], d), since(a["h13"], d), since(a["s8"], d), since(a["d25"], d), since(a["posam"], d)]
    row += [since(a["i" + it], d) for it in ITEMS]
    M[n] = row; fpi[n] = a["fpi"]
    s = info[cik]["sic"]; sic[n] = int(s) if s and str(s).isdigit() else 0
for j, c in enumerate(cols): C[c] = M[:, j]
C["fpi"] = fpi; C["bio"] = np.isin(sic, [2833, 2834, 2835, 2836, 8731])
C["bigloss"] = (C.r10o <= -0.3).astype(int)
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))

FLAGS = {
    "prospectus (424B) in de laatste 5 dagen": C.d_424 <= 5, "prospectus in de laatste 30 dagen": C.d_424 <= 30, "prospectus in de laatste 90 dagen": C.d_424 <= 90,
    "3 of meer prospectussen in een jaar": C.n424_365 >= 3, "geen prospectus in een jaar": C.n424_365 == 0,
    "S-1/F-1 ingediend in de laatste 60 dagen": C.d_s1 <= 60, "S-3/F-3 ingediend in de laatste 60 dagen": C.d_s3 <= 60, "registratie van kracht (EFFECT) in de laatste 30 dagen": C.d_eff <= 30,
    "S-3/F-3 in de laatste 3 jaar": C.d_s3 <= 1095,
    "8-K vandaag of gisteren": C.k8_1 >= 1, "8-K in de laatste 3 dagen": C.k8_3 >= 1, "geen 8-K in 10 dagen": C.k8_10 == 0, "10 of meer 8-K's in 90 dagen": C.k8_90 >= 10,
    "8-K 1.01 (overeenkomst) ≤ 5 dagen": C["d_i1.01"] <= 5, "8-K 2.02 (cijfers) ≤ 5 dagen": C["d_i2.02"] <= 5, "8-K 3.01 (noteringsbrief) ≤ 180 dagen": C["d_i3.01"] <= 180,
    "8-K 3.02 (onderhandse uitgifte) ≤ 30 dagen": C["d_i3.02"] <= 30, "8-K 5.03 (statutenwijziging, vaak omgekeerde split) ≤ 30 dagen": C["d_i5.03"] <= 30,
    "8-K 5.07 (aandeelhoudersstemming) ≤ 30 dagen": C["d_i5.07"] <= 30, "8-K 7.01/8.01 (persbericht) ≤ 3 dagen": (C["d_i7.01"] <= 3) | (C["d_i8.01"] <= 3),
    "8-K 4.02 of 1.03 (cijfers ingetrokken, faillissement) ≤ 180 dagen": (C["d_i4.02"] <= 180) | (C["d_i1.03"] <= 180),
    "te late cijfers (NT) ≤ 90 dagen": C.d_nt <= 90, "Form D (onderhandse plaatsing) ≤ 30 dagen": C.d_formd <= 30,
    "Form 4 (handel bestuurders) ≥ 3 in 30 dagen": C.n4_30 >= 3, "Form 144 (voorgenomen verkoop) in 30 dagen": C.n144_30 >= 1,
    "kwartaal- of jaarcijfers ≤ 5 dagen": C.d_per <= 5, "oproep aandeelhoudersvergadering ≤ 30 dagen": C.d_proxy <= 30, "nieuwe grootaandeelhouder (13D/G) ≤ 10 dagen": C.d_13 <= 10,
    "buitenlandse uitgever (20-F/6-K)": C.fpi, "farmacie of biotech (SIC)": C.bio,
}


def stats(g):
    return len(g), 100 * g.yo.mean(), 100 * g.bigloss.mean(), 100 * g.r10o.mean(), 100 * g.r10o.median(), 100 * g.y.mean()


print("\n== 1. Losse kenmerken (kandidaat-dagen ≥ 15%, omzet ≥ $100k, dagbeweging ≤ 30%) ==")
E = C[C.vw <= .30]
print(f"{'kenmerk':62s} | 2020–2024: n met · raak opening met/zonder · −30% met/zonder · rendement met/zonder | 2025–2026: idem")
rows = []
for nm, fl in FLAGS.items():
    parts = []; rec = {"kenmerk": nm}
    for lab_, m in PERIODS:
        g = E[m.reindex(E.index)]; a = g[fl.reindex(g.index)]; b = g[~fl.reindex(g.index)]
        if len(a) < 30 or len(b) < 30: parts.append(f"n={len(a)} (te weinig)"); continue
        sa, sb = stats(a), stats(b)
        parts.append(f"n={sa[0]:5d} · raak {sa[1]:4.1f}/{sb[1]:4.1f} · −30% {sa[2]:4.1f}/{sb[2]:4.1f} · rend {sa[3]:+5.1f}/{sb[3]:+5.1f}")
        rec[lab_] = (sa[1] - sb[1], sa[2] - sb[2], sa[3] - sb[3], sa[0])
    rows.append(rec)
    print(f"{nm:62s} | " + " | ".join(parts))
print("\n-- kenmerken die in beide perioden dezelfde kant op wijzen (verschil in aandeel grote verliezers ≥ 4 punten, of in raak ≥ 3 punten) --")
for r in rows:
    if "2020–2024" not in r or "2025–2026" not in r: continue
    a, b = r["2020–2024"], r["2025–2026"]
    if (a[1] * b[1] > 0 and min(abs(a[1]), abs(b[1])) >= 4) or (a[0] * b[0] > 0 and min(abs(a[0]), abs(b[0])) >= 3):
        print(f"  {r['kenmerk']:62s} raak {a[0]:+5.1f} / {b[0]:+5.1f} punten · grote verliezers {a[1]:+5.1f} / {b[1]:+5.1f} punten · rendement {a[2]:+5.1f} / {b[2]:+5.1f} · n {a[3]} / {b[3]}")

print("\n== 2. Samen: een model op de SEC-kenmerken naast de kans (geleerd op 2020–2024, getoetst op 2025–2026) ==")
from sklearn.metrics import roc_auc_score
import lightgbm as lgb
feats = cols + ["fpi", "bio"]
Xm = C[feats].replace(np.inf, 9999).astype(float)
for target, yy in (("groot verlies", C.bigloss), ("raak vanaf de opening", C.yo.astype(int))):
    tr, te = DEV.to_numpy(), CHK.to_numpy()
    base_tr, base_te = C.p_glob[tr].to_numpy(), C.p_glob[te].to_numpy()
    m = lgb.LGBMClassifier(n_estimators=150, learning_rate=0.03, num_leaves=8, min_child_samples=150, subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=10, verbose=-1, random_state=1)
    m.fit(pd.concat([Xm[tr], C.loc[tr, ["p_glob", "vw"]]], axis=1), yy[tr])
    p = m.predict_proba(pd.concat([Xm[te], C.loc[te, ["p_glob", "vw"]]], axis=1))[:, 1]
    m0 = lgb.LGBMClassifier(n_estimators=150, learning_rate=0.03, num_leaves=8, min_child_samples=150, subsample=0.8, subsample_freq=1, reg_lambda=10, verbose=-1, random_state=1)
    m0.fit(C.loc[tr, ["p_glob", "vw"]], yy[tr]); p0 = m0.predict_proba(C.loc[te, ["p_glob", "vw"]])[:, 1]
    print(f"  {target}: onderscheid (AUC) op 2025–2026 zonder SEC {roc_auc_score(yy[te], p0):.3f}, met SEC {roc_auc_score(yy[te], p):.3f}")
    imp = pd.Series(m.booster_.feature_importance("gain"), index=list(Xm.columns) + ["p_glob", "vw"]).sort_values(ascending=False)
    print("     belangrijkste kenmerken:", ", ".join(f"{k} {v / imp.sum():.0%}" for k, v in imp.head(8).items()))

print("\n== 3. Als regel op de meldingen (alleen de VS; omzet ≥ $100k, dagbeweging ≤ 30%, geen weekplafond) ==")


def alerts(d, floor, realert_days=10, realert_gain=5.0, col="p_glob"):
    c = d[d[col] >= floor].sort_values(["day", col], ascending=[True, False]); out, last = [], {}
    for i, day, tid, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy()):
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[tid] = (day, p); out.append(i)
    return d.loc[out]


def desc(g):
    if not len(g): return "—"
    return f"n={len(g):4d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | −30% {100 * g.bigloss.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%)"


RULES = {"alle Amerikaanse meldingen": lambda g: g, "zonder prospectus in de laatste 30 dagen": lambda g: g[~(g.d_424 <= 30)], "met prospectus in de laatste 30 dagen": lambda g: g[g.d_424 <= 30],
         "zonder onderhandse uitgifte (8-K 3.02) in 30 dagen": lambda g: g[~(g["d_i3.02"] <= 30)], "zonder nieuwe grootaandeelhouder (13D/G) in 10 dagen": lambda g: g[~(g.d_13 <= 10)]}
for B in (20.0, 26.0):
    print(f"-- lat {B:.0f}% --")
    for nm, f in RULES.items():
        for lab_, m in PERIODS:
            a = alerts(C[m & (C.vw <= .30)], B)
            print(f"  [{nm}] {lab_}: {desc(f(a))}")
C.to_parquet(os.path.join(D, "cand_sec.parquet"))
