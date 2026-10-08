/**
 * Convergence, seed stability, and a model-risk spread.
 * The model-risk panel reruns the same book under the Nelson-Siegel curve,
 * the old three-point curve, and a higher level volatility. The spread is the
 * disagreement. It is not a confidence interval for a recommendation.
 */

import { runModel } from "./run";
import type { Assumptions, CurveModel } from "./types";

export interface ConvergencePoint {
  trials: number;
  mean: number;
  standardErrorMean: number;
  fundedShare: number | null;
  standardErrorFunded: number | null;
}

function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardError(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance / values.length);
}

/** Standard error of the 2033 mean and of P(funded), on nested prefixes of one sample. */
export function convergenceCurve(wealth: number[], reserve: number | null): ConvergencePoint[] {
  const cuts = [25, 50, 100, 200, 400, 800, 1600, 3200, 5000].filter((count) => count <= wealth.length);
  if (wealth.length > 1 && !cuts.includes(wealth.length)) cuts.push(wealth.length);
  return cuts.map((trials) => {
    const slice = wealth.slice(0, trials);
    const funded = reserve != null && reserve > 0 ? slice.map((value) => (value >= reserve ? 1 : 0)) : null;
    const fundedShare = funded ? mean(funded) : null;
    const fundedSe = funded ? standardError(funded) : null;
    return {
      trials,
      mean: mean(slice),
      standardErrorMean: standardError(slice),
      fundedShare,
      standardErrorFunded: fundedShare != null && fundedSe != null ? fundedSe : null,
    };
  });
}

export interface SeedRow {
  seed: number;
  p50: number | null;
  p5: number | null;
  funded: number | null;
}

function cappedTrials(assumptions: Assumptions, trialCap: number): number {
  const cap = Math.max(50, trialCap);
  return Math.max(50, Math.min(assumptions.trials, cap));
}

export function seedStability(assumptions: Assumptions, seeds: number[], trialCap = 80): SeedRow[] {
  return seeds.map((seed) => {
    const output = runModel({ ...assumptions, seed, trials: cappedTrials(assumptions, trialCap), mixes: [] });
    return {
      seed,
      p50: output.metrics?.wealthPercentiles["50"] ?? null,
      p5: output.metrics?.wealthPercentiles["5"] ?? null,
      funded: output.metrics?.fullyFundedProbability ?? null,
    };
  });
}

export interface ModelRiskRow {
  label: string;
  curveModel: CurveModel;
  sigma: number;
  p50: number | null;
  p5: number | null;
  funded: number | null;
}

export function modelRisk(assumptions: Assumptions, trialCap = 80): ModelRiskRow[] {
  const trials = cappedTrials(assumptions, trialCap);
  const variants: { label: string; curveModel: CurveModel; sigmaScale: number }[] = [
    { label: "Nelson-Siegel factors", curveModel: "nelson_siegel", sigmaScale: 1 },
    { label: "Three-point curve", curveModel: "three_point", sigmaScale: 1 },
    { label: "Nelson-Siegel, 1.5× level vol", curveModel: "nelson_siegel", sigmaScale: 1.5 },
  ];
  return variants.map((variant) => {
    const output = runModel({
      ...assumptions,
      trials,
      mixes: [],
      rates: {
        ...assumptions.rates,
        curveModel: variant.curveModel,
        sigma: assumptions.rates.sigma * variant.sigmaScale,
      },
    });
    return {
      label: variant.label,
      curveModel: variant.curveModel,
      sigma: assumptions.rates.sigma * variant.sigmaScale,
      p50: output.metrics?.wealthPercentiles["50"] ?? null,
      p5: output.metrics?.wealthPercentiles["5"] ?? null,
      funded: output.metrics?.fullyFundedProbability ?? null,
    };
  });
}

export function metricSpread(rows: ModelRiskRow[], pick: (row: ModelRiskRow) => number | null): number | null {
  const values = rows.map(pick).filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 2) return null;
  return Math.max(...values) - Math.min(...values);
}
