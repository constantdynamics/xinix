"""Controle: komen de 'zoals TradingView'-kenmerken uit de dagkoersen overeen met wat de scanner nu levert?"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, pandas as pd, pickle
import feat
from clean import Fx
from lib import *
S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARKET, LASTDAY = sys.argv[1], sys.argv[2]
CHUNKS = [int(x) for x in sys.argv[3].split(",")]
fx = Fx(S + '/ssdata/bars')
u = pd.read_parquet(S + '/ssdata/universe.parquet').set_index('ticker').add_prefix('tv_')
rows = []
for k in CHUNKS:
    for t, c in pickle.load(open(S + f'/ssdata/prep/clean_{k:03d}.pkl', 'rb')):
        if u.loc[t, 'tv_market'] != MARKET or c['n'] < 300 or d2s(c['day'][-1]) != LASTDAY:
            continue
        X, e = feat.features(c, fx.usd(c['currency'], c['day']))
        r = {k2: float(X[-1, feat.FIDX[k2]]) for k2 in feat.LITE}
        r['ticker'] = t; r['last'] = float(c['close'][-1]); r['usd'] = float(fx.usd(c['currency'], c['day'][-1:])[0])
        rows.append(r)
d = pd.DataFrame(rows).set_index('ticker').join(u)
d = d[(d.tv_close - d['last']).abs() / d['last'] < 0.002]
print(MARKET, 'aandelen', len(d), 'kenmerken totaal', feat.NFEAT)


def cmp(a, b, x, y):
    m = np.isfinite(x) & np.isfinite(y); x = x[m]; y = y[m]
    print(f"{a:9s} vs {b:22s} n={m.sum():5d} corr={np.corrcoef(x, y)[0, 1]:.4f} med|d|={np.median(np.abs(x - y)):.5f} p95|d|={np.percentile(np.abs(x - y), 95):.4f}")


T = lambda c: d['tv_' + c]
cmp('r1', 'change', d.r1 * 100, T('change'))
cmp('t_p5d', 'Perf.5D', d.t_p5d * 100, T('Perf.5D'))
cmp('t_p1m', 'Perf.1M', d.t_p1m * 100, T('Perf.1M'))
cmp('t_p3m', 'Perf.3M', d.t_p3m * 100, T('Perf.3M'))
cmp('t_p6m', 'Perf.6M', d.t_p6m * 100, T('Perf.6M'))
cmp('t_vd', 'Volatility.D', d.t_vd * 100, T('Volatility.D'))
cmp('t_vw', 'Volatility.W', d.t_vw * 100, T('Volatility.W'))
cmp('t_vm', 'Volatility.M', d.t_vm * 100, T('Volatility.M'))
cmp('t_rv10', 'rel.vol 10d', d.t_rv10, T('relative_volume_10d_calc'))
cmp('t_v10_30', 'avg10/avg30', d.t_v10_30, T('average_volume_10d_calc') / T('average_volume_30d_calc'))
cmp('t_v30_90', 'avg30/avg90', d.t_v30_90, T('average_volume_30d_calc') / T('average_volume_90d_calc'))
cmp('t_v_30', 'vol/avg30', d.t_v_30, T('volume') / T('average_volume_30d_calc'))
cmp('t_dd52', '1-c/52wH', d.t_dd52, 1 - T('close') / T('price_52_week_high'))
cmp('t_up52', 'ln c/52wL', d.t_up52, np.log(T('close') / T('price_52_week_low')))
cmp('t_dd6m', '1-c/6mH', d.t_dd6m, 1 - T('close') / T('High.6M'))
cmp('t_dd3m', '1-c/3mH', d.t_dd3m, 1 - T('close') / T('High.3M'))
cmp('t_up3m', 'ln c/3mL', d.t_up3m, np.log(T('close') / T('Low.3M')))
cmp('t_pos3m', 'pos 3m', d.t_pos3m, ((T('close') - T('Low.3M')) / (T('High.3M') - T('Low.3M')).replace(0, np.nan)).fillna(0.5))
cmp('t_dd1m', '1-c/1mH', d.t_dd1m, 1 - T('close') / T('High.1M'))
cmp('t_up1m', 'ln c/1mL', d.t_up1m, np.log(T('close') / T('Low.1M')))
cmp('gap', 'gap', d.gap * 100, T('gap'))
cmp('intra', 'c/o-1', d.intra, T('close') / T('open') - 1)
cmp('clv', 'clv', d.clv, ((T('close') - T('low')) / (T('high') - T('low')).replace(0, np.nan)).fillna(0.5))
cmp('wick', 'h/c-1', d.wick, T('high') / T('close') - 1)
cmp('t_ldv30', 'log avg30*close*fx', d.t_ldv30, np.log10((T('average_volume_30d_calc') * T('close') * d.usd).clip(lower=1)))
cmp('t_ldv1', 'log vol*close*fx', d.t_ldv1, np.log10((T('volume') * T('close') * d.usd).clip(lower=1)))
cmp('t_ldv1', 'log Value.Traded*fx', d.t_ldv1, np.log10((T('Value.Traded') * d.usd).clip(lower=1)))
cmp('lpx', 'log close*fx', d.lpx, np.log10(T('close') * d.usd))
