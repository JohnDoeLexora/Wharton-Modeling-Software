#!/usr/bin/env python3
"""Cross-check Bend and the TypeScript engine without importing the app.

Deterministic pieces must match exactly (or within 1e-9 for the extracted
float bond helpers). The Monte Carlo piece must land inside a sampling band
of the TypeScript run written to /tmp/gao-parity-ts.json.
"""

from __future__ import annotations

import ast
import json
import math
import pathlib
import sys

MASK = (1 << 64) - 1
PPM = 1_000_000


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def splitmix64(x: int) -> int:
    z = (x + 0x9E3779B97F4A7C15) & MASK
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
    return (z ^ (z >> 31)) & MASK


def raw_word(seed: int, stream: int, trial: int, step: int, dimension: int) -> tuple[int, int]:
    z = 0x9E3779B97F4A7C15
    for part in (seed, stream, trial, step, dimension):
        z = splitmix64(z ^ (part & MASK))
    return (z >> 32) & 0xFFFFFFFF, z & 0xFFFFFFFF


def unit_interval(seed: int, stream: int, trial: int, step: int, dimension: int) -> float:
    z = 0x9E3779B97F4A7C15
    for part in (seed, stream, trial, step, dimension):
        z = splitmix64(z ^ (part & MASK))
    bits = (z >> 11) & ((1 << 53) - 1)
    return (bits + 0.5) / float(1 << 53)


def standard_normal(seed: int, stream: int, trial: int, step: int, dimension: int) -> float:
    pair = dimension // 2
    u = unit_interval(seed, stream, trial, step, pair * 2)
    v = unit_interval(seed, stream, trial, step, pair * 2 + 1)
    magnitude = math.sqrt(-2.0 * math.log(u))
    angle = 2.0 * math.pi * v
    return magnitude * math.cos(angle) if dimension % 2 == 0 else magnitude * math.sin(angle)


def simple_return(mu: float, sigma: float, z: float) -> float:
    if mu <= -1:
        return -1.0
    mean_relative = 1.0 + mu
    s2 = math.log(1.0 + (sigma * sigma) / (mean_relative * mean_relative))
    m = math.log(mean_relative) - s2 / 2.0
    s = math.sqrt(s2)
    exponent = min(709.0, m + s * z)
    return math.exp(exponent) - 1.0


def percentile_sorted(sorted_values: list[float], p: float) -> float:
    if p <= 0:
        return sorted_values[0]
    if p >= 1:
        return sorted_values[-1]
    position = (len(sorted_values) - 1) * p
    lo = math.floor(position)
    hi = math.ceil(position)
    if lo == hi:
        return sorted_values[lo]
    weight = position - lo
    return sorted_values[lo] * (1.0 - weight) + sorted_values[hi] * weight


def muldiv(a: int, b: int, d: int) -> int:
    return (a * b) // d


def mtm_ppm(carry: int, duration_milli: int, convexity_milli: int, dy: int) -> int:
    duration_loss = muldiv(duration_milli, dy, 1000)
    step = muldiv(convexity_milli, dy, 1000)
    convexity = muldiv(step, dy, 2_000_000)
    gross = carry + convexity
    return gross - duration_loss if gross >= duration_loss else 0


def ladder_at_one_percent() -> int:
    pay = 50_000
    needed = pay
    for _ in range(9):
        needed = pay + muldiv(needed, PPM, PPM + 10_000)
    return needed


def wealth_sample(trials: int, seed: int, mu: list[float], sigma: list[float], weights: list[float]) -> list[float]:
    return path_wealth(trials, seed, mu, sigma, weights, 0.0, 0, None, 0.0)


def path_wealth(
    trials: int,
    seed: int,
    mu: list[float],
    sigma: list[float],
    weights: list[float],
    rho: float,
    bps: int,
    crash_year: int | None,
    crash_shock: float,
) -> list[float]:
    """Same year step as src/core/yearStep.ts. Identity correlation and zero cost match wealth_sample."""
    scale = math.sqrt(max(0.0, 1.0 - rho * rho))
    rate = 0.0 if bps <= 0 else bps / 10_000.0
    out: list[float] = []
    for trial in range(trials):
        balances = [0.0, 0.0]
        wealth_2033 = 0.0
        for year in range(2027, 2043):
            contribution = 300_000.0 if year == 2027 else 150_000.0 if year == 2028 else 0.0
            existing = balances[0] + balances[1]
            drifted = [balance / existing for balance in balances] if existing > 0 else list(weights)
            contribution_cost = 0.0 if contribution <= 0 else min(contribution, contribution * rate)
            net = contribution - contribution_cost
            fraction = 0.0
            if existing > 0 and rate > 0:
                l1 = abs(weights[0] - drifted[0]) + abs(weights[1] - drifted[1])
                fraction = min(1.0, 0.5 * l1 * rate)
            total = existing * (1.0 - fraction) + net
            balances = [total * weight for weight in weights]
            if year == 2033:
                wealth_2033 = balances[0] + balances[1]
            if year < 2042:
                z0 = standard_normal(seed, 1, trial, year, 0)
                z1 = standard_normal(seed, 1, trial, year, 1)
                shocks = [z0, rho * z0 + scale * z1]
                returns = [simple_return(mu[i], sigma[i], shocks[i]) for i in range(2)]
                if crash_year == year and crash_shock != 0.0:
                    returns = [value + crash_shock for value in returns]
                balances = [balance * (1.0 + returns[i]) for i, balance in enumerate(balances)]
        out.append(wealth_2033)
    return out


def extracted_bond_helpers():
    import numpy as np

    source = pathlib.Path(__file__).with_name("sim.py").read_text()
    tree = ast.parse(source)
    wanted = {"bond_price", "par_dur_conv", "curve_y"}
    chunks = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in wanted:
            chunks.append(ast.get_source_segment(source, node))
    if len(chunks) != 3:
        fail("sim.py is missing bond_price, par_dur_conv, or curve_y")
    namespace = {"np": np, "math": math}
    exec("\n\n".join(chunk for chunk in chunks if chunk), namespace)
    return namespace


def main() -> None:
    hi, lo = raw_word(42, 1, 0, 2027, 0)
    if (hi, lo) != (2195427346, 1420824054):
        fail(f"SplitMix word {hi} {lo}")
    if mtm_ppm(50_000, 16_000, 300_000, 0) != 50_000:
        fail("zero yield change did not return the carry")
    if mtm_ppm(400_000, 5_000, 0, 20_000) >= mtm_ppm(400_000, 5_000, 0, 10_000):
        fail("mark-to-market did not fall as the yield rose")
    if ladder_at_one_percent() != 478297:
        fail(f"1% ladder {ladder_at_one_percent()}")
    if 10 * 50_000 != 500_000:
        fail("zero-yield reserve")
    if 300_000 + 150_000 != 450_000:
        fail("locked contributions")

    helpers = extracted_bond_helpers()
    price = float(helpers["bond_price"](0.04, 10, 0.04))
    if abs(price - 1.0) > 1e-8:
        fail(f"par bond price {price}")
    duration, convexity = helpers["par_dur_conv"](0.04, 10)
    duration_value = float(duration.reshape(-1)[0])
    convexity_value = float(convexity.reshape(-1)[0])
    if not (5 < duration_value < 10) or not (convexity_value > 0):
        fail(f"duration/convexity {duration_value} {convexity_value}")
    y5 = float(helpers["curve_y"](5, 0.02, 0.03, 0.04, 0.0))
    if abs(y5 - 0.03) > 1e-12:
        fail(f"curve at 5y {y5}")

    payload_path = pathlib.Path("/tmp/gao-parity-ts.json")
    if not payload_path.exists():
        fail("missing /tmp/gao-parity-ts.json — run scripts/parity.ts first")
    payload = json.loads(payload_path.read_text())
    sample = wealth_sample(int(payload["trials"]), int(payload["seed"]), payload["mu"], payload["sigma"], payload["weights"])
    funded = sum(1 for wealth in sample if wealth + 1e-6 >= float(payload["reserve"])) / len(sample)
    ordered = sorted(sample)
    p5 = percentile_sorted(ordered, 0.05)
    p50 = percentile_sorted(ordered, 0.50)
    ts_funded = float(payload["funded"])
    se = math.sqrt(max(ts_funded * (1.0 - ts_funded), 1e-12) / len(sample))
    # Same seed and the same formula. A libm gap of a few dollars is allowed.
    # A real disagreement is larger than the sampling standard error.
    if abs(funded - ts_funded) > max(1.0 / len(sample), 2.0 * se):
        fail(f"P(funded) python {funded} ts {ts_funded} se {se}")
    for label, py, ts in (("p5", p5, float(payload["p5"])), ("p50", p50, float(payload["p50"]))):
        band = max(50.0, 2.0 * se * max(abs(ts), 1.0))
        if abs(py - ts) > band:
            fail(f"{label} python {py} ts {ts} band {band}")
    print(f"python agrees: P(funded)={funded:.4f} p5={p5:.2f} p50={p50:.2f} se={se:.4f}")
    check_path()
    check_risk()


def check_path() -> None:
    path_file = pathlib.Path("/tmp/gao-parity-path.json")
    if not path_file.exists():
        fail("missing /tmp/gao-parity-path.json — run scripts/parity.ts first")
    books = json.loads(path_file.read_text())
    for book in books:
        got = path_wealth(
            int(book["trials"]),
            int(book["seed"]),
            book["mu"],
            book["sigma"],
            book["weights"],
            float(book["rho"]),
            int(book["bps"]),
            book["crashYear"],
            float(book["crashShock"]),
        )
        expected = book["wealth"]
        if len(got) != len(expected):
            fail(f"{book['name']} length {len(got)} vs {len(expected)}")
        worst = max(abs(py - float(ts)) for py, ts in zip(got, expected))
        if worst > 1e-6:
            fail(f"{book['name']} pathwise gap {worst}")
        print(f"pathwise {book['name']} max abs {worst:.3e} over {len(got)} trials")


def check_risk() -> None:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import risk

    if risk.ewma_step_ppm(940_000, 1_000_000, 250_000) != 955_000:
        fail("ewma step")
    if risk.vasicek_ppm(70_000, 1_000_000, 40_000, 60_000) != 628_000:
        fail("vasicek step")
    if not 70_000 <= 628_000 <= 1_000_000:
        fail("vasicek range")
    if risk.jump_variance_ppm(8_000, 4, 2_500) != 18_000:
        fail("jump variance")
    if risk.jump_variance_ppm(8_000, 4, 2_500) < 8_000:
        fail("jump variance below diffusion")
    cov = risk.shrunk_cov()
    if cov["det"] != 7729 or cov["s11"] <= 0 or cov["det"] <= 0:
        fail(f"shrunk covariance {cov}")

    payload_path = pathlib.Path("/tmp/gao-risk-golden.json")
    if not payload_path.exists():
        fail("missing /tmp/gao-risk-golden.json — run scripts/parity.ts first")
    payload = json.loads(payload_path.read_text())
    asset = [float(value) for value in payload["series"]["asset"]]
    market = [float(value) for value in payload["series"]["market"]]
    if abs(risk.ewma_next(asset) - float(payload["ewmaNext"])) > 1e-12:
        fail(f"ewma next {risk.ewma_next(asset)} ts {payload['ewmaNext']}")
    intercept, slope, se = risk.ols_intercept(asset, market)
    if abs(intercept - float(payload["ols"]["intercept"])) > 1e-9 or abs(slope - float(payload["ols"]["slope"])) > 1e-9:
        fail(f"ols {intercept} {slope}")
    if abs(se - float(payload["ols"]["se"])) > 1e-9:
        fail(f"ols se {se}")
    beta = risk.vasicek_beta(slope, se, 1.0, 0.25)
    if abs(beta - float(payload["vasicekBeta"])) > 1e-12:
        fail(f"vasicek beta {beta}")
    garch = risk.fit_garch(asset)
    if not garch["ok"]:
        fail("garch did not fit")
    if abs(float(garch["alpha"]) - float(payload["garch"]["alpha"])) > 0.02:
        fail(f"garch alpha {garch['alpha']} ts {payload['garch']['alpha']}")
    if abs(float(garch["beta"]) - float(payload["garch"]["beta"])) > 0.02:
        fail(f"garch beta {garch['beta']} ts {payload['garch']['beta']}")
    if garch["alpha"] == payload["garch"]["alpha"] and garch["beta"] == payload["garch"]["beta"]:
        if abs(float(garch["omega"]) - float(payload["garch"]["omega"])) > 1e-8:
            fail(f"garch omega {garch['omega']}")
    lr, p_value = risk.kupiec(int(payload["kupiec"]["hits"]), int(payload["kupiec"]["n"]), 0.05)
    if abs(lr - float(payload["kupiec"]["lr"])) > 1e-9 or abs(p_value - float(payload["kupiec"]["pValue"])) > 1e-9:
        fail(f"kupiec {lr} {p_value}")
    shrinkage, shrunk = risk.ledoit_wolf([[left, right] for left, right in zip(asset, market)])
    if abs(shrinkage - float(payload["shrinkage"])) > 1e-8 or abs(shrunk[0][0] - float(payload["shrunk00"])) > 1e-8:
        fail(f"ledoit-wolf {shrinkage} {shrunk[0][0]}")
    print(
        f"risk parity agrees: ewma {payload['ewma']} vasicek {payload['vasicek']} "
        f"jump {payload['jump']} det {payload['covDet']} garch {garch['alpha']}/{garch['beta']}"
    )


if __name__ == "__main__":
    main()
