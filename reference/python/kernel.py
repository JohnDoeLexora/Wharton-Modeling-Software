"""
Thin NumPy-free year-step kernel.

The generator is SplitMix64 in the same order as src/core/rng.ts (MODEL_SPEC §6.1).
The year step matches stepYearMut (MODEL_SPEC §5.1): contribution, rebalance from
drifted weights, record beginning wealth, then earn the return. 2042 is terminal.

This file replaces the Philox generator in the analysis harness for parity.
Philox is a second engine and is not used here. See docs/MODEL_SPEC.md §6.3.
"""

from __future__ import annotations

import json
import math
import sys

MASK = (1 << 64) - 1
GOLDEN = 0x9E3779B97F4A7C15
MUL_1 = 0xBF58476D1CE4E5B9
MUL_2 = 0x94D049BB133111EB


def _splitmix(x: int) -> int:
    z = (x + GOLDEN) & MASK
    z = ((z ^ (z >> 30)) * MUL_1) & MASK
    z = ((z ^ (z >> 27)) * MUL_2) & MASK
    return (z ^ (z >> 31)) & MASK


def raw_word(seed: int, stream: int, trial: int, step: int, dimension: int) -> tuple[int, int]:
    z = GOLDEN
    for part in (seed, stream, trial, step, dimension):
        z = _splitmix(z ^ (part & MASK))
    return (z >> 32) & 0xFFFFFFFF, z & 0xFFFFFFFF


def unit_interval(seed: int, stream: int, trial: int, step: int, dimension: int) -> float:
    hi, lo = raw_word(seed, stream, trial, step, dimension)
    bits = hi * 2097152 + (lo >> 11)
    return (bits + 0.5) / 9007199254740992


def standard_normal(seed: int, stream: int, trial: int, step: int, dimension: int) -> float:
    pair = dimension // 2
    u = unit_interval(seed, stream, trial, step, pair * 2)
    v = unit_interval(seed, stream, trial, step, pair * 2 + 1)
    magnitude = math.sqrt(-2.0 * math.log(u))
    angle = 2.0 * math.pi * v
    return magnitude * math.cos(angle) if dimension % 2 == 0 else magnitude * math.sin(angle)


def simple_return(mu: float, sigma: float, z: float, model: str, floor: float) -> float:
    vol = 0.0 if sigma < 0 else sigma
    if model == "normal":
        linear = mu + vol * z
        if not math.isfinite(linear):
            return 1e6 if z >= 0 else floor
        return max(floor, linear)
    if mu <= -1:
        return -1.0
    mean_relative = 1.0 + mu
    s2 = math.log(1.0 + (vol * vol) / (mean_relative * mean_relative))
    m = math.log(mean_relative) - s2 / 2.0
    s = math.sqrt(s2)
    exponent = min(709.0, m + s * z)
    result = math.exp(exponent) - 1.0
    return result if math.isfinite(result) else 1e6


def _sum(values: list[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total


def step_year(balances: list[float], contribution: float, policy: list[float], rebalance: str, bps: float, returns: list[float] | None) -> float:
    n = len(policy)
    existing = _sum(balances)
    rate = 0.0 if bps <= 0 else bps / 10000.0
    contribution_cost = 0.0 if contribution <= 0 else min(contribution, contribution * rate)
    net = contribution - contribution_cost
    fraction = 0.0
    if rebalance == "annual":
        if existing > 0 and rate != 0:
            l1 = 0.0
            for i in range(n):
                l1 += abs(policy[i] - balances[i] / existing)
            fraction = min(1.0, 0.5 * l1 * rate)
        total = existing * (1.0 - fraction) + net
        for i in range(n):
            balances[i] = total * policy[i]
    else:
        for i in range(n):
            balances[i] += net * policy[i]
    wealth = _sum(balances)
    if returns is None:
        return wealth
    for i in range(n):
        balances[i] *= 1.0 + returns[i]
    return wealth


def simulate(config: dict) -> dict:
    seed = int(config["seed"])
    trials = int(config["trials"])
    mu = config["mu"]
    sigma = config["sigma"]
    model = config["model"]
    floor = float(config["floor"])
    bps = float(config["bps"])
    rebalance = config["rebalance"]
    factor = config["factor"]
    weights = config["weights"]
    n = len(mu)
    wealth = []
    path0 = []
    for trial in range(trials):
        balances = [0.0] * n
        row_path = []
        for offset, year in enumerate(range(2027, 2043)):
            contribution = 300000.0 if year == 2027 else 150000.0 if year == 2028 else 0.0
            policy = weights[offset]
            returns = None
            if year < 2042:
                z = [standard_normal(seed, 1, trial, year, dim) for dim in range(n)]
                shocks = []
                for i in range(n):
                    acc = 0.0
                    for k in range(i + 1):
                        acc += factor[i][k] * z[k]
                    shocks.append(acc)
                returns = [simple_return(mu[i], sigma[i], shocks[i], model, floor) for i in range(n)]
                crash = config.get("crash")
                if crash and crash["year"] == year:
                    for i in range(n):
                        returns[i] += float(crash["shock"])
            wealth_start = step_year(balances, contribution, policy, rebalance, bps, returns)
            row_path.append(wealth_start)
        wealth.append(row_path[2033 - 2027])
        if trial == 0:
            path0 = row_path
    return {"wealth2033": wealth, "path0": path0}


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "audit"
    if command == "audit":
        hi, lo = raw_word(42, 1, 0, 2027, 0)
        print(json.dumps({"hi": hi, "lo": lo}))
        return
    config = json.loads(sys.stdin.read())
    print(json.dumps(simulate(config)))


if __name__ == "__main__":
    main()
