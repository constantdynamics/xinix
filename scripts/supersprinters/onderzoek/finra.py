"""FINRA short interest (tweewekelijks): alle bestanden ophalen en compact bewaren."""
import os, sys, io, datetime as dt, time
import requests, pandas as pd, numpy as np
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0"


def candidates(y0=2017, y1=2026):
    d = dt.date(y0, 1, 1)
    while d <= dt.date(y1, 11, 13):
        # halverwege de maand (15e of de werkdag ervoor) en de laatste werkdag van de maand
        nxt = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        for target in (d.replace(day=15), nxt - dt.timedelta(days=1)):
            yield [target - dt.timedelta(days=k) for k in range(0, 5)]
        d = nxt


rows = 0; got = 0; miss = []
for cand in candidates():
    ok = False
    for c in cand:
        if c.weekday() >= 5:
            continue
        name = f"shrt{c:%Y%m%d}"
        p = os.path.join(OUT, name + ".parquet")
        if os.path.exists(p):
            ok = True; break
        try:
            r = S.get(f"https://cdn.finra.org/equity/otcmarket/biweekly/{name}.csv", timeout=90)
        except Exception as e:
            time.sleep(3); continue
        if r.status_code != 200 or len(r.content) < 1000:
            continue
        df = pd.read_csv(io.BytesIO(r.content), sep="|", dtype=str, quoting=3, on_bad_lines="skip", encoding_errors="replace")
        df.columns = [c.strip('"') for c in df.columns]
        df = df.apply(lambda col: col.str.strip('"'))
        keep = df[["symbolCode", "marketClassCode", "currentShortPositionQuantity", "averageDailyVolumeQuantity", "daysToCoverQuantity", "changePercent", "settlementDate"]].copy()
        keep.columns = ["sym", "mkt", "si", "adv", "dtc", "chg", "settle"]
        for k in ("si", "adv", "dtc", "chg"):
            keep[k] = pd.to_numeric(keep[k], errors="coerce")
        keep.to_parquet(p)
        rows += len(keep); got += 1; ok = True
        time.sleep(0.2)
        break
    if not ok:
        miss.append(str(cand[0]))
print("bestanden", got, "rijen", rows, "niet gevonden", len(miss), miss[:12], miss[-5:])
