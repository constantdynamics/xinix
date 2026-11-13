"""10 jaar dagkoersen bij Yahoo voor het hele universum. Hervatbaar; slaat per aandeel een npz op."""
import asyncio, json, os, sys, time, random
import aiohttp
import numpy as np
import pandas as pd

UNIVERSE, OUTDIR = sys.argv[1], sys.argv[2]
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 0
CONC = int(os.environ.get("CONC", "6"))
RANGE = os.environ.get("RANGE", "10y")
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
UA = "Mozilla/5.0 (compatible; XinixEngine/1.0; +https://github.com)"

os.makedirs(OUTDIR, exist_ok=True)
df = pd.read_parquet(UNIVERSE)
tickers = df["ticker"].tolist()
extra = [t for t in os.environ.get("EXTRA", "").split(",") if t]
tickers = extra + tickers
if LIMIT:
    random.seed(1)
    tickers = extra + random.sample(tickers[len(extra):], LIMIT)
fail_path = os.path.join(OUTDIR, "_failed.jsonl")
done = {f[:-4] for f in os.listdir(OUTDIR) if f.endswith(".npz")}
failed = {}
if os.path.exists(fail_path):
    for line in open(fail_path):
        try:
            j = json.loads(line); failed[j["t"]] = j["e"]
        except Exception:
            pass
RETRY_FAILED = os.environ.get("RETRY_FAILED", "0") == "1"
todo = [t for t in tickers if t not in done and (RETRY_FAILED or t not in failed)]
print(f"{len(tickers)} tickers, {len(done)} klaar, {len(failed)} eerder mislukt, {len(todo)} te doen", flush=True)

stats = {"ok": 0, "fail": 0, "429": 0, "bytes": 0}
backoff_until = 0.0


def fname(t):
    return t.replace("/", "_")


async def fetch(session, t, k):
    global backoff_until
    host = HOSTS[k % 2]
    url = f"https://{host}/v8/finance/chart/{t}?range={RANGE}&interval=1d&events=split"
    for attempt in range(6):
        now = time.time()
        if now < backoff_until:
            await asyncio.sleep(backoff_until - now + random.random())
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=40)) as r:
                body = await r.read()
                if r.status == 429 or r.status >= 500:
                    stats["429"] += 1
                    backoff_until = time.time() + min(120, 5 * (attempt + 1) ** 2)
                    host = HOSTS[(k + attempt + 1) % 2]
                    url = f"https://{host}/v8/finance/chart/{t}?range={RANGE}&interval=1d&events=split"
                    continue
                if r.status == 404:
                    try:
                        j = json.loads(body)
                        return None, j.get("chart", {}).get("error", {}).get("description", "404")
                    except Exception:
                        return None, "404"
                if r.status != 200:
                    return None, f"HTTP {r.status}"
                stats["bytes"] += len(body)
                return json.loads(body), None
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            await asyncio.sleep(2 + attempt * 2)
            last = repr(e)
    return None, f"retries exhausted"


def parse(t, j):
    res = (j.get("chart") or {}).get("result") or []
    if not res:
        return None, ((j.get("chart") or {}).get("error") or {}).get("description", "no result")
    r = res[0]
    meta = r.get("meta") or {}
    if meta.get("symbol") and str(meta["symbol"]).upper() != t.upper():
        return None, f"gaf {meta.get('symbol')} terug"
    ts = r.get("timestamp") or []
    if not ts:
        return None, "geen koersen"
    q = ((r.get("indicators") or {}).get("quote") or [{}])[0]
    adj = ((r.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or [None] * len(ts)
    f = lambda a: np.array([np.nan if x is None else x for x in (a or [None] * len(ts))], dtype=np.float64)
    out = {
        "ts": np.array(ts, dtype=np.int64),
        "open": f(q.get("open")), "high": f(q.get("high")), "low": f(q.get("low")), "close": f(q.get("close")),
        "adj": f(adj), "vol": f(q.get("volume")),
    }
    sp = (r.get("events") or {}).get("splits") or {}
    spl = sorted([(int(s["date"]), float(s.get("numerator") or 0), float(s.get("denominator") or 0)) for s in sp.values()])
    out["splits"] = np.array(spl, dtype=np.float64).reshape(-1, 3)
    out["meta"] = np.array(json.dumps({k: meta.get(k) for k in ("currency", "symbol", "exchangeName", "fullExchangeName", "instrumentType", "firstTradeDate", "gmtoffset", "exchangeTimezoneName", "regularMarketPrice", "longName", "shortName")}))
    return out, None


async def worker(session, queue, k, ff):
    while True:
        try:
            t = queue.get_nowait()
        except asyncio.QueueEmpty:
            return
        j, err = await fetch(session, t, k)
        out = None
        if j is not None:
            out, err = parse(t, j)
        if out is None:
            stats["fail"] += 1
            ff.write(json.dumps({"t": t, "e": err}) + "\n"); ff.flush()
        else:
            np.savez_compressed(os.path.join(OUTDIR, fname(t) + ".npz"), **out)
            stats["ok"] += 1
        await asyncio.sleep(0.05 + random.random() * 0.1)


async def main():
    queue = asyncio.Queue()
    for t in todo:
        queue.put_nowait(t)
    t0 = time.time()
    conn = aiohttp.TCPConnector(limit=CONC * 2)
    async with aiohttp.ClientSession(connector=conn, headers={"User-Agent": UA, "Accept": "application/json"}, trust_env=True) as session:
        with open(fail_path, "a") as ff:
            tasks = [asyncio.create_task(worker(session, queue, k, ff)) for k in range(CONC)]

            async def report():
                while any(not x.done() for x in tasks):
                    await asyncio.sleep(30)
                    el = time.time() - t0
                    n = stats["ok"] + stats["fail"]
                    print(f"{el:6.0f}s ok {stats['ok']} fail {stats['fail']} 429 {stats['429']} {n / max(el, 1):.1f}/s {stats['bytes'] / 1e6:.0f}MB rest {queue.qsize()}", flush=True)
            rep = asyncio.create_task(report())
            await asyncio.gather(*tasks)
            rep.cancel()
    print("klaar", stats, f"{time.time() - t0:.0f}s", flush=True)

asyncio.run(main())
