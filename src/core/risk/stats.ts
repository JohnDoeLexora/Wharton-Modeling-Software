/** Distributions, least squares, and covariance helpers used by the risk estimators. */

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function variance(values: number[], sample = true): number {
  if (values.length < (sample ? 2 : 1)) return NaN;
  const center = mean(values);
  let sum = 0;
  for (const value of values) {
    const d = value - center;
    sum += d * d;
  }
  return sum / (sample ? values.length - 1 : values.length);
}

export function stdev(values: number[], sample = true): number {
  const v = variance(values, sample);
  return Number.isFinite(v) ? Math.sqrt(Math.max(0, v)) : NaN;
}

export function meanSquare(values: number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const value of values) sum += value * value;
  return sum / values.length;
}

export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sorted[lo];
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

/** Abramowitz-Stegun 7.1.26. Absolute error about 1.5e-7. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

export function normalCdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Acklam's rational approximation of the standard normal quantile. */
export function normalPpf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.984369654078961e-6, 1.5056327351493116e-7,
];

export function lgamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBeta(a: number, b: number): number {
  return lgamma(a) + lgamma(b) - lgamma(a + b);
}

/** Lentz continued fraction for the incomplete beta. */
function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - logBeta(a, b));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** CDF of a raw Student-t (variance ν/(ν−2), not 1). */
export function studentCdf(t: number, nu: number): number {
  const x = nu / (nu + t * t);
  const ib = regularizedBeta(x, nu / 2, 0.5);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

export function studentPpf(p: number, nu: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (studentCdf(mid, nu) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function studentLogPdf(x: number, nu: number, mu: number, scale: number): number {
  const z = (x - mu) / scale;
  return (
    lgamma((nu + 1) / 2) -
    lgamma(nu / 2) -
    0.5 * Math.log(nu * Math.PI) -
    Math.log(scale) -
    ((nu + 1) / 2) * Math.log(1 + (z * z) / nu)
  );
}

/** Unit-variance Student-t quantile. The raw t is divided by sqrt(ν/(ν−2)). */
export function unitStudentPpf(p: number, nu: number): number {
  const scale = Math.sqrt(nu / (nu - 2));
  return studentPpf(p, nu) / scale;
}

export function unitStudentCdf(x: number, nu: number): number {
  const scale = Math.sqrt(nu / (nu - 2));
  return studentCdf(x * scale, nu);
}

/**
 * Expected shortfall of a unit-variance Student-t at the lower tail probability p.
 * The result is negative. Gaussian ES is the ν → ∞ limit.
 */
export function unitStudentEs(p: number, nu: number): number {
  const rawQ = studentPpf(p, nu);
  const density = Math.exp(studentLogPdf(rawQ, nu, 0, 1));
  const rawEs = -((density * (nu + rawQ * rawQ)) / ((nu - 1) * p));
  return rawEs / Math.sqrt(nu / (nu - 2));
}

export function gaussianEs(p: number): number {
  const z = normalPpf(p);
  return -normalPdf(z) / p;
}

/** Survival function of a chi-square. df is 1 or 2, the Kupiec and Christoffersen cases. */
export function chiSquareSurvival(x: number, df: 1 | 2): number {
  if (!Number.isFinite(x) || x < 0) return NaN;
  if (x === 0) return 1;
  if (df === 2) return Math.exp(-x / 2);
  return 1 - erf(Math.sqrt(x / 2));
}

export interface LinearSolve {
  coef: number[];
  cov: number[][] | null;
  sigma: number;
  n: number;
  rank: number;
}

function solveInto(matrix: number[][], vector: number[]): { coef: number[]; inv: number[][] | null; rank: number } {
  const k = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  const inv = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
  let rank = 0;
  let row = 0;
  for (let col = 0; col < k && row < k; col++) {
    let pivot = row;
    let best = Math.abs(a[row][col]);
    for (let i = row + 1; i < k; i++) {
      const value = Math.abs(a[i][col]);
      if (value > best) {
        best = value;
        pivot = i;
      }
    }
    if (best < 1e-10) continue;
    if (pivot !== row) {
      const swap = a[row];
      a[row] = a[pivot];
      a[pivot] = swap;
      const swapInv = inv[row];
      inv[row] = inv[pivot];
      inv[pivot] = swapInv;
    }
    const div = a[row][col];
    for (let j = col; j <= k; j++) a[row][j] /= div;
    for (let j = 0; j < k; j++) inv[row][j] /= div;
    for (let i = 0; i < k; i++) {
      if (i === row) continue;
      const factor = a[i][col];
      if (factor === 0) continue;
      for (let j = col; j <= k; j++) a[i][j] -= factor * a[row][j];
      for (let j = 0; j < k; j++) inv[i][j] -= factor * inv[row][j];
    }
    rank += 1;
    row += 1;
  }
  if (rank < k) return { coef: Array(k).fill(NaN), inv: null, rank };
  return { coef: a.map((line) => line[k]), inv, rank };
}

/**
 * OLS of y on columns. columns[j][i] is regressor j at observation i.
 * The caller includes an intercept column when it wants one.
 * Standard errors use σ² (X′X)⁻¹ with σ² = SSE / (n − rank).
 */
export function ols(y: number[], columns: number[][]): LinearSolve {
  const n = y.length;
  const k = columns.length;
  const empty = { coef: Array(k).fill(NaN), cov: null, sigma: NaN, n, rank: 0 };
  if (n === 0 || k === 0 || columns.some((column) => column.length !== n)) return empty;
  const xtx = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      xty[a] += columns[a][i] * y[i];
      for (let b = a; b < k; b++) xtx[a][b] += columns[a][i] * columns[b][i];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) xtx[a][b] = xtx[b][a];
  const solved = solveInto(xtx, xty);
  if (!solved.inv) return { coef: solved.coef, cov: null, sigma: NaN, n, rank: solved.rank };
  let sse = 0;
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let a = 0; a < k; a++) fit += solved.coef[a] * columns[a][i];
    const e = y[i] - fit;
    sse += e * e;
  }
  const dof = Math.max(1, n - solved.rank);
  const sigma2 = sse / dof;
  const cov = solved.inv.map((row) => row.map((value) => value * sigma2));
  return { coef: solved.coef, cov, sigma: Math.sqrt(Math.max(0, sigma2)), n, rank: solved.rank };
}

export function seOfSum(cov: number[][] | null, indexes: number[]): number {
  if (!cov) return NaN;
  let total = 0;
  for (const i of indexes) {
    for (const j of indexes) total += cov[i][j];
  }
  return Math.sqrt(Math.max(0, total));
}

/** Cholesky succeeds when every leading pivot is above −tol. A zero pivot is positive semidefinite. */
export function isPositiveSemidefinite(matrix: number[][], tol = 1e-8): boolean {
  const n = matrix.length;
  if (n === 0) return true;
  const a = matrix.map((row) => row.slice());
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= a[i][k] * a[j][k];
      if (Math.abs(a[j][j]) < tol) {
        if (Math.abs(sum) > tol * 10) return false;
        a[i][j] = 0;
      } else a[i][j] = sum / a[j][j];
    }
    let sum = a[i][i];
    for (let k = 0; k < i; k++) sum -= a[i][k] * a[i][k];
    if (sum < -tol) return false;
    a[i][i] = Math.sqrt(Math.max(0, sum));
  }
  return true;
}

/** Symmetric eigendecomposition by Jacobi rotation. Columns of vectors are eigenvectors. */
export function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let iter = 0; iter < 60; iter++) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const value = Math.abs(a[i][j]);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const tau = (aqq - app) / (2 * apq);
    const root = Math.sqrt(1 + tau * tau);
    const t = tau >= 0 ? 1 / (tau + root) : 1 / (tau - root);
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue;
      const aik = a[k][p];
      const aiq = a[k][q];
      a[k][p] = a[p][k] = c * aik - s * aiq;
      a[k][q] = a[q][k] = s * aik + c * aiq;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < n; k++) {
      const vip = v[k][p];
      const viq = v[k][q];
      v[k][p] = c * vip - s * viq;
      v[k][q] = s * vip + c * viq;
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/** Clip negative eigenvalues to zero and rebuild. `repaired` is true when a clip was needed. */
export function projectPsd(matrix: number[][]): { matrix: number[][]; repaired: boolean } {
  if (matrix.length === 0) return { matrix, repaired: false };
  if (isPositiveSemidefinite(matrix)) return { matrix: matrix.map((row) => row.slice()), repaired: false };
  const { values, vectors } = jacobiEigen(matrix);
  const n = matrix.length;
  const clipped = values.map((value) => (value < 0 ? 0 : value));
  const next = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let p = 0; p < n; p++) sum += vectors[i][p] * clipped[p] * vectors[j][p];
      next[i][j] = next[j][i] = sum;
    }
  }
  return { matrix: next, repaired: true };
}

export interface ShrinkResult {
  cov: number[][];
  shrinkage: number;
  mu: number;
  target: "scaled-identity";
}

/**
 * Ledoit-Wolf shrinkage toward μ I, with μ = tr(S) / p and S = X′X / n (X centered).
 * The intensity matches the sklearn identity-target formula: β / ||S − μI||², clipped to [0, 1].
 */
export function ledoitWolf(samples: number[][]): ShrinkResult {
  const n = samples.length;
  const p = samples[0]?.length ?? 0;
  if (n < 2 || p === 0) return { cov: [], shrinkage: 0, mu: 0, target: "scaled-identity" };
  const center = Array(p).fill(0);
  for (const row of samples) for (let i = 0; i < p; i++) center[i] += row[i];
  for (let i = 0; i < p; i++) center[i] /= n;
  const x = samples.map((row) => row.map((value, i) => value - center[i]));
  const emp = Array.from({ length: p }, () => Array(p).fill(0));
  for (const row of x) {
    for (let i = 0; i < p; i++) {
      for (let j = i; j < p; j++) emp[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      emp[i][j] /= n;
      emp[j][i] = emp[i][j];
    }
  }
  let trace = 0;
  for (let i = 0; i < p; i++) trace += emp[i][i];
  const mu = trace / p;
  let sumSq = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      const delta = emp[i][j] - (i === j ? mu : 0);
      sumSq += delta * delta;
    }
  }
  let betaSum = 0;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let second = 0;
      for (const row of x) {
        const prod = row[i] * row[j];
        second += prod * prod;
      }
      second /= n;
      betaSum += second - emp[i][j] * emp[i][j];
    }
  }
  const beta = betaSum / n;
  const shrinkage = sumSq === 0 ? 0 : Math.min(1, Math.max(0, beta / sumSq));
  const cov = emp.map((row, i) => row.map((value, j) => (1 - shrinkage) * value + (i === j ? shrinkage * mu : 0)));
  return { cov, shrinkage, mu, target: "scaled-identity" };
}

export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const k = b.length;
  const m = b[0]?.length ?? 0;
  const out = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < k; t++) {
      const ait = a[i][t];
      if (ait === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += ait * b[t][j];
    }
  }
  return out;
}

export function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((sum, value, j) => sum + value * (v[j] ?? 0), 0));
}

export function transpose(a: number[][]): number[][] {
  if (a.length === 0) return [];
  return a[0].map((_, j) => a.map((row) => row[j]));
}

export function symmetric(a: number[][]): number[][] {
  const n = a.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out[i][j] = 0.5 * (a[i][j] + a[j][i]);
  }
  return out;
}

export function correlationFromCov(cov: number[][]): number[][] {
  const n = cov.length;
  const out = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = Math.sqrt(Math.max(cov[i][i], 0) * Math.max(cov[j][j], 0));
      out[i][j] = d > 0 ? cov[i][j] / d : i === j ? 1 : 0;
    }
  }
  return out;
}

export function scaleCov(cov: number[][], factor: number): number[][] {
  return cov.map((row) => row.map((value) => value * factor));
}
