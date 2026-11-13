"""Kenmerken en uitkomst (h14) per aandeel per handelsdag. Alles op dag t gebruikt alleen gegevens t/m dag t.

De functie `features(c, usd)` is de referentie: de TypeScript-versie in de edge function moet exact
hetzelfde opleveren (dat wordt met een vergelijkingstest gecontroleerd).
"""
import numpy as np
import pandas as pd

HORIZON = 10
MIN_BARS = 30
MIN_PX_USD = 0.50
MIN_DVOL_USD = 10_000.0
W = 1200          # langste terugblik in bars: past in één Yahoo-verzoek van 5 jaar

FEATURES = [
    # rendement
    "r1", "r2", "r3", "r5", "r10", "r22", "r63", "r126", "r252",
    # dag zelf
    "gap", "intra", "clv", "rng1", "wick", "gap5", "gapmax22",
    # beweeglijkheid
    "rng5", "rng22", "rng63", "sd10", "sd22", "sd63", "rng_ratio", "sd_ratio",
    "max1d_5", "max1d_22", "max1d_63", "max1d_252", "min1d_22", "min1d_63",
    "nup10_22", "nup10_63", "nup20_63", "nup20_252", "ndn10_22", "ndn20_63",
    # volume en omzet
    "vrel1", "vrel5", "vrel22", "vmax5", "vmax22", "vmin5", "ldv30", "ldv1", "ldv5", "zerov22", "since_vmax63", "upvol10",
    # plaats in de grafiek
    "dd22", "dd63", "dd252", "dd504", "ddall", "up22", "up63", "up252", "pos63", "pos252", "box10", "box22",
    "since_hi252", "since_lo252", "sma10", "sma22", "sma50", "sma200", "runup", "rundn", "fromlo10", "fromlo22",
    # eerdere explosies
    "since_peak", "npeak252", "npeak504", "maxr10_252", "maxr10_504", "nup50_252", "nup50_504", "own_rate", "own_n", "since_rsplit",
    # verloop van de laatste dagen en van de lopende sprint
    "r1_l1", "r1_l2", "r1_l3", "vrel1_l1", "vrel1_l2", "clv_l1", "rng1_l1", "gap_l1",
    "since_lo22", "since_hi22", "since_max1d22", "ret_since_max1d22", "vol_since_max1d22", "since_lo63",
    # niveau
    "lpx", "nbars",
    # zoals TradingView ze levert (voor de goedkope voorselectie); definities gecontroleerd tegen de scanner
    "t_p5d", "t_p1m", "t_p3m", "t_p6m", "t_vd", "t_vw", "t_vm", "t_rv10", "t_v10_30", "t_v30_90", "t_v_30",
    "t_dd52", "t_up52", "t_dd6m", "t_dd3m", "t_up3m", "t_pos3m", "t_dd1m", "t_up1m", "t_ldv30", "t_ldv1",
]
LITE = ["r1", "gap", "intra", "clv", "wick", "lpx",
        "t_p5d", "t_p1m", "t_vd", "t_vw", "t_vm", "t_rv10", "t_v10_30", "t_v30_90", "t_v_30",
        "t_dd52", "t_up52", "t_dd6m", "t_dd3m", "t_up3m", "t_pos3m", "t_dd1m", "t_up1m", "t_ldv30", "t_ldv1"]
NFEAT = len(FEATURES)
FIDX = {k: i for i, k in enumerate(FEATURES)}


def _roll(x, w, fn, minp=None):
    s = pd.Series(x)
    r = s.rolling(w, min_periods=minp if minp is not None else w)
    return getattr(r, fn)().to_numpy()


def _shift(x, k):
    out = np.full(len(x), np.nan)
    if k < len(x):
        out[k:] = x[:-k] if k > 0 else x
    return out


def _since_true(mask):
    """Bars sinds de laatste True (0 op de dag zelf), NaN als nog nooit."""
    n = len(mask)
    idx = np.where(mask, np.arange(n), -1)
    last = np.maximum.accumulate(idx)
    out = (np.arange(n) - last).astype(np.float64)
    out[last < 0] = np.nan
    return out


def _run_length(mask):
    """Aantal opeenvolgende True's eindigend op elke dag."""
    n = len(mask)
    idx = np.where(~mask, np.arange(n), -1)
    last_false = np.maximum.accumulate(idx)
    return (np.arange(n) - last_false).astype(np.float64)


def _arg_since(x, w, kind):
    """Bars sinds het hoogste (of laagste) slot in de laatste w bars (incl. vandaag)."""
    s = pd.Series(x)
    r = s.rolling(w, min_periods=1)
    f = (lambda a: len(a) - 1 - np.argmax(a)) if kind == "max" else (lambda a: len(a) - 1 - np.argmin(a))
    return r.apply(f, raw=True).to_numpy()


def _months_back_idx(day, months):
    """Per dag t: index van de eerste bar met datum > (datum t, `months` kalendermaanden terug)."""
    d = day.astype("datetime64[D]")
    ym = d.astype("datetime64[M]")
    dom = (d - ym).astype(np.int64)                         # dag van de maand - 1
    tm = ym - np.timedelta64(months, "M")
    mlen = ((tm + np.timedelta64(1, "M")).astype("datetime64[D]") - tm.astype("datetime64[D]")).astype(np.int64)
    target = tm.astype("datetime64[D]") + np.minimum(dom, mlen - 1).astype("timedelta64[D]")
    return np.searchsorted(day, target.astype(np.int64), side="right")


def labels(a):
    """h14: eerste dag j in t+1..t+10 met slot ≥ 1,5× slot(t) die op j+1 nog ≥ 1,2× staat.
    Geeft (y, jhit): y = 1/0 of NaN (nog niet te beoordelen), jhit = index van de trefdag of -1."""
    n = len(a)
    y = np.full(n, np.nan)
    jhit = np.full(n, -1, np.int32)
    if n <= HORIZON + 1:
        return y, jhit
    hit = np.zeros(n, bool)
    first = np.full(n, -1, np.int32)
    for k in range(1, HORIZON + 1):
        m = n - k - 1                       # t loopt tot n-k-2, want j+1 moet bestaan
        if m <= 0:
            continue
        t = np.arange(m)
        ok = (a[t + k] >= 1.5 * a[t]) & (a[t + k + 1] >= 1.2 * a[t]) & ~hit[:m]
        first[:m][ok] = t[ok] + k
        hit[:m] |= ok
    res = n - HORIZON - 1                   # dagen met volledig venster: t + 11 ≤ n - 1
    y[:res] = hit[:res]
    jhit[:res] = first[:res]
    return y, jhit


def features(c, usd):
    """c: opgeschoonde reeks (clean.py), usd: USD per lokale eenheid per dag. Geeft (X, extra)."""
    a = c["adj"].astype(np.float64)
    n = len(a)
    vol = c["vol"].astype(np.float64)
    hi = c["high"].astype(np.float64) * a
    lo = c["low"].astype(np.float64) * a
    op = c["open"].astype(np.float64) * a
    px_usd = c["px"] * usd
    dv_usd = c["dvol_local"] * usd
    X = np.full((n, NFEAT), np.nan, np.float32)

    def put(k, v):
        X[:, FIDX[k]] = v

    prev = _shift(a, 1)
    r1 = a / prev - 1
    for k in (1, 2, 3, 5, 10, 22, 63, 126, 252):
        put(f"r{k}", a / _shift(a, k) - 1)
    gap = op / prev - 1
    put("gap", gap)
    put("gap5", _roll(gap, 5, "sum", 3)); put("gapmax22", _roll(gap, 22, "max", 10))
    put("intra", a / op - 1)
    rng = hi / lo - 1
    put("clv", np.where(hi > lo, (a - lo) / np.where(hi > lo, hi - lo, 1), 0.5))
    put("rng1", rng)
    put("wick", hi / a - 1)

    rng5, rng22, rng63 = _roll(rng, 5, "mean"), _roll(rng, 22, "mean"), _roll(rng, 63, "mean", 30)
    put("rng5", rng5); put("rng22", rng22); put("rng63", rng63)
    lr = np.log(a / prev)
    sd10, sd22, sd63 = _roll(lr, 10, "std"), _roll(lr, 22, "std"), _roll(lr, 63, "std", 30)
    put("sd10", sd10); put("sd22", sd22); put("sd63", sd63)
    put("rng_ratio", rng5 / np.where(rng63 > 0, rng63, np.nan))
    put("sd_ratio", sd10 / np.where(sd63 > 0, sd63, np.nan))
    for w in (5, 22, 63, 252):
        put(f"max1d_{w}", _roll(r1, w, "max", min(w, 20)))
    put("min1d_22", _roll(r1, 22, "min", 20)); put("min1d_63", _roll(r1, 63, "min", 20))
    up10, up20, up50 = (r1 >= 0.10).astype(float), (r1 >= 0.20).astype(float), (r1 >= 0.50).astype(float)
    dn10, dn20 = (r1 <= -0.10).astype(float), (r1 <= -0.20).astype(float)
    put("nup10_22", _roll(up10, 22, "sum", 1)); put("nup10_63", _roll(up10, 63, "sum", 1))
    put("nup20_63", _roll(up20, 63, "sum", 1)); put("nup20_252", _roll(up20, 252, "sum", 1))
    put("ndn10_22", _roll(dn10, 22, "sum", 1)); put("ndn20_63", _roll(dn20, 63, "sum", 1))
    put("nup50_252", _roll(up50, 252, "sum", 1)); put("nup50_504", _roll(up50, 504, "sum", 1))

    # volume: steeds t.o.v. een gemiddelde dat vóór het vergeleken venster ligt
    avg30p = _shift(_roll(vol, 30, "mean", 15), 1)
    vrel1 = vol / np.where(avg30p > 0, avg30p, np.nan)
    put("vrel1", vrel1)
    put("vrel5", _roll(vol, 5, "mean") / np.where(_shift(_roll(vol, 58, "mean", 30), 5) > 0, _shift(_roll(vol, 58, "mean", 30), 5), np.nan))
    put("vrel22", _roll(vol, 22, "mean") / np.where(_shift(_roll(vol, 230, "mean", 60), 22) > 0, _shift(_roll(vol, 230, "mean", 60), 22), np.nan))
    put("vmax5", _roll(vrel1, 5, "max", 1)); put("vmax22", _roll(vrel1, 22, "max", 1)); put("vmin5", _roll(vrel1, 5, "min", 1))
    dv30 = _shift(_roll(dv_usd, 30, "mean", 15), 1)          # omzet per dag over de 30 dagen ervoor
    put("ldv30", np.log10(np.maximum(dv30, 1.0)))
    put("ldv1", np.log10(np.maximum(dv_usd, 1.0)))
    put("ldv5", np.log10(np.maximum(_roll(dv_usd, 5, "mean", 1), 1.0)))
    put("zerov22", _roll((vol <= 0).astype(float), 22, "mean", 5))
    put("since_vmax63", _arg_since(vol, 63, "max"))
    upv = _roll(np.where(r1 > 0, vol, 0.0), 10, "sum", 5)
    allv = _roll(vol, 10, "sum", 5)
    put("upvol10", upv / np.where(allv > 0, allv, np.nan))

    for w, key in ((22, "dd22"), (63, "dd63"), (252, "dd252"), (504, "dd504")):
        put(key, 1 - a / _roll(a, w, "max", 1))
    put("ddall", 1 - a / _roll(a, W, "max", 1))
    for w, key in ((10, "box10"), (22, "box22")):
        put(key, _roll(a, w, "max", w) / _roll(a, w, "min", w) - 1)
    for w, key in ((22, "up22"), (63, "up63"), (252, "up252")):
        put(key, np.log(a / _roll(a, w, "min", 1)))
    for w, key in ((63, "pos63"), (252, "pos252")):
        h, l = _roll(a, w, "max", 1), _roll(a, w, "min", 1)
        put(key, np.where(h > l, (a - l) / np.where(h > l, h - l, 1), 0.5))
    put("since_hi252", _arg_since(a, 252, "max")); put("since_lo252", _arg_since(a, 252, "min"))
    for w in (10, 22, 50, 200):
        put(f"sma{w}", a / _roll(a, w, "mean", max(5, w // 2)) - 1)
    put("runup", _run_length(r1 > 0)); put("rundn", _run_length(r1 < 0))
    put("fromlo10", a / _roll(a, 10, "min", 1) - 1); put("fromlo22", a / _roll(a, 22, "min", 1) - 1)

    # eerdere explosies: piekdag = slot ≥ 1,5× het laagste slot van de 10 dagen ervoor
    lo10p = _shift(_roll(a, 10, "min", 1), 1)
    is_peak = a >= 1.5 * lo10p
    sp = _since_true(is_peak)
    put("since_peak", np.where(sp <= W - 15, sp, np.nan))
    start = is_peak & ~np.concatenate([[False], is_peak[:-1]])
    put("npeak252", _roll(start.astype(float), 252, "sum", 1)); put("npeak504", _roll(start.astype(float), 504, "sum", 1))
    r10 = a / _shift(a, 10) - 1
    put("maxr10_252", _roll(r10, 252, "max", 10)); put("maxr10_504", _roll(r10, 504, "max", 10))

    y, jhit = labels(a)
    # eigen trefkans tot nu toe: alleen uitkomsten die op dag t al bekend zijn (dag ≤ t-11)
    # (binnen het venster van W bars, zodat het uit één verzoek van 5 jaar volgt)
    lag = HORIZON + 1
    yk = _shift(np.where(np.isfinite(y), y, 0.0), lag)
    known = _shift(np.isfinite(y).astype(float), lag)
    h_before = np.nan_to_num(_roll(np.nan_to_num(yk), W - lag, "sum", 1))
    n_before = np.nan_to_num(_roll(np.nan_to_num(known), W - lag, "sum", 1))
    put("own_rate", (h_before + 250 * 0.004) / (n_before + 250))
    put("own_n", n_before)
    # bars sinds de laatste omgekeerde split (alleen zichtbaar binnen het venster)
    rs = np.zeros(n, bool)
    for sdt, num, den in c.get("splits", np.zeros((0, 3))):
        if num > 0 and den > 0 and num < den:
            i = int(np.searchsorted(c["day"], int(sdt) // 86400, side="left"))
            if 0 <= i < n:
                rs[i] = True
    srs = _since_true(rs)
    put("since_rsplit", np.where(srs <= W - 15, srs, np.nan))

    # verloop van de laatste dagen
    put("r1_l1", _shift(r1, 1)); put("r1_l2", _shift(r1, 2)); put("r1_l3", _shift(r1, 3))
    put("vrel1_l1", _shift(vrel1, 1)); put("vrel1_l2", _shift(vrel1, 2))
    clv = np.where(hi > lo, (a - lo) / np.where(hi > lo, hi - lo, 1), 0.5)
    put("clv_l1", _shift(clv, 1)); put("rng1_l1", _shift(rng, 1)); put("gap_l1", _shift(gap, 1))
    put("since_lo22", _arg_since(a, 22, "min")); put("since_hi22", _arg_since(a, 22, "max")); put("since_lo63", _arg_since(a, 63, "min"))
    # de grootste stijgdag van de laatste 22 dagen: hoe lang geleden, en wat deed de koers en het volume sindsdien
    r1z = np.where(np.isfinite(r1), r1, -1.0)
    k = _arg_since(r1z, 22, "max").astype(np.int64)
    j = np.maximum(np.arange(n) - k, 0)
    put("since_max1d22", k.astype(np.float64))
    put("ret_since_max1d22", a / a[j] - 1)
    cv = np.concatenate([[0.0], np.cumsum(vol)])
    mean_since = np.where(k > 0, (cv[np.arange(n) + 1] - cv[j + 1]) / np.maximum(k, 1), np.nan)
    put("vol_since_max1d22", mean_since / np.where(vol[j] > 0, vol[j], np.nan))

    put("lpx", np.log10(np.maximum(px_usd, 1e-6)))
    put("nbars", np.minimum(np.arange(n), W).astype(np.float64))

    # ── TradingView-definities (op de niet voor dividend gecorrigeerde reeks) ──
    cl = c["close"].astype(np.float64)
    fac = cl / a
    O, H, L = op * fac, hi * fac, lo * fac
    idx = np.arange(n)
    put("t_p5d", cl / _shift(O, 4) - 1)
    for months, key in ((1, "t_p1m"), (3, "t_p3m"), (6, "t_p6m")):
        j = _months_back_idx(c["day"], months)
        okj = (j < idx) & (j > 0)              # j == 0: de reeks begint pas binnen het venster
        put(key, np.where(okj, cl / O[np.minimum(j, n - 1)] - 1, np.nan))
    dr = H / L - 1
    put("t_vd", dr); put("t_vw", _roll(dr, 5, "mean")); put("t_vm", _roll(dr, 22, "mean"))
    av10p = _shift(_roll(vol, 10, "mean"), 1)
    put("t_rv10", vol / np.where(av10p > 0, av10p, np.nan))
    av10, av30, av90 = _roll(vol, 10, "mean"), _roll(vol, 30, "mean", 15), _roll(vol, 90, "mean", 30)
    put("t_v10_30", av10 / np.where(av30 > 0, av30, np.nan)); put("t_v30_90", av30 / np.where(av90 > 0, av90, np.nan))
    put("t_v_30", vol / np.where(av30 > 0, av30, np.nan))
    for w, kd, ku in ((252, "t_dd52", "t_up52"), (63, "t_dd3m", "t_up3m"), (22, "t_dd1m", "t_up1m")):
        hh, ll = _roll(H, w, "max", 1), _roll(L, w, "min", 1)
        put(kd, 1 - cl / hh); put(ku, np.log(cl / ll))
        if w == 63:
            put("t_pos3m", np.where(hh > ll, (cl - ll) / np.where(hh > ll, hh - ll, 1), 0.5))
    put("t_dd6m", 1 - cl / _roll(H, 126, "max", 1))
    tv_dv30 = av30 * cl * usd                  # zoals Sprinters: slot × gemiddeld volume (30 dagen) × wisselkoers
    put("t_ldv30", np.log10(np.maximum(tv_dv30, 1.0)))
    put("t_ldv1", np.log10(np.maximum(vol * cl * usd, 1.0)))

    elig = (np.arange(n) >= MIN_BARS) & (px_usd >= MIN_PX_USD) & (tv_dv30 >= MIN_DVOL_USD)
    # uitkomst telt niet als de trefdag zonder handel was (koers zonder volume)
    bad = np.zeros(n, bool)
    hj = jhit >= 0
    bad[hj] = vol[jhit[hj]] <= 0
    extra = {"y": y, "jhit": jhit, "elig": elig, "bad": bad, "px_usd": px_usd, "dv30": tv_dv30, "r1": r1,
             "r5": a / _shift(a, 5) - 1, "r22": a / _shift(a, 22) - 1}
    return X, extra
