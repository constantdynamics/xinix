"""Welke stukken van de SEC moet Claude lezen? Lijsten ophalen en per kandidaat-dag de stukken kiezen.

  SEC_KEY=<sleutel> python3 tekst_lijst.py <ssdata> <url van de hulpfunctie>      (na sec_test.py: leest sec/cand_sec.parquet)

1. Per bedrijf de lijst van stukken met tekst (8-K, 6-K, prospectus 424B, registratie S-1/S-3/F-1/F-3) met het nummer
   waaronder ze zijn ingediend (hervatbaar: sec/tekst_lijst/part_NNN.json).
2. Per kandidaat-dag (Amerikaans aandeel, kans vanaf 15%, omzet vanaf $100.000) de stukken die een lezer op dat moment
   kon kennen. Twee momenten per stuk:
     k_slot    bekend op het slot van de dag (ontvangen vóór 16:00 uur New York), zoals in sec_test.py
     k_melding bekend vóór de melding van de volgende ochtend (ontvangen op die kalenderdag; de SEC neemt tot 22:00 aan)
   Gekozen worden, op k_melding:
     nieuws    de laatste drie 8-K's of 6-K's van de afgelopen 7 dagen
     geld      het laatste prospectus (424B) en de laatste registratie (S-1, S-3, F-1, F-3) van de afgelopen 90 dagen
3. Schrijft sec/tekst_docs.parquet (elk stuk één keer) en sec/tekst_cand.parquet (kandidaat-dag × stuk).
"""
import os, sys, json, time, glob
import numpy as np, pandas as pd
import requests

ROOT, URL = sys.argv[1], sys.argv[2]
KEY = os.environ["SEC_KEY"]
D = os.path.join(ROOT, "sec"); L = os.path.join(D, "tekst_lijst"); os.makedirs(L, exist_ok=True)
EPOCH = pd.Timestamp("1970-01-01")
NEWS_DAYS, NEWS_MAX, OFFER_DAYS = 7, 3, 90

C = pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["idx", "day", "tid", "cik", "p_glob", "yr"])
ciks = sorted(int(c) for c in C.cik.unique())
print(f"kandidaat-dagen {len(C)}, bedrijven {len(ciks)}", flush=True)

S = requests.Session(); S.headers.update({"x-onderzoek": KEY, "content-type": "application/json"})
N = 30
for b in range(0, len(ciks), N):
    out = os.path.join(L, f"part_{b // N:03d}.json")
    if os.path.exists(out): continue
    for attempt in range(4):
        try:
            r = S.post(URL, data=json.dumps({"op": "lijst", "ciks": ciks[b:b + N], "since": "2019-07-01"}), timeout=145)
            if r.status_code == 200:
                j = r.json()
                bad = [k for k, v in j.items() if isinstance(v, dict) and "error" in v]
                if bad and attempt < 3:
                    print(f"portie {b // N}: fouten {[(k, j[k]['error']) for k in bad[:3]]}, opnieuw", flush=True); time.sleep(10); continue
                open(out, "w").write(r.text)
                print(f"portie {b // N}: {len(j)} bedrijven, {sum(len(v.get('f', [])) for v in j.values() if isinstance(v, dict))} stukken, fouten {len(bad)}", flush=True)
                break
            print(f"portie {b // N}: HTTP {r.status_code} {r.text[:120]}", flush=True)
        except Exception as e:
            print(f"portie {b // N}: {str(e)[:120]}", flush=True)
        time.sleep(8 * (attempt + 1))
    time.sleep(1.0)

rows = []
for p in sorted(glob.glob(os.path.join(L, "part_*.json"))):
    for cik, v in json.load(open(p)).items():
        if not isinstance(v, dict) or "f" not in v: continue
        for d, form, items, acc, accn, doc, size in v["f"]:
            rows.append((int(cik), d, form, items, acc, accn, doc, size))
F = pd.DataFrame(rows, columns=["cik", "date", "form", "items", "accepted", "acc", "doc", "size"]).drop_duplicates(["cik", "acc"])
t = pd.to_datetime(F.accepted, errors="coerce", utc=True).dt.tz_convert("America/New_York")
fd = (pd.to_datetime(F.date) - EPOCH).dt.days.to_numpy()
ad = ((t.dt.tz_localize(None).dt.normalize() - EPOCH).dt.days).to_numpy(np.float64)
late = (t.dt.hour * 60 + t.dt.minute > 16 * 60).to_numpy()
F["k_slot"] = np.where(np.isfinite(ad), ad + late, fd + 1).astype(np.int64)        # zonder ontvangsttijd: pas de dag erna
F["k_melding"] = np.where(np.isfinite(ad), ad, fd + 1).astype(np.int64)
F["soort"] = np.where(F.form.str.match(r"^(8-K|6-K)"), "nieuws", np.where(F.form.str.match(r"^424B"), "prospectus", "registratie"))
print(f"stukken met tekst: {len(F)} bij {F.cik.nunique()} bedrijven | " + ", ".join(f"{k} {v}" for k, v in F.soort.value_counts().items()), flush=True)

pairs = []
by = {cik: g.sort_values("k_melding") for cik, g in F.groupby("cik")}
for cik, g in C.groupby("cik"):
    f = by.get(int(cik))
    if f is None: continue
    k = f.k_melding.to_numpy(); so = f.soort.to_numpy(); acc = f.acc.to_numpy()
    for idx, d in zip(g.idx.to_numpy(), g.day.to_numpy()):
        hi = np.searchsorted(k, d, side="right")
        n_idx = [i for i in range(np.searchsorted(k, d - NEWS_DAYS, side="left"), hi) if so[i] == "nieuws"][-NEWS_MAX:]
        lo = np.searchsorted(k, d - OFFER_DAYS, side="left")
        p_idx = [i for i in range(lo, hi) if so[i] == "prospectus"][-1:]
        r_idx = [i for i in range(lo, hi) if so[i] == "registratie"][-1:]
        for i in n_idx + p_idx + r_idx:
            pairs.append((int(idx), int(cik), acc[i], int(d - k[i])))
P = pd.DataFrame(pairs, columns=["idx", "cik", "acc", "dagen_oud"])
docs = F.merge(P[["cik", "acc"]].drop_duplicates(), on=["cik", "acc"])
docs.to_parquet(os.path.join(D, "tekst_docs.parquet")); P.to_parquet(os.path.join(D, "tekst_cand.parquet"))
has = C.idx.isin(P.idx)
print(f"kandidaat-dagen met minstens één stuk: {int(has.sum())} van {len(C)} ({100 * has.mean():.0f}%)")
print(f"verschillende stukken: {len(docs)} | " + ", ".join(f"{k} {v}" for k, v in docs.soort.value_counts().items()))
print("per soort formulier:", docs.form.value_counts().head(12).to_dict())
yr = docs.date.str[:4]
print("per jaar:", yr.value_counts().sort_index().to_dict())
print("KLAAR", flush=True)
