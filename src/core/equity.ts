import { STREAM, standardNormal, unitInterval } from "./rng";
import type { BasketName, ScenarioName } from "./types";

const DF_MIN = 3;
const DF_MAX = 30;

export function clampDf(df: number): number {
  if (!Number.isFinite(df)) return 5;
  return Math.max(DF_MIN, Math.min(DF_MAX, Math.round(df)));
}

/**
 * Student-t from one normal and a chi-square built from `df` more normals.
 * Dimensions start at `dimBase` and use the next `df` integers. No generator state is kept.
 */
export function studentT(seed: number, stream: number, trial: number, step: number, dimBase: number, df: number): number {
  const k = clampDf(df);
  const z = standardNormal(seed, stream, trial, step, dimBase);
  let chi = 0;
  for (let i = 0; i < k; i++) {
    const g = standardNormal(seed, stream, trial, step, dimBase + 1 + i);
    chi += g * g;
  }
  const scale = Math.sqrt(chi / k);
  const raw = scale < 1e-8 ? 0 : z / scale;
  // A Student-t with k degrees of freedom has variance k/(k-2). Scale it to 1 so σ stays the return scale.
  const variance = k / (k - 2);
  return raw / Math.sqrt(variance);
}

/** Market-factor kernel. Stream 1, dimensions from 120, so sleeve indexes 0…5 are untouched. */
export const MARKET_DIM = 120;

export function equityKernel(args: {
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  seed: number;
  trial: number;
  year: number;
  df: number;
  rho: number;
  rateShock: number;
}): number {
  if (args.mode === "scenario") {
    if (args.scenario === "bear") return -1;
    if (args.scenario === "bull") return 1;
    return 0;
  }
  const t = studentT(args.seed, STREAM.portfolio, args.trial, args.year, MARKET_DIM, args.df);
  const rho = Math.max(-0.999, Math.min(0.999, args.rho));
  return rho * args.rateShock + Math.sqrt(1 - rho * rho) * t;
}

export const SECTORS = [
  "region",
  "chips",
  "software",
  "media",
  "internet",
  "education",
  "travel",
  "payments",
  "financials",
  "telecom",
  "utilities",
  "staples",
  "real_estate",
  "health",
  "energy",
  "industrials",
  "broad",
] as const;

export function sectorIndex(sector: string): number {
  const index = SECTORS.indexOf(sector as (typeof SECTORS)[number]);
  return index < 0 ? SECTORS.length : index;
}

/** Positive weights only. Equal weights of n names give effective N = n. */
export function effectiveN(weights: number[]): number {
  let total = 0;
  for (const weight of weights) if (weight > 0) total += weight;
  if (total <= 0) return 0;
  let hhi = 0;
  for (const weight of weights) {
    if (weight > 0) {
      const share = weight / total;
      hhi += share * share;
    }
  }
  return hhi > 0 ? 1 / hhi : 0;
}

export function heldCount(names: BasketName[]): number {
  return names.filter((name) => name.weight > 0).length;
}

/** Annual Poisson intensity. An explicit `jumpLambda` wins. Otherwise λ = −log(1−p). */
export function jumpIntensity(name: { jumpLambda?: number; jumpProb: number }): number {
  if (name.jumpLambda !== undefined && Number.isFinite(name.jumpLambda)) return Math.max(0, Math.min(50, name.jumpLambda));
  const p = Math.min(0.999999, Math.max(0, name.jumpProb));
  if (!(p > 0)) return 0;
  return -Math.log(1 - p);
}

/** Inverse CDF of Poisson(λ) at a uniform in (0, 1). λ = 0 returns 0. */
export function poissonCount(u: number, lambda: number): number {
  if (!(lambda > 0) || !Number.isFinite(lambda) || !Number.isFinite(u)) return 0;
  const target = Math.min(1 - 1e-12, Math.max(0, u));
  let term = Math.exp(-lambda);
  if (!Number.isFinite(term) || term === 0) return 0;
  let cdf = term;
  let count = 0;
  const limit = Math.min(5000, Math.ceil(lambda + 20 * Math.sqrt(lambda) + 20));
  while (cdf < target && count < limit) {
    count += 1;
    term *= lambda / count;
    cdf += term;
    if (!Number.isFinite(term)) break;
  }
  return count;
}

/**
 * One-factor single-name return.
 * r = α + β r_m + sector beta × sector shock + idiosyncratic Student-t
 * + a compensated compound-Poisson jump (α_jump = −λ E[size]),
 * then USD/TWD (or any fxSigma) and a compensated geopolitical jump.
 * The jump uniform stays on stream 6, dimension 8000+index, so other coordinates do not move.
 * Scenario paths use the compensated mean, which is zero.
 */
export function singleNameReturn(args: {
  name: BasketName;
  index: number;
  market: number;
  sectorShock: number;
  mode: "mc" | "scenario";
  seed: number;
  trial: number;
  year: number;
  /** Unit-variance divisor. Set only when the shared-chi overlay is on. MODEL_SPEC §7.2. */
  sharedScale?: number;
}): number {
  const { name } = args;
  let idiosyncratic = 0;
  let jump = 0;
  let fx = 0;
  if (args.mode === "mc") {
    if (args.sharedScale !== undefined && args.sharedScale > 0) {
      const z = standardNormal(args.seed, STREAM.idio, args.trial, args.year, args.index * 40);
      idiosyncratic = name.idioSigma * (z / args.sharedScale);
    } else {
      idiosyncratic = name.idioSigma * studentT(args.seed, STREAM.idio, args.trial, args.year, args.index * 40, name.studentDf);
    }
    const lambda = jumpIntensity(name);
    const jumpDraw = unitInterval(args.seed, STREAM.idio, args.trial, args.year, 8000 + args.index);
    const count = poissonCount(jumpDraw, lambda);
    jump = (count - lambda) * name.jumpMean;
    const fxShock = standardNormal(args.seed, STREAM.idio, args.trial, args.year, 9000 + args.index);
    const geoDraw = unitInterval(args.seed, STREAM.idio, args.trial, args.year, 11000 + args.index);
    const geo = geoDraw < name.geoJumpProb ? name.geoJumpMean : 0;
    fx = name.fxSigma * fxShock + geo - name.geoJumpProb * name.geoJumpMean;
  }
  let result = name.alpha + name.beta * args.market + name.sectorBeta * args.sectorShock + idiosyncratic + jump;
  if (fx !== 0) result = (1 + result) * (1 + fx) - 1;
  if (name.expenseRatio !== 0) result = (1 + result) * (1 - name.expenseRatio) - 1;
  return result;
}

export function sectorShockAt(args: {
  sector: string;
  sigma: number;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
  seed: number;
  trial: number;
  year: number;
}): number {
  if (!(args.sigma > 0)) return 0;
  if (args.mode === "scenario") {
    const kernel = args.scenario === "bear" ? -1 : args.scenario === "bull" ? 1 : 0;
    return args.sigma * kernel;
  }
  const z = standardNormal(args.seed, STREAM.idio, args.trial, args.year, 20000 + sectorIndex(args.sector));
  return args.sigma * z;
}
