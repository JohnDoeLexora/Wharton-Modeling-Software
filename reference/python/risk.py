"""Daily risk identities and the estimators shared with the TypeScript engine.

Integer results use floor division, the same policy as bend/risk.bend.
Float estimators are ordinary EWMA, OLS, Vasicek, variance-targeted GARCH(1,1),
Kupiec, and Ledoit-Wolf toward a scaled identity. This file does not import
the app and it does not contain a portfolio.
"""

from __future__ import annotations

import math

PPM = 1_000_000


def muldiv(a: int, b: int, d: int) -> int:
    if d == 0:
        return 0
    return (a * b) // d


def ewma_step_ppm(lambda_ppm: int, variance: int, squared: int) -> int:
    return muldiv(lambda_ppm, variance, PPM) + muldiv(PPM - lambda_ppm, squared, PPM)


def vasicek_ppm(raw: int, prior: int, prior_var: int, se2: int) -> int:
    denom = prior_var + se2
    if denom == 0:
        return raw
    return muldiv(raw, prior_var, denom) + muldiv(prior, se2, denom)


def jump_variance_ppm(diffusion: int, intensity: int, mean_square: int) -> int:
    return diffusion + intensity * mean_square


def shrunk_cov() -> dict[str, int]:
    delta = 250_000
    keep = PPM - delta
    mu = 90
    s11 = muldiv(keep, 100, PPM) + muldiv(delta, mu, PPM)
    s22 = muldiv(keep, 80, PPM) + muldiv(delta, mu, PPM)
    s12 = muldiv(keep, 20, PPM)
    return {"s11": s11, "s12": s12, "s22": s22, "det": s11 * s22 - s12 * s12}


def ewma_next(returns: list[float], lam: float = 0.94) -> float:
    warm = returns[: min(20, len(returns))]
    nxt = sum(value * value for value in warm) / len(warm) if warm else 1e-12
    nxt = max(nxt, 1e-12)
    clipped = min(0.999, max(0.001, lam))
    for value in returns:
        squared = value * value if math.isfinite(value) else 0.0
        nxt = clipped * nxt + (1.0 - clipped) * squared
        if not nxt > 0:
            nxt = 1e-12
    return nxt


def ols_intercept(y: list[float], x: list[float]) -> tuple[float, float, float]:
    n = len(y)
    mean_x = sum(x) / n
    mean_y = sum(y) / n
    sxx = sum((xi - mean_x) ** 2 for xi in x)
    sxy = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    sse = sum((yi - intercept - slope * xi) ** 2 for xi, yi in zip(x, y))
    sigma2 = sse / (n - 2)
    se = math.sqrt(sigma2 / sxx)
    return intercept, slope, se


def vasicek_beta(raw: float, se: float, prior: float, prior_var: float) -> float:
    se2 = se * se if math.isfinite(se) else math.inf
    pv = max(0.0, prior_var)
    denom = pv + se2
    if not math.isfinite(denom) or denom <= 0:
        return raw
    weight = pv / denom
    return weight * raw + (1.0 - weight) * prior


def _garch_path(demeaned: list[float], long_run: float, alpha: float, beta: float) -> tuple[float, float]:
    omega = long_run * (1.0 - alpha - beta)
    nxt = long_run
    log_lik = 0.0
    for value in demeaned:
        variance = max(nxt, 1e-16)
        log_lik += -0.5 * (math.log(2.0 * math.pi) + math.log(variance) + (value * value) / variance)
        nxt = omega + alpha * value * value + beta * variance
        if not nxt > 0:
            nxt = 1e-16
    return nxt, log_lik


def fit_garch(returns: list[float]) -> dict[str, float | bool]:
    if len(returns) < 30:
        return {"ok": False, "alpha": math.nan, "beta": math.nan, "omega": math.nan, "longRun": math.nan}
    center = sum(returns) / len(returns)
    demeaned = [value - center for value in returns]
    long_run = max(sum(value * value for value in demeaned) / len(demeaned), 1e-12)
    best_a = 0.0
    best_b = 0.9
    best_ll = -math.inf
    for ai in range(0, 21):
        alpha = ai / 100
        for bi in range(50, 99, 2):
            beta = bi / 100
            if alpha + beta >= 0.995:
                continue
            _, log_lik = _garch_path(demeaned, long_run, alpha, beta)
            better = log_lik > best_ll + 1e-9
            tie = abs(log_lik - best_ll) <= 1e-9 and (alpha < best_a or (alpha == best_a and beta < best_b))
            if better or tie:
                best_ll = log_lik
                best_a = alpha
                best_b = beta
    omega = long_run * (1.0 - best_a - best_b)
    return {"ok": True, "alpha": best_a, "beta": best_b, "omega": omega, "longRun": long_run}


def kupiec(hits: int, n: int, p: float) -> tuple[float, float]:
    rate = hits / n
    alt = (0.0 if hits == 0 else hits * math.log(rate)) + (0.0 if hits == n else (n - hits) * math.log(1.0 - rate))
    nul = hits * math.log(p) + (n - hits) * math.log(1.0 - p)
    lr = max(0.0, -2.0 * (nul - alt))
    if lr == 0:
        return lr, 1.0
    return lr, 1.0 - math.erf(math.sqrt(lr / 2.0))


def ledoit_wolf(samples: list[list[float]]) -> tuple[float, list[list[float]]]:
    n = len(samples)
    p = len(samples[0])
    center = [0.0] * p
    for row in samples:
        for i in range(p):
            center[i] += row[i]
    for i in range(p):
        center[i] /= n
    centered = [[row[i] - center[i] for i in range(p)] for row in samples]
    emp = [[0.0] * p for _ in range(p)]
    for row in centered:
        for i in range(p):
            for j in range(i, p):
                emp[i][j] += row[i] * row[j]
    for i in range(p):
        for j in range(i, p):
            emp[i][j] /= n
            emp[j][i] = emp[i][j]
    mu = sum(emp[i][i] for i in range(p)) / p
    sum_sq = 0.0
    for i in range(p):
        for j in range(p):
            delta = emp[i][j] - (mu if i == j else 0.0)
            sum_sq += delta * delta
    beta_sum = 0.0
    for i in range(p):
        for j in range(p):
            second = 0.0
            for row in centered:
                prod = row[i] * row[j]
                second += prod * prod
            second /= n
            beta_sum += second - emp[i][j] * emp[i][j]
    beta = beta_sum / n
    shrinkage = 0.0 if sum_sq == 0 else min(1.0, max(0.0, beta / sum_sq))
    cov = [
        [(1.0 - shrinkage) * emp[i][j] + (shrinkage * mu if i == j else 0.0) for j in range(p)]
        for i in range(p)
    ]
    return shrinkage, cov
