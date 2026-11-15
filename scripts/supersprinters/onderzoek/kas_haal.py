"""Haalt per bedrijf de kas, de kasstroom en het aantal aandelen uit de jaar- en kwartaalverslagen (XBRL bij de SEC).

  SEC_KEY=<sleutel> python3 kas_haal.py <ssdata> <url van de hulpfunctie> [werkers]      (na sec_test.py)

Via de tijdelijke hulpfunctie (sec_proxy.ts, opdracht "facts"). Schrijft sec/kas/part_NNN.json (hervatbaar). Per begrip
alle gemelde waarden met de periode, het soort verslag en de dag waarop het verslag is ingediend, zodat per kandidaat-dag
alleen telt wat toen al gepubliceerd was.
"""
import os, sys, json, time, threading
import pandas as pd
import requests

ROOT, URL = sys.argv[1], sys.argv[2]
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 2
KEY = os.environ["SEC_KEY"]
D = os.path.join(ROOT, "sec"); K = os.path.join(D, "kas"); os.makedirs(K, exist_ok=True)
CONCEPTS = ["us-gaap/CashAndCashEquivalentsAtCarryingValue", "us-gaap/CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
            "us-gaap/NetCashProvidedByUsedInOperatingActivities", "dei/EntityCommonStockSharesOutstanding", "us-gaap/CommonStockSharesOutstanding",
            "us-gaap/StockholdersEquity", "ifrs-full/CashAndCashEquivalents", "ifrs-full/CashFlowsFromUsedInOperatingActivities"]
ciks = sorted(int(c) for c in pd.read_parquet(os.path.join(D, "cand_sec.parquet"), columns=["cik"]).cik.unique())
N = 4
parts = [(b // N, ciks[b:b + N]) for b in range(0, len(ciks), N) if not os.path.exists(os.path.join(K, f"part_{b // N:03d}.json"))]
print(f"bedrijven {len(ciks)}, porties te doen {len(parts)}", flush=True)
lock = threading.Lock(); n_done = [0]


def work(items):
    s = requests.Session(); s.headers.update({"x-onderzoek": KEY, "content-type": "application/json"})
    for i, part in items:
        for attempt in range(4):
            try:
                r = s.post(URL, data=json.dumps({"op": "facts", "ciks": part, "concepts": CONCEPTS, "since": "2019-01-01"}), timeout=145)
                if r.status_code == 200:
                    j = r.json()
                    bad = sum(1 for v in j.values() for c in v.values() if isinstance(c, dict) and "error" in c)
                    if bad and attempt < 3: time.sleep(15); continue
                    open(os.path.join(K, f"part_{i:03d}.json"), "w").write(r.text)
                    with lock:
                        n_done[0] += 1
                        if n_done[0] % 25 == 0: print(f"{n_done[0]} van {len(parts)} porties, fouten in de laatste {bad}", flush=True)
                    break
                print(f"portie {i}: HTTP {r.status_code} {r.text[:100]}", flush=True)
            except Exception as e:
                print(f"portie {i}: {str(e)[:100]}", flush=True)
            time.sleep(10 * (attempt + 1))


th = [threading.Thread(target=work, args=(parts[i::WORKERS],)) for i in range(WORKERS)]
for t in th: t.start()
for t in th: t.join()
print("KLAAR", flush=True)
