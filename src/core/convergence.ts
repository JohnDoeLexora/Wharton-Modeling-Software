/**
 * Sampler standard-error curves and a target-SE stop for the Curve lab.
 * The main form still uses the trial count the team typed. MODEL_SPEC §14.
 */

import { runModel } from "./run";
import type { Assumptions, SamplingMethod } from "./types";

export { effectiveSampleSize } from "./ess";

export interface SamplerErrorPoint {
  sampler: SamplingMethod;
  trials: number;
  mean: number;
  standardError: number;
}

export interface StoppedSample {
  trials: number;
  mean: number;
  standardError: number;
  /** True when the standard error of the mean reached the target. */
  stopped: boolean;
  flag: string | null;
}

function meanOf(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function standardErrorOf(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const center = meanOf(values);
  let square = 0;
  for (const value of values) {
    const gap = value - center;
    square += gap * gap;
  }
  return Math.sqrt(square / (values.length - 1) / values.length);
}

const SAMPLERS: SamplingMethod[] = ["pseudo", "antithetic", "sobol"];

function wealthAt(assumptions: Assumptions, sampling: SamplingMethod, trials: number): number[] {
  const copy = structuredClone(assumptions);
  copy.sampling = sampling;
  copy.trials = trials;
  copy.diagnostics = { ...(copy.diagnostics ?? {}), samplerComparison: false };
  const output = runModel(copy);
  return output.monteCarlo?.wealth2033 ?? [];
}

/** Standard error of mean 2033 wealth versus N, one run per sampler, prefixes of that run. */
export function samplerErrorCurve(assumptions: Assumptions, sizes: number[]): SamplerErrorPoint[] {
  const cuts = [...new Set(sizes.filter((count) => count >= 50 && count <= 20_000))].sort((a, b) => a - b);
  if (cuts.length === 0) return [];
  const max = cuts[cuts.length - 1];
  const rows: SamplerErrorPoint[] = [];
  for (const sampler of SAMPLERS) {
    const wealth = wealthAt(assumptions, sampler, max);
    for (const trials of cuts) {
      const slice = wealth.slice(0, trials);
      rows.push({
        sampler,
        trials: slice.length,
        mean: meanOf(slice),
        standardError: standardErrorOf(slice),
      });
    }
  }
  return rows;
}

/**
 * Grow the sample in steps of 50 until the standard error of the mean is at or under `targetSe`,
 * or until `maxTrials`. Does not change the trial count stored on the assumptions form.
 */
export function runUntilStandardError(
  assumptions: Assumptions,
  targetSe: number,
  options: { minTrials?: number; maxTrials?: number } = {},
): StoppedSample {
  const minTrials = Math.max(50, options.minTrials ?? 50);
  const maxTrials = Math.min(20_000, Math.max(minTrials, options.maxTrials ?? Math.max(assumptions.trials, minTrials)));
  const wealth = wealthAt(assumptions, assumptions.sampling, maxTrials);
  let chosen = Math.min(minTrials, wealth.length);
  let mean = Number.NaN;
  let se = Number.NaN;
  for (let trials = minTrials; trials <= wealth.length; trials += 50) {
    const slice = wealth.slice(0, trials);
    mean = meanOf(slice);
    se = standardErrorOf(slice);
    chosen = trials;
    if (Number.isFinite(se) && se <= targetSe) {
      return { trials, mean, standardError: se, stopped: true, flag: null };
    }
  }
  return {
    trials: chosen,
    mean,
    standardError: se,
    stopped: false,
    flag: "Target standard error was not reached inside the trial cap.",
  };
}

