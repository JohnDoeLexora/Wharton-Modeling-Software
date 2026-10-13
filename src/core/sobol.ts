import { standardNormal } from "./rng";
import { SOBOL_POLY, SOBOL_VINIT } from "./sobolData";
import type { SamplerComparison } from "./types";

/**
 * Sobol' sequence with a digital shift, plus a Brownian bridge that puts the
 * first coordinates on the coarse time scale. Direction numbers are the
 * Joe–Kuo set stored in `sobolData.ts` (the same initialization SciPy uses).
 * Point 0 is skipped: index 0 here is the first nonzero point.
 */

const BITS = 32;

function bitLength(n: number): number {
  let bits = 0;
  let x = n >>> 0;
  while (x !== 0) {
    x >>>= 1;
    bits += 1;
  }
  return bits;
}

let directionCache: Uint32Array[] | null = null;

function directionNumbers(): Uint32Array[] {
  if (directionCache) return directionCache;
  const dim = SOBOL_POLY.length;
  const rows: Uint32Array[] = [];
  const first = new Uint32Array(BITS);
  for (let i = 0; i < BITS; i++) first[i] = 1;
  rows.push(first);
  for (let d = 1; d < dim; d++) {
    const row = new Uint32Array(BITS);
    const p = SOBOL_POLY[d] >>> 0;
    const m = bitLength(p) - 1;
    const init = SOBOL_VINIT[d] ?? [];
    for (let j = 0; j < m; j++) row[j] = (init[j] ?? 0) >>> 0;
    for (let j = m; j < BITS; j++) {
      let next = row[j - m];
      let pow2 = 1;
      for (let k = 0; k < m; k++) {
        pow2 = (pow2 << 1) >>> 0;
        if ((p >>> (m - 1 - k)) & 1) next = (next ^ Math.imul(pow2, row[j - k - 1])) >>> 0;
      }
      row[j] = next;
    }
    rows.push(row);
  }
  let pow2 = 1;
  for (let col = 0; col < BITS; col++) {
    for (let i = 0; i < dim; i++) rows[i][BITS - 1 - col] = Math.imul(rows[i][BITS - 1 - col], pow2) >>> 0;
    pow2 = (pow2 << 1) >>> 0;
  }
  directionCache = rows;
  return rows;
}

function lowZeroBit(x: number): number {
  let i = 1;
  let n = x >>> 0;
  while (n & 1) {
    n >>>= 1;
    i += 1;
  }
  return i;
}

/** Digital shift from the master seed so two seeds do not share a sequence. */
function shiftWord(seed: number, dimension: number): number {
  let x = (seed >>> 0) ^ Math.imul(dimension + 1, 0x9e3779b9);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

interface SobolState {
  next: number;
  quasi: Uint32Array;
  last: number[];
}

const pointCache = new Map<string, SobolState>();

/**
 * One Sobol point. `index` starts at 0 for the first nonzero point.
 * Returns uniforms in (0, 1). Sequential indexes are O(1) after the first.
 */
export function sobolPoint(index: number, dimensions: number, seed = 0, shifted = true): number[] {
  const rows = directionNumbers();
  const dim = Math.min(dimensions, rows.length);
  const key = `${shifted ? seed >>> 0 : "raw"}|${dim}`;
  let state = pointCache.get(key);
  if (!state || state.quasi.length !== dim || state.next > index + 1) {
    state = { next: 0, quasi: new Uint32Array(dim), last: [] };
    pointCache.set(key, state);
  }
  if (state.next === index + 1 && state.last.length === dim) return state.last.slice();
  while (state.next <= index) {
    const bit = lowZeroBit(state.next);
    const point = Array(dim).fill(0.5);
    for (let j = 0; j < dim; j++) {
      state.quasi[j] = (state.quasi[j] ^ rows[j][bit - 1]) >>> 0;
      const word = shifted ? (state.quasi[j] ^ shiftWord(seed, j)) >>> 0 : state.quasi[j];
      const uniform = (word + 0.5) / 2 ** 32;
      point[j] = uniform > 0 && uniform < 1 ? uniform : 0.5;
    }
    state.last = point;
    state.next += 1;
  }
  return state.last.slice();
}

/** Acklam's inverse normal. Maps (0, 1) to a standard normal. */
export function inverseNormal(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface BridgeKnot {
  left: number;
  mid: number;
  right: number;
}

/** Order in which a Brownian bridge fills the interior of a path of `steps` increments. */
export function bridgeKnots(steps: number): BridgeKnot[] {
  const done = [0, steps];
  const knots: BridgeKnot[] = [];
  while (done.length < steps + 1) {
    let best = -1;
    let left = 0;
    let right = steps;
    for (let k = 0; k < done.length - 1; k++) {
      const gap = done[k + 1] - done[k];
      if (gap > best) {
        best = gap;
        left = done[k];
        right = done[k + 1];
      }
    }
    if (best <= 1) break;
    const mid = left + Math.floor((right - left) / 2);
    knots.push({ left, mid, right });
    done.push(mid);
    done.sort((a, b) => a - b);
  }
  return knots;
}

/**
 * Turn `steps` uniforms into standard-normal increments whose terminal level
 * is fixed by the first uniform. Later uniforms fill finer dates.
 */
export function brownianBridgeIncrements(uniforms: number[]): number[] {
  const steps = uniforms.length;
  if (steps === 0) return [];
  const level = Array(steps + 1).fill(0);
  level[steps] = inverseNormal(uniforms[0]) * Math.sqrt(steps);
  const knots = bridgeKnots(steps);
  knots.forEach((knot, index) => {
    const z = inverseNormal(uniforms[index + 1] ?? 0.5);
    const span = knot.right - knot.left;
    const mean = ((knot.right - knot.mid) * level[knot.left] + (knot.mid - knot.left) * level[knot.right]) / span;
    const variance = ((knot.mid - knot.left) * (knot.right - knot.mid)) / span;
    level[knot.mid] = mean + z * Math.sqrt(Math.max(0, variance));
  });
  const increments: number[] = [];
  for (let t = 1; t <= steps; t++) increments.push(level[t] - level[t - 1]);
  return increments;
}

const RETURN_YEARS = 15;

const bridgeCache = new Map<string, number[]>();

/**
 * Portfolio shock for one sleeve and one projection year under Sobol + bridge.
 * Sleeve `s` owns dimensions `[s * 15, s * 15 + 15)`.
 */
export function sobolSleeveShock(seed: number, trial: number, yearIndex: number, sleeve: number, sleeveCount: number): number {
  const count = Math.max(1, sleeveCount);
  const key = `${seed >>> 0}|${trial}|${sleeve}|${count}`;
  let increments = bridgeCache.get(key);
  if (!increments) {
    const point = sobolPoint(trial, count * RETURN_YEARS, seed);
    const start = sleeve * RETURN_YEARS;
    const uniforms = point.slice(start, start + RETURN_YEARS);
    while (uniforms.length < RETURN_YEARS) uniforms.push(0.5);
    increments = brownianBridgeIncrements(uniforms);
    bridgeCache.set(key, increments);
  }
  return increments[yearIndex] ?? 0;
}

/** Squared-normal integral error, for the pseudo-random versus Sobol comparison. */
export function secondMomentError(samples: number[]): number {
  if (samples.length === 0) return Number.NaN;
  let total = 0;
  for (const value of samples) total += value * value;
  return total / samples.length - 1;
}

/** Shock-level convergence. Not a portfolio result and not a recommended sampler. */
export function samplerConvergence(seed: number): SamplerComparison {
  const small = momentErrors(seed, 128);
  const large = momentErrors(seed, 2048);
  return {
    trials: 2048,
    pseudoMean: 1 + large.pseudo,
    sobolMean: 1 + large.sobol,
    pseudoError: large.pseudo,
    sobolError: large.sobol,
    note:
      `Mean of z² on the first sleeve's 2027 shock. Sobol error at 128 trials is ${small.sobol.toExponential(3)}; ` +
      `at 2048 it is ${large.sobol.toExponential(3)}. Pseudo-random at 2048 is ${large.pseudo.toExponential(3)}. ` +
      `The bridge puts the first Sobol coordinate on the full-horizon level. This is a property of the sampler, not a market view.`,
  };
}

export function momentErrors(seed: number, count: number): { pseudo: number; sobol: number } {
  const pseudo: number[] = [];
  const sobol: number[] = [];
  for (let trial = 0; trial < count; trial++) {
    pseudo.push(standardNormal(seed, 1, trial, 2027, 0));
    sobol.push(sobolSleeveShock(seed, trial, 0, 0, 1));
  }
  return { pseudo: secondMomentError(pseudo), sobol: secondMomentError(sobol) };
}
