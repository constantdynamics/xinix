"""Opschonen van een Yahoo-dagreeks tot iets waar je eerlijk op kunt meten.

Volgt de schoonmaak van _shared/engine.ts (fetchYahoo10y) en _shared/units.ts, met drie aanvullingen:
  * eenheidswissels (pence/pond e.d.) worden rechtgezet,
  * een gemelde split die nog niet in de reeks verwerkt is, wordt alsnog verwerkt,
  * de werkelijke koers van de dag zelf wordt teruggerekend (Yahoo's slotkoers is achteraf voor splits
    aangepast: een aandeel van $0,20 met later een omgekeerde split van 1:50 staat er als $10).
"""
import json, os
import numpy as np

DAY = 86400
SUB_OF_MAIN = {"GBP": "GBp", "ZAR": "ZAc", "ILS": "ILA"}
SUBUNITS = {"GBp", "GBX", "ZAc", "ZAC", "ILA"}
MAX_BAR_JUMP = 5.0

# USD per eenheid, statisch (zelfde tabel als engine.ts) — alleen als er geen historische koers is.
FX_STATIC = {"USD": 1, "CAD": 0.73, "AUD": 0.66, "NZD": 0.6, "GBP": 1.33, "GBX": 0.0133, "GBp": 0.0133, "EUR": 1.12, "CHF": 1.2,
             "SEK": 0.105, "NOK": 0.098, "DKK": 0.15, "PLN": 0.27, "HKD": 0.128, "JPY": 0.0068, "SGD": 0.77,
             "ZAR": 0.055, "ZAc": 0.00055, "ILS": 0.27, "ILA": 0.0027, "CNY": 0.14}


def unit_jump(r):
    if 40 <= r <= 250:
        return 1 / 100
    if 1 / 250 <= r <= 1 / 40:
        return 100
    return 1.0


def load_raw(path):
    z = np.load(path, allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    return {k: z[k] for k in ("ts", "open", "high", "low", "close", "adj", "vol", "splits")}, meta


def clean(raw, meta, ticker):
    """Geeft dict met arrays (zelfde lengte n) of None."""
    ts = raw["ts"].astype(np.int64)
    c = raw["close"].astype(np.float64)
    a = raw["adj"].astype(np.float64)
    o = raw["open"].astype(np.float64)
    h = raw["high"].astype(np.float64)
    l = raw["low"].astype(np.float64)
    v = raw["vol"].astype(np.float64)
    first = (meta.get("firstTradeDate") or 0) - DAY
    ok = np.isfinite(c) & (c > 0) & (ts >= first)
    # dubbele tijdstempels (Yahoo plakt soms de lopende dag er nog eens achter)
    if ok.sum() < 5:
        return None
    ts, c, a, o, h, l, v = ts[ok], c[ok], a[ok], o[ok], h[ok], l[ok], v[ok]
    # Datum in de tijdzone van de beurs. Yahoo geeft het begin van de sessie in UTC: voor Sydney is dat in
    # de zomertijd 23:00 uur van de dag ervóór, en de lopende koers komt er als extra bar achteraan.
    day = ((ts + int(meta.get("gmtoffset") or 0)) // DAY).astype(np.int32)
    keep = np.ones(len(day), bool)
    keep[:-1] = day[1:] != day[:-1]          # bij dubbele dag: de laatste houden
    ts, c, a, o, h, l, v, day = ts[keep], c[keep], a[keep], o[keep], h[keep], l[keep], v[keep], day[keep]
    a = np.where(np.isfinite(a) & (a > 0), a, c)
    h = np.where(np.isfinite(h) & (h > 0), h, c)
    l = np.where(np.isfinite(l) & (l > 0), l, c)
    o = np.where(np.isfinite(o) & (o > 0), o, c)
    v = np.where(np.isfinite(v) & (v >= 0), v, 0.0)
    hh = np.maximum(h, l); ll = np.minimum(h, l); h, l = hh, ll
    n = len(c)
    flags = {"unit_fix": 0, "split_fix": 0, "blips": 0}

    # 1. Eenheidswissels binnen de reeks (alleen munten met een subeenheid).
    cur = meta.get("currency")
    has_sub = (cur in SUBUNITS or cur in SUB_OF_MAIN) if cur else ticker.upper().endswith((".L", ".IL", ".JO", ".TA"))
    if has_sub:
        scale = np.ones(n)
        nxt = c[-1]
        f_run = 1.0
        for i in range(n - 2, -1, -1):
            f = unit_jump((c[i] * f_run) / nxt)
            if f != 1.0:
                f_run *= f
                flags["unit_fix"] += 1
            scale[i] = f_run
            nxt = c[i] * f_run
        if flags["unit_fix"]:
            c = c * scale; a = a * scale; o = o * scale; h = h * scale; l = l * scale
        if cur in SUB_OF_MAIN:           # hoofdmunt → subeenheid (pond → pence)
            c = c * 100; a = a * 100; o = o * 100; h = h * 100; l = l * 100
            cur = SUB_OF_MAIN[cur]

    # 2. Gemelde split die nog niet in adj/close verwerkt is: sprong van (ongeveer) de splitfactor.
    splits = raw["splits"]
    for s in splits:
        sd, num, den = int(s[0]) // DAY, s[1], s[2]
        if not (num > 0 and den > 0) or num == den:
            continue
        f = den / num                       # factor waarmee oudere koersen vermenigvuldigd horen te zijn
        i = int(np.searchsorted(day, sd, side="left"))
        if i <= 0 or i >= n:
            continue
        jump = a[i] / a[i - 1]
        if abs(np.log(jump / f)) < abs(np.log(jump)) and abs(np.log(f)) > np.log(1.8):
            a[:i] *= f; c[:i] *= f; o[:i] *= f; h[:i] *= f; l[:i] *= f
            v[:i] /= f
            flags["split_fix"] += 1

    # 3. Eéndaagse datafouten: bar ≥5× de vorige en meteen terug (engine), en het spiegelbeeld.
    good = np.ones(n, bool)
    prev = np.nan
    for i in range(n):
        nx = a[i + 1] if i + 1 < n else np.nan
        if np.isfinite(prev) and np.isfinite(nx):
            if a[i] >= prev * MAX_BAR_JUMP and nx < prev * 1.5:
                good[i] = False; continue
            if a[i] <= prev / MAX_BAR_JUMP and nx > prev / 1.5:
                good[i] = False; continue
        prev = a[i]
    flags["blips"] = int((~good).sum())
    if flags["blips"]:
        ts, c, a, o, h, l, v, day = ts[good], c[good], a[good], o[good], h[good], l[good], v[good], day[good]
        n = len(c)
    if n < 5:
        return None

    # 4. Werkelijke koers en volume van de dag zelf: splits ná die dag terugdraaien.
    back = np.ones(n)
    for s in splits:
        sd, num, den = int(s[0]) // DAY, s[1], s[2]
        if not (num > 0 and den > 0) or num == den:
            continue
        i = int(np.searchsorted(day, sd, side="left"))
        if i > 0:
            back[:i] *= num / den            # 1:50 omgekeerde split → oude koersen ÷ 50
    px = c * back                             # werkelijke slotkoers (lokale munt/subeenheid)
    # dagrange/gap als verhoudingen op de (voor dividend) gecorrigeerde reeks
    ratio = a / c
    return {
        "day": day, "adj": a, "close": c, "px": px, "open": o * ratio, "high": h * ratio, "low": l * ratio,
        "vol": v, "dvol_local": c * v,       # lokale omzet per dag (ongevoelig voor splits)
        "currency": cur, "flags": flags, "n": n, "split_days": (splits[:, 0] // DAY).astype(np.int32) if len(splits) else np.zeros(0, np.int32),
    }


class Fx:
    """USD per lokale eenheid per dag, uit Yahoo-reeksen (XXXUSD=X); anders de statische tabel."""

    def __init__(self, bars_dir):
        self.series = {}
        for cur in ("CAD", "AUD", "GBP", "EUR", "CHF", "SEK", "NOK", "DKK", "PLN", "HKD", "JPY", "SGD", "CNY"):
            p = os.path.join(bars_dir, f"{cur}USD=X.npz")
            if not os.path.exists(p):
                continue
            raw, _ = load_raw(p)
            ok = np.isfinite(raw["close"]) & (raw["close"] > 0)
            d = (raw["ts"][ok] // DAY).astype(np.int32)
            self.series[cur] = (d, raw["close"][ok].astype(np.float64))

    def usd(self, cur, days):
        if cur in (None, "USD"):
            return np.ones(len(days))
        mult = 1.0
        base = cur
        if cur in ("GBp", "GBX"):
            base, mult = "GBP", 0.01
        elif cur == "ZAc":
            base, mult = "ZAR", 0.01
        elif cur == "ILA":
            base, mult = "ILS", 0.01
        s = self.series.get(base)
        if s is None:
            return np.full(len(days), FX_STATIC.get(cur, FX_STATIC.get(base, 1.0) * mult))
        d, x = s
        idx = np.clip(np.searchsorted(d, days, side="right") - 1, 0, len(d) - 1)
        return x[idx] * mult
