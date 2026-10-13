"""Bond helpers kept for the parity checker.

The portfolio year step is reference/python/kernel.py. It uses the same
SplitMix64 draws as the TypeScript engine (MODEL_SPEC §6.1 and §5.1).

The numpy Philox generator that used to live in this file is deleted.
It was a second engine: different streams, a different year step, and a
different uniform. MODEL_SPEC §6.3 records that deletion. Regimes,
multivariate-t, sector and FX factors, the investment-grade spread,
issuer credit, target-maturity duration, and the binned 2031 range are
optional flags on the TypeScript kernel (MODEL_SPEC §7), not a second path.

`parity_check.py` extracts `bond_price`, `par_dur_conv`, and `curve_y`
by name. Those three functions stay.
"""

import numpy as np


def par_dur_conv(y, n):
    """Modified duration & convexity of an n-year annual-pay par bond at yield y (vectorized)."""
    y = np.maximum(y, 1e-4)
    def price(yy, c):
        k = np.arange(1, n + 1)[None, :]
        v = (1 + yy[..., None]) ** (-k)
        return (c[..., None] * v).sum(-1) + v[..., -1]
    h = 1e-4; c = y
    p0, pu, pd = price(y, c), price(y + h, c), price(y - h, c)
    D = -(pu - pd) / (2 * h * p0); C = (pu + pd - 2 * p0) / (h * h * p0)
    return D, C

def bond_price(c, M, y):
    """Clean-ish price per 1 face of annual coupon c, remaining maturity M (years, may be fractional), flat yield y."""
    y = np.maximum(y, -0.009)
    M = np.asarray(M, float)
    out = np.zeros(np.broadcast(c, M, y).shape)
    mmax = int(np.ceil(np.max(M))) + 1
    for j in range(mmax):
        tj = M - j
        out = out + np.where(tj > 1e-9, c * (1 + y) ** (-np.maximum(tj, 0)), 0.0)
    return out + np.where(M > 1e-9, (1 + y) ** (-np.maximum(M, 0)), 1.0)

def curve_y(M, r, y5, y10, ls):
    """3-point curve, linear interpolation in maturity; M scalar or array broadcastable."""
    M = np.asarray(M, float)
    a = np.where(M <= 0.25, r, np.where(M <= 5, r + (y5 - r) * (M - 0.25) / 4.75,
          np.where(M <= 10, y5 + (y10 - y5) * (M - 5) / 5, y10 + ls * np.minimum((M - 10) / 10, 1.0))))
    return a
