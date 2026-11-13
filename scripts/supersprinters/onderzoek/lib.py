"""Gedeelde laders en hulpfuncties voor het onderzoek."""
import os, json, datetime as dt
import numpy as np, pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ssdata")   # scripts/supersprinters/ssdata
ALL = os.path.join(ROOT, "all")
EPOCH = dt.date(1970, 1, 1)


def d2s(d):
    return str(EPOCH + dt.timedelta(days=int(d)))


def s2d(s):
    return (dt.date.fromisoformat(s) - EPOCH).days


def load_cols(names=("tid", "day", "tix", "y", "px", "dv", "eid")):
    return {n: np.load(os.path.join(ALL, f"{n}.npy"), mmap_mode="r") for n in names}


def load_X():
    return np.load(os.path.join(ALL, "X.npy"), mmap_mode="r")


def load_meta():
    return pd.read_parquet(os.path.join(ALL, "meta.parquet"))


def year_of(day):
    return (np.asarray(day).astype("datetime64[D]").astype("datetime64[Y]").astype(int) + 1970).astype(np.int16)
