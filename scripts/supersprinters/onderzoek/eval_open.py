"""Vergelijkt rangschikkingen en meldregels op wat er gebeurt als je bij de opening van de volgende dag koopt.

  python3 eval_open.py <map van reduce_open.py>

Keuzes (drempels, regels) op 2020–2024; 2025–2026 is de controle.
"""
import os, sys, json
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import policy

RED = sys.argv[1]
YEARS = list(range(2019, 2027))
t = pd.concat([pd.read_parquet(os.path.join(RED, f"top_{Y}.parquet")) for Y in YEARS], ignore_index=True)
cal = pd.concat([pd.read_parquet(os.path.join(RED, f"cal_{Y}.parquet")) for Y in YEARS], ignore_index=True)
for d in (t, cal):
    d["loss"] = np.where(np.isfinite(d.r10o), (d.r10o < -0.3).astype(float), np.nan)
    d["win"] = np.where(np.isfinite(d.r10o), (d.r10o > 0.2).astype(float), np.nan)
print("rijen", len(t), "ijksteekproef", len(cal))

def calibrate(score, label, out, by_region=False):
    """Kans in % per testjaar, met een ijklijn uit de eerdere testjaren (gewogen steekproef)."""
    t[out] = np.nan
    groups = [None] if not by_region else [0, 1, 2, 3]
    for Y in YEARS[1:]:
        for g in groups:
            prev = cal[(cal.yr < Y) & np.isfinite(cal[label]) & np.isfinite(cal[score])]
            cur = (t.yr == Y) & np.isfinite(t[score])
            if g is not None:
                prev = prev[prev.region == g]; cur &= t.region == g
            if len(prev) < 2000 or prev[label].sum() < 30 or not cur.any():
                # te weinig eigen gegevens: de lijn van alle regio's samen
                prev = cal[(cal.yr < Y) & np.isfinite(cal[label]) & np.isfinite(cal[score])]
            cv = policy.fit_curve(prev[score].to_numpy(np.float64), prev[label].to_numpy(np.float64), prev.w.to_numpy(np.float64))
            t.loc[cur, out] = 100 * policy.apply_curve(cv, t.loc[cur, score].to_numpy(np.float64))

calibrate("s_yo", "yo", "p_yo"); calibrate("s_yo", "yo", "p_yo_r", True)
calibrate("s_close", "y", "p_cl_r", True)
calibrate("s_loss", "loss", "p_loss"); calibrate("s_win", "win", "p_win"); calibrate("s_gap", "yo", "p_gap")
t = t[t.yr >= 2020].copy()
DEV = t.yr <= 2024; CHK = t.yr >= 2025

def desc(g):
    g = g[np.isfinite(g.yo) & np.isfinite(g.r10o)]
    if not len(g): return "—"
    return (f"n={len(g):5d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%) "
            f"| +50%-regel {100 * g.tp50o.mean():+5.1f}% | plus {100 * (g.r10o > 0).mean():3.0f}% | −30% {100 * (g.r10o <= -0.3).mean():3.0f}%")

def weeks(d): return max(1e-9, (d.day.max() - d.day.min() + 1) / 7)
W = {"dev": weeks(t[DEV]), "chk": weeks(t[CHK])}

def alerts(d, col, floor, per_week=3, realert_days=10, realert_gain=5.0, per_day=None):
    c = d[d[col] >= floor].sort_values(["day", col], ascending=[True, False])
    out, sent, last, today, nt = [], [], {}, None, 0
    for i, day, tid, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy()):
        if day != today: today, nt = day, 0
        while sent and sent[0] <= day - 7: sent.pop(0)
        if len(sent) >= per_week or (per_day is not None and nt >= per_day): continue
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        sent.append(day); last[tid] = (day, p); nt += 1; out.append(i)
    return d.loc[out]

def floor_for(d, col, target, **kw):
    lo, hi = 0.0, 99.0
    for _ in range(20):
        mid = (lo + hi) / 2
        if len(alerts(d, col, mid, **kw)) / W["dev"] > target: lo = mid
        else: hi = mid
    return hi

print("\n== 1. De vijf hoogste van elke dag ==")
for name, rk in (("volgorde nu (kans vanaf het slot)", "s_close"), ("kans vanaf de opening", "s_yo"), ("kans op +20% na 10 dagen", "s_win"), ("verwacht rendement", "s_ret")):
    for pre, lq in (("rk_", ""), ("rkl_", " · omzet ≥ $100k")):
        for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
            print(f"[{name}{lq}] {lab_}: {desc(t[m & (t[pre + rk] <= 5)])}")

print("\n== 2. Klopt de kans bovenin, per regio? (kandidaten met kans vanaf het slot ≥ 15%, gewone ijking) ==")
RN = ["VS", "Canada", "Europa", "Azië-Pacific"]
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    for r in range(4):
        g = t[m & (t.p_new >= 15) & (t.region == r) & np.isfinite(t.y)]
        if len(g): print(f"  {lab_} {RN[r]:13s} n={len(g):5d} voorspeld {g.p_new.mean():4.1f}% werkelijk {100 * g.y.mean():4.1f}%  | met ijking per regio voorspeld {g.p_cl_r.mean():4.1f}%")

print("\n== 3. Meldingen bij een vast aantal per week (lat gekozen op 2020–2024), omzet ≥ $100k ==")
L = t[t.dv >= 100_000]
t["p_mix"] = t.p_yo_r - 0.5 * t.p_loss
L = t[t.dv >= 100_000]
variants = [("nu: kans vanaf het slot", "p_new", {}), ("kans vanaf het slot, ijking per regio", "p_cl_r", {}), ("kans vanaf de opening", "p_yo", {}),
            ("kans vanaf de opening, ijking per regio", "p_yo_r", {}), ("idem, hoogstens 1 per dag", "p_yo_r", {"per_day": 1}),
            ("opening per regio − ½ × kans op groot verlies", "p_mix", {})]
keep = {}
for target in (1.0, 0.5, 0.25):
    print(f"-- doel: {target} per week --")
    for name, col, kw in variants:
        fl = floor_for(L[DEV.reindex(L.index)], col, target, **kw)
        a1 = alerts(L[DEV.reindex(L.index)], col, fl, **kw); a2 = alerts(L[CHK.reindex(L.index)], col, fl, **kw)
        keep[(name, target)] = (col, fl, kw, a1, a2)
        print(f"[{name}] lat {fl:5.1f}: 2020–2024 {len(a1) / W['dev']:.2f}/wk {desc(a1)}")
        print(f"{'':>10}2025–2026 {len(a2) / W['chk']:.2f}/wk {desc(a2)}")

print("\n== 4. Regels bovenop de meldingen (kans vanaf de opening, ijking per regio, doel 1 per week) ==")
col, fl, kw, a1, a2 = keep[("kans vanaf de opening, ijking per regio", 1.0)]
for nm, f in (("alles", lambda a: a), ("opening niet meer dan 15% boven of onder het slot", lambda a: a[(a.gap1 <= 0.15) & (a.gap1 >= -0.15)]),
              ("opening hoogstens +15%", lambda a: a[a.gap1 <= 0.15]), ("opening hoogstens +5%", lambda a: a[a.gap1 <= 0.05]),
              ("kans op groot verlies in de laagste helft", lambda a: a[a.p_loss <= a1.p_loss.median()]),
              ("koers hoogstens $20", lambda a: a[a.px <= 20]), ("omzet hoogstens $10 mln", lambda a: a[a.dv <= 1e7]),
              ("alleen de VS", lambda a: a[a.region == 0]),
              ("oordeel met de opening erbij ≥ de lat", lambda a: a[a.p_gap >= fl])):
    print(f"[{nm}] 2020–2024 {desc(f(a1))}\n{'':>6}2025–2026 {desc(f(a2))}")
t.to_parquet(os.path.join(RED, "eval_rows.parquet"))
