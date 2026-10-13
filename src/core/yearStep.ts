import { dot, sum } from "./math";
import type { RebalanceMode } from "./types";

/**
 * One beginning-of-year step. The main path, the 2031–2033 range, mixes,
 * and the Python parity fixture all call this function.
 *
 * Order: charge the new contribution, charge the rebalance from drifted
 * weights to the policy, record beginning wealth, then earn the year's return.
 * A null return is the terminal date (2042): costs still apply, no growth.
 */

export interface Holdings {
  balances: number[];
  balancesHtm: number[];
  /** Unit value after the previous step. Starts at 1. Contributions do not change it. */
  nav: number;
}

export interface StepInput {
  contribution: number;
  policy: number[];
  rebalance: RebalanceMode;
  /** Round-trip turnover charge in basis points. */
  transactionCostBps: number;
  /** Share of a positive portfolio return paid as tax. Zero leaves the return unchanged. */
  gainTaxRate: number;
  /** Simple returns earned during the year. Null on the terminal date. */
  returns: number[] | null;
  returnsHtm: number[] | null;
}

export interface StepResult {
  wealthStart: number;
  wealthStartHtm: number;
  policyWeights: number[];
  actualWeights: number[];
  /** Weights of the book before this year's rebalance. Equal to the policy when the book was empty. */
  driftedWeights: number[];
  /** Fraction of pre-contribution wealth removed by the rebalance trade. */
  rebalanceCostFraction: number;
  /** Dollars removed from the contribution itself. */
  contributionCost: number;
  /** Portfolio simple return after the gain tax, before it is mixed into the time-weighted return. */
  yearReturn: number | null;
  yearReturnHtm: number | null;
  /**
   * Time-weighted return of a unit that was already invested.
   * Includes the rebalance cost and the year's asset return. Excludes the contribution.
   */
  twr: number | null;
  nav: number;
  /** Balances that earn this year's return, after the rebalance and the cost. */
  balancesAtStart: number[];
  balancesHtmAtStart: number[];
  balances: number[];
  balancesHtm: number[];
  sleeveReturns: number[] | null;
}

export function costRateFromBps(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return bps / 10_000;
}

/** One-way turnover fraction: 0.5 · Σ|policy − drifted| · (bps / 10000), capped at 100%. */
export function rebalanceCostFraction(drifted: number[], policy: number[], bps: number): number {
  const rate = costRateFromBps(bps);
  if (rate === 0) return 0;
  const n = Math.max(drifted.length, policy.length);
  let l1 = 0;
  for (let i = 0; i < n; i++) l1 += Math.abs((policy[i] ?? 0) - (drifted[i] ?? 0));
  return Math.min(1, 0.5 * l1 * rate);
}

/** New cash pays the round-trip rate once. That is the initial purchase and each later contribution. */
export function contributionCostDollars(contribution: number, bps: number): number {
  if (!Number.isFinite(contribution) || contribution <= 0) return 0;
  return Math.min(contribution, contribution * costRateFromBps(bps));
}

export function emptyHoldings(count: number): Holdings {
  return {
    balances: Array(count).fill(0),
    balancesHtm: Array(count).fill(0),
    nav: 1,
  };
}

function weightsOf(balances: number[], policy: number[]): number[] {
  const total = sum(balances);
  if (!(total > 0)) return policy.slice();
  return balances.map((balance) => balance / total);
}

/** Earn `returns` on balances that have already been rebalanced. Applies the gain tax. */
export function realizeReturn(
  balances: number[],
  balancesHtm: number[],
  returns: number[],
  returnsHtm: number[],
  gainTaxRate: number,
): { balances: number[]; balancesHtm: number[]; yearReturn: number; yearReturnHtm: number } {
  const wealth = sum(balances);
  const wealthHtm = sum(balancesHtm);
  const actual = weightsOf(balances, returns.map(() => 0));
  let yearReturn = wealth > 0 ? dot(actual, returns) : 0;
  let yearReturnHtm = wealthHtm > 0 ? dot(weightsOf(balancesHtm, returnsHtm.map(() => 0)), returnsHtm) : yearReturn;
  let next = balances.map((balance, index) => balance * (1 + (returns[index] ?? 0)));
  let nextHtm = balancesHtm.map((balance, index) => balance * (1 + (returnsHtm[index] ?? 0)));
  if (gainTaxRate > 0 && yearReturn > 0 && wealth > 0) {
    const tax = wealth * yearReturn * gainTaxRate;
    const after = sum(next);
    if (after > 0 && tax > 0) {
      const scale = Math.max(0, (after - tax) / after);
      next = next.map((balance) => balance * scale);
      nextHtm = nextHtm.map((balance) => balance * scale);
      yearReturn = sum(next) / wealth - 1;
      if (wealthHtm > 0) yearReturnHtm = sum(nextHtm) / wealthHtm - 1;
    }
  }
  return { balances: next, balancesHtm: nextHtm, yearReturn, yearReturnHtm };
}

export function stepYear(holdings: Holdings, step: StepInput): StepResult {
  const policy = step.policy;
  const existing = sum(holdings.balances);
  const existingHtm = sum(holdings.balancesHtm);
  const driftedWeights = existing > 0 ? holdings.balances.map((balance) => balance / existing) : policy.slice();
  const contributionCost = contributionCostDollars(step.contribution, step.transactionCostBps);
  const netContribution = step.contribution - contributionCost;
  let fraction = 0;
  let balances: number[];
  let balancesHtm: number[];
  if (step.rebalance === "annual") {
    if (existing > 0) fraction = rebalanceCostFraction(driftedWeights, policy, step.transactionCostBps);
    const total = existing * (1 - fraction) + netContribution;
    const totalHtm = existingHtm * (1 - fraction) + netContribution;
    balances = policy.map((weight) => total * weight);
    balancesHtm = policy.map((weight) => totalHtm * weight);
  } else {
    balances = holdings.balances.map((balance, index) => balance + netContribution * (policy[index] ?? 0));
    balancesHtm = holdings.balancesHtm.map((balance, index) => balance + netContribution * (policy[index] ?? 0));
  }

  const wealthStart = sum(balances);
  const wealthStartHtm = sum(balancesHtm);
  const actualWeights = weightsOf(balances, policy);

  if (!step.returns) {
    const twr = fraction > 0 ? -fraction : null;
    return {
      wealthStart,
      wealthStartHtm,
      policyWeights: policy.slice(),
      actualWeights,
      driftedWeights,
      rebalanceCostFraction: fraction,
      contributionCost,
      yearReturn: null,
      yearReturnHtm: null,
      twr,
      nav: twr === null ? holdings.nav : holdings.nav * (1 + twr),
      balancesAtStart: balances.slice(),
      balancesHtmAtStart: balancesHtm.slice(),
      balances,
      balancesHtm,
      sleeveReturns: null,
    };
  }

  const htmReturns = step.returnsHtm ?? step.returns;
  const earned = realizeReturn(balances, balancesHtm, step.returns, htmReturns, step.gainTaxRate);
  const twr = (1 - fraction) * (1 + earned.yearReturn) - 1;
  return {
    wealthStart,
    wealthStartHtm,
    policyWeights: policy.slice(),
    actualWeights,
    driftedWeights,
    rebalanceCostFraction: fraction,
    contributionCost,
    yearReturn: earned.yearReturn,
    yearReturnHtm: earned.yearReturnHtm,
    twr,
    nav: holdings.nav * (1 + twr),
    balancesAtStart: balances.slice(),
    balancesHtmAtStart: balancesHtm.slice(),
    balances: earned.balances,
    balancesHtm: earned.balancesHtm,
    sleeveReturns: step.returns.slice(),
  };
}
