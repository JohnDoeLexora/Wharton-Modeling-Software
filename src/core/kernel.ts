/**
 * Optional overlays on the canonical year-step kernel. MODEL_SPEC §7.
 * Every helper is a no-op unless the matching flag is on. The default path
 * does not call these helpers, so a book with no `kernel` object is unchanged.
 */
import { clampDf, MARKET_DIM } from "./equity";
import { STREAM, standardNormal, unitInterval } from "./rng";
import type { KernelFlags, KernelReport, Sleeve } from "./types";

export const DEFAULT_TRANSITION_2: number[][] = [
  [0.85, 0.15],
  [0.35, 0.65],
];

export const DEFAULT_TRANSITION_3: number[][] = [
  [0.8, 0.15, 0.05],
  [0.25, 0.6, 0.15],
  [0.2, 0.3, 0.5],
];

export const DEFAULT_DRAG = [0, -0.08, -0.18];

/** Dimension of the regime uniform on stream 1. Clear of sleeve indexes and the market factor. */
export const REGIME_DIM = 400;
/** Sector and FX normals for the equity-index overlay, on stream 6. */
export const SECTOR_FX_DIM = 21000;
/** Investment-grade spread shock, on stream 5, clear of sleeve default draws. */
export const IG_DIM = 500;

export function kernelEngaged(flags: KernelFlags | undefined): boolean {
  if (!flags) return false;
  return Boolean(
    flags.markovRegimes ||
      flags.sharedStudent ||
      flags.sectorFx ||
      flags.igSpread ||
      flags.issuerCredit ||
      flags.targetMaturity ||
      flags.binnedRange,
  );
}

export function activeFlags(flags: KernelFlags | undefined): string[] {
  if (!flags) return [];
  const names: string[] = [];
  if (flags.markovRegimes) names.push("markovRegimes");
  if (flags.sharedStudent) names.push("sharedStudent");
  if (flags.sectorFx) names.push("sectorFx");
  if (flags.igSpread) names.push("igSpread");
  if (flags.issuerCredit) names.push("issuerCredit");
  if (flags.targetMaturity) names.push("targetMaturity");
  if (flags.binnedRange) names.push("binnedRange");
  return names;
}

export function transitionOf(flags: KernelFlags): number[][] {
  if (flags.transition && flags.transition.length >= 2) return flags.transition;
  return (flags.states ?? 2) === 3 ? DEFAULT_TRANSITION_3 : DEFAULT_TRANSITION_2;
}

export function dragOf(flags: KernelFlags, state: number): number {
  const table = flags.stateDrag && flags.stateDrag.length > 0 ? flags.stateDrag : DEFAULT_DRAG;
  return table[state] ?? table[table.length - 1] ?? 0;
}

/** One Markov step. `u` is uniform on (0, 1). The row is renormalized if it does not sum to 1. */
export function markovStep(state: number, u: number, transition: number[][]): number {
  const row = transition[Math.min(state, transition.length - 1)] ?? transition[0];
  let total = 0;
  for (const p of row) total += p > 0 ? p : 0;
  if (!(total > 0)) return 0;
  let cursor = 0;
  for (let next = 0; next < row.length; next++) {
    const p = row[next] > 0 ? row[next] / total : 0;
    cursor += p;
    if (u <= cursor) return next;
  }
  return row.length - 1;
}

/** Multinomial standard error sqrt(p (1-p) / n) for one row. Null when the count is not positive. */
export function transitionStandardErrors(transition: number[][], counts: number[] | undefined): (number | null)[][] {
  return transition.map((row, index) => {
    const n = counts?.[index] ?? 0;
    return row.map((p) => (n > 0 && p >= 0 && p <= 1 ? Math.sqrt((p * (1 - p)) / n) : null));
  });
}

/**
 * Unit-variance Student-t scale shared by the market factor and, when the flag is on, basket residuals.
 * The chi-square uses the same stream-1 dimensions as `studentT` at MARKET_DIM, so the market kernel is unchanged.
 * MODEL_SPEC §7.2.
 */
export function sharedStudentScale(seed: number, trial: number, year: number, df: number): number {
  const k = clampDf(df);
  let chi = 0;
  for (let i = 0; i < k; i++) {
    const g = standardNormal(seed, STREAM.portfolio, trial, year, MARKET_DIM + 1 + i);
    chi += g * g;
  }
  const scale = Math.sqrt(chi / k);
  return (scale < 1e-8 ? 1e-8 : scale) * Math.sqrt(k / (k - 2));
}

export function regimeDragAt(args: {
  flags: KernelFlags;
  seed: number;
  trial: number;
  year: number;
  state: number;
}): { state: number; drag: number } {
  const transition = transitionOf(args.flags);
  const u = unitInterval(args.seed, STREAM.portfolio, args.trial, args.year, REGIME_DIM);
  const state = markovStep(args.state, u, transition);
  return { state, drag: dragOf(args.flags, state) };
}

/** Sector and USD/TWD add-on for an equity-index simple return. Draws only when the caller asks. */
export function sectorFxReturn(args: {
  base: number;
  flags: KernelFlags;
  seed: number;
  trial: number;
  year: number;
}): number {
  const sectorSigma = args.flags.sectorSigma ?? 0;
  const fxSigma = args.flags.fxSigma ?? 0;
  let result = args.base;
  if (sectorSigma !== 0) {
    result += sectorSigma * standardNormal(args.seed, STREAM.idio, args.trial, args.year, SECTOR_FX_DIM);
  }
  if (fxSigma !== 0) {
    const fx = fxSigma * standardNormal(args.seed, STREAM.idio, args.trial, args.year, SECTOR_FX_DIM + 1);
    result = (1 + result) * (1 + fx) - 1;
  }
  return result;
}

/** Mean-reverting spread. A zero kappa and a zero sigma leave the spread where it was. MODEL_SPEC §7.4. */
export function stepIgSpread(args: {
  spread: number;
  kappa: number;
  theta: number;
  sigma: number;
  shock: number;
  equity: number;
  spreadBeta: number;
}): number {
  const next = args.spread + args.kappa * (args.theta - args.spread) + args.sigma * args.shock;
  return next + args.spreadBeta * Math.max(0, -args.equity);
}

export function issuerDefaultProbability(base: number, beta: number, equity: number): number {
  if (!(base > 0)) return 0;
  const intensity = base * Math.exp(beta * Math.max(0, -equity));
  return intensity > 1 ? 1 : intensity;
}

/**
 * Duration pulled linearly to zero at the target year.
 * At the first projection year the sleeve duration is unchanged. At the target year it is zero.
 */
export function targetDuration(duration: number, year: number, targetYear: number, firstYear: number): number {
  const span = targetYear - firstYear;
  if (!(span > 0)) return year >= targetYear ? 0 : duration;
  const left = targetYear - year;
  if (left <= 0) return 0;
  const scaled = duration * (left / span);
  return scaled > 0 ? scaled : 0;
}

export function effectiveDuration(sleeve: Sleeve, year: number, flags: KernelFlags | undefined, firstYear: number): number {
  if (!flags?.targetMaturity || !(typeof sleeve.targetYear === "number") || !Number.isFinite(sleeve.targetYear)) {
    return sleeve.duration;
  }
  return targetDuration(sleeve.duration, year, sleeve.targetYear, firstYear);
}

/**
 * Binned 2031 communication range. Wealth is sorted into `bins` equal-count bins.
 * The reported low and high are the mean gift in the bottom and top bins.
 * This is a summary of the sample, not a recommended range. MODEL_SPEC §7.7.
 */
export function binnedCommunicationRange(
  wealth: number[],
  gift: number[],
  bins: number,
): { low: number | null; high: number | null } {
  const count = Math.min(wealth.length, gift.length);
  const rows: { wealth: number; gift: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (Number.isFinite(wealth[i]) && Number.isFinite(gift[i])) rows.push({ wealth: wealth[i], gift: gift[i] });
  }
  const nBins = Math.max(2, Math.floor(bins));
  if (rows.length < nBins) return { low: null, high: null };
  rows.sort((a, b) => a.wealth - b.wealth);
  const size = Math.floor(rows.length / nBins);
  if (size < 1) return { low: null, high: null };
  const mean = (start: number) => {
    let total = 0;
    for (let i = start; i < start + size; i++) total += rows[i].gift;
    return total / size;
  };
  return { low: mean(0), high: mean(rows.length - size) };
}

export function kernelReportFrom(args: {
  flags: KernelFlags | undefined;
  wealth2031: number[];
  gift: number[];
}): KernelReport | undefined {
  if (!kernelEngaged(args.flags) || !args.flags) return undefined;
  const flags = args.flags;
  const transition = flags.markovRegimes ? transitionOf(flags) : null;
  const binned = flags.binnedRange
    ? binnedCommunicationRange(args.wealth2031, args.gift, flags.bins ?? 10)
    : { low: null, high: null };
  return {
    label: "Kernel overlays are on. The canonical sample still uses the same year step. This block is the overlay, not a recommendation.",
    flags: activeFlags(flags),
    transitionSe: transition ? transitionStandardErrors(transition, flags.transitionCount) : null,
    binnedLow: binned.low,
    binnedHigh: binned.high,
  };
}
