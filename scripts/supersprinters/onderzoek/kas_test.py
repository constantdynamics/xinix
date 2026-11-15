"""Kas en verwatering: zeggen de kasvoorraad en de groei van het aantal aandelen iets over treffers en grote verliezers?

  python3 kas_test.py <ssdata>      (na kas_haal.py; leest sec/cand_sec.parquet van sec_test.py)

Alleen Amerikaanse aandelen, zonder Claude: de cijfers komen uit de jaar- en kwartaalverslagen (XBRL). Per kandidaat-dag
telt alleen een verslag dat toen al was ingediend. Keuzes op 2020–2024, 2025–2026 als controle.

  kas          kasgeld volgens het laatste verslag (hoogstens 200 dagen oud; bij een jaarverslag 460)
  kasstroom    kasstroom uit de bedrijfsvoering over de laatste gemelde periode, omgerekend naar een maand
  maanden kas  kas gedeeld door wat er per maand uitgaat (oneindig bij een positieve kasstroom)
  aandelen     aantal uitstaande aandelen volgens het laatste verslag, vergeleken met ±12 maanden eerder. Een omgekeerde
               split verlaagt het aantal en verbergt verwatering; die groei is dus een ondergrens.

Feiten K1–K5 van de vooraf vastgelegde lijst (rapport 14.13), plus kas ten opzichte van de beurswaarde.
"""
import os, sys, json, glob
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import vlaggen

ROOT = sys.argv[1]
D = os.path.join(ROOT, "sec"); EPOCH = pd.Timestamp("1970-01-01")
CASH = ["us-gaap/CashAndCashEquivalentsAtCarryingValue", "us-gaap/CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "ifrs-full/CashAndCashEquivalents"]
OCF = ["us-gaap/NetCashProvidedByUsedInOperatingActivities", "ifrs-full/CashFlowsFromUsedInOperatingActivities"]
SHARES = ["dei/EntityCommonStockSharesOutstanding", "us-gaap/CommonStockSharesOutstanding"]
day = lambda s: (pd.Timestamp(s) - EPOCH).days

facts = {}
for p in sorted(glob.glob(os.path.join(D, "kas", "part_*.json"))):
    for cik, v in json.load(open(p)).items():
        facts[int(cik)] = v
print("bedrijven met een antwoord:", len(facts))


def series(v, concepts):
    """→ (rijen [start, end, val, filed] in dagen, eenheid) van het eerste begrip dat waarden heeft; de eenheid met de meeste rijen."""
    for c in concepts:
        u = v.get(c)
        if not isinstance(u, dict) or "error" in u or not u: continue
        unit, rows = max(u.items(), key=lambda kv: len(kv[1]))
        if not rows: continue
        out = [(day(r[0]) if r[0] else -1, day(r[1]), float(r[2]), day(r[6]), r[5]) for r in rows if r[1] and r[6] and r[2] is not None]
        if out: return out, unit
    return [], None


def latest(rows, d, max_age):
    """De waarde met de laatste einddatum onder de verslagen die op dag d al waren ingediend."""
    best = None
    for r in rows:
        if r[3] <= d and d - r[1] <= max_age and (best is None or r[1] > best[1] or (r[1] == best[1] and r[3] > best[3])): best = r
    return best


C = pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["idx", "day", "tid", "cik", "y", "yo", "r10o", "p_glob", "yr", "vw", "px", "dv"])
C = C[np.isfinite(C.r10o) & np.isfinite(C.yo) & np.isfinite(C.y)].reset_index(drop=True)
out = {k: np.full(len(C), np.nan) for k in ("cash", "burn_m", "runway", "sh", "sh_growth", "sh_now")}
unit_cash = np.empty(len(C), object)
for cik, g in C.groupby("cik"):
    v = facts.get(int(cik))
    if not v: continue
    cash, cu = series(v, CASH); ocf, ou = series(v, OCF); sh, _ = series(v, SHARES)
    for i, d in zip(g.index.to_numpy(), g.day.to_numpy()):
        c = latest(cash, d, 460)
        o = latest([r for r in ocf if r[0] >= 0 and r[1] - r[0] >= 60], d, 460)
        if c is not None:
            out["cash"][i] = c[2]; unit_cash[i] = cu
            if o is not None and cu == ou:
                months = (o[1] - o[0]) / 30.44
                out["burn_m"][i] = -o[2] / months
                out["runway"][i] = np.inf if o[2] >= 0 else c[2] / (-o[2] / months)
        s = latest(sh, d, 460)
        if s is not None and s[2] > 0:
            out["sh_now"][i] = s[2]
            prev = [r for r in sh if r[3] <= d and 270 <= s[1] - r[1] <= 500 and r[2] > 0]
            if prev:
                pr = max(prev, key=lambda r: r[1])
                out["sh_growth"][i] = s[2] / pr[2] - 1
for k, a in out.items(): C[k] = a
C["usd"] = unit_cash == "USD"
C["mcap"] = C.sh_now * C.px
C["cash_mcap"] = np.where(C.usd & (C.mcap > 0), C.cash / C.mcap, np.nan)
known = lambda col: np.isfinite(C[col]) | np.isinf(C[col])
print(f"kandidaat-dagen {len(C)} | met kas en kasstroom {int(known('runway').sum())} ({100 * known('runway').mean():.0f}%) | met groei van het aantal aandelen {int(np.isfinite(C.sh_growth).sum())} ({100 * np.isfinite(C.sh_growth).mean():.0f}%)")
print("maanden kas (kandidaat-dagen met een negatieve kasstroom): kwartielen", np.round(C.runway[np.isfinite(C.runway)].quantile([.1, .25, .5, .75, .9]).to_numpy(), 1),
      "| positieve kasstroom:", f"{100 * np.isinf(C.runway).sum() / max(1, known('runway').sum()):.0f}%")
print("groei van het aantal aandelen in ±12 maanden: kwartielen", np.round(C.sh_growth.dropna().quantile([.1, .25, .5, .75, .9]).to_numpy(), 2))


def flag(cond, known_mask):
    return pd.Series(np.where(known_mask, cond, np.nan), index=C.index).astype(object).where(known_mask, np.nan)


kr = known("runway").to_numpy(); kg = np.isfinite(C.sh_growth).to_numpy(); km = np.isfinite(C.cash_mcap).to_numpy()
FLAGS = {
    "K1 kas voor minder dan 6 maanden": flag((C.runway < 6).to_numpy(), kr),
    "K2 kas voor minder dan 12 maanden": flag((C.runway < 12).to_numpy(), kr),
    "   kas voor minder dan 3 maanden": flag((C.runway < 3).to_numpy(), kr),
    "K3 positieve kasstroom uit de bedrijfsvoering": flag(np.isinf(C.runway).to_numpy(), kr),
    "K4 aantal aandelen in 12 maanden meer dan +50%": flag((C.sh_growth > 0.5).to_numpy(), kg),
    "K5 aantal aandelen in 12 maanden meer dan +200%": flag((C.sh_growth > 2.0).to_numpy(), kg),
    "   aantal aandelen gedaald (omgekeerde split of inkoop)": flag((C.sh_growth < -0.2).to_numpy(), kg),
    "   kas groter dan de helft van de beurswaarde": flag((C.cash_mcap > 0.5).to_numpy(), km),
    "   kas kleiner dan 5% van de beurswaarde": flag((C.cash_mcap < 0.05).to_numpy(), km),
    "   geen cijfers gevonden (kas of kasstroom)": pd.Series(~kr, index=C.index).astype(object),
}
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))
print("\n== 1. Alle kandidaat-dagen (kans ≥ 15%, omzet ≥ $100k) ==")
vlaggen.tabel(C, FLAGS, PERIODS)
print("\n== 2. Alleen dagbeweging tot 30% (wat een melding kan krijgen) ==")
E = C[C.vw <= 0.30]
rows = vlaggen.tabel(E, {k: v.reindex(E.index) for k, v in FLAGS.items()}, PERIODS)

print("\n== 3. Maanden kas in vier groepen (dagbeweging tot 30%) ==")
for lab, m in PERIODS:
    g = E[m.reindex(E.index)]
    for nm, sel in (("< 3 maanden", g.runway < 3), ("3–6 maanden", (g.runway >= 3) & (g.runway < 6)), ("6–12 maanden", (g.runway >= 6) & (g.runway < 12)),
                    ("12+ maanden", (g.runway >= 12) & np.isfinite(g.runway)), ("positieve kasstroom", np.isinf(g.runway)), ("onbekend", g.runway.isna())):
        s = g[sel]
        if len(s) >= 20: print(f"  {lab} {nm:20s} n={len(s):5d} voorspeld {s.p_glob.mean():4.1f}% | raak slot {100 * s.y.mean():4.1f}% opening {100 * s.yo.mean():4.1f}% | −30% {100 * (s.r10o <= -.3).mean():4.1f}% | houden {100 * s.r10o.mean():+5.1f}%")

print("\n== 4. Per jaar: kas voor minder dan 6 maanden tegenover de rest (dagbeweging tot 30%) ==")
for Y in range(2020, 2027):
    g = E[(E.yr == Y) & (np.isfinite(E.runway) | np.isinf(E.runway))]
    a, b = g[g.runway < 6], g[g.runway >= 6]
    if len(a) >= 20 and len(b) >= 20:
        print(f"  {Y}: n {len(a)}/{len(b)} | raak opening {100 * a.yo.mean():4.1f}/{100 * b.yo.mean():4.1f}% | −30% {100 * (a.r10o <= -.3).mean():4.1f}/{100 * (b.r10o <= -.3).mean():4.1f}%")

print("\n== 5. Als regel op de meldingen (alleen de VS; elk aandeel één keer per 10 dagen tenzij 5 punten hoger) ==")


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    keep, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); keep.append(i)
    return d.loc[keep]


def desc(g):
    return f"n={len(g):4d} raak slot {100 * g.y.mean():4.1f}% opening {100 * g.yo.mean():4.1f}% | −30% {100 * (g.r10o <= -.3).mean():4.1f}% | houden {100 * g.r10o.mean():+5.1f}%" if len(g) >= 5 else f"n={len(g)}"


for floor in (26.0, 20.0):
    for lab, m in PERIODS:
        a = alerts(E[m.reindex(E.index)], floor)
        print(f"lat {floor:.0f}% {lab}: alle {desc(a)}")
        for nm, sel in (("kas < 6 maanden", a.runway < 6), ("kas ≥ 6 maanden of positief", a.runway >= 6), ("aandelen > +50%", a.sh_growth > .5), ("aandelen ≤ +50%", a.sh_growth <= .5)):
            print(f"      {nm:30s} {desc(a[sel])}")
C.to_parquet(os.path.join(D, "cand_kas.parquet"))
