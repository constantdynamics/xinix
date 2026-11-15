"""Vier controles voor de tweede ronde, op de opgeslagen testvoorspellingen. Keuzes op 2020–2024, 2025–2026 als controle.

  python3 ronde2_regels.py <rijen.parquet van final_eval.py> <map van reduce_open.py>

1. Bijsturing per regio in plaats van één getal voor alles (met en zonder krimp naar het gezamenlijke getal).
2. Weekplafond: hoe vaak houdt het een kandidaat tegen, en wat deden de tegengehouden kandidaten?
3. Azië-Pacific: de melding komt pas de volgende ochtend, als die markten al open zijn. Wat scheelt een dag later instappen?
4. Kans op een groot verlies: zegt die iets binnen de groep kandidaten?
5. De lat: aantal meldingen per week tegen trefkans, vanaf het slot en vanaf de opening.
"""
import os, sys
import numpy as np, pandas as pd, pyarrow.dataset as pads
sys.path.insert(0, os.path.dirname(__file__))
from lib import ALL

ROWS, RED = sys.argv[1], sys.argv[2]
TOP_MIN, TOP_N, MIN_BASE = 25, 100, 0.01
RN = ["VS", "Canada", "Europa", "Azië-Pacific"]

e = pd.read_parquet(os.path.join(RED, "eval_rows.parquet"))
e = e[e.yr >= 2020].copy()
print("kandidaatrijen", len(e))

# ── uitkomsten bij een dag later instappen (opening van dag t+2): de rij van hetzelfde aandeel een dag verder ──
tid_a = np.load(os.path.join(ALL, "tid.npy"), mmap_mode="r"); tix_a = np.load(os.path.join(ALL, "tix.npy"), mmap_mode="r")
key = np.asarray(tid_a).astype(np.int64) * 100_000 + np.asarray(tix_a).astype(np.int64)
order = np.argsort(key, kind="stable"); ks = key[order]
want = e.tid.to_numpy(np.int64) * 100_000 + np.asarray(tix_a[e.idx.to_numpy()]).astype(np.int64) + 1
pos = np.searchsorted(ks, want); pos = np.clip(pos, 0, len(ks) - 1)
found = ks[pos] == want
nxt = np.where(found, order[pos], -1)
for n in ("yo", "r10o", "gap1"):
    a = np.load(os.path.join(ALL, f"lab_{n}.npy"), mmap_mode="r")
    v = np.full(len(e), np.nan, np.float32); v[found] = np.asarray(a[np.sort(nxt[found])])[np.argsort(np.argsort(nxt[found]))]
    e[n + "_2"] = v
del key, order, ks
# opening van dag t+2 t.o.v. het slot van dag t: (1 + rendement dag t+1 vanaf opening...) is niet nodig; we vergelijken trefkansen

# ── bijsturing ──
t = pads.dataset(ROWS).to_table(columns=["yr", "day", "tid", "raw", "p0", "y"]).to_pandas()
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "region"])
reg = np.zeros(int(meta.tid.max()) + 1, dtype=np.int8); reg[meta.tid.to_numpy()] = meta.region.to_numpy()
t["region"] = reg[t.tid.to_numpy()]
t = t.sort_values(["day", "region", "raw"], ascending=[True, True, False]).reset_index(drop=True)
t["i"] = t.groupby(["day", "region"]).cumcount()
k = t[(t.i < TOP_MIN) | ((t.i < TOP_N) & (t.p0 >= MIN_BASE))]
k = k[np.isfinite(k.y)]
days = np.sort(t.day.unique())
del t


def sums(sub, power=1.0):
    w = sub.p0 ** (power - 1)
    a = pd.DataFrame({"day": sub.day, "sp": sub.p0 * w, "sy": sub.y * w}).groupby("day").sum().sort_index()
    return a.index.to_numpy(), np.concatenate([[0], np.cumsum(a.sp.to_numpy())]), np.concatenate([[0], np.cumsum(a.sy.to_numpy())])


def window_sums(sub, window=120, lag=16, power=1.0):
    ad, csp, csy = sums(sub, power)
    a = np.searchsorted(ad, days - lag - window, side="right"); b = np.searchsorted(ad, days - lag, side="right")
    return csp[b] - csp[a], csy[b] - csy[a]


SPG, SYG = window_sums(k)
MG = np.clip((SYG + 15) / (SPG + 15), 0.5, 2.0)
mg = dict(zip(days, MG))
per = {}
for g in range(4):
    per[g] = window_sums(k[k.region == g])
per_top = {g: window_sums(k[(k.region == g)], power=2.0) for g in range(4)}
print("verwachte treffers in het venster, gemiddeld: alles %.0f | " % SPG.mean() + " ".join(f"{RN[g]} {per[g][0].mean():.0f}" for g in range(4)))


def region_mult(K, source=per):
    """m_r = (treffers_r + K × m_alles) / (verwacht_r + K): hoe groter K, hoe meer het gezamenlijke getal telt."""
    out = {}
    for g in range(4):
        sp, sy = source[g]
        out[g] = dict(zip(days, np.clip((sy + K * MG) / (sp + K), 0.5, 2.0)))
    return out


def final(p0, m):
    o = p0 / (1 - p0) * m; p = o / (1 + o)
    return np.where(p > 0.15, 0.15 + 0.75 * (p - 0.15), p) * 100


def with_mult(rm):
    m = np.ones(len(e))
    for g in range(4):
        s = (e.region == g).to_numpy(); m[s] = e.day[s].map(rm[g]).to_numpy()
    return final(e.p0.to_numpy(np.float64), m)


e["p_glob"] = final(e.p0.to_numpy(np.float64), e.day.map(mg).to_numpy())
for K in (15, 40, 100, 300):
    e[f"p_reg{K}"] = with_mult(region_mult(K))
e["p_regtop40"] = with_mult(region_mult(40, per_top))
DEV = e.yr <= 2024; CHK = e.yr >= 2025
weeks = lambda d: max(1e-9, (d.day.max() - d.day.min() + 1) / 7)
W = {"dev": weeks(e[DEV]), "chk": weeks(e[CHK])}


def desc(g, wk=None):
    g = g[np.isfinite(g.yo) & np.isfinite(g.r10o) & np.isfinite(g.y)]
    if not len(g): return "—"
    s = f"n={len(g):4d}" + (f" ({len(g) / wk:.2f}/wk)" if wk else "")
    return (s + f" raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%)"
            f" | plus {100 * (g.r10o > 0).mean():3.0f}% | −30% {100 * (g.r10o <= -0.3).mean():3.0f}%")


def alerts(d, col, floor, per_week=3, realert_days=10, realert_gain=5.0, min_dv=100_000, want_blocked=False):
    c = d[(d[col] >= floor) & (d.dv >= min_dv)].sort_values(["day", col], ascending=[True, False])
    out, blocked, sent, last = [], [], [], {}
    for i, day, tid, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy()):
        while sent and sent[0] <= day - 7: sent.pop(0)
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        if len(sent) >= per_week:
            blocked.append(i); continue
        sent.append(day); last[tid] = (day, p); out.append(i)
    return (d.loc[out], d.loc[blocked]) if want_blocked else d.loc[out]


print("\n== 1. Bijsturing: één getal of per regio (meldingen met omzet ≥ $100k, hoogstens 3 per week) ==")
names = [("één getal (nu)", "p_glob"), ("per regio, K=15", "p_reg15"), ("per regio, K=40", "p_reg40"), ("per regio, K=100", "p_reg100"),
         ("per regio, K=300", "p_reg300"), ("per regio op de bovenkant gewogen, K=40", "p_regtop40")]
for floor in (15.0, 20.0, 25.0):
    print(f"-- lat {floor:.0f}% --")
    for nm, col in names:
        print(f"[{nm}] 2020–2024 {desc(alerts(e[DEV], col, floor), W['dev'])}")
        print(f"{'':>8}2025–2026 {desc(alerts(e[CHK], col, floor), W['chk'])}")
print("-- klopt de kans bovenin per regio? (kandidaten ≥ 15%, alle omzet) --")
for nm, col in (("één getal (nu)", "p_glob"), ("per regio, K=40", "p_reg40"), ("per regio, K=15", "p_reg15")):
    for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
        parts = []
        for r in range(4):
            g = e[m & (e[col] >= 15) & (e.region == r) & np.isfinite(e.y)]
            parts.append(f"{RN[r]} n={len(g)} {g[col].mean():.1f}→{100 * g.y.mean():.1f}" if len(g) else f"{RN[r]} —")
        g = e[m & (e[col] >= 15) & np.isfinite(e.y)]
        print(f"  [{nm}] {lab_}: alles n={len(g)} {g[col].mean():.1f}→{100 * g.y.mean():.1f} | " + " | ".join(parts))
print("-- gemiddelde bijsturing per regio (K=40) per jaar --")
rm = region_mult(40)
dy = pd.Series(days).astype("int64").to_numpy().astype("datetime64[D]").astype("datetime64[Y]").astype(int) + 1970
for Y in range(2020, 2027):
    s = dy == Y
    print(f"  {Y}: alles ×{MG[s].mean():.2f} | " + " ".join(f"{RN[g]} ×{np.mean([rm[g][d] for d in days[s]]):.2f}" for g in range(4)))

print("\n== 2. Het weekplafond (lat 20%, omzet ≥ $100k) ==")
for lab_, m, wk in (("2020–2024", DEV, W["dev"]), ("2025–2026", CHK, W["chk"])):
    a, b = alerts(e[m], "p_glob", 20.0, want_blocked=True)
    print(f"{lab_}: verstuurd {desc(a, wk)}")
    print(f"{'':>10}tegengehouden door het plafond {desc(b, wk)}")
    wk_id = (a.day // 7); full = (wk_id.value_counts() >= 3).sum()
    print(f"{'':>10}kalenderweken met een melding: {wk_id.nunique()}, waarvan met drie of meer: {full}")
    for cap in (1, 2, 3, 5, 99):
        print(f"{'':>10}plafond {cap:2d} per week: {desc(alerts(e[m], 'p_glob', 20.0, per_week=cap), wk)}")

print("\n== 3. Azië-Pacific: een dag later instappen (kandidaten ≥ 15%, omzet ≥ $100k) ==")
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    for r in range(4):
        g = e[m & (e.p_glob >= 15) & (e.dv >= 100_000) & (e.region == r) & np.isfinite(e.yo) & np.isfinite(e.yo_2) & np.isfinite(e.r10o) & np.isfinite(e.r10o_2)]
        if len(g) < 20: continue
        print(f"  {lab_} {RN[r]:13s} n={len(g):5d} | instap opening dag 1: raak {100 * g.yo.mean():4.1f}%, houden {100 * g.r10o.mean():+5.1f}% (mediaan {100 * g.r10o.median():+5.1f}%)"
              f" | opening dag 2: raak {100 * g.yo_2.mean():4.1f}%, houden {100 * g.r10o_2.mean():+5.1f}% (mediaan {100 * g.r10o_2.median():+5.1f}%)")
a_all = alerts(e, "p_glob", 20.0)
print("  aandeel per regio in de meldingen (lat 20%, 2020–2026):", " ".join(f"{RN[r]} {100 * (a_all.region == r).mean():.0f}%" for r in range(4)), f"(n={len(a_all)})")
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    a = alerts(e[m], "p_glob", 20.0)
    print(f"  {lab_} meldingen per regio: " + " | ".join(f"{RN[r]} n={int((a.region == r).sum())} raak slot {100 * a[a.region == r].y.mean():.0f}% opening {100 * a[a.region == r].yo.mean():.0f}%" for r in range(4) if (a.region == r).any()))

print("\n== 4. Kans op een groot verlies (≥ 30% lager na 10 handelsdagen, vanaf de opening) ==")
print("-- klopt die kans? alle kandidaatrijen --")
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    g = e[m & np.isfinite(e.loss) & np.isfinite(e.p_loss)]
    parts = []
    for a_, b_ in ((0, 2), (2, 5), (5, 10), (10, 20), (20, 40), (40, 101)):
        s = g[(g.p_loss >= a_) & (g.p_loss < b_)]
        if len(s): parts.append(f"{a_}-{b_}%: {s.p_loss.mean():.1f}→{100 * s.loss.mean():.1f} ({len(s)})")
    print(f"  {lab_}: " + "  ".join(parts))
print("-- binnen de kandidaten ≥ 15% met omzet ≥ $100k, in drie gelijke groepen naar die kans --")
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    g = e[m & (e.p_glob >= 15) & (e.dv >= 100_000) & np.isfinite(e.p_loss)]
    q = g.p_loss.quantile([1 / 3, 2 / 3]).to_numpy()
    for nm, s in (("laagste derde", g[g.p_loss <= q[0]]), ("middelste derde", g[(g.p_loss > q[0]) & (g.p_loss <= q[1])]), ("hoogste derde", g[g.p_loss > q[1]])):
        print(f"  {lab_} {nm:15s} (kans op verlies gem. {s.p_loss.mean():4.1f}%): {desc(s)}")
print("-- vaste grenzen (gekozen vóór het kijken): kans op verlies < 10%, 10–20%, ≥ 20% --")
for lab_, m in (("2020–2024", DEV), ("2025–2026", CHK)):
    g = e[m & (e.p_glob >= 15) & (e.dv >= 100_000) & np.isfinite(e.p_loss)]
    for nm, s in (("< 10%", g[g.p_loss < 10]), ("10–20%", g[(g.p_loss >= 10) & (g.p_loss < 20)]), ("≥ 20%", g[g.p_loss >= 20])):
        print(f"  {lab_} {nm:7s}: {desc(s)}")

print("\n== 5. De lat (omzet ≥ $100k, hoogstens 3 per week, bijsturing zoals nu) ==")
for floor in (15, 18, 20, 22, 24, 26, 28, 30):
    print(f"lat {floor}%: 2020–2024 {desc(alerts(e[DEV], 'p_glob', float(floor)), W['dev'])}")
    print(f"{'':>9}2025–2026 {desc(alerts(e[CHK], 'p_glob', float(floor)), W['chk'])}")
e.to_parquet(os.path.join(RED, "eval_rows2.parquet"))
