"""Controles op drie keuzes in de productiecode, nagerekend op de opgeslagen testvoorspellingen.

  python3 productie_check.py <rijen.parquet>      (het bestand <uit>_rows.parquet van final_eval.py)

1. Track record afrekenen: hoeveel aandelen per run zijn nodig om de dagelijkse aanwas bij te houden?
   (RESOLVE_TICKERS in supabase/functions/xinix-supersprint/run.ts)
2. Bijsturing: productie rekent hem over de bewaarde kopgroep (hoogstens 100 per regio), het onderzoek
   over de 300 hoogste van de dag. Maakt dat uit voor de meldingen en de ijking?
3. Opstart van de bijsturing: een startwaarde die geleidelijk plaatsmaakt voor eigen uitkomsten
   (xinix_ss_calib_refresh), tegenover het volle venster dat pas na vier maanden bestaat.
"""
import os, sys, collections
import numpy as np, pandas as pd, pyarrow.dataset as ds
sys.path.insert(0, os.path.dirname(__file__))
from lib import ALL

ROWS = sys.argv[1]
TOP_MIN, TOP_N, MIN_BASE = 25, 100, 0.01          # zoals in run.ts
SEED_PER_DAY = 20.0                               # zoals in xinix_ss_calib_refresh

meta = pd.read_parquet(os.path.join(ALL, "meta.parquet"), columns=["tid", "region"])
reg = np.zeros(int(meta.tid.max()) + 1, dtype=np.int8); reg[meta.tid.to_numpy()] = meta.region.to_numpy()
t = ds.dataset(ROWS).to_table(columns=["yr", "day", "tid", "raw", "p0", "mult", "y", "eid"]).to_pandas()
t["region"] = reg[t.tid.to_numpy()]
t = t.sort_values(["day", "region", "raw"], ascending=[True, True, False]).reset_index(drop=True)
t["i"] = t.groupby(["day", "region"]).cumcount()
kept = (t.i < TOP_MIN) | ((t.i < TOP_N) & (t.p0 >= MIN_BASE))
days = np.sort(t.day.unique())

# ── 1. Wachtrij van het track record ────────────────────────────────────────
k = t[kept & (t.yr >= 2025)]
kd = np.sort(k.day.unique())
sets = {d: set(g.tid.to_numpy()) for d, g in k.groupby("day")}
per_day = k.groupby("day").size()
new = [len(sets[kd[i]] - sets[kd[i - 1]]) for i in range(1, len(kd))]
print(f"1. bewaard per dag: gemiddeld {per_day.mean():.0f} voorspellingen; {np.mean(new):.0f} aandelen stonden er de dag ervoor niet; "
      f"{np.mean([len(set().union(*[sets[kd[j]] for j in range(i - 4, i + 1)])) for i in range(4, len(kd))]):.0f} verschillende aandelen per 5 handelsdagen")


def queue(K, rows_limit=2000):
    """Afrekenbaar vanaf dag + 16; runs op dinsdag t/m zaterdag; per run de 2000 oudste rijen, de eerste K aandelen."""
    by_day = {d: sorted(sets[d]) for d in kd}
    pending, di, backlog, age = [], 0, [], []
    for cal in np.arange(kd.min(), kd.max() + 40):
        while di < len(kd) and kd[di] + 16 <= cal:
            pending.extend((int(kd[di]), x) for x in by_day[kd[di]]); di += 1
        if pd.Timestamp(int(cal), unit="D").weekday() in (1, 2, 3, 4, 5):
            head, cs = pending[:rows_limit], set()
            for _, tk in head:
                if tk not in cs and len(cs) < K:
                    cs.add(tk)
            pending = [(mo, tk) for mo, tk in head if tk not in cs] + pending[rows_limit:]
        backlog.append(len(pending)); age.append((cal - pending[0][0]) if pending else 0)
    return backlog, age


for K in (80, 160, 240):
    b, a = queue(K)
    print(f"   {K} aandelen per run: open na 200 dagen {b[200]}, aan het eind {b[-40]}; oudste open voorspelling aan het eind {a[-40]} dagen oud")


# ── 2. Bijsturing over de kopgroep of over de top 300 ───────────────────────
def sums(sub):
    w = sub[np.isfinite(sub.y)]
    a = pd.DataFrame({"day": w.day, "sp": w.p0, "sy": w.y}).groupby("day").sum().sort_index()
    return a.index.to_numpy(), np.concatenate([[0], np.cumsum(a.sp.to_numpy())]), np.concatenate([[0], np.cumsum(a.sy.to_numpy())])


def mults(sub, kk=15.0, window=120, lag=16):
    ad, csp, csy = sums(sub)
    out = {}
    for d in days:
        a = np.searchsorted(ad, d - lag - window, side="right"); b = np.searchsorted(ad, d - lag, side="right")
        sp, sy = csp[b] - csp[a], csy[b] - csy[a]
        out[d] = float(np.clip((sy + kk) / (sp + kk), 0.5, 2.0)) if sp > 0 else 1.0
    return out


def final(p0, m):
    o = p0 / (1 - p0) * m; p = o / (1 + o)
    return np.where(p > 0.15, 0.15 + 0.75 * (p - 0.15), p) * 100


def alerts(df, col, floor=15.0, per_week=3, realert_days=10, realert_gain=5.0):
    c = df[df[col] >= floor].sort_values(["day", col], ascending=[True, False])
    out, sent, last = [], [], {}
    for day, tid, p, y in zip(c.day.to_numpy(), c.tid.to_numpy(), c[col].to_numpy(), c.y.to_numpy()):
        while sent and sent[0] <= day - 7:
            sent.pop(0)
        if len(sent) >= per_week:
            continue
        lp = last.get(tid)
        if lp is not None and day - lp[0] < realert_days and not (p >= lp[1] + realert_gain):
            continue
        sent.append(day); last[tid] = (day, p); out.append((p, y))
    a = pd.DataFrame(out, columns=["p", "y"]); r = a[np.isfinite(a.y)]
    return f"{len(a)} meldingen, raak {int(r.y.sum())}/{len(r)} = {100 * r.y.mean():.1f}% (voorspeld {r.p.mean():.1f}%)"


def band(df, col, a=15, b=25):
    g = df[np.isfinite(df.y) & (df[col] >= a) & (df[col] < b)]
    return f"{a}–{b}%: {g[col].mean():.1f}→{100 * g.y.mean():.1f} (n={len(g)})"


variants = {"top 300 per dag (zo getest)": t["mult"].to_numpy(),
            "kopgroep per regio (zo rekent productie)": t.day.map(mults(t[kept])).to_numpy(),
            "geen bijsturing": np.ones(len(t))}
m = np.ones(len(t))
for g in range(4):
    s = (t.region == g).to_numpy(); m[s] = t.day[s].map(mults(t[kept & (t.region == g)])).to_numpy()
variants["per regio een eigen bijsturing (niet in gebruik)"] = m
print("2. meldingen (vanaf 15%, hoogstens 3 per week) bij verschillende manieren van bijsturen:")
for name, mm in variants.items():
    t["pp"] = final(t.p0.to_numpy(), mm)
    for lab, sel in (("2020–2024", (t.yr >= 2020) & (t.yr <= 2024)), ("2025–2026", t.yr >= 2025)):
        print(f"   [{name}] {lab}: {alerts(t[sel], 'pp')} | {band(t[sel], 'pp')}")
last = int(days.max())
for name, sub in (("top 300 per dag", t[t.groupby("day").raw.rank(ascending=False, method="first") <= 300]), ("kopgroep per regio", t[kept])):
    print(f"   bijsturing op de laatste dag ({name}): ×{mults(sub)[last]:.4f}")

# ── 3. Opstartregel ─────────────────────────────────────────────────────────
ad, csp, csy = sums(t[kept])
N = len(ad)
full = lambda j: (csy[j] - csy[max(0, j - 85)] + 15) / (csp[j] - csp[max(0, j - 85)] + 15)
print(f"3. opstart: verwachte treffers per dag in de kopgroep {np.diff(csp).mean():.1f}; verhouding tot het volle venster (5e–95e percentiel):")
for n in (1, 5, 10, 20, 40, 60, 85):
    r1, r2 = [], []
    for j in range(100, N - n, 5):
        seed, so, po = full(j), csy[j + n] - csy[j], csp[j + n] - csp[j]
        w = 15 + SEED_PER_DAY * max(0, 85 - n)
        r1.append((so + w * seed) / (po + w) / full(j + n)); r2.append((so + 15 * seed) / (po + 15) / full(j + n))
    print(f"   na {n:2d} dagen eigen uitkomsten: met opstartregel {np.percentile(r1, 5):.2f}–{np.percentile(r1, 95):.2f}, zonder {np.percentile(r2, 5):.2f}–{np.percentile(r2, 95):.2f}")
