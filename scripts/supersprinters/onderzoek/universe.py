"""Actueel universum bij de TradingView-scanner, zelfde filter als tvMarket in _shared/universe.ts."""
import json, sys, time, re
import requests
import pandas as pd

OUT = sys.argv[1]
MARKETS = [
    ("america", {"NASDAQ": "", "NYSE": "", "AMEX": ""}),
    ("canada", {"TSX": ".TO", "TSXV": ".V", "CSE": ".CN", "NEO": ".NE"}),
    ("uk", {"LSE": ".L"}),
    ("germany", {"XETR": ".DE", "FWB": ".F"}),
    ("france", {"EURONEXT": ".PA"}),
    ("netherlands", {"EURONEXT": ".AS"}),
    ("belgium", {"EURONEXT": ".BR"}),
    ("italy", {"MIL": ".MI"}),
    ("spain", {"BME": ".MC"}),
    ("portugal", {"EURONEXT": ".LS"}),
    ("poland", {"GPW": ".WA"}),
    ("switzerland", {"SIX": ".SW"}),
    ("sweden", {"OMXSTO": ".ST"}),
    ("norway", {"OSL": ".OL"}),
    ("denmark", {"OMXCOP": ".CO"}),
    ("finland", {"OMXHEX": ".HE"}),
    ("australia", {"ASX": ".AX"}),
    ("hongkong", {"HKEX": ".HK"}),
    ("japan", {"TSE": ".T"}),
    ("singapore", {"SGX": ".SI"}),
]
COLS = ["name", "description", "close", "currency", "change", "Perf.W", "Perf.1M", "Perf.6M",
        "volume", "average_volume_30d_calc", "market_cap_basic", "price_52_week_high", "price_52_week_low",
        "High.3M", "Low.3M", "High.All", "Low.All", "Volatility.M", "sector", "industry", "exchange",
        # extra, voor onderzoek
        "type", "subtype", "typespecs", "is_primary", "float_shares_outstanding", "total_shares_outstanding",
        "Volatility.D", "Volatility.W", "relative_volume_10d_calc", "average_volume_10d_calc", "average_volume_90d_calc",
        "Perf.3M", "Perf.Y", "gap", "ATR", "RSI", "open", "high", "low", "country", "Value.Traded",
        "average_volume_60d_calc", "Perf.5D", "High.1M", "Low.1M", "High.6M", "Low.6M", "Perf.YTD", "Perf.All",
        "earnings_release_next_date", "earnings_release_date", "premarket_change", "postmarket_change", "update_mode", "pricescale", "minmov", "fundamental_currency_code"]


def yahoo_symbol(region, ex_map, exchange, name):
    sfx = ex_map.get(exchange)
    if sfx is None:
        return None
    sym = re.sub(r"[._]", "-", name.upper())
    if region == "hongkong":
        sym = sym.rjust(4, "0")
    if region == "uk" and re.match(r"^[0-9][0-9A-Z]{3}$", sym):
        return None
    return sym + sfx


def post(region, body):
    for attempt in range(5):
        r = requests.post(f"https://scanner.tradingview.com/{region}/scan", json=body,
                          headers={"User-Agent": "Mozilla/5.0", "Origin": "https://www.tradingview.com"}, timeout=60)
        if r.status_code == 200:
            return r.json()
        print("TV", region, r.status_code, r.text[:200], file=sys.stderr)
        time.sleep(3 + attempt * 3)
    raise RuntimeError(f"TV {region} failed")


rows = []
for region, ex in MARKETS:
    PAGE = 3000
    frm = 0
    n_reg = 0
    while frm < 20000:
        j = post(region, {
            "filter": [
                {"left": "type", "operation": "equal", "right": "stock"},
                {"left": "is_primary", "operation": "equal", "right": True},
                {"left": "subtype", "operation": "in_range", "right": ["common", "foreign-issuer", ""]},
                {"left": "exchange", "operation": "in_range", "right": list(ex.keys())},
                {"left": "close", "operation": "greater", "right": 0},
            ],
            "options": {"lang": "en"},
            "columns": COLS,
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
            "range": [frm, frm + PAGE],
        })
        data = j.get("data") or []
        for row in data:
            d = dict(zip(COLS, row["d"]))
            t = yahoo_symbol(region, ex, str(d.get("exchange") or ""), str(d.get("name") or ""))
            if not t:
                continue
            d["ticker"] = t
            d["tv_symbol"] = row["s"]
            d["market"] = region
            d["typespecs"] = ",".join(d.get("typespecs") or [])
            rows.append(d)
            n_reg += 1
        total = int(j.get("totalCount") or 0)
        if frm + PAGE >= total or not data:
            break
        frm += PAGE
        time.sleep(0.5)
    print(region, n_reg, "of", total, file=sys.stderr)
    time.sleep(0.5)

df = pd.DataFrame(rows)
df = df.drop_duplicates("ticker", keep="first")
TEXT = {"name", "description", "currency", "sector", "industry", "exchange", "type", "subtype", "typespecs", "country",
        "update_mode", "fundamental_currency_code", "ticker", "tv_symbol", "market"}
for c in df.columns:
    if c not in TEXT and c != "is_primary":
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("float64")
df.to_parquet(OUT)
print(len(df), "tickers")
print(df.groupby(["market", "exchange"]).size().to_string())
