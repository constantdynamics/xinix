"""Verdachte openingskoersen uit de uitkomsten vanaf de opening halen (na labels_open.py en rsplit.py).

  python3 mask_open.py <ssdata>

Een rij telt niet mee (alle lab_*-uitkomsten worden NaN) als:
  - er een gemiste omgekeerde split in het uitkomstvenster valt (lab_rswin van rsplit.py);
  - de opening meer dan 2% buiten de hoogste en laagste koers van die dag ligt (de bron spreekt zichzelf tegen);
  - de opening meer dan 50× boven het slot ligt (eenheidsfout).
Op de dataset van november 2026: 16.411 van de 26,5 miljoen rijen.
"""
import os, sys
import numpy as np

A = os.path.join(sys.argv[1], "all")
load = lambda n: np.load(os.path.join(A, f"lab_{n}.npy"))
g, lo, hi, rs = load("gap1"), load("lo1r"), load("hi1r"), load("rswin")
ok = np.isfinite(g)
bad = ok & (((1 + g) < (1 + lo) * 0.98) | ((1 + g) > (1 + hi) * 1.02))
mask = (rs == 1) | bad | (ok & (g > 50))
print("gemaskeerd:", int(mask.sum()), "(verdacht venster %d, opening buiten de dagrange %d, sprong > 50× %d)" % (int((rs == 1).sum()), int(bad.sum()), int((ok & (g > 50)).sum())))
for k in ["gap1", "lo1r", "hi1r", "yo", "to", "r10o", "r5o", "mx10o", "mn10o", "mnl10o", "tp50o"]:
    v = load(k); v[mask] = np.nan; np.save(os.path.join(A, f"lab_{k}.npy"), v)
y = np.load(os.path.join(A, "y.npy")); yo = load("yo"); r10 = load("r10o"); g = load("gap1")
both = np.isfinite(y) & np.isfinite(yo)
print("basiskans vanaf het slot %.3f%%, vanaf de opening %.3f%%; opening t.o.v. het slot gemiddeld %+.3f%%; rendement na 10 dagen vanaf de opening gemiddeld %+.3f%% (mediaan %+.3f%%)"
      % (100 * y[both].mean(), 100 * yo[both].mean(), 100 * np.nanmean(g), 100 * np.nanmean(r10), 100 * np.nanmedian(r10)))
