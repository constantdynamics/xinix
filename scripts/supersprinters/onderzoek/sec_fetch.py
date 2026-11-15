"""Haalt per Amerikaans aandeel de lijst van SEC-stukken op via de tijdelijke hulpfunctie (sec_proxy.ts).

  SEC_KEY=<sleutel> python3 sec_fetch.py <ssdata> <url van de hulpfunctie>

Leest ssdata/sec/us_tickers.json en ssdata/sec/company_tickers.json; schrijft ssdata/sec/part_NNN.json
(hervatbaar: een portie die er al is wordt overgeslagen) en ssdata/sec/cik_map.json (ticker → CIK).
"""
import os, sys, json, time
import requests
ROOT, URL = sys.argv[1], sys.argv[2]
KEY = os.environ["SEC_KEY"]
D = os.path.join(ROOT, "sec")
tick = json.load(open(os.path.join(D, "us_tickers.json")))
ct = json.load(open(os.path.join(D, "company_tickers.json")))
by = {}
for v in ct.values():
    by.setdefault(v["ticker"].upper(), int(v["cik_str"]))
cmap = {t: by[t.upper()] for t in tick if t.upper() in by}
json.dump(cmap, open(os.path.join(D, "cik_map.json"), "w"))
ciks = sorted(set(cmap.values()))
print(f"aandelen {len(tick)}, met CIK {len(cmap)}, verschillende CIK's {len(ciks)}; zonder CIK: {[t for t in tick if t not in cmap][:25]}", flush=True)
S = requests.Session(); S.headers.update({"x-onderzoek": KEY, "content-type": "application/json"})
N = 30
for b in range(0, len(ciks), N):
    out = os.path.join(D, f"part_{b // N:03d}.json")
    if os.path.exists(out): continue
    part = ciks[b:b + N]
    for attempt in range(4):
        try:
            r = S.post(URL, data=json.dumps({"ciks": part, "since": "2018-06-01"}), timeout=140)
            if r.status_code == 200:
                j = r.json()
                bad = [k for k, v in j.items() if isinstance(v, dict) and "error" in v]
                open(out, "w").write(r.text)
                print(f"portie {b // N}: {len(j)} aandelen, {sum(len(v.get('f', [])) for v in j.values() if isinstance(v, dict))} stukken, fouten {len(bad)} {[(k, j[k]['error']) for k in bad[:3]]}, {len(r.content) // 1024} kB", flush=True)
                break
            print(f"portie {b // N}: HTTP {r.status_code} {r.text[:120]}", flush=True)
        except Exception as e:
            print(f"portie {b // N}: {str(e)[:120]}", flush=True)
        time.sleep(8 * (attempt + 1))
    time.sleep(1.0)
print("KLAAR", flush=True)
