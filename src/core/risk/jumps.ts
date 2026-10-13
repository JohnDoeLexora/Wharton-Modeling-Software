/**
 * Per-name jump intensity and size.
 * A gap is a session with |return| > k · σ_EWMA. An earnings flag lowers the multiple to 2.
 * The annual model is a compound Poisson. The simulation engine draws one Bernoulli jump per year,
 * moment-matched to that Poisson. Fixed etf/large/small/moon classes are a fallback only.
 */

import type { CleanSeries } from "./clean";
import { ewmaVariance, TRADING_DAYS } from "./vol";

export const DEFAULT_JUMP_K = 3;

export interface JumpClass {
  id: "etf" | "large" | "small" | "moon";
  prob: number;
  mean: number;
}

/** Legacy annual classes. Not a fit. Used only when the name and its sector have almost no gaps. */
export const JUMP_CLASSES: Record<JumpClass["id"], JumpClass> = {
  etf: { id: "etf", prob: 0, mean: 0 },
  large: { id: "large", prob: 0.02, mean: -0.35 },
  small: { id: "small", prob: 0.04, mean: -0.5 },
  moon: { id: "moon", prob: 0.08, mean: -0.6 },
};

export type JumpSource = "name" | "sector-pool" | "class-fallback";

export interface JumpFit {
  source: JumpSource;
  fallbackClass: JumpClass["id"] | null;
  k: number;
  gaps: number;
  lambdaAnnual: number;
  mean: number;
  meanSquare: number;
  upside: number;
  downside: number;
  /** Bernoulli probability used by the annual engine. */
  prob: number;
  /** Bernoulli size used by the annual engine. */
  size: number;
  /** λ E[J²], annual. */
  jumpVariance: number;
  /** Diffusion variance of the non-gap daily sample, annualized. */
  diffusionVariance: number;
  /** diffusion + λ E[J²]. Always at least the diffusion piece. */
  totalVariance: number;
  /** Share of gaps that are positive. NaN when there are no gaps. */
  upProb: number;
  /** Double-exponential rate of the positive gaps, 1 / mean. NaN when that side is empty. */
  upRate: number;
  /** Double-exponential rate of the absolute negative gaps. */
  downRate: number;
  note: string;
}

/** Kou-style rates from the observed gap sizes. The annual engine still uses the empirical moments. */
export function doubleExponential(sizes: number[]): { upProb: number; upRate: number; downRate: number } {
  const up = sizes.filter((size) => size > 0);
  const down = sizes.filter((size) => size < 0);
  const upMean = up.length > 0 ? up.reduce((sum, size) => sum + size, 0) / up.length : NaN;
  const downMean = down.length > 0 ? down.reduce((sum, size) => sum + Math.abs(size), 0) / down.length : NaN;
  return {
    upProb: sizes.length > 0 ? up.length / sizes.length : NaN,
    upRate: upMean > 0 ? 1 / upMean : NaN,
    downRate: downMean > 0 ? 1 / downMean : NaN,
  };
}

export function detectGaps(returns: number[], events: boolean[] | null, k = DEFAULT_JUMP_K, lambda = 0.94): boolean[] {
  const ewma = ewmaVariance(returns, lambda);
  return returns.map((value, index) => {
    const sigma = Math.sqrt(Math.max(ewma.variance[index], 1e-12));
    const multiple = events?.[index] ? Math.min(k, 2) : k;
    return Math.abs(value) > multiple * sigma;
  });
}

function moments(sizes: number[]): { mean: number; meanSquare: number } {
  if (sizes.length === 0) return { mean: 0, meanSquare: 0 };
  let mean = 0;
  let meanSquare = 0;
  for (const size of sizes) {
    mean += size;
    meanSquare += size * size;
  }
  return { mean: mean / sizes.length, meanSquare: meanSquare / sizes.length };
}

/**
 * Match E[J] and, as far as a single Bernoulli can, E[J²].
 * p = 1 − exp(−λ), size = λ μ / p. Variance left unmatched is returned as a shortfall
 * for the idiosyncratic variance, so the jump piece is not silently dropped.
 */
export function bernoulliMatch(lambdaAnnual: number, mean: number, meanSquare: number): { prob: number; size: number; shortfall: number } {
  if (!(lambdaAnnual > 0) || !(meanSquare > 0)) return { prob: 0, size: 0, shortfall: 0 };
  const prob = 1 - Math.exp(-lambdaAnnual);
  if (!(prob > 1e-8)) return { prob: 0, size: 0, shortfall: lambdaAnnual * meanSquare };
  const size = (lambdaAnnual * mean) / prob;
  const matched = prob * size * size;
  const target = lambdaAnnual * meanSquare;
  return { prob: Math.min(1, prob), size, shortfall: Math.max(0, target - matched) };
}

export function jumpVariance(diffusionVariance: number, lambdaAnnual: number, meanSquare: number): number {
  return diffusionVariance + Math.max(0, lambdaAnnual) * Math.max(0, meanSquare);
}

function annualizeCount(gaps: number, sessions: number): number {
  if (sessions <= 0) return 0;
  return (gaps / sessions) * TRADING_DAYS;
}

function fitFromSizes(sizes: number[], sessions: number, diffusionDaily: number, k: number, source: JumpSource, fallback: JumpClass["id"] | null, note: string): JumpFit {
  const { mean, meanSquare } = moments(sizes);
  const lambdaAnnual = annualizeCount(sizes.length, sessions);
  const matched = bernoulliMatch(lambdaAnnual, mean, meanSquare);
  const diffusionVariance = Math.max(0, diffusionDaily) * TRADING_DAYS;
  const jumpVar = Math.max(0, lambdaAnnual) * Math.max(0, meanSquare);
  return {
    source,
    fallbackClass: fallback,
    k,
    gaps: sizes.length,
    lambdaAnnual,
    mean,
    meanSquare,
    upside: sizes.filter((size) => size > 0).length,
    downside: sizes.filter((size) => size < 0).length,
    prob: matched.prob,
    size: matched.size,
    jumpVariance: jumpVar,
    diffusionVariance,
    totalVariance: diffusionVariance + jumpVar,
    ...doubleExponential(sizes),
    note,
  };
}

export function fallbackJumpClass(role: string, ipoShort: boolean, realizedAnnual: number): JumpClass["id"] {
  if (role === "etf" || role === "index") return "etf";
  if (ipoShort || realizedAnnual >= 0.4) return "small";
  return "large";
}

export function classJump(id: JumpClass["id"], diffusionDaily: number, k: number): JumpFit {
  const klass = JUMP_CLASSES[id];
  const meanSquare = klass.mean * klass.mean;
  const diffusionVariance = Math.max(0, diffusionDaily) * TRADING_DAYS;
  const jumpVar = klass.prob * meanSquare;
  return {
    source: "class-fallback",
    fallbackClass: id,
    k,
    gaps: 0,
    lambdaAnnual: klass.prob,
    mean: klass.mean,
    meanSquare,
    upside: 0,
    downside: 0,
    prob: klass.prob,
    size: klass.mean,
    jumpVariance: jumpVar,
    diffusionVariance,
    totalVariance: diffusionVariance + jumpVar,
    ...doubleExponential([]),
    note: `Fallback jump class "${id}" (${(klass.prob * 100).toFixed(0)}%/yr, size ${(klass.mean * 100).toFixed(0)}%). Not fit to this name's gaps.`,
  };
}

export interface SectorJumpPool {
  gaps: number;
  sessions: number;
  sizes: number[];
}

export function fitJumps(args: {
  series: CleanSeries;
  k?: number;
  pool?: SectorJumpPool;
  realizedAnnual?: number;
  forceClass?: JumpClass["id"];
}): JumpFit {
  const k = args.k ?? DEFAULT_JUMP_K;
  const gaps = detectGaps(args.series.returns, args.series.events, k);
  const sizes = args.series.returns.filter((_, index) => gaps[index]);
  const quiet = args.series.returns.filter((_, index) => !gaps[index]);
  const diffusionDaily = quiet.length > 2 ? quiet.reduce((sum, value) => sum + value * value, 0) / (quiet.length - 1) : 0;
  if (args.forceClass) return classJump(args.forceClass, diffusionDaily, k);
  if (sizes.length >= 3) {
    return fitFromSizes(
      sizes,
      args.series.returns.length,
      diffusionDaily,
      k,
      "name",
      null,
      `${sizes.length} gaps with |return| > ${k} conditional standard deviations. Intensity is gaps per year. The annual engine uses one Bernoulli jump matched to the compound-Poisson mean.`,
    );
  }
  const pool = args.pool;
  if (pool && pool.gaps >= 3 && pool.sessions > 0) {
    const ownWeight = args.series.returns.length;
    const blendedSessions = ownWeight + pool.sessions;
    const blendedSizes = [...sizes, ...pool.sizes];
    const lambda = annualizeCount(sizes.length + pool.gaps, blendedSessions);
    const { mean, meanSquare } = moments(blendedSizes);
    const matched = bernoulliMatch(lambda, mean, meanSquare);
    const diffusionVariance = Math.max(0, diffusionDaily) * TRADING_DAYS;
    const jumpVar = lambda * Math.max(0, meanSquare);
    return {
      source: "sector-pool",
      fallbackClass: null,
      k,
      gaps: sizes.length,
      lambdaAnnual: lambda,
      mean,
      meanSquare,
      upside: blendedSizes.filter((size) => size > 0).length,
      downside: blendedSizes.filter((size) => size < 0).length,
      prob: matched.prob,
      size: matched.size,
      jumpVariance: jumpVar,
      diffusionVariance,
      totalVariance: diffusionVariance + jumpVar,
      ...doubleExponential(blendedSizes),
      note: `Short gap history (${sizes.length}). Intensity pools this name with ${pool.gaps} sector gaps. Not a fixed class.`,
    };
  }
  const id = fallbackJumpClass(args.series.role, args.series.quality.ipoShort, args.realizedAnnual ?? 0);
  return classJump(id, diffusionDaily, k);
}
