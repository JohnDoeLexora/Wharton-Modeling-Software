/**
 * Ex-ante factor risk and ex-post Brinson attribution.
 * Weights are the caller's. Nothing here is a recommended book. MODEL_SPEC §9.
 */

export interface FactorModel {
  assetNames: string[];
  factorNames: string[];
  /** Asset by factor. */
  exposures: number[][];
  /** Factor covariance, annual. */
  factorCov: number[][];
  /** Specific variance of each asset, annual. */
  specific: number[];
}

export interface RiskDecomposition {
  total: number;
  factor: number;
  specific: number;
  marginal: number[];
  component: number[];
  diversificationRatio: number;
  /** Meucci entropy of the normalized eigenvalues of the asset covariance. */
  effectiveBets: number;
  repaired: boolean;
  note: string;
}

export interface BrinsonGroup {
  name: string;
  allocation: number;
  selection: number;
  interaction: number;
}

export interface BrinsonResult {
  allocation: number;
  selection: number;
  interaction: number;
  active: number;
  groups: BrinsonGroup[];
  note: string;
}

export interface TrackingDecomposition {
  trackingError: number;
  factor: number;
  specific: number;
  note: string;
}

const NOTE = "Exploration under the factor model the team supplied. Not a recommended allocation.";

export function assetCovariance(model: FactorModel): { cov: number[][]; repaired: boolean } {
  const n = model.assetNames.length;
  const k = model.factorNames.length;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let systematic = 0;
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          systematic += (model.exposures[i]?.[a] ?? 0) * (model.factorCov[a]?.[b] ?? 0) * (model.exposures[j]?.[b] ?? 0);
        }
      }
      cov[i][j] = systematic + (i === j ? model.specific[i] ?? 0 : 0);
    }
  }
  return repairCovariance(cov);
}

/** Clip negative eigenvalues and rebuild. A true `repaired` flag means a user edit was not PSD. */
export function repairCovariance(matrix: number[][]): { cov: number[][]; repaired: boolean } {
  const eig = jacobiEigen(matrix);
  let repaired = false;
  const clipped = eig.values.map((value) => {
    if (value < 0) {
      repaired = true;
      return 0;
    }
    return value;
  });
  if (!repaired) return { cov: matrix, repaired: false };
  const n = matrix.length;
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let total = 0;
      for (let m = 0; m < n; m++) total += eig.vectors[i][m] * clipped[m] * eig.vectors[j][m];
      cov[i][j] = total;
    }
  }
  return { cov, repaired };
}

export function decomposeRisk(weights: number[], model: FactorModel): RiskDecomposition {
  const { cov, repaired } = assetCovariance(model);
  const n = weights.length;
  const sigmaW = multiply(cov, weights);
  let variance = 0;
  for (let i = 0; i < n; i++) variance += weights[i] * sigmaW[i];
  const total = Math.sqrt(Math.max(0, variance));
  const systematic = systematicVariance(weights, model);
  const specificVar = specificVariance(weights, model);
  const factor = Math.sqrt(Math.max(0, systematic));
  const specific = Math.sqrt(Math.max(0, specificVar));
  const marginal = sigmaW.map((value) => (total > 1e-12 ? value / total : 0));
  const component = marginal.map((value, index) => weights[index] * value);
  let weightedVol = 0;
  for (let i = 0; i < n; i++) weightedVol += Math.abs(weights[i]) * Math.sqrt(Math.max(0, cov[i][i]));
  return {
    total,
    factor,
    specific,
    marginal,
    component,
    diversificationRatio: total > 1e-12 ? weightedVol / total : 0,
    effectiveBets: effectiveNumberOfBets(cov),
    repaired,
    note: NOTE,
  };
}

export function brinson(args: {
  names: string[];
  portfolioWeights: number[];
  benchmarkWeights: number[];
  portfolioReturns: number[];
  benchmarkReturns: number[];
}): BrinsonResult {
  const groups: BrinsonGroup[] = [];
  let allocation = 0;
  let selection = 0;
  let interaction = 0;
  let benchmarkTotal = 0;
  for (let i = 0; i < args.names.length; i++) benchmarkTotal += (args.benchmarkWeights[i] ?? 0) * (args.benchmarkReturns[i] ?? 0);
  for (let i = 0; i < args.names.length; i++) {
    const wp = args.portfolioWeights[i] ?? 0;
    const wb = args.benchmarkWeights[i] ?? 0;
    const rp = args.portfolioReturns[i] ?? 0;
    const rb = args.benchmarkReturns[i] ?? 0;
    const alloc = (wp - wb) * (rb - benchmarkTotal);
    const sel = wb * (rp - rb);
    const inter = (wp - wb) * (rp - rb);
    allocation += alloc;
    selection += sel;
    interaction += inter;
    groups.push({ name: args.names[i], allocation: alloc, selection: sel, interaction: inter });
  }
  return {
    allocation,
    selection,
    interaction,
    active: allocation + selection + interaction,
    groups,
    note: "Brinson allocation, selection, and interaction against the benchmark the team chose. Not a score of a strategy.",
  };
}

export function trackingError(weights: number[], benchmark: number[], model: FactorModel, periodsPerYear = 1): TrackingDecomposition {
  const active = weights.map((weight, index) => weight - (benchmark[index] ?? 0));
  const factorVar = systematicVariance(active, model);
  const specificVar = specificVariance(active, model);
  const scale = Math.sqrt(periodsPerYear);
  return {
    trackingError: Math.sqrt(Math.max(0, factorVar + specificVar)) * scale,
    factor: Math.sqrt(Math.max(0, factorVar)) * scale,
    specific: Math.sqrt(Math.max(0, specificVar)) * scale,
    note: "Tracking error of the active weights versus the team's benchmark. Factor and specific pieces sum in variance.",
  };
}

/** Rolling OLS of a portfolio return on factor returns. Each window is `length` observations ending at t. */
export function rollingFactorAttribution(portfolio: number[], factors: number[][], length: number): { end: number; betas: number[]; alpha: number }[] {
  const out: { end: number; betas: number[]; alpha: number }[] = [];
  const n = portfolio.length;
  if (length < 3 || n < length) return out;
  for (let end = length; end <= n; end++) {
    const y = portfolio.slice(end - length, end);
    const x = factors.map((column) => column.slice(end - length, end));
    const fit = multivariateOls(y, x);
    out.push({ end: end - 1, betas: fit.betas, alpha: fit.alpha });
  }
  return out;
}

export function effectiveNumberOfBets(cov: number[][]): number {
  const values = jacobiEigen(cov).values.map((value) => (value > 0 ? value : 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return 0;
  let entropy = 0;
  for (const value of values) {
    if (value > 0) {
      const p = value / total;
      entropy -= p * Math.log(p);
    }
  }
  return Math.exp(entropy);
}

function systematicVariance(weights: number[], model: FactorModel): number {
  const k = model.factorNames.length;
  const exposure = Array(k).fill(0);
  for (let a = 0; a < k; a++) {
    for (let i = 0; i < weights.length; i++) exposure[a] += weights[i] * (model.exposures[i]?.[a] ?? 0);
  }
  let variance = 0;
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) variance += exposure[a] * (model.factorCov[a]?.[b] ?? 0) * exposure[b];
  }
  return variance;
}

function specificVariance(weights: number[], model: FactorModel): number {
  let variance = 0;
  for (let i = 0; i < weights.length; i++) variance += weights[i] * weights[i] * (model.specific[i] ?? 0);
  return variance;
}

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function multivariateOls(y: number[], columns: number[][]): { alpha: number; betas: number[] } {
  const n = y.length;
  const k = columns.length;
  const meanY = y.reduce((sum, value) => sum + value, 0) / n;
  const means = columns.map((column) => column.reduce((sum, value) => sum + value, 0) / n);
  const xtx = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let t = 0; t < n; t++) {
    for (let a = 0; a < k; a++) {
      const xa = columns[a][t] - means[a];
      xty[a] += xa * (y[t] - meanY);
      for (let b = 0; b < k; b++) xtx[a][b] += xa * (columns[b][t] - means[b]);
    }
  }
  const betas = solveLinear(xtx, xty);
  let alpha = meanY;
  for (let a = 0; a < k; a++) alpha -= (betas[a] ?? 0) * means[a];
  return { alpha, betas };
}

function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return Array(n).fill(0);
    if (pivot !== col) {
      const swap = a[col];
      a[col] = a[pivot];
      a[pivot] = swap;
    }
    const scale = a[col][col];
    for (let j = col; j <= n; j++) a[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

/** Symmetric Jacobi eigen-decomposition. Vectors are columns. */
function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const tau = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        // Equal diagonals give tau = 0. sign(0) is 0, which would skip the rotation. A 45° step is the right one.
        const t = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const aik = a[k][p];
          const akq = a[k][q];
          a[k][p] = a[p][k] = c * aik - s * akq;
          a[k][q] = a[q][k] = s * aik + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const vip = v[k][p];
          const viq = v[k][q];
          v[k][p] = c * vip - s * viq;
          v[k][q] = s * vip + c * viq;
        }
      }
    }
  }
  return { values: a.map((row, index) => row[index]), vectors: v };
}
