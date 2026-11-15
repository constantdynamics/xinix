"""Zeggen de feiten die Claude uit de SEC-stukken haalt iets over treffers en grote verliezers?

  python3 tekst_test.py <ssdata> [modellen in volgorde van voorkeur, standaard "sonnet,opus,haiku"]
  (na tekst_batch.py haal; leest sec/cand_sec.parquet, sec/tekst_docs.parquet, sec/tekst_cand.parquet, sec/claude/uit_*.jsonl
   en, als kas_test.py gedraaid is, sec/cand_kas.parquet)

Alleen Amerikaanse aandelen. Keuzes op 2020–2024, 2025–2026 als controle. De lijst van feiten (N1–N12, P1–P7) lag vast
voordat er één uitkomst was: rapport 14.13. Lat: in beide perioden dezelfde kant op, minstens 5 punten verschil, minstens
100 kandidaat-dagen met het feit in elke periode (vlaggen.py).

1. Wat Claude vond: soorten nieuws, rollen van prospectussen.
2. De feiten, met en zonder: op alle kandidaat-dagen en op de dagen met een dagbeweging tot 30%.
3. Hetzelfde met alleen wat op het slot van de dag al bekend was (in plaats van vóór de melding van de volgende ochtend).
4. Samen: voegt een klein model op deze feiten iets toe aan de kans, steeds geleerd op de jaren vóór het testjaar?
5. Als regel op de meldingen (alleen de VS), voor de feiten die aan de lat voldoen.
"""
import os, sys, json, glob
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
from sklearn.linear_model import LogisticRegression
sys.path.insert(0, os.path.dirname(__file__))
import vlaggen

ROOT = sys.argv[1]
PREF = (sys.argv[2] if len(sys.argv) > 2 else "sonnet,opus,haiku").split(",")
D = os.path.join(ROOT, "sec"); CL = os.path.join(D, "claude")
POS = {"clinical_or_regulatory", "contract_or_partnership", "product_or_technology", "earnings_or_guidance", "company_acquires_business"}
EQUITY = {"underwritten_public_offering", "registered_direct", "private_placement", "at_the_market_program", "equity_line", "warrant_exercise_or_inducement", "rights_offering", "preferred_stock"}

# ── uitkomsten van Claude per stuk ───────────────────────────────────────────
res = {}
for p in sorted(glob.glob(os.path.join(CL, "uit_*.jsonl"))):
    m = os.path.basename(p).split("_")[1]
    for line in open(p):
        if not line.strip(): continue
        x = json.loads(line)
        if not x.get("ok") or x.get("stop") != "end_turn": continue
        try: res.setdefault(x["id"], {})[m] = json.loads(x["text"])
        except Exception: pass
pick = {d: next((v[m] for m in PREF if m in v), None) for d, v in res.items()}
docs = pd.read_parquet(os.path.join(D, "tekst_docs.parquet"))
docs["id"] = docs.cik.astype(str) + "_" + docs.acc
docs["gelezen"] = docs.id.map(lambda d: pick.get(d) is not None)
print(f"stukken {len(docs)}, gelezen {int(docs.gelezen.sum())} ({100 * docs.gelezen.mean():.1f}%) | per model: " +
      ", ".join(f"{m} {sum(1 for v in res.values() if m in v)}" for m in PREF))


def num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else np.nan


def feit(row):
    """Feiten per stuk, uit het antwoord van Claude."""
    v = pick.get(row.id)
    if v is None: return None
    f = v.get("financing") or {}
    o = {"soort": row.soort, "fin": bool(f), "structure": f.get("structure"), "stage": f.get("stage"),
         "priced": f.get("stage") in ("priced_or_signed", "closed"), "equity": f.get("structure") in EQUITY,
         "warrants": num(f.get("warrant_shares")) > 0, "floating": bool(f.get("floating_price")),
         "price": num(f.get("price_per_share_usd")), "wprice": num(f.get("warrant_exercise_price_usd")), "shares": num(f.get("shares")),
         "gross": num(f.get("gross_proceeds_usd")), "crypto": bool(f.get("proceeds_for_digital_assets"))}
    if row.soort == "nieuws":
        ev = v.get("events") or []
        kinds = {e["kind"] for e in ev}
        o.update(first=ev[0]["kind"] if ev else None, kinds=kinds,
                 hard_pos=any(e["kind"] in POS and e["hardness"] == "completed_or_binding" and e["tone"] == "positive" for e in ev),
                 soft_pos=any(e["kind"] in POS and e["hardness"] == "planned_or_nonbinding" and e["tone"] == "positive" for e in ev),
                 equity_news=("equity_financing" in kinds) or o["equity"],
                 pivot=bool(kinds & {"strategy_pivot", "digital_asset_treasury"}),
                 target=("company_is_being_acquired" in kinds) or np.isfinite(num(v.get("takeover_cash_price_usd"))),
                 listing=bool(kinds & {"listing_deficiency", "reverse_split"}) or np.isfinite(num(v.get("reverse_split_ratio"))),
                 negative=any(e["tone"] == "negative" for e in ev) or bool(v.get("going_concern_or_default")) or bool(kinds & {"distress_or_default"}))
    else:
        role = v.get("role")
        o.update(role=role, priced=o["priced"] or role == "priced_offering", atm=role in ("at_the_market_program", "equity_line") or f.get("structure") in ("at_the_market_program", "equity_line"),
                 resale=role == "resale_by_holders", baby=bool(v.get("baby_shelf_limited")), going=bool(v.get("going_concern")),
                 before=num(v.get("shares_outstanding_before")), resale_shares=num(v.get("resale_shares")))
    return o


F = {r.id: feit(r) for r in docs.itertuples()}
nw = [f for f in F.values() if f and f["soort"] == "nieuws"]; gd = [f for f in F.values() if f and f["soort"] != "nieuws"]
print("\n== 1. Wat Claude vond ==")
print("nieuws, belangrijkste gebeurtenis:", pd.Series([f["first"] for f in nw]).value_counts().to_dict())
print(f"nieuws: hard positief {sum(f['hard_pos'] for f in nw)}, zacht positief {sum(f['soft_pos'] and not f['hard_pos'] for f in nw)}, uitgifte {sum(f['equity_news'] for f in nw)}, "
      f"geprijsd {sum(f['priced'] for f in nw)}, met warrants {sum(f['warrants'] for f in nw)}, zwevende prijs {sum(f['floating'] for f in nw)}, nieuwe koers {sum(f['pivot'] for f in nw)}, "
      f"bod op het bedrijf {sum(f['target'] for f in nw)}, notering {sum(f['listing'] for f in nw)}, negatief {sum(f['negative'] for f in nw)}")
print("prospectus en registratie, rol:", pd.Series([f["role"] for f in gd]).value_counts().to_dict())
print(f"prospectus en registratie: geprijsd {sum(f['priced'] for f in gd)}, verkoopprogramma {sum(f['atm'] for f in gd)}, doorverkoop {sum(f['resale'] for f in gd)}, "
      f"kleine-bedrijvenregel {sum(f['baby'] for f in gd)}, twijfel over voortbestaan {sum(f['going'] for f in gd)}, zwevende prijs {sum(f['floating'] for f in gd)}")

# ── kandidaat-dagen ─────────────────────────────────────────────────────────
C = pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["idx", "day", "tid", "cik", "y", "yo", "r10o", "p_glob", "yr", "vw", "px", "dv"])
C = C[np.isfinite(C.r10o) & np.isfinite(C.yo) & np.isfinite(C.y)].reset_index(drop=True)
kp = os.path.join(D, "cand_kas.parquet")
if os.path.exists(kp): C = C.merge(pd.read_parquet(kp, columns=["idx", "sh_now"]), on="idx", how="left")
else: C["sh_now"] = np.nan
P = pd.read_parquet(os.path.join(D, "tekst_cand.parquet")).merge(docs[["cik", "acc", "id", "soort", "k_slot", "k_melding"]], on=["cik", "acc"])
P = P.merge(C[["idx", "day"]], on="idx")
P["oud_slot"] = P.day - P.k_slot                 # negatief = op het slot nog niet bekend


def bouw(P, kolom):
    """Feiten per kandidaat-dag; `kolom` = leeftijd van het stuk (dagen_oud of oud_slot). Onbekend (NaN) als een gekozen stuk niet gelezen is."""
    Pk = P[P[kolom] >= 0]
    by = {i: g for i, g in Pk.groupby("idx")}
    rows = []
    for r in C.itertuples():
        g = by.get(r.idx)
        o = {"idx": r.idx}
        if g is None:
            o.update({k: False for k in ("N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "P1", "P2", "P3", "P4", "P5", "P6", "P7")}, N12=True)
            rows.append(o); continue
        fs = [(F.get(i), a, s) for i, a, s in zip(g.id, g[kolom], g.soort)]
        if any(f is None for f, _, _ in fs):
            o.update({k: np.nan for k in ("N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "P1", "P2", "P3", "P4", "P5", "P6", "P7")})
            o.update(N1=any(s == "nieuws" and a <= 2 for _, a, s in fs), N12=False); rows.append(o); continue
        n2 = [f for f, a, s in fs if s == "nieuws" and a <= 2]; n7 = [f for f, a, s in fs if s == "nieuws" and a <= 7]
        g90 = [f for f, a, s in fs if s != "nieuws"]; g30 = [f for f, a, s in fs if s != "nieuws" and a <= 30]
        deals = [f for f in n7 + g90 if f["fin"]]
        before = next((f["before"] for f in g90 if np.isfinite(f.get("before", np.nan))), r.sh_now)
        big = [f["shares"] / before for f in deals if np.isfinite(f["shares"]) and before and np.isfinite(before) and before > 0]
        ref = [min(x for x in (f["price"], f["wprice"]) if np.isfinite(x)) for f in deals if f["priced"] and (np.isfinite(f["price"]) or np.isfinite(f["wprice"]))]
        hard = any(f["hard_pos"] for f in n2)
        o.update(N1=bool(n2), N2=hard, N3=(not hard) and any(f["soft_pos"] for f in n2), N4=any(f["equity_news"] for f in n7), N5=any(f["priced"] and f["equity_news"] for f in n2),
                 N6=any(f["warrants"] for f in n7), N7=any(f["floating"] for f in n7 + g90), N8=any(f["pivot"] for f in n7), N9=any(f["target"] for f in n7),
                 N10=any(f["listing"] for f in n7), N11=any(f["negative"] for f in n7), N12=False,
                 P1=any(f["priced"] for f in g30), P2=any(f["atm"] for f in g90), P3=any(f["resale"] for f in g90),
                 P4=(max(big) >= 0.2) if big else (False if deals else False), P5=(r.px >= 1.2 * min(ref)) if ref else False,
                 P6=any(f["baby"] for f in g90), P7=any(f["going"] for f in g90))
        rows.append(o)
    return pd.DataFrame(rows).set_index("idx")


NAMEN = {"N1": "N1 bedrijfsnieuws in 2 dagen", "N2": "N2 hard positief nieuws in 2 dagen", "N3": "N3 zacht positief nieuws in 2 dagen", "N4": "N4 uitgifte van aandelen in 7 dagen",
         "N5": "N5 uitgifte geprijsd of gesloten in 2 dagen", "N6": "N6 uitgifte met warrants in 7 dagen", "N7": "N7 prijs die meebeweegt met de koers",
         "N8": "N8 nieuwe koers of cryptostrategie in 7 dagen", "N9": "N9 bod op het bedrijf in 7 dagen", "N10": "N10 noteringsprobleem of omgekeerde split",
         "N11": "N11 negatief nieuws in 7 dagen", "N12": "N12 geen enkel stuk", "P1": "P1 geprijsde uitgifte in 30 dagen", "P2": "P2 verkoopprogramma of kredietlijn in 90 dagen",
         "P3": "P3 houders mogen verkopen (registratie, 90 dagen)", "P4": "P4 uitgifte ≥ 20% van de uitstaande aandelen", "P5": "P5 koers ≥ 20% boven uitgifte- of warrantprijs",
         "P6": "P6 kleine-bedrijvenregel (een derde per jaar)", "P7": "P7 twijfel over voortbestaan in het prospectus"}
DEV = C.yr <= 2024; CHK = C.yr >= 2025
PERIODS = (("2020–2024", DEV), ("2025–2026", CHK))
Ci = C.set_index("idx")
PERI = (("2020–2024", Ci.yr <= 2024), ("2025–2026", Ci.yr >= 2025))
W = bouw(P, "dagen_oud")
print(f"\nkandidaat-dagen {len(C)}; met een stuk dat niet gelezen is: {int(W.N2.isna().sum())}")
print("\n== 2a. De feiten op alle kandidaat-dagen (stukken bekend vóór de melding van de volgende ochtend) ==")
vlaggen.tabel(Ci, {NAMEN[k]: W[k].astype(object) for k in NAMEN}, PERI)
print("\n== 2b. Alleen dagbeweging tot 30% (wat een melding kan krijgen) ==")
E = Ci[Ci.vw <= 0.30]
rows = vlaggen.tabel(E, {NAMEN[k]: W[k].reindex(E.index).astype(object) for k in NAMEN}, PERI)
ok = []
for r, k in zip(rows, NAMEN):
    if all(lab in r for lab, _ in PERI):
        a, b = r["2020–2024"], r["2025–2026"]
        if min(a["n"], b["n"]) >= vlaggen.MIN_N and any(a[x] * b[x] > 0 and min(abs(a[x]), abs(b[x])) >= vlaggen.MIN_VERSCHIL for x in ("slot", "open", "verlies")): ok.append(k)

print("\n== 3. Alleen wat op het slot van de dag al bekend was ==")
Ws = bouw(P, "oud_slot")
vlaggen.tabel(E, {NAMEN[k]: Ws[k].reindex(E.index).astype(object) for k in NAMEN}, PERI)

print("\n== 4. Samen: een klein model op de feiten naast de kans (geleerd op de jaren vóór het testjaar) ==")
X = W[[k for k in NAMEN]].astype(float)
full = X.notna().all(axis=1)
lg = lambda p: np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
for target, tn in (("y", "treffers vanaf het slot"), ("yo", "treffers vanaf de opening"), ("bigloss", "grote verliezers")):
    yv = (Ci.r10o <= -0.3).astype(int) if target == "bigloss" else Ci[target].astype(int)
    out, tot = [], {"dev": [[], [], []], "chk": [[], [], []]}
    for Y in range(2021, 2027):
        tr = full & (Ci.yr < Y); te = full & (Ci.yr == Y)
        if te.sum() < 50 or yv[te].nunique() < 2 or yv[tr].nunique() < 2: continue
        A = np.c_[lg(Ci.p_glob[tr].to_numpy() / 100), Ci.vw[tr].to_numpy(), X[tr].to_numpy()]; B = np.c_[lg(Ci.p_glob[te].to_numpy() / 100), Ci.vw[te].to_numpy(), X[te].to_numpy()]
        base = LogisticRegression(C=0.3, max_iter=1000).fit(A[:, :2], yv[tr]); m = LogisticRegression(C=0.3, max_iter=1000).fit(A, yv[tr])
        s0, s1 = base.predict_proba(B[:, :2])[:, 1], m.predict_proba(B)[:, 1]
        out.append(f"{Y}: {roc_auc_score(yv[te], s0):.3f}→{roc_auc_score(yv[te], s1):.3f}")
        b = tot["dev" if Y <= 2024 else "chk"]; b[0].append(yv[te].to_numpy()); b[1].append(s0); b[2].append(s1)
    summ = []
    for lab in ("dev", "chk"):
        if tot[lab][0]:
            a, s0, s1 = (np.concatenate(x) for x in tot[lab])
            summ.append(f"{'2021–2024' if lab == 'dev' else '2025–2026'}: {roc_auc_score(a, s0):.3f}→{roc_auc_score(a, s1):.3f}")
    print(f"  [{tn}] kans en beweeglijkheid → met de feiten erbij: " + " | ".join(summ) + "\n      " + " ".join(out))

print("\n== 5. Als regel op de meldingen (alleen de VS, dagbeweging tot 30%) ==")


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


print("feiten die aan de lat voldoen:", [NAMEN[k] for k in ok] or "geen")
for floor in (26.0, 20.0, 15.0):
    for lab, m in PERI:
        a = alerts(E[m.reindex(E.index)], floor)
        print(f"lat {floor:.0f}% {lab}: alle meldingen {desc(a)}")
        for k in ok:
            f = W[k].reindex(a.index)
            print(f"      met    {NAMEN[k]:50s} {desc(a[f == True])}\n      zonder {NAMEN[k]:50s} {desc(a[f == False])}")      # noqa: E712
W.join(Ci[["day", "tid", "cik", "yr", "p_glob", "vw", "y", "yo", "r10o"]]).to_parquet(os.path.join(D, "cand_tekst.parquet"))
