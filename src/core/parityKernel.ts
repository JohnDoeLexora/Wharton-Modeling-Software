/**
 * Parametric year-step used by the Python parity fixture.
 * The arithmetic is stepYearMut plus simpleReturn. MODEL_SPEC §5.1 and §6.1.
 */
import { caseContribution, FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR } from "./case";
import { correlatedShocks, simpleReturn } from "./math";
import { STREAM, standardNormal } from "./rng";
import { stepYearMut } from "./yearStep";

export interface ParityConfig {
  seed: number;
  trials: number;
  mu: number[];
  sigma: number[];
  model: "normal" | "lognormal";
  floor: number;
  bps: number;
  rebalance: "annual" | "drift";
  factor: number[][];
  weights: number[][];
  crash?: { year: number; shock: number };
}

export function parityRun(config: ParityConfig): { wealth2033: number[]; path0: number[] } {
  const n = config.mu.length;
  const wealth2033: number[] = [];
  let path0: number[] = [];
  for (let trial = 0; trial < config.trials; trial++) {
    const balances = Array(n).fill(0);
    const htm = Array(n).fill(0);
    const path: number[] = [];
    for (let offset = 0; offset <= LAST_PROJECTION_YEAR - FIRST_PROJECTION_YEAR; offset++) {
      const year = FIRST_PROJECTION_YEAR + offset;
      const terminal = year === LAST_PROJECTION_YEAR;
      let returns: number[] | null = null;
      if (!terminal) {
        const z = Array.from({ length: n }, (_, dim) => standardNormal(config.seed, STREAM.portfolio, trial, year, dim));
        const shocks = correlatedShocks(config.factor, z);
        returns = config.mu.map((mu, index) => simpleReturn(mu, config.sigma[index], shocks[index] ?? 0, config.model, config.floor, false));
        if (config.crash && config.crash.year === year) returns = returns.map((value) => value + config.crash!.shock);
      }
      const result = stepYearMut(balances, htm, 1, {
        contribution: caseContribution(year),
        policy: config.weights[offset],
        rebalance: config.rebalance,
        transactionCostBps: config.bps,
        gainTaxRate: 0,
        returns,
        returnsHtm: returns,
      });
      path.push(result.wealthStart);
    }
    wealth2033.push(path[2033 - FIRST_PROJECTION_YEAR]);
    if (trial === 0) path0 = path;
  }
  return { wealth2033, path0 };
}

export function parityConfigs(): { name: string; rich: boolean; config: ParityConfig }[] {
  const factor2 = [
    [1, 0],
    [0.2, Math.sqrt(1 - 0.04)],
  ];
  const weights = (a: number, b: number) => Array.from({ length: 16 }, () => [a, b]);
  const base = {
    trials: 8,
    mu: [0.06, 0.02],
    sigma: [0.15, 0.04],
    model: "lognormal" as const,
    floor: -0.99,
    bps: 0,
    rebalance: "annual" as const,
    factor: factor2,
    weights: weights(0.6, 0.4),
  };
  const golden: { name: string; config: ParityConfig }[] = [];
  for (let i = 0; i < 20; i++) {
    golden.push({
      name: `golden-${i}`,
      config: {
        ...base,
        seed: 42 + i * 17,
        mu: [0.03 + (i % 5) * 0.01, 0.01 + (i % 3) * 0.005],
        sigma: [0.08 + (i % 4) * 0.02, 0.02],
        bps: i % 4 === 0 ? 0 : 25,
        rebalance: i % 2 === 0 ? "annual" : "drift",
        model: i % 5 === 0 ? "normal" : "lognormal",
        floor: -0.5,
        weights: weights(0.4 + (i % 5) * 0.05, 0.6 - (i % 5) * 0.05),
      },
    });
  }
  const factor3 = [
    [1, 0, 0],
    [0.3, Math.sqrt(1 - 0.09), 0],
    [0.1, 0.05, Math.sqrt(1 - 0.01 - 0.0025)],
  ];
  const rich: { name: string; config: ParityConfig }[] = [
    { name: "rich-normal", config: { ...base, seed: 7, model: "normal", floor: -0.2, trials: 40 } },
    { name: "rich-cost", config: { ...base, seed: 9, bps: 50, trials: 40 } },
    { name: "rich-drift", config: { ...base, seed: 11, rebalance: "drift", bps: 10, trials: 40 } },
    { name: "rich-crash", config: { ...base, seed: 13, trials: 40, crash: { year: 2030, shock: -0.25 } } },
    {
      name: "rich-three",
      config: {
        seed: 15,
        trials: 40,
        mu: [0.05, 0.03, 0.01],
        sigma: [0.16, 0.08, 0.02],
        model: "lognormal",
        floor: -0.99,
        bps: 15,
        rebalance: "annual",
        factor: factor3,
        weights: Array.from({ length: 16 }, () => [0.5, 0.3, 0.2]),
      },
    },
  ];
  return [...golden.map((row) => ({ ...row, rich: false })), ...rich.map((row) => ({ ...row, rich: true }))];
}
