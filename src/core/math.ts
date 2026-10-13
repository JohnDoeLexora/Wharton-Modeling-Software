import type { ReturnModel } from "./types";

/**
 * Mulberry32. Returns uniforms on [0, 1).
 * Not used by the projection engine. The engine draws from the counter-based
 * streams in `rng.ts`, so a sample does not depend on call order.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normals via Box–Muller. One spare draw is cached. */
export function boxMuller(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const saved = spare;
      spare = null;
      return saved;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };
}

/** Seeds are unsigned 32-bit integers. Values outside that set are rejected, not wrapped. */
export const SEED_MODULUS = 2 ** 32;

export function seedProblem(seed: number): string | null {
  if (!Number.isFinite(seed)) return "The seed is not a finite number. It was not replaced with another seed.";
  if (!Number.isInteger(seed)) return `Seed ${seed} is not an integer. It was not rounded.`;
  if (seed < 0) return `Seed ${seed} is negative. It is not run as seed ${Math.abs(seed)}.`;
  if (seed >= SEED_MODULUS) return `Seed ${seed} is outside 0 … ${SEED_MODULUS - 1}. It was not wrapped modulo 2^32.`;
  return null;
}

export function normalizeSeed(seed: number): number {
  const problem = seedProblem(seed);
  if (problem) throw new Error(problem);
  return seed;
}

/** Lower-triangular Cholesky factor. Returns null if the matrix is not positive semidefinite. */
export function cholesky(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += lower[i][k] * lower[j][k];
      if (i === j) {
        const diag = matrix[i][i] - sum;
        if (diag < -1e-8) return null;
        lower[i][j] = Math.sqrt(Math.max(0, diag));
      } else if (lower[j][j] <= 1e-12) {
        if (Math.abs(matrix[i][j] - sum) > 1e-6) return null;
        lower[i][j] = 0;
      } else {
        lower[i][j] = (matrix[i][j] - sum) / lower[j][j];
      }
    }
  }
  return lower;
}

export function correlatedShocks(lower: number[][], z: number[]): number[] {
  const n = lower.length;
  const out = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k <= i; k++) sum += lower[i][k] * z[k];
    out[i] = sum;
  }
  return out;
}

/**
 * Map one standard normal into a simple annual return.
 * Lognormal is calibrated so E[1+r] = 1+mu and Var(1+r) = sigma^2.
 * The correlation across sleeves is applied to the normal shocks first (Gaussian copula).
 */
/** Abramowitz and Stegun 7.1.26. Absolute error under about 1.5e-7. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const p = 0.3275911;
  const t = 1 / (1 + p * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp(-a * a);
  return sign * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** E[max(floor, μ + σ Z)] for a standard normal Z. */
export function censoredNormalMean(mu: number, sigma: number, floor: number): number {
  if (!(sigma > 0)) return Math.max(floor, mu);
  const a = (floor - mu) / sigma;
  const cdf = normalCdf(a);
  return floor * cdf + mu * (1 - cdf) + sigma * normalPdf(a);
}

/**
 * The normal floor lifts the mean. `bias` is that lift at the typed μ.
 * `location` is the center that puts the censored mean back on μ, when that is possible.
 */
export function normalFloorAdjustment(
  mu: number,
  sigma: number,
  floor: number,
): { location: number; bias: number; achievable: boolean } {
  const biased = censoredNormalMean(mu, sigma, floor);
  const bias = biased - mu;
  if (!(sigma > 0) || Math.abs(bias) < 1e-14) return { location: mu, bias: 0, achievable: true };
  if (mu < floor - 1e-12) return { location: floor, bias, achievable: false };
  let lo = Math.min(mu, floor) - 12 * sigma;
  let hi = mu;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (censoredNormalMean(mid, sigma, floor) > mu) hi = mid;
    else lo = mid;
  }
  return { location: (lo + hi) / 2, bias, achievable: true };
}

const locationCache = new Map<string, number>();

export function correctedNormalLocation(mu: number, sigma: number, floor: number): number {
  const key = `${mu}|${sigma}|${floor}`;
  const hit = locationCache.get(key);
  if (hit !== undefined) return hit;
  const location = normalFloorAdjustment(mu, sigma, floor).location;
  locationCache.set(key, location);
  return location;
}

export function simpleReturn(
  mu: number,
  sigma: number,
  z: number,
  model: ReturnModel,
  floor: number,
  correctFloor = false,
): number {
  if (!Number.isFinite(mu) || !Number.isFinite(sigma) || !Number.isFinite(z) || !Number.isFinite(floor)) {
    return Number.NaN;
  }
  const vol = sigma < 0 ? 0 : sigma;
  if (model === "normal") {
    const center = correctFloor ? correctedNormalLocation(mu, vol, floor) : mu;
    const linear = center + vol * z;
    if (!Number.isFinite(linear)) return z >= 0 ? 1e6 : floor;
    return Math.max(floor, linear);
  }
  if (mu <= -1) return -1;
  const meanRelative = 1 + mu;
  const s2 = Math.log(1 + (vol * vol) / (meanRelative * meanRelative));
  const m = Math.log(meanRelative) - s2 / 2;
  const s = Math.sqrt(s2);
  const exponent = m + s * z;
  // Math.exp overflows past about 709. Cap the exponent so a wild normal does not become Infinity.
  const capped = Math.min(709, exponent);
  const result = Math.exp(capped) - 1;
  return Number.isFinite(result) ? result : 1e6;
}

/** Present value of `count` payments, first one immediate, discounted at a flat yield. */
export function pvAnnuityDue(payment: number, count: number, yieldPerYear: number): number {
  if (count <= 0 || payment === 0) return 0;
  if (yieldPerYear <= -0.999999) return Number.POSITIVE_INFINITY;
  if (Math.abs(yieldPerYear) < 1e-14) return payment * count;
  let total = 0;
  for (let k = 0; k < count; k++) {
    total += payment / Math.pow(1 + yieldPerYear, k);
  }
  return total;
}

/** Macaulay duration in years. The immediate payment (k = 0) has zero time weight. */
export function macaulayDuration(payment: number, count: number, yieldPerYear: number): number {
  const pv = pvAnnuityDue(payment, count, yieldPerYear);
  if (!Number.isFinite(pv) || pv === 0) return Number.NaN;
  let weighted = 0;
  for (let k = 0; k < count; k++) {
    const piece = Math.abs(yieldPerYear) < 1e-14 ? payment : payment / Math.pow(1 + yieldPerYear, k);
    weighted += k * piece;
  }
  return weighted / pv;
}

export function modifiedDuration(payment: number, count: number, yieldPerYear: number): number {
  if (yieldPerYear <= -0.999999) return Number.NaN;
  return macaulayDuration(payment, count, yieldPerYear) / (1 + yieldPerYear);
}

/** Linear (Hyndman–Fan type 7) percentile. `p` is between 0 and 1. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sorted[lo];
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function percentiles(values: number[], ps: number[]): Record<string, number> {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const p of ps) {
    out[percentileKey(p)] = percentileSorted(sorted, p);
  }
  return out;
}

export function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return percentileSorted(sorted, p);
}

export function percentileKey(p: number): string {
  return String(Math.round(p * 1000) / 10);
}

export function histogram(
  values: number[],
  bins: number,
): { lo: number; hi: number; count: number }[] {
  if (values.length === 0 || bins < 1) return [];
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max) return [{ lo: min, hi: max, count: values.length }];
  const width = (max - min) / bins;
  const counts = Array(bins).fill(0);
  for (const value of values) {
    let index = Math.floor((value - min) / width);
    if (index >= bins) index = bins - 1;
    counts[index] += 1;
  }
  return counts.map((count, index) => ({
    lo: min + index * width,
    hi: min + (index + 1) * width,
    count,
  }));
}

export function sum(values: number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export function dot(a: number[], b: number[]): number {
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) total += a[i] * b[i];
  return total;
}

export function money(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(value));
  return sign + "$" + rounded.toLocaleString("en-US");
}

export function percentText(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return (value * 100).toFixed(digits) + "%";
}
