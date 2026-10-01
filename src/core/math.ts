import type { ReturnModel } from "./types";

/** Mulberry32. Returns uniforms on [0, 1). */
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

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 1;
  return Math.abs(Math.floor(seed)) >>> 0;
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
      } else {
        if (lower[j][j] <= 1e-12) return null;
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
export function simpleReturn(
  mu: number,
  sigma: number,
  z: number,
  model: ReturnModel,
  floor: number,
): number {
  const vol = sigma < 0 ? 0 : sigma;
  if (model === "normal") {
    return Math.max(floor, mu + vol * z);
  }
  if (mu <= -1) return -1;
  const meanRelative = 1 + mu;
  const s2 = Math.log(1 + (vol * vol) / (meanRelative * meanRelative));
  const m = Math.log(meanRelative) - s2 / 2;
  const s = Math.sqrt(s2);
  return Math.exp(m + s * z) - 1;
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
