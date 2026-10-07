import { percentile, percentiles } from "./math";
import type { RiskMetrics, SleeveKind, YearPoint } from "./types";

/** Percentiles the spec asks for, whether or not they are on the chart list. */
export const SPEC_PERCENTILES = [0.01, 0.05, 0.1, 0.5, 0.9, 0.95];

export function maxDrawdown(path: YearPoint[]): number {
  let peak = 0;
  let worst = 0;
  for (const point of path) {
    const wealth = point.wealthStart;
    if (wealth > peak) peak = wealth;
    if (peak > 0) {
      const drawdown = (peak - wealth) / peak;
      if (drawdown > worst) worst = drawdown;
    }
  }
  return worst;
}

/** Mean of the lowest ceil(5% of n) beginning-of-2033 wealth figures. */
export function cvar5(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const count = Math.max(1, Math.ceil(0.05 * sorted.length));
  let total = 0;
  for (let i = 0; i < count; i++) total += sorted[i];
  return total / count;
}

export interface Welford {
  n: number;
  mean: number;
  m2: number;
}

export function welford(): Welford {
  return { n: 0, mean: 0, m2: 0 };
}

export function welfordPush(state: Welford, value: number): void {
  if (!Number.isFinite(value)) return;
  state.n += 1;
  const delta = value - state.mean;
  state.mean += delta / state.n;
  state.m2 += delta * (value - state.mean);
}

export function welfordStdev(state: Welford): number {
  if (state.n < 2) return Number.NaN;
  return Math.sqrt(state.m2 / (state.n - 1));
}

export function wealthPercentileRecord(values: number[], extra: number[]): Record<string, number> {
  const merged = [...SPEC_PERCENTILES];
  for (const p of extra) if (!merged.some((item) => Math.abs(item - p) < 1e-9)) merged.push(p);
  return percentiles(values, merged);
}

export function standardErrorMean(values: number[]): { mean: number; se: number } {
  const state = welford();
  for (const value of values) welfordPush(state, value);
  const stdev = welfordStdev(state);
  return {
    mean: state.n > 0 ? state.mean : Number.NaN,
    se: Number.isFinite(stdev) && state.n > 0 ? stdev / Math.sqrt(state.n) : Number.NaN,
  };
}

export function standardErrorProbability(p: number, n: number): number | null {
  if (!(n > 0) || !Number.isFinite(p)) return null;
  return Math.sqrt((p * (1 - p)) / n);
}

export const CONVERGENCE_NOTE =
  "Standard error of the mean is the sample standard deviation of beginning-of-2033 wealth divided by sqrt(trials). " +
  "Standard error of P(fully funded) is sqrt(p(1−p)/n). Raise the trial count to shrink them. " +
  "These are sampling errors inside this seeded design, not a forecast interval.";

export function sharpeRatio(meanExcess: number, stdevExcess: number): number | null {
  if (!Number.isFinite(meanExcess) || !Number.isFinite(stdevExcess) || stdevExcess < 1e-12) return null;
  return meanExcess / stdevExcess;
}

export function sortinoRatio(meanExcess: number, downsideDeviation: number): number | null {
  if (!Number.isFinite(meanExcess) || !Number.isFinite(downsideDeviation) || downsideDeviation < 1e-12) return null;
  return meanExcess / downsideDeviation;
}

export function emptyMetrics(): RiskMetrics {
  return {
    wealthPercentiles: {},
    fullyFundedProbability: null,
    cvar5: null,
    maxDrawdownPercentiles: {},
    meanMaxDrawdown: null,
    facilityPercentiles: {},
    conditionalLow: null,
    conditionalHigh: null,
    conditionalCoverage: null,
    sharpe: null,
    sortino: null,
    convergence: {
      trials: 0,
      meanWealth2033: Number.NaN,
      standardErrorMean: Number.NaN,
      standardErrorFunded: null,
      note: CONVERGENCE_NOTE,
    },
    sleeveMtm: [],
  };
}

export function percentileOrNull(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const value = percentile(values, p);
  return Number.isFinite(value) ? value : null;
}

export interface SleeveMtmInput {
  id: string;
  name: string;
  kind: SleeveKind;
  meanPrice: number;
}
