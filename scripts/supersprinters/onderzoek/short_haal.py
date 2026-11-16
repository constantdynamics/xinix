"""Dagelijkse cijfers over short-verkopen van FINRA ophalen voor de Amerikaanse kandidaat-aandelen (16 november 2026).

  python3 short_haal.py <ssdata> [eerste maand JJJJ-MM] [laatste dag JJJJ-MM-DD]

FINRA (de Amerikaanse toezichthouder op effectenhandelaren) publiceert elke handelsdag na het slot, gratis, per aandeel
hoeveel aandelen er short zijn verkocht en hoeveel er in totaal zijn verhandeld in de handel die buiten de beurzen om
wordt gemeld (ongeveer de helft van alle handel): cdn.finra.org/equity/regsho/daily/CNMSshvolJJJJMMDD.txt, sinds
augustus 2018. Dit script haalt die bestanden op (±1.800 handelsdagen, ±750 MB) en bewaart alleen de regels van de
aandelen in sec/cand_sec.parquet: <ssdata>/finra_dag/shvol.parquet met dag, ticker, short verkocht, totaal.

Per maand één tussenbestand, zodat een onderbroken run verdergaat waar hij was. Een dag zonder bestand (weekend,
beursvrije dag) geeft 403 en telt als geen handel. De tweewekelijkse shortposities staan al in <ssdata>/finra (finra.py).
"""
import os, sys, io, time, datetime as dt
from concurrent.futures import ThreadPoolExecutor
import numpy as np, pandas as pd, requests

ROOT = sys.argv[1]
FIRST = sys.argv[2] if len(sys.argv) > 2 else "2019-09"
LAST = dt.date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else dt.date(2026, 11, 13)
OUT = os.path.join(ROOT, "finra_dag")
os.makedirs(OUT, exist_ok=True)
EPOCH = dt.date(1970, 1, 1)
want = set(pd.read_parquet(os.path.join(ROOT, "sec", "cand_sec.parquet"), columns=["ticker"]).ticker.unique())
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0"


def fetch(d):
    """→ (dag, rijen [ticker, short, totaal]) of (dag, None) als er die dag geen bestand is."""
    url = f"https://cdn.finra.org/equity/regsho/daily/CNMSshvol{d:%Y%m%d}.txt"
    for attempt in range(4):
        try:
            r = S.get(url, timeout=90)
        except Exception:
            time.sleep(2 + 3 * attempt); continue
        if r.status_code in (403, 404): return d, None
        if r.status_code != 200: time.sleep(2 + 3 * attempt); continue
        rows = []
        for line in io.StringIO(r.text):
            p = line.rstrip("\n").split("|")
            if len(p) < 5 or p[1] not in want: continue
            try: rows.append((p[1], float(p[2]), float(p[4])))
            except ValueError: continue
        return d, rows
    raise RuntimeError(f"niet opgehaald: {url}")


y, m = map(int, FIRST.split("-"))
n_days = n_rows = 0
while dt.date(y, m, 1) <= LAST:
    part = os.path.join(OUT, f"part_{y}{m:02d}.parquet")
    nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
    if not os.path.exists(part):
        days = [dt.date(y, m, 1) + dt.timedelta(days=k) for k in range((nxt - dt.date(y, m, 1)).days)]
        days = [d for d in days if d.weekday() < 5 and d <= LAST]
        with ThreadPoolExecutor(6) as ex: res = list(ex.map(fetch, days))
        recs = [((d - EPOCH).days, t, sv, tv) for d, rows in res if rows is not None for t, sv, tv in rows]
        df = pd.DataFrame(recs, columns=["day", "ticker", "sv", "tv"]).astype({"day": np.int32, "sv": np.float64, "tv": np.float64})
        df.to_parquet(part + ".tmp"); os.replace(part + ".tmp", part)
        got = sum(rows is not None for _, rows in res)
        print(f"{y}-{m:02d}: {got} handelsdagen, {len(df)} regels", flush=True)
    y, m = nxt.year, nxt.month
parts = sorted(p for p in os.listdir(OUT) if p.startswith("part_") and p.endswith(".parquet"))
A = pd.concat([pd.read_parquet(os.path.join(OUT, p)) for p in parts], ignore_index=True)
A.to_parquet(os.path.join(OUT, "shvol.parquet"))
print(f"klaar: {A.day.nunique()} handelsdagen van {pd.Timestamp('1970-01-01') + pd.Timedelta(days=int(A.day.min())):%Y-%m-%d} t/m "
      f"{pd.Timestamp('1970-01-01') + pd.Timedelta(days=int(A.day.max())):%Y-%m-%d}, {len(A)} regels, {A.ticker.nunique()} van de {len(want)} aandelen")
