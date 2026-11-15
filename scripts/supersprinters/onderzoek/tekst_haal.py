"""Haalt de tekst van de gekozen SEC-stukken op via de tijdelijke hulpfunctie (sec_proxy.ts, opdracht "docs").

  SEC_KEY=<sleutel> python3 tekst_haal.py <ssdata> <url van de hulpfunctie> [werkers]      (na tekst_lijst.py)

Leest sec/tekst_docs.parquet; schrijft sec/tekst/part_NNNN.jsonl.gz (hervatbaar: wat er al staat wordt overgeslagen;
met OPNIEUW=6-K in de omgeving worden de 6-K's zonder bijlage opnieuw opgehaald).
Per stuk: bij een 8-K of 6-K het stuk zelf (tot 8.000 tekens) en de eerste twee persberichten (bijlage 99: tot 14.000
en 6.000 tekens); bij een prospectus of registratie het begin van het stuk (tot 28.000 tekens: voorblad, samenvatting
en "The Offering"). `cut` zegt of er meer tekst was. Tempo: twee werkers, samen ±5 stukken per seconde (de SEC staat
10 verzoeken per seconde toe).
"""
import os, sys, json, gzip, glob, time, threading
import pandas as pd
import requests

ROOT, URL = sys.argv[1], sys.argv[2]
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 2
KEY = os.environ["SEC_KEY"]
D = os.path.join(ROOT, "sec"); T = os.path.join(D, "tekst"); os.makedirs(T, exist_ok=True)
docs = pd.read_parquet(os.path.join(D, "tekst_docs.parquet"), columns=["cik", "acc", "form"])
# OPNIEUW=6-K haalt de stukken van dat soort opnieuw op als er alleen het stuk zelf staat, zonder bijlage (de eerste
# versie van de hulpfunctie miste het persbericht bij een 6-K). Wie de teksten leest, neemt per stuk de laatste regel.
OPNIEUW = os.environ.get("OPNIEUW", "")
done = set()
for p in sorted(glob.glob(os.path.join(T, "part_*.jsonl.gz"))):
    with gzip.open(p, "rt", encoding="utf-8") as f:
        for line in f:
            j = json.loads(line)
            if "error" in j: continue
            key = (int(j["cik"]), j["acc"])
            if OPNIEUW and j["form"].startswith(OPNIEUW) and len(j["docs"]) < 2: done.discard(key)
            else: done.add(key)
todo = [(int(c), a, f) for c, a, f in zip(docs.cik, docs.acc, docs.form) if (int(c), a) not in done]
print(f"stukken {len(docs)}, al opgehaald {len(done)}, te doen {len(todo)}", flush=True)
lock = threading.Lock(); buf = []; stats = {"ok": 0, "err": 0, "chars": 0}
part = [len(glob.glob(os.path.join(T, "part_*.jsonl.gz")))]


def flush(force=False):
    with lock:
        if not buf or (len(buf) < 400 and not force): return
        p = os.path.join(T, f"part_{part[0]:04d}.jsonl.gz"); part[0] += 1
        with gzip.open(p, "wt", encoding="utf-8") as f:
            for j in buf: f.write(json.dumps(j, ensure_ascii=False) + "\n")
        buf.clear()


def work(items):
    s = requests.Session(); s.headers.update({"x-onderzoek": KEY, "content-type": "application/json"})
    for b in range(0, len(items), 8):
        chunk = [{"cik": c, "acc": a, "form": f} for c, a, f in items[b:b + 8]]
        res = None
        for attempt in range(4):
            try:
                r = s.post(URL, data=json.dumps({"op": "docs", "items": chunk}), timeout=145)
                if r.status_code == 200: res = r.json(); break
                print(f"HTTP {r.status_code} {r.text[:100]}", flush=True)
            except Exception as e:
                print(str(e)[:100], flush=True)
            time.sleep(10 * (attempt + 1))
        if res is None: continue
        with lock:
            for j in res:
                if "error" in j: stats["err"] += 1; continue
                buf.append(j); stats["ok"] += 1; stats["chars"] += sum(len(d["text"]) for d in j["docs"])
            n = stats["ok"] + stats["err"]
            if n % 200 < 8: print(f"{n} van {len(todo)}: gelukt {stats['ok']}, fouten {stats['err']}, gemiddeld {stats['chars'] // max(1, stats['ok'])} tekens", flush=True)
        flush()
        if any("error" in j and "429" in str(j["error"]) for j in res): time.sleep(30)


th = [threading.Thread(target=work, args=(todo[i::WORKERS],)) for i in range(WORKERS)]
for t in th: t.start()
for t in th: t.join()
flush(force=True)
print(f"KLAAR gelukt {stats['ok']}, fouten {stats['err']}", flush=True)
