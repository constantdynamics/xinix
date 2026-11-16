"""Short-gegevens: zeggen shortposities en short-verkopen iets over treffers en grote verliezers onder de kandidaten?

  python3 short_test.py <ssdata> verdeling     alleen dekking en verdeling van de kenmerken (geen uitkomsten)
  python3 short_test.py <ssdata>               de meting

Aanleiding (16 november 2026): de vraag of een betaald abonnement de meldingen betrouwbaarder maakt. De soort gegevens
die daarvoor het meest in aanmerking komt (wie zit er short) is voor een deel gratis: FINRA publiceert twee keer per
maand de openstaande shortpositie per aandeel (finra.py) en elke handelsdag het aandeel short-verkopen in de handel
buiten de beurzen om (short_haal.py). Beide gaan ver genoeg terug. Alleen Amerikaanse aandelen.

Zelfde opzet als kas_test.py en tekst_test.py: de 13.696 Amerikaanse kandidaat-dagen (kans vanaf 15%, omzet vanaf
$100.000), keuzes op 2020–2024, 2025–2026 als controle, en de lat van vlaggen.py (beide perioden dezelfde kant op,
minstens 5 punten, minstens 100 kandidaat-dagen met het feit).

Wat op de kandidaat-dag bekend was:
  shortpositie   de laatste melding die al gepubliceerd was: peildatum + 9 werkdagen (FINRA publiceert na 7 à 8), en
                 niet ouder dan 45 dagen. De cijfers zijn dus 2 tot 6 weken oud.
  short-verkopen het bestand van de dag zelf komt 's avonds na het slot: bekend vóór het meldmoment van de ochtend erna.

De grenzen van de feiten zijn gekozen op de verdeling van de kenmerken in 2020–2024 (ronde getallen bij het bovenste
en onderste vijfde deel), vóórdat er een uitkomst naast lag ("verdeling" drukt die verdeling af zonder uitkomsten).
FINRA's eigen "dagen om te dekken" is nooit lager dan 1; voor de onderkant dient daarom de positie in dagen eigen omzet.

Dekking: ±73% van de kandidaat-dagen. De rest zijn aandelen die toen onder een andere ticker handelden; de bestanden
van FINRA kennen alleen de ticker van dat moment. In productie speelt dat niet (de ticker van vandaag is bekend).
"""
import os, sys, glob
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import vlaggen

ROOT = sys.argv[1]
ONLY_DIST = len(sys.argv) > 2 and sys.argv[2] == "verdeling"
D = os.path.join(ROOT, "sec"); EPOCH = np.datetime64("1970-01-01")
C = pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["idx", "day", "tid", "ticker", "y", "yo", "r10o", "p_glob", "yr", "vw", "px", "dv"])
C = C[np.isfinite(C.r10o) & np.isfinite(C.yo) & np.isfinite(C.y)].reset_index(drop=True)
n = len(C)

# ── 1. Shortpositie (twee keer per maand) ───────────────────────────────────
fr = []
for f in sorted(glob.glob(os.path.join(ROOT, "finra", "*.parquet"))):
    d = pd.read_parquet(f)
    fr.append(d[d.mkt != "OTC"][["sym", "si", "adv", "dtc", "chg", "settle"]])
SI = pd.concat(fr, ignore_index=True).dropna(subset=["settle", "si"])
SI = SI[SI.sym.isin(set(C.ticker))]
st = pd.to_datetime(SI.settle).to_numpy().astype("datetime64[D]")
SI["sday"] = (st - EPOCH).astype(int)
SI["kday"] = (np.busday_offset(st, 9, roll="forward") - EPOCH).astype(int)      # vanaf deze dag bekend
SI = SI.sort_values(["sym", "sday"])
grp = {t: g for t, g in SI.groupby("sym")}
si = np.full(n, np.nan); adv = np.full(n, np.nan); dtc = np.full(n, np.nan); chg = np.full(n, np.nan); age = np.full(n, np.nan)
for t, g in C.groupby("ticker"):
    s = grp.get(t)
    if s is None: continue
    kd, sd = s.kday.to_numpy(), s.sday.to_numpy()
    d = g.day.to_numpy(); i = np.searchsorted(kd, d, side="right") - 1
    ok = (i >= 0); ii = np.clip(i, 0, len(sd) - 1); ok &= (d - sd[ii] <= 45)
    ix = g.index.to_numpy()[ok]; jj = ii[ok]
    si[ix] = s.si.to_numpy()[jj]; adv[ix] = s.adv.to_numpy()[jj]; dtc[ix] = s.dtc.to_numpy()[jj]; chg[ix] = s.chg.to_numpy()[jj]; age[ix] = d[ok] - sd[jj]
C["si"] = si; C["si_age"] = age
# Hoort de melding bij hetzelfde aandeel? De gemiddelde handel volgens FINRA maal de koers moet in de buurt liggen van
# de eigen omzet (30 dagen). Wijkt dat meer dan een factor 50 af, dan is het een ander aandeel met dezelfde ticker.
chk = adv * C.px.to_numpy() / np.maximum(C.dv.to_numpy(), 1.0)
same = np.isfinite(chk) & (chk > 0.02) & (chk < 50)
C["dtc"] = np.where(same & (dtc < 999), dtc, np.nan)                     # dagen om te dekken (FINRA: positie / gemiddelde handel)
C["si_chg"] = np.where(same & np.isfinite(chg) & (np.abs(chg) < 100000), chg, np.nan)   # verandering t.o.v. de vorige melding, in %
C["si_dv"] = np.where(same, si * C.px.to_numpy() / np.maximum(C.dv.to_numpy(), 1.0), np.nan)   # positie in dagen eigen omzet
kas = os.path.join(D, "cand_kas.parquet")
if os.path.exists(kas):                                                   # uitstaande aandelen uit de verslagen (kas_test.py)
    K = pd.read_parquet(kas, columns=["tid", "day", "sh_now"]).drop_duplicates(["tid", "day"])
    sh = C[["tid", "day"]].merge(K, on=["tid", "day"], how="left").sh_now.to_numpy()
    pct = 100 * si / np.where(sh > 0, sh, np.nan)
    C["si_pct"] = np.where(same & np.isfinite(pct) & (pct <= 100), pct, np.nan)   # positie in % van de uitstaande aandelen
else:
    C["si_pct"] = np.nan
    print("(geen cand_kas.parquet: de feiten over het deel van de uitstaande aandelen vallen weg; draai eerst kas_haal.py en kas_test.py)")

# ── 2. Short-verkopen per dag ───────────────────────────────────────────────
V = pd.read_parquet(os.path.join(ROOT, "finra_dag", "shvol.parquet"))
days = np.sort(V.day.unique()); pos = {int(d): i for i, d in enumerate(days)}
vg = {t: g for t, g in V.groupby("ticker")}
out = {k: np.full(n, np.nan) for k in ("sv1", "tv1", "sv5", "tv5", "sv20", "tv20", "sv60", "tv60")}
for t, g in C.groupby("ticker"):
    v = vg.get(t)
    if v is None: continue
    a_sv = np.zeros(len(days)); a_tv = np.zeros(len(days))
    p = np.fromiter((pos[int(x)] for x in v.day.to_numpy()), int, len(v))
    a_sv[p] = v.sv.to_numpy(); a_tv[p] = v.tv.to_numpy()
    cs, ct = np.concatenate([[0], np.cumsum(a_sv)]), np.concatenate([[0], np.cumsum(a_tv)])
    for i, d in zip(g.index.to_numpy(), g.day.to_numpy()):
        j = pos.get(int(d))
        if j is None: continue
        for w in (1, 5, 20, 60):
            lo = max(0, j + 1 - w)
            out[f"sv{w}"][i] = cs[j + 1] - cs[lo]; out[f"tv{w}"][i] = ct[j + 1] - ct[lo]
# Zelfde controle: de handel buiten de beurzen om over 20 dagen, maal de koers, tegenover de eigen omzet.
chk2 = out["tv20"] / 20 * C.px.to_numpy() / np.maximum(C.dv.to_numpy(), 1.0)
same2 = np.isfinite(chk2) & (chk2 > 0.02) & (chk2 < 20)
for w, mn in ((1, 1000), (5, 5000), (20, 20000), (60, 60000)):
    C[f"svr{w}"] = np.where(same2 & (out[f"tv{w}"] >= mn), 100 * out[f"sv{w}"] / np.maximum(out[f"tv{w}"], 1), np.nan)   # % short-verkopen
C["dsvr"] = C.svr5 - C.svr60                                               # laatste week tegenover de laatste drie maanden, in punten

FEATS = {"dtc": "dagen om te dekken (FINRA)", "si_pct": "shortpositie in % van de uitstaande aandelen", "si_dv": "shortpositie in dagen eigen omzet",
         "si_chg": "verandering van de shortpositie in %", "svr1": "% short-verkopen op de dag zelf", "svr5": "% short-verkopen over 5 dagen",
         "svr20": "% short-verkopen over 20 dagen", "dsvr": "5 dagen min 60 dagen, in punten"}
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))
print(f"kandidaat-dagen {n} ({C.ticker.nunique()} aandelen) | shortpositie gevonden {100 * np.isfinite(si).mean():.0f}%, waarvan zelfde aandeel {100 * same[np.isfinite(si)].mean():.0f}% | "
      f"short-verkopen gevonden {100 * np.isfinite(out['tv20']).mean():.0f}%, waarvan zelfde aandeel {100 * same2[np.isfinite(out['tv20'])].mean():.0f}%")
print(f"ouderdom van de shortpositie op de kandidaat-dag: middelste {np.nanmedian(age):.0f} dagen (10%–90%: {np.nanpercentile(age, 10):.0f}–{np.nanpercentile(age, 90):.0f})")
print("controle zelfde aandeel, kwantielen 1/5/50/95/99%: shortpositie", np.round(np.nanpercentile(chk, [1, 5, 50, 95, 99]), 3), "| short-verkopen", np.round(np.nanpercentile(chk2, [1, 5, 50, 95, 99]), 3))
print("\n== 0. Dekking en verdeling (2020–2024; geen uitkomsten) ==")
for k, nm in FEATS.items():
    a = C.loc[DEV, k].dropna()
    print(f"  {nm:48s} bekend {100 * C[k].notna().mean():3.0f}% (2020–2024 {100 * C.loc[DEV, k].notna().mean():3.0f}%, 2025–2026 {100 * C.loc[CHK, k].notna().mean():3.0f}%) | "
          f"10/20/50/80/90%: {' / '.join(f'{x:.1f}' for x in a.quantile([.1, .2, .5, .8, .9]))}")
if ONLY_DIST: sys.exit(0)


def flag(col, cond):
    k = C[col].notna().to_numpy()
    return pd.Series(np.where(k, cond(C[col].to_numpy()), np.nan), index=C.index).astype(object).where(k, np.nan)


# Vooraf vastgelegd (zie de kop van dit bestand).
FLAGS = {
    "S1 dagen om te dekken 4 of meer (FINRA)": flag("dtc", lambda x: x >= 4),
    "S2 shortpositie 3 dagen eigen omzet of meer": flag("si_dv", lambda x: x >= 3),
    "S3 shortpositie minder dan 0,1 dag eigen omzet": flag("si_dv", lambda x: x < 0.1),
    "S4 shortpositie 10% of meer van de uitstaande aandelen": flag("si_pct", lambda x: x >= 10),
    "S5 shortpositie minder dan 1% van de uitstaande aandelen": flag("si_pct", lambda x: x < 1),
    "S6 shortpositie in de laatste melding 40% of meer gestegen": flag("si_chg", lambda x: x >= 40),
    "S7 shortpositie in de laatste melding 20% of meer gedaald": flag("si_chg", lambda x: x <= -20),
    "V1 short-verkopen op de dag zelf 55% of meer": flag("svr1", lambda x: x >= 55),
    "V2 short-verkopen op de dag zelf minder dan 35%": flag("svr1", lambda x: x < 35),
    "V3 short-verkopen over 5 dagen 55% of meer": flag("svr5", lambda x: x >= 55),
    "V4 short-verkopen over 5 dagen minder dan 35%": flag("svr5", lambda x: x < 35),
    "V5 laatste week 5 punten of meer boven drie maanden": flag("dsvr", lambda x: x >= 5),
    "V6 laatste week 10 punten of meer onder drie maanden": flag("dsvr", lambda x: x <= -10),
    "   geen short-gegevens gevonden (andere ticker in die tijd)": pd.Series(~C.si_dv.notna().to_numpy() & ~C.svr5.notna().to_numpy(), index=C.index).astype(object),
}
C["bigloss"] = (C.r10o <= -0.3).astype(int)
print("\n== 1. Alle kandidaat-dagen (kans ≥ 15%, omzet ≥ $100k) ==")
vlaggen.tabel(C, FLAGS, PERIODS)
print("\n== 2. Alleen dagbeweging tot 30% (wat een melding kan krijgen) ==")
E = C[C.vw <= 0.30]
vlaggen.tabel(E, {k: v.reindex(E.index) for k, v in FLAGS.items()}, PERIODS)

print("\n== 3. Per vijfde deel (dagbeweging tot 30%): loopt de uitkomst mee met het kenmerk? ==")
for k, nm in FEATS.items():
    for lab, m in PERIODS:
        g = E[m.reindex(E.index) & E[k].notna()]
        if len(g) < 250: print(f"  {nm} · {lab}: te weinig ({len(g)})"); continue
        q = pd.qcut(g[k], 5, duplicates="drop")
        t = g.groupby(q, observed=True).agg(n=("y", "size"), slot=("y", "mean"), opening=("yo", "mean"), verlies=("bigloss", "mean"), houden=("r10o", "mean"))
        print(f"  {nm} · {lab}: " + " | ".join(f"{iv.left:.1f}…{iv.right:.1f}: raak {100 * r.opening:4.1f}% −30% {100 * r.verlies:4.1f}%" for iv, r in t.iterrows()))

print("\n== 4. Samen: een model op de short-kenmerken naast de kans (geleerd op 2020–2024, getoetst op 2025–2026) ==")
from sklearn.metrics import roc_auc_score
import lightgbm as lgb
feats = list(FEATS)
for target, yy in (("groot verlies", C.bigloss), ("raak vanaf de opening", C.yo.astype(int)), ("raak vanaf het slot", C.y.astype(int))):
    tr, te = DEV.to_numpy(), CHK.to_numpy()
    kw = dict(n_estimators=150, learning_rate=0.03, num_leaves=8, min_child_samples=150, subsample=0.8, subsample_freq=1, reg_lambda=10, verbose=-1, random_state=1)
    m = lgb.LGBMClassifier(colsample_bytree=0.7, **kw).fit(C.loc[tr, feats + ["p_glob", "vw"]], yy[tr])
    p = m.predict_proba(C.loc[te, feats + ["p_glob", "vw"]])[:, 1]
    m0 = lgb.LGBMClassifier(**kw).fit(C.loc[tr, ["p_glob", "vw"]], yy[tr]); p0 = m0.predict_proba(C.loc[te, ["p_glob", "vw"]])[:, 1]
    print(f"  {target}: onderscheid (AUC) op 2025–2026 zonder short-kenmerken {roc_auc_score(yy[te], p0):.3f}, met {roc_auc_score(yy[te], p):.3f}")
    imp = pd.Series(m.booster_.feature_importance("gain"), index=feats + ["p_glob", "vw"]).sort_values(ascending=False)
    print("     belangrijkste kenmerken:", ", ".join(f"{k} {v / imp.sum():.0%}" for k, v in imp.head(6).items()))
print("  per jaar (geleerd op alle jaren ervóór, vanaf 2022):")
for target, yy in (("groot verlies", C.bigloss), ("raak vanaf de opening", C.yo.astype(int))):
    res = []
    for Y in range(2022, 2027):
        tr, te = (C.yr < Y).to_numpy(), (C.yr == Y).to_numpy()
        if te.sum() < 200 or len(np.unique(yy[te])) < 2: continue
        kw = dict(n_estimators=150, learning_rate=0.03, num_leaves=8, min_child_samples=150, subsample=0.8, subsample_freq=1, reg_lambda=10, verbose=-1, random_state=1)
        p = lgb.LGBMClassifier(colsample_bytree=0.7, **kw).fit(C.loc[tr, feats + ["p_glob", "vw"]], yy[tr]).predict_proba(C.loc[te, feats + ["p_glob", "vw"]])[:, 1]
        p0 = lgb.LGBMClassifier(**kw).fit(C.loc[tr, ["p_glob", "vw"]], yy[tr]).predict_proba(C.loc[te, ["p_glob", "vw"]])[:, 1]
        res.append(f"{Y}: {roc_auc_score(yy[te], p0):.3f} → {roc_auc_score(yy[te], p):.3f}")
    print(f"     {target}: " + " | ".join(res))

print("\n== 4b. Tegenover wat het model al verwachtte (dagbeweging tot 30%): raak vanaf het slot gedeeld door de voorspelde kans ==")
print("    Staat er bij 'met' en 'zonder' ongeveer hetzelfde getal, dan wist het model het al.")
for nm, fl in FLAGS.items():
    parts = []
    for lab, m in PERIODS:
        g = E[m.reindex(E.index)]; f = fl.reindex(g.index); a, b = g[f == True], g[f == False]      # noqa: E712
        if len(a) < 100 or len(b) < 100: parts.append(f"{lab}: te weinig"); continue
        parts.append(f"{lab}: voorspeld {a.p_glob.mean():4.1f}/{b.p_glob.mean():4.1f}% · raak÷voorspeld {100 * a.y.mean() / a.p_glob.mean():.2f}/{100 * b.y.mean() / b.p_glob.mean():.2f}")
    print(f"  {nm:58s} | " + " | ".join(parts))

print("\n== 4c. Verkenning: de kans bijsturen met vier ja/nee-feiten (geleerd op 2020–2024, getoetst op 2025–2026) ==")
print("    Geen deel van de vooraf vastgelegde meting: bedacht nadat 4b liet zien dat het model deze verschillen niet kent.")
from sklearn.linear_model import LogisticRegression
lp = np.log(np.clip(C.p_glob.to_numpy() / 100, 1e-4, 1 - 1e-4) / (1 - np.clip(C.p_glob.to_numpy() / 100, 1e-4, 1 - 1e-4)))
Z = np.column_stack([lp, (C.si_pct >= 10).to_numpy(float), (C.si_pct < 1).to_numpy(float), (C.svr5 >= 55).to_numpy(float), (C.svr5 < 35).to_numpy(float)])
el = (C.vw <= 0.30).to_numpy()
for target, yy in (("raak vanaf het slot", C.y.to_numpy().astype(int)), ("raak vanaf de opening", C.yo.to_numpy().astype(int))):
    tr, te = DEV.to_numpy() & el, CHK.to_numpy() & el
    lr = LogisticRegression(C=1.0, max_iter=500).fit(Z[tr], yy[tr])
    s = lr.decision_function(Z[te]); base = lp[te]
    k = max(1, int(0.2 * te.sum())); top_s = np.argsort(-s)[:k]; top_b = np.argsort(-base)[:k]
    print(f"  {target}: gewichten shortpositie ≥10% {lr.coef_[0][1]:+.2f}, <1% {lr.coef_[0][2]:+.2f}, short-verkopen ≥55% {lr.coef_[0][3]:+.2f}, <35% {lr.coef_[0][4]:+.2f} | "
          f"onderscheid (AUC) 2025–2026: kans alleen {roc_auc_score(yy[te], base):.3f}, bijgestuurd {roc_auc_score(yy[te], s):.3f} | "
          f"bovenste vijfde deel ({k} kandidaat-dagen): raak {100 * yy[te][top_b].mean():.1f}% → {100 * yy[te][top_s].mean():.1f}%")
    res = []
    for Y in range(2022, 2027):
        tr, te = (C.yr < Y).to_numpy() & el, (C.yr == Y).to_numpy() & el
        if te.sum() < 200 or len(np.unique(yy[te])) < 2: continue
        s = LogisticRegression(C=1.0, max_iter=500).fit(Z[tr], yy[tr]).decision_function(Z[te])
        k = max(1, int(0.2 * te.sum()))
        res.append(f"{Y}: AUC {roc_auc_score(yy[te], lp[te]):.3f} → {roc_auc_score(yy[te], s):.3f}, bovenste vijfde {100 * yy[te][np.argsort(-lp[te])[:k]].mean():.0f}% → {100 * yy[te][np.argsort(-s)[:k]].mean():.0f}%")
    print("     per jaar (geleerd op de jaren ervóór): " + " | ".join(res))

print("\n== 5. Als regel op de meldingen (alleen de VS; dagbeweging tot 30%, elk aandeel één keer per 10 dagen tenzij 5 punten hoger) ==")


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    keep, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); keep.append(i)
    return d.loc[keep]


def desc(g):
    return f"n={len(g):4d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | −30% {100 * g.bigloss.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}%" if len(g) >= 5 else f"n={len(g)}"


for floor in (26.0, 20.0):
    for lab, m in PERIODS:
        a = alerts(E[m.reindex(E.index)], floor)
        print(f"lat {floor:.0f}% {lab}: alle {desc(a)}")
        for nm, sel in (("dagen om te dekken ≥ 4", a.dtc >= 4), ("dagen om te dekken < 4", a.dtc < 4), ("shortpositie ≥ 10% van de aandelen", a.si_pct >= 10), ("shortpositie < 10%", a.si_pct < 10),
                        ("shortpositie ≥ 3 dagen eigen omzet", a.si_dv >= 3), ("shortpositie < 3 dagen eigen omzet", a.si_dv < 3),
                        ("short-verkopen 5 dagen ≥ 55%", a.svr5 >= 55), ("short-verkopen 5 dagen < 55%", a.svr5 < 55), ("short-verkopen 5 dagen < 35%", a.svr5 < 35),
                        ("laatste week ≥ 5 punten boven drie maanden", a.dsvr >= 5), ("laatste week ≥ 10 punten onder drie maanden", a.dsvr <= -10)):
            print(f"      {nm:44s} {desc(a[sel])}")
C.to_parquet(os.path.join(D, "cand_short.parquet"))
