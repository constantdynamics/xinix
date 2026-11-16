"""Hoe volledig zijn de velden van TradingView voor de twee eisen aan de lijst (16 november 2026)?

  python3 tv_leeftijd.py [uit.pkl]

Haalt voor alle Saxo-markten (zelfde filter als de functie xinix-supersprint) op:
  first_bar_time    eerste koers bij TradingView (seconden sinds 1970)
  ipo_offer_date    datum van de beursgang of van de overstap naar deze beurs
  High.All          hoogste koers ooit, gecorrigeerd voor splits
en telt hoe vaak ze gevuld zijn, hoe vaak de twee datums verschillen, en hoeveel aandelen de eisen raken:
korter dan twee jaar genoteerd (keuze 1b: de beursgang, en als die onbekend is de eerste koers) en een slot
boven 95% van de hoogste koers ooit. 22 verzoeken aan de scanner; schrijft niets naar de database.
"""
import sys, json, time
import numpy as np, pandas as pd
import requests

H = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0", "Origin": "https://www.tradingview.com"}
MARKET_EX = {"america": ["NASDAQ", "NYSE", "AMEX"], "canada": ["TSX", "TSXV"], "uk": ["LSE"], "germany": ["XETR", "FWB"], "france": ["EURONEXT"], "netherlands": ["EURONEXT"],
             "belgium": ["EURONEXT"], "italy": ["MIL"], "spain": ["BME"], "portugal": ["EURONEXT"], "poland": ["GPW"], "switzerland": ["SIX"], "sweden": ["OMXSTO"], "norway": ["OSL"],
             "denmark": ["OMXCOP"], "finland": ["OMXHEX"], "australia": ["ASX"], "hongkong": ["HKEX"], "japan": ["TSE"], "singapore": ["SGX"]}
COLS = ["name", "description", "close", "exchange", "first_bar_time", "ipo_offer_date", "High.All", "market_cap_basic"]
rows = []
for m, ex in MARKET_EX.items():
    frm = 0
    while True:
        body = {"filter": [{"left": "type", "operation": "equal", "right": "stock"}, {"left": "is_primary", "operation": "equal", "right": True},
                           {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer", ""]}, {"left": "exchange", "operation": "in_range", "right": ex},
                           {"left": "close", "operation": "greater", "right": 0}],
                "options": {"lang": "en"}, "columns": COLS, "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [frm, frm + 3000]}
        r = requests.post(f"https://scanner.tradingview.com/{m}/scan", headers=H, data=json.dumps(body), timeout=60)
        r.raise_for_status()
        j = r.json()
        for x in j.get("data", []): rows.append([m, x["s"]] + x["d"])
        frm += 3000
        if frm >= j.get("totalCount", 0) or not j.get("data"): break
        time.sleep(0.4)
    time.sleep(0.4)
T = pd.DataFrame(rows, columns=["market", "sym"] + COLS)
for c in ("close", "first_bar_time", "ipo_offer_date", "High.All", "market_cap_basic"): T[c] = pd.to_numeric(T[c], errors="coerce").astype(float)
if len(sys.argv) > 1: T.to_pickle(sys.argv[1])

now = time.time(); Y2 = 2 * 365.25 * 86400
print(f"{len(T)} aandelen | gevuld: eerste koers {100 * T.first_bar_time.notna().mean():.1f}%, beursgang {100 * T.ipo_offer_date.notna().mean():.1f}%, hoogste koers ooit {100 * T['High.All'].notna().mean():.1f}%")
d = (T.first_bar_time - T.ipo_offer_date) / 86400 / 365.25
print(f"eerste koers tegenover de beursgang: binnen een maand gelijk {100 * (d.abs() < 0.085).mean():.1f}%, eerste koers meer dan een jaar later {100 * (d > 1).mean():.1f}%, meer dan een jaar eerder {100 * (d < -1).mean():.1f}%")
since = np.where(np.isfinite(T.ipo_offer_date), T.ipo_offer_date, T.first_bar_time)
jong = (now - since) < Y2; jong_bar = (now - T.first_bar_time) < Y2
top = T.close / T["High.All"]
print(f"korter dan twee jaar genoteerd (beursgang, anders eerste koers): {int(jong.sum())} ({100 * jong.mean():.1f}%) | alleen op de eerste koers: {int(jong_bar.sum())}")
print(f"  jong volgens de eerste koers maar niet volgens de beursgang: {int((jong_bar & ~jong).sum())} | andersom: {int((jong & ~jong_bar).sum())}")
print(f"slot boven 95% van de hoogste koers ooit: {int((top > .95).sum())} ({100 * (top > .95).mean():.1f}%) | hoger dan de top (mag niet voorkomen): {int((top > 1.0001).sum())}")
print(f"een van beide eisen: {int((jong | (top > .95)).sum())} ({100 * (jong | (top > .95)).mean():.1f}%)")
