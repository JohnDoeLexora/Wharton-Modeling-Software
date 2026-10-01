import type { Assumptions, CandidateRule, Sleeve } from "./types";

export const RESERVE_STEPS = 9;

function zeros(count: number): number[] {
  return Array(count).fill(0);
}

function sleeve(id: string, name: string, mu: number, sigma: number, base: number, bull: number, bear: number): Sleeve {
  return { id, name, mu, sigma, base, bull, bear };
}

function rules(): CandidateRule[] {
  return [
    {
      id: "retain",
      name: "Retain a fraction of residual",
      kind: "retain_fraction",
      retainFraction: 1,
      keepDollars: 0,
      capDollars: 0,
    },
    {
      id: "buffer",
      name: "Keep a dollar buffer",
      kind: "keep_dollars",
      retainFraction: 0,
      keepDollars: 0,
      capDollars: 0,
    },
    {
      id: "cap",
      name: "Cap the contribution",
      kind: "cap_dollars",
      retainFraction: 0,
      keepDollars: 0,
      capDollars: 0,
    },
  ];
}

/** Case cash flows plus zero market assumptions. Charts sit still until the team types its own inputs. */
export function zeroAssumptions(): Assumptions {
  return {
    schema: 1,
    tag: "zero-default",
    certaintyNote: "",
    sleeves: [
      sleeve("growth", "Growth sleeve (label only)", 0, 0, 0, 0, 0),
      sleeve("funding", "Funding / liquidity sleeve (label only)", 0, 0, 0, 0, 0),
    ],
    glide: [
      { year: 2027, weights: [0.5, 0.5] },
      { year: 2033, weights: [0.5, 0.5] },
    ],
    correlation: [
      [1, 0],
      [0, 1],
    ],
    rebalance: "annual",
    returnModel: "lognormal",
    normalFloor: -0.999,
    inflation: 0,
    trials: 1000,
    seed: 42,
    percentiles: [0.05, 0.25, 0.5, 0.75, 0.95],
    reserve: {
      method: "ladder",
      discountYield: 0,
      surplusMargin: 0,
      stressReturn: 0,
      shortfallMu: 0,
      shortfallSigma: 0,
      shortfallTarget: 1,
      useCustomSchedule: false,
      customReturns: zeros(RESERVE_STEPS),
    },
    facility: {
      rules: rules(),
      activeRuleId: "retain",
      rangeMethod: "scenario_envelope",
      rangeLowPercentile: 0.1,
      rangeHighPercentile: 0.9,
      envelopeScenarios: ["bear", "base", "bull"],
      conditionalSource: "base",
      conditionalManualWealth: 450_000,
      useReserveOverride: false,
      reserveOverride: 500_000,
    },
  };
}

/**
 * Round numbers so the charts move. Not a capital-market view and not a strategy.
 * The glide is intentionally flat. Bend it yourself if you want to study de-risking.
 */
export function teachingAssumptions(): Assumptions {
  const next = zeroAssumptions();
  next.tag = "teaching-example";
  next.sleeves = [
    sleeve("growth", "Growth sleeve (teaching numbers)", 0.07, 0.16, 0.07, 0.14, -0.08),
    sleeve("funding", "Funding / liquidity sleeve (teaching numbers)", 0.03, 0.04, 0.03, 0.045, 0.01),
  ];
  next.correlation = [
    [1, 0.1],
    [0.1, 1],
  ];
  next.inflation = 0.02;
  next.reserve.discountYield = 0.03;
  next.reserve.stressReturn = 0.01;
  next.reserve.shortfallMu = 0.03;
  next.reserve.shortfallSigma = 0.04;
  next.reserve.shortfallTarget = 0.9;
  next.facility.rules = [
    {
      id: "retain",
      name: "Retain a fraction of residual",
      kind: "retain_fraction",
      retainFraction: 0.5,
      keepDollars: 0,
      capDollars: 0,
    },
    {
      id: "buffer",
      name: "Keep a dollar buffer",
      kind: "keep_dollars",
      retainFraction: 0,
      keepDollars: 100_000,
      capDollars: 0,
    },
    {
      id: "cap",
      name: "Cap the contribution",
      kind: "cap_dollars",
      retainFraction: 0,
      keepDollars: 0,
      capDollars: 150_000,
    },
  ];
  return next;
}
