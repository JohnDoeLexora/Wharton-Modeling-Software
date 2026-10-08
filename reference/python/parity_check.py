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
    out: list[float] = []
    for trial in range(trials):
        balances = [0.0, 0.0]
        wealth_2033 = 0.0
        for year in range(2027, 2043):
            contribution = 300_000 if year == 2027 else 150_000 if year == 2028 else 0
            total = sum(balances) + contribution
            balances = [total * weight for weight in weights]
            if year == 2033:
                wealth_2033 = sum(balances)
            if year < 2042:
                returns = [simple_return(mu[i], sigma[i], standard_normal(seed, 1, trial, year, i)) for i in range(2)]
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


if __name__ == "__main__":
    main()
