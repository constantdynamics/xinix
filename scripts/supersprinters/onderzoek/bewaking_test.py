"""Bewaking na een melding: wat gebeurt er als het bedrijf ná de melding een uitgifte aankondigt?

  python3 bewaking_test.py <ssdata>      (na sec_test.py en tekst_lijst.py; zonder Claude, zonder kosten)

De proef van rapport 14.13–14.16 keek naar stukken van vóór de melding. Dit kijkt naar de tien handelsdagen erna.
Opzet, vastgelegd voordat er een uitkomst was:

  Meldingen   nagespeeld in de VS, dagbeweging tot 30%, lat 15%, 20% en 26% (zelfde herhaalregel als elders).
              Kopen op de opening van de dag na de voorspeldag (dag 1), aanhouden tot het slot van dag 10.
  Stuk        een stuk dat de SEC ontving ná de kalenderdag van de voorspeldag (wat op die dag binnenkwam was vóór
              de melding van de volgende ochtend bekend en zit in de eerdere proef):
                uitgifteprospectus   424B1, 424B2, 424B4, 424B5 (een verkoop door het bedrijf zelf, of een verkoopprogramma)
                overig prospectus    424B3, 424B7, 424B8 (vaak doorverkoop door houders of een aanvulling)
                registratie          S-1, S-3, F-1, F-3 en wijzigingen daarvan
                onderhandse verkoop  8-K met onderdeel 3.02
  Handelen    op de eerste opening nadat het stuk binnen was: binnengekomen vóór 09:30 uur New York op een handelsdag
              → die opening, anders de opening van de volgende handelsdag.
                dag 1      het stuk was er vóór de aankoop: niet kopen
                dag 2–10   het stuk kwam tijdens het aanhouden: verkopen op die opening
  Meten       dag 1: het resultaat van kopen en aanhouden (opening dag 1 → slot dag 10) met en zonder zo'n stuk.
              dag 2–10: het rendement van de opening na het stuk tot het slot van dag 10 (wat verkopen bespaart of kost),
              naast hetzelfde rendement vanaf dezelfde dag voor alle meldingen (de vergelijking), en hoeveel er op het
              moment van handelen al verloren was (slot van de dag ervoor → die opening).
  Lat         in 2020–2024 en in 2025–2026 dezelfde kant op, minstens 5 punten verschil met de vergelijking, minstens
              100 meldingen met zo'n stuk in elke periode (bij de lat van 15%; bij 20% en 26% zijn het er te weinig).
"""
import os, sys, json, glob, pickle
import numpy as np, pandas as pd

ROOT = sys.argv[1]
D = os.path.join(ROOT, "sec"); ALL = os.path.join(ROOT, "all")
EPOCH = pd.Timestamp("1970-01-01")
KLASSEN = {"uitgifteprospectus": lambda f, it: f in ("424B1", "424B2", "424B4", "424B5"),
           "overig prospectus": lambda f, it: f in ("424B3", "424B7", "424B8"),
           "registratie": lambda f, it: f.split("/")[0] in ("S-1", "S-3", "F-1", "F-3", "S-3ASR", "F-3ASR", "S-1MEF", "S-3MEF"),
           "onderhandse verkoop": lambda f, it: f.startswith("8-K") and "3.02" in (it or "")}

# ── meldingen ────────────────────────────────────────────────────────────────
C = pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["idx", "day", "tid", "ticker", "cik", "y", "yo", "r10o", "p_glob", "yr", "vw"])
C = C[np.isfinite(C.r10o) & np.isfinite(C.yo) & np.isfinite(C.y) & (C.vw <= 0.30)].reset_index(drop=True)


def alerts(d, floor, realert_days=10, realert_gain=5.0):
    c = d[d.p_glob >= floor].sort_values(["day", "p_glob"], ascending=[True, False])
    keep, last = [], {}
    for i, dy, t, p in zip(c.index.to_numpy(), c.day.to_numpy(), c.tid.to_numpy(), c.p_glob.to_numpy()):
        lp = last.get(t)
        if lp is not None and dy - lp[0] < realert_days and not (p >= lp[1] + realert_gain): continue
        last[t] = (dy, p); keep.append(i)
    return d.loc[keep]


# De meldingen bij een hogere lat zijn geen deel van die bij een lagere (de herhaalregel kiest anders), dus de koersen
# en stukken worden voor de vereniging van de drie verzamelingen opgezocht.
SETS = {floor: pd.concat([alerts(C[C.yr <= 2024], floor), alerts(C[C.yr >= 2025], floor)]).index for floor in (15.0, 20.0, 26.0)}
A15 = C.loc[sorted(set().union(*[set(v) for v in SETS.values()]))].copy()
for floor, ix in SETS.items(): print(f"meldingen bij lat {floor:.0f}%: {int((C.yr[ix] <= 2024).sum())} in 2020–2024, {int((C.yr[ix] >= 2025).sum())} in 2025–2026")

# ── koersen van dag 0 t/m dag 10 ─────────────────────────────────────────────
tix = np.load(os.path.join(ALL, "tix.npy"))
meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "ticker", "chunk"]).set_index("tid")
A15["t"] = tix[A15.idx.to_numpy()].astype(np.int64)
A15["chunk"] = meta.chunk.reindex(A15.tid).to_numpy()
days, opens, closes = {}, {}, {}
for ch, g in A15.groupby("chunk"):
    items = dict(pickle.load(open(os.path.join(ROOT, "prep", f"clean_{int(ch):03d}.pkl"), "rb")))
    for r in g.itertuples():
        c = items.get(meta.ticker[r.tid])
        if c is None or r.t + 10 >= len(c["adj"]): continue
        a = c["adj"][r.t:r.t + 11].astype(np.float64); o = c["open"][r.t:r.t + 11].astype(np.float64) * a
        days[r.Index] = c["day"][r.t:r.t + 11].astype(np.int64); opens[r.Index] = o; closes[r.Index] = a
A15 = A15[A15.index.isin(days)]
chk = np.array([closes[i][10] / opens[i][1] - 1 for i in A15.index])
print(f"met koersen: {len(A15)} | controle: opening dag 1 → slot dag 10 wijkt gemiddeld {np.abs(chk - A15.r10o.to_numpy()).mean():.4f} af van r10o")

# ── stukken per bedrijf, met het moment waarop erop gehandeld kan worden ─────
rows = []
for p in sorted(glob.glob(os.path.join(D, "tekst_lijst", "part_*.json"))):
    for cik, v in json.load(open(p)).items():
        if isinstance(v, dict) and "f" in v:
            for f in v["f"]: rows.append((int(cik), f[1], f[2], f[3], f[4]))
F = pd.DataFrame(rows, columns=["cik", "form", "items", "accepted", "acc"]).drop_duplicates(["cik", "acc"])
tny = pd.to_datetime(F.accepted, errors="coerce", utc=True).dt.tz_convert("America/New_York")
F = F[tny.notna()].copy(); tny = tny[tny.notna()]
F["d"] = (tny.dt.tz_localize(None).dt.normalize() - EPOCH).dt.days.astype(np.int64)        # kalenderdag in New York
F["voor_open"] = (tny.dt.hour * 60 + tny.dt.minute) < 570                                   # binnen vóór 09:30
for k, fn in KLASSEN.items(): F[k] = [fn(a, b) for a, b in zip(F.form, F["items"])]
F = F[F[list(KLASSEN)].any(axis=1)]
byc = {c: g.sort_values("d") for c, g in F.groupby("cik")}
print(f"stukken in de vier klassen: {len(F)} bij {len(byc)} bedrijven")

out = {k: [] for k in KLASSEN}
for r in A15.itertuples():
    dd = days[r.Index]; f = byc.get(int(r.cik)) if np.isfinite(r.cik) else None
    res = {k: 0 for k in KLASSEN}                    # 0 = geen stuk in het venster; anders de dag (1–10) waarop gehandeld kan worden
    if f is not None:
        g = f[(f.d > dd[0]) & (f.d <= dd[10])]
        for d, vo, *kl in zip(g.d.to_numpy(), g.voor_open.to_numpy(), *[g[k].to_numpy() for k in KLASSEN]):
            # eerste handelsdag waarvan de opening na ontvangst ligt
            j = int(np.searchsorted(dd, d, side="left" if vo else "right"))
            if j < 1 or j > 10: continue
            for k, hit in zip(KLASSEN, kl):
                if hit and (res[k] == 0 or j < res[k]): res[k] = j
    for k in KLASSEN: out[k].append(res[k])
for k in KLASSEN: A15[k] = out[k]
A15["bl"] = (A15.r10o <= -0.3).astype(int)
O = np.array([opens[i] for i in A15.index]); CL = np.array([closes[i] for i in A15.index])
REST = CL[:, [10]] / O - 1                          # REST[:, j] = opening van dag j → slot van dag 10
GAP = np.full_like(O, np.nan); GAP[:, 1:] = O[:, 1:] / CL[:, :-1] - 1      # slot van dag j−1 → opening van dag j
TOT = CL[:, :-1] / O[:, [1]] - 1                    # TOT[:, j] = opening van dag 1 → slot van dag j (j = 0 is de voorspeldag zelf)
A15["pos"] = np.arange(len(A15))
PER = (("2020–2024", A15.yr <= 2024), ("2025–2026", A15.yr >= 2025))


def blok(A, titel):
    print(f"\n=== {titel} ===")
    for k in KLASSEN:
        print(f"\n-- {k} --")
        for lab, m in PER:
            g = A[m.reindex(A.index)]
            if len(g) < 20: print(f"  {lab}: {len(g)} meldingen (te weinig)"); continue
            e1 = g[g[k] == 1]; e2 = g[g[k] >= 2]; no = g[g[k] == 0]
            print(f"  {lab}: {len(g)} meldingen | geen stuk {len(no)} | stuk vóór de aankoop {len(e1)} ({100 * len(e1) / len(g):.1f}%) | stuk tijdens het aanhouden {len(e2)} ({100 * len(e2) / len(g):.1f}%)")
            f = lambda x: f"n={len(x):4d} raak opening {100 * x.yo.mean():4.1f}% | −30% {100 * x.bl.mean():4.1f}% | houden gemiddeld {100 * x.r10o.mean():+5.1f}% middelste {100 * x.r10o.median():+5.1f}%" if len(x) >= 5 else f"n={len(x)}"
            print(f"     geen stuk:            {f(no)}")
            print(f"     vóór de aankoop:      {f(e1)}" + (f" | opening dag 1 t.o.v. het slot {100 * np.nanmean(GAP[e1.pos.to_numpy(), 1]):+5.1f}%" if len(e1) >= 5 else ""))
            if len(e2) >= 5:
                pos = e2.pos.to_numpy(); j = e2[k].to_numpy()
                rest = REST[pos, j]; gap = GAP[pos, j]; tot = TOT[pos, j - 1]
                # vergelijking: hetzelfde rendement vanaf dezelfde dag, gemiddeld over alle meldingen van de periode
                allpos = g.pos.to_numpy(); base = np.array([np.nanmean(REST[allpos, jj]) for jj in j])
                print(f"     tijdens het aanhouden: {f(e2)}")
                print(f"        tot het slot vóór het stuk {100 * np.nanmean(tot):+5.1f}% | verlies bij de opening erna {100 * np.nanmean(gap):+5.1f}% (middelste {100 * np.nanmedian(gap):+5.1f}%) | "
                      f"van die opening tot het slot van dag 10: gemiddeld {100 * np.nanmean(rest):+5.1f}%, middelste {100 * np.nanmedian(rest):+5.1f}%, lager in {100 * np.mean(rest < 0):.0f}% | vergelijking {100 * base.mean():+5.1f}%")
    # wat levert de regel per melding op? aanhouden tegenover: niet kopen bij een uitgifteprospectus vóór de aankoop, verkopen op de opening erna
    k = "uitgifteprospectus"
    for lab, m in PER:
        g = A[m.reindex(A.index)]
        if len(g) < 20: continue
        pos = g.pos.to_numpy(); j = g[k].to_numpy(); r = g.r10o.to_numpy().copy()
        r2 = r.copy(); sel = j >= 2; r2[sel] = O[pos[sel], j[sel]] / O[pos[sel], 1] - 1          # verkocht op de opening na het stuk
        keep = j != 1                                                                                # niet gekocht
        print(f"  [{lab}] aanhouden: gemiddeld {100 * r.mean():+5.1f}% over {len(r)} meldingen, −30% {100 * (r <= -.3).mean():4.1f}% | "
              f"met bewaking: gemiddeld {100 * r2[keep].mean():+5.1f}% over {int(keep.sum())} meldingen, −30% {100 * (r2[keep] <= -.3).mean():4.1f}%")


for floor in (15.0, 20.0, 26.0):
    blok(A15[A15.index.isin(SETS[floor])], f"Lat {floor:.0f}%")
A15 = A15[A15.index.isin(SETS[15.0])]              # per jaar: de meldingen bij lat 15%

print("\n=== Per jaar, lat 15%, uitgifteprospectus tijdens het aanhouden: van de opening na het stuk tot het slot van dag 10 ===")
for Y in range(2020, 2027):
    g = A15[(A15.yr == Y) & (A15["uitgifteprospectus"] >= 2)]
    if len(g) < 10: print(f"  {Y}: {len(g)} (te weinig)"); continue
    pos = g.pos.to_numpy(); j = g["uitgifteprospectus"].to_numpy(); rest = REST[pos, j]
    allpos = A15[A15.yr == Y].pos.to_numpy(); base = np.array([np.nanmean(REST[allpos, jj]) for jj in j])
    print(f"  {Y}: n={len(g):3d} gemiddeld {100 * rest.mean():+5.1f}% middelste {100 * np.median(rest):+5.1f}% | vergelijking {100 * base.mean():+5.1f}% | verlies bij de opening {100 * np.nanmean(GAP[pos, j]):+5.1f}%")
A15.drop(columns=["chunk"]).to_parquet(os.path.join(D, "bewaking.parquet"))
