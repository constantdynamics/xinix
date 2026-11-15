"""Gedeelde tabel voor de proeven met ja/nee-feiten per kandidaat-dag (kas_test.py, tekst_test.py).

Per feit en per periode: aantal kandidaat-dagen met het feit, raak vanaf het slot en vanaf de opening, en het aandeel
dat tien handelsdagen later 30% of meer lager stond, telkens met en zonder het feit. Daarna de feiten die aan de vooraf
vastgelegde lat voldoen: in beide perioden dezelfde kant op, minstens 5 punten verschil, minstens 100 kandidaat-dagen
met het feit in elke periode.
"""
import numpy as np

MIN_N, MIN_VERSCHIL = 100, 5.0


def stats(g):
    return len(g), 100 * g.y.mean(), 100 * g.yo.mean(), 100 * (g.r10o <= -0.3).mean(), 100 * g.r10o.mean()


def tabel(E, flags, periods, min_show=30):
    """E: kandidaat-dagen; flags: naam → booleaanse reeks op de index van E (NaN = onbekend, telt niet mee)."""
    rows = []
    print(f"{'feit':58s} | " + " | ".join(f"{lab}: n · raak slot met/zonder · raak opening · −30%" for lab, _ in periods))
    for nm, fl in flags.items():
        parts = []; rec = {"feit": nm}
        for lab, m in periods:
            g = E[m.reindex(E.index).fillna(False)]
            f = fl.reindex(g.index)
            a, b = g[f == True], g[f == False]            # noqa: E712  (NaN valt in geen van beide)
            if len(a) < min_show or len(b) < min_show: parts.append(f"n={len(a):5d} (te weinig)"); continue
            sa, sb = stats(a), stats(b)
            parts.append(f"n={sa[0]:5d} · {sa[1]:4.1f}/{sb[1]:4.1f} · {sa[2]:4.1f}/{sb[2]:4.1f} · {sa[3]:4.1f}/{sb[3]:4.1f}")
            rec[lab] = {"n": sa[0], "slot": sa[1] - sb[1], "open": sa[2] - sb[2], "verlies": sa[3] - sb[3], "met": sa, "zonder": sb}
        rows.append(rec)
        print(f"{nm:58s} | " + " | ".join(parts))
    labs = [lab for lab, _ in periods]
    print(f"\n-- feiten die aan de lat voldoen (beide perioden dezelfde kant op, ≥ {MIN_VERSCHIL:.0f} punten, ≥ {MIN_N} kandidaat-dagen met het feit) --")
    n_ok = 0
    for r in rows:
        if any(lab not in r for lab in labs): continue
        a, b = r[labs[0]], r[labs[1]]
        if min(a["n"], b["n"]) < MIN_N: continue
        hit = [k for k in ("slot", "open", "verlies") if a[k] * b[k] > 0 and min(abs(a[k]), abs(b[k])) >= MIN_VERSCHIL]
        if not hit: continue
        n_ok += 1
        print(f"  {r['feit']:58s} " + " · ".join(f"{k} {a[k]:+5.1f} / {b[k]:+5.1f}" for k in ("slot", "open", "verlies")) + f" · n {a['n']} / {b['n']}  → op: {', '.join(hit)}")
    if not n_ok: print("  geen")
    return rows


def auc_pair(y, base, extra):
    """Onderscheid (AUC) van de bestaande score en van de score met het extra model, op dezelfde rijen."""
    from sklearn.metrics import roc_auc_score
    y = np.asarray(y)
    if len(np.unique(y)) < 2: return np.nan, np.nan
    return roc_auc_score(y, base), roc_auc_score(y, extra)
