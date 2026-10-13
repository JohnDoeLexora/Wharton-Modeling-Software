/**
 * Per-name jump intensity and size.
 * Jumps are days whose GARCH residual (EWMA if GARCH does not converge) exceeds a
 * Student-t quantile set for a small false-positive rate. The annual model is a
 * compensated compound Poisson: N ~ Poisson(λ), sizes iid, α_jump = −λ E[size].
 * A fixed etf/large/small/moon class is used only for a short history with no pool.
 */

import type { CleanSeries } from "./clean";
import { mean, studentPpf } from "./stats";
import { fitStudentT } from "./tails";
import { conditionalSigma, seriesKey, TRADING_DAYS, type ConditionalVol } from "./vol";

export const DEFAULT_JUMP_K = 3;
/** Two-sided false positives per year on ordinary sessions. Pure Student-t noise stays near this rate. */
export const FALSE_POSITIVES_PER_YEAR = 0.02;
/** Earnings days use a looser bar, still a Student-t quantile. */
const EVENT_FALSE_POSITIVES_PER_YEAR = 1;
const LONG_HISTORY = 3 * TRADING_DAYS;
const OUTLIER_RATE = 0.005;
const OUTLIER_SIGMAS = 10;

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
  /**
   * Left at 0. The annual engine draws a Poisson count of `mean`, not one Bernoulli of `size`.
   * `bernoulliMatch` is still available for the moment-match identity.
   */
  prob: number;
  /** Single-jump mean. Not the aggregate λμ / (1−e^{−λ}). */
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
  /** True on sessions classified as jumps. Same length as the return series when the fit saw one. */
  isJump: boolean[];
  volSource: "garch" | "ewma";
  /** Set when the standardized residual used EWMA because GARCH did not converge. */
  volFlag: string | null;
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

interface Detection {
  mask: boolean[];
  vol: ConditionalVol;
}

const detectionCache = new Map<string, Detection>();

function robustScale(values: number[]): { median: number; scale: number } {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return { median: 0, scale: 1 };
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
  const abs = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const mad = abs.length % 2 === 1 ? abs[mid] : 0.5 * (abs[mid - 1] + abs[mid]);
  return { median, scale: Math.max(1.4826 * mad, 1e-8) };
}

function eventKey(events: boolean[] | null): string {
  if (!events) return "0";
  let hash = 0;
  for (let i = 0; i < events.length; i++) if (events[i]) hash = (hash * 131 + i + 1) % 1000003;
  return String(hash);
}

function classifyJumps(returns: number[], events: boolean[] | null, lambda: number): Detection {
  const key = `${seriesKey(returns)}|${eventKey(events)}|${lambda}`;
  const cached = detectionCache.get(key);
  if (cached) return cached;
  const vol = conditionalSigma(returns, lambda);
  const center = mean(returns);
  const z = returns.map((value, index) => {
    if (!Number.isFinite(value)) return 0;
    const sigma = Math.max(vol.sigma[index] ?? 0, 1e-12);
    return (value - (Number.isFinite(center) ? center : 0)) / sigma;
  });
  const robust = robustScale(z);
  let outliers = 0;
  for (const value of z) if (Math.abs(value - robust.median) > OUTLIER_SIGMAS * robust.scale) outliers += 1;
  const rate = z.length > 0 ? outliers / z.length : 0;
  const bulk = rate > OUTLIER_RATE ? z.filter((value) => Math.abs(value - robust.median) <= OUTLIER_SIGMAS * robust.scale) : z;
  const sample = bulk.length >= 30 ? bulk : z;
  const fit = fitStudentT(sample);
  const df = fit?.df ?? 5;
  const fittedMean = mean(sample);
  const mu = Number.isFinite(fittedMean) ? fittedMean : 0;
  const scale = fit && fit.scale > 0 ? fit.scale : robust.scale;
  const ordinary = Math.min(0.5, FALSE_POSITIVES_PER_YEAR / TRADING_DAYS);
  const eventTail = Math.min(0.5, EVENT_FALSE_POSITIVES_PER_YEAR / TRADING_DAYS);
  const cutoff = scale * studentPpf(1 - ordinary / 2, df);
  const eventCutoff = scale * studentPpf(1 - eventTail / 2, df);
  const mask = z.map((value, index) => {
    const bar = events?.[index] ? eventCutoff : cutoff;
    return Number.isFinite(bar) && Math.abs(value - mu) > bar;
  });
  const detection = { mask, vol };
  detectionCache.set(key, detection);
  if (detectionCache.size > 48) {
    const oldest = detectionCache.keys().next().value;
    if (oldest !== undefined) detectionCache.delete(oldest);
  }
  return detection;
}

/**
 * Jump days. `k` is retained for callers and is no longer the threshold:
 * the bar is a Student-t quantile with about 0.02 false positives per year.
 * `lambda` is the EWMA decay used only when GARCH does not converge.
 */
export function detectGaps(returns: number[], events: boolean[] | null, k = DEFAULT_JUMP_K, lambda = 0.94): boolean[] {
  void k;
  if (returns.length === 0) return [];
  return classifyJumps(returns, events, lambda).mask;
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
 * p = 1 − exp(−λ), size = λ μ / p. The portfolio engine does not use this match.
 * It draws the Poisson count and compensates λμ.
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

function withVol(fit: Omit<JumpFit, "isJump" | "volSource" | "volFlag">, detection: Detection | null, mask: boolean[]): JumpFit {
  return {
    ...fit,
    isJump: mask,
    volSource: detection?.vol.source ?? "ewma",
    volFlag: detection?.vol.flag ?? null,
  };
}

function fitFromSizes(
  sizes: number[],
  sessions: number,
  diffusionDaily: number,
  k: number,
  source: JumpSource,
  fallback: JumpClass["id"] | null,
  note: string,
  detection: Detection | null,
  mask: boolean[],
): JumpFit {
  const { mean, meanSquare } = moments(sizes);
  const lambdaAnnual = annualizeCount(sizes.length, sessions);
  const diffusionVariance = Math.max(0, diffusionDaily) * TRADING_DAYS;
  const jumpVar = Math.max(0, lambdaAnnual) * Math.max(0, meanSquare);
  const volNote = detection?.vol.flag ? ` ${detection.vol.flag}` : "";
  return withVol(
    {
      source,
      fallbackClass: fallback,
      k,
      gaps: sizes.length,
      lambdaAnnual,
      mean,
      meanSquare,
      upside: sizes.filter((size) => size > 0).length,
      downside: sizes.filter((size) => size < 0).length,
      prob: 0,
      size: mean,
      jumpVariance: jumpVar,
      diffusionVariance,
      totalVariance: diffusionVariance + jumpVar,
      ...doubleExponential(sizes),
      note: `${note}${volNote}`,
    },
    detection,
    mask,
  );
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
    isJump: [],
    volSource: "ewma",
    volFlag: null,
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
  const detection = classifyJumps(args.series.returns, args.series.events, 0.94);
  const gaps = detection.mask;
  const sizes = args.series.returns.filter((_, index) => gaps[index]);
  const quiet = args.series.returns.filter((_, index) => !gaps[index]);
  const diffusionDaily = quiet.length > 2 ? quiet.reduce((sum, value) => sum + value * value, 0) / (quiet.length - 1) : 0;
  const sessions = args.series.returns.length;
  if (args.forceClass) {
    const forced = classJump(args.forceClass, diffusionDaily, k);
    forced.isJump = gaps;
    forced.volSource = detection.vol.source;
    forced.volFlag = detection.vol.flag;
    return forced;
  }
  const long = sessions >= LONG_HISTORY;
  if (sizes.length >= 3 || (long && sizes.length > 0)) {
    return fitFromSizes(
      sizes,
      sessions,
      diffusionDaily,
      k,
      "name",
      null,
      `${sizes.length} jumps on ${detection.vol.source === "garch" ? "GARCH" : "EWMA"} residuals, past a Student-t quantile aimed at ${FALSE_POSITIVES_PER_YEAR} false positives a year. Intensity is jumps per year. The engine draws a compensated compound Poisson of this mean size.`,
      detection,
      gaps,
    );
  }
  if (long) {
    return fitFromSizes(
      [],
      sessions,
      diffusionDaily,
      k,
      "name",
      null,
      `At least three years of history and no jumps at the Student-t threshold. Intensity is zero. No class fallback.`,
      detection,
      gaps,
    );
  }
  const pool = args.pool;
  if (pool && pool.gaps >= 3 && pool.sessions > 0) {
    const blendedSessions = sessions + pool.sessions;
    const blendedSizes = [...sizes, ...pool.sizes];
    const lambda = annualizeCount(sizes.length + pool.gaps, blendedSessions);
    const { mean, meanSquare } = moments(blendedSizes);
    const diffusionVariance = Math.max(0, diffusionDaily) * TRADING_DAYS;
    const jumpVar = lambda * Math.max(0, meanSquare);
    const volNote = detection.vol.flag ? ` ${detection.vol.flag}` : "";
    return withVol(
      {
        source: "sector-pool",
        fallbackClass: null,
        k,
        gaps: sizes.length,
        lambdaAnnual: lambda,
        mean,
        meanSquare,
        upside: blendedSizes.filter((size) => size > 0).length,
        downside: blendedSizes.filter((size) => size < 0).length,
        prob: 0,
        size: mean,
        jumpVariance: jumpVar,
        diffusionVariance,
        totalVariance: diffusionVariance + jumpVar,
        ...doubleExponential(blendedSizes),
        note: `Short gap history (${sizes.length}). Intensity pools this name with ${pool.gaps} sector gaps. Not a fixed class.${volNote}`,
      },
      detection,
      gaps,
    );
  }
  const id = fallbackJumpClass(args.series.role, args.series.quality.ipoShort, args.realizedAnnual ?? 0);
  const fallback = classJump(id, diffusionDaily, k);
  fallback.isJump = gaps;
  fallback.volSource = detection.vol.source;
  fallback.volFlag = detection.vol.flag;
  if (detection.vol.flag) fallback.note = `${fallback.note} ${detection.vol.flag}`;
  return fallback;
}
