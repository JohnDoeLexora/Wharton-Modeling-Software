/**
 * Frontier tools for exploration. Every result is labeled as exploration
 * under the assumptions the caller passed. There is no default allocation.
 * MODEL_SPEC §11.
 */

export const EXPLORATION_LABEL = "Exploration under assumptions. Not a recommended portfolio.";

export interface FrontierPoint {
  weights: number[];
  mean: number;
  risk: number;
  label: string;
}

export interface View {
  /** Row of the pick matrix P. */
  assets: number[];
  /** Expected excess return of that combination. */
  mean: number;
  /** Uncertainty of the view, variance. */
  variance: number;
}

export function meanCvar(args: {
  scenarios: number[][];
  targetMean: number;
  alpha?: number;
  steps?: number;
}): FrontierPoint[] {
  const rows = args.scenarios;
  const n = rows[0]?.length ?? 0;
  if (rows.length < 5 || n < 1) return [];
  const alpha = args.alpha ?? 0.05;
  const points: FrontierPoint[] = [];
  const start = equalWeights(n);
  for (let risk = 0; risk <= 8; risk++) {
    const lambda = risk / 2;
    const weights = coordinateSearch(start, (candidate) => {
      const stats = scenarioStats(rows, candidate, alpha);
      if (stats.mean + 1e-9 < args.targetMean) return Number.POSITIVE_INFINITY;
      return -stats.mean + lambda * stats.cvar;
    }, args.steps ?? 40);
    const stats = scenarioStats(rows, weights, alpha);
    points.push({ weights, mean: stats.mean, risk: stats.cvar, label: EXPLORATION_LABEL });
  }
  return points;
}

/** Michaud-style resample: each draw recomputes a max-Sharpe point and the cloud is returned. The average is not a recommendation. */
export function resampledFrontier(args: {
  scenarios: number[][];
  draws: number;
  seed: number;
}): { cloud: FrontierPoint[]; average: number[]; label: string } {
  const rows = args.scenarios;
  const n = rows[0]?.length ?? 0;
  const cloud: FrontierPoint[] = [];
  const total = Array(n).fill(0);
  let used = 0;
  for (let draw = 0; draw < args.draws; draw++) {
    const sample = bootstrapRows(rows, args.seed + draw);
    const weights = coordinateSearch(equalWeights(n), (candidate) => -sharpeOf(sample, candidate), 25);
    const stats = scenarioStats(sample, weights, 0.05);
    cloud.push({ weights, mean: stats.mean, risk: stats.volatility, label: EXPLORATION_LABEL });
    for (let i = 0; i < n; i++) total[i] += weights[i];
    used += 1;
  }
  const average = used > 0 ? total.map((value) => value / used) : equalWeights(n);
  return {
    cloud,
    average,
    label: "Resampled average under this bootstrap. Exploration only. Not a recommended allocation.",
  };
}

/** Black-Litterman posterior mean given market weights, covariance, and the team's views. */
export function blackLitterman(args: {
  marketWeights: number[];
  covariance: number[][];
  riskAversion: number;
  tau: number;
  views: View[];
}): { prior: number[]; posterior: number[]; label: string } {
  const prior = multiply(args.covariance, args.marketWeights).map((value) => args.riskAversion * value);
  if (args.views.length === 0) {
    return { prior, posterior: prior.slice(), label: EXPLORATION_LABEL };
  }
  const tauSigmaInv = invert(scaleMatrix(args.covariance, args.tau));
  const p = args.views.map((view) => view.assets);
  const omegaInv = args.views.map((view, index) => {
    const row = Array(args.views.length).fill(0);
    row[index] = view.variance > 0 ? 1 / view.variance : 0;
    return row;
  });
  const pt = transpose(p);
  const left = add(tauSigmaInv, multiplyMatrices(multiplyMatrices(pt, omegaInv), p));
  const q = args.views.map((view) => view.mean);
  const right = addVectors(multiply(tauSigmaInv, prior), multiply(multiplyMatrices(pt, omegaInv), q));
  const posterior = solve(left, right);
  return { prior, posterior, label: EXPLORATION_LABEL };
}

/**
 * Worst-case mean over the ellipsoid (μ − μ0)' Σ^{-1} (μ − μ0) ≤ κ².
 * The closed form is μ0'w − κ sqrt(w' Σ w). The weights are the caller's.
 */
export function worstCaseMean(weights: number[], mean: number[], covariance: number[][], kappa: number): { worst: number; label: string } {
  let center = 0;
  for (let i = 0; i < weights.length; i++) center += weights[i] * (mean[i] ?? 0);
  const variance = quadratic(weights, covariance);
  const worst = center - Math.abs(kappa) * Math.sqrt(Math.max(0, variance));
  return { worst, label: EXPLORATION_LABEL };
}

/** Equity mean at which a one-factor funded share would fall below `threshold`, holding other inputs fixed. */
export function fundedBreakeven(args: {
  threshold: number;
  baseMean: number;
  baseFunded: number;
  slope: number;
}): { equityMean: number | null; note: string } {
  if (!(Math.abs(args.slope) > 1e-8)) {
    return {
      equityMean: null,
      note: "The funded share did not move with the equity mean in this grid, so there is no breakeven to report.",
    };
  }
  const equityMean = args.baseMean + (args.threshold - args.baseFunded) / args.slope;
  return {
    equityMean,
    note: "The equity mean at which the team's linear grid would put P(funded) on the threshold. A what-would-have-to-be-true line, not a forecast.",
  };
}

function scenarioStats(rows: number[][], weights: number[], alpha: number): { mean: number; cvar: number; volatility: number } {
  const outcomes = rows.map((row) => row.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0));
  const mean = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
  const sorted = outcomes.slice().sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.floor(alpha * sorted.length));
  let tail = 0;
  for (let i = 0; i < tailCount; i++) tail += sorted[i];
  const cvar = -(tail / tailCount);
  let square = 0;
  for (const value of outcomes) {
    const gap = value - mean;
    square += gap * gap;
  }
  const volatility = Math.sqrt(square / Math.max(1, outcomes.length - 1));
  return { mean, cvar, volatility };
}

function sharpeOf(rows: number[][], weights: number[]): number {
  const stats = scenarioStats(rows, weights, 0.05);
  if (stats.volatility < 1e-12) return 0;
  return stats.mean / stats.volatility;
}

function coordinateSearch(start: number[], objective: (weights: number[]) => number, steps: number): number[] {
  let weights = projectSimplex(start);
  let best = objective(weights);
  let step = 0.05;
  for (let round = 0; round < steps; round++) {
    let improved = false;
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        if (i === j) continue;
        const trial = weights.slice();
        const move = Math.min(step, trial[i]);
        if (!(move > 0)) continue;
        trial[i] -= move;
        trial[j] += move;
        const score = objective(trial);
        if (score < best - 1e-12) {
          weights = trial;
          best = score;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
    if (step < 1e-4) break;
  }
  return projectSimplex(weights);
}

function equalWeights(n: number): number[] {
  if (n <= 0) return [];
  return Array(n).fill(1 / n);
}

function projectSimplex(weights: number[]): number[] {
  const clipped = weights.map((weight) => (weight > 0 ? weight : 0));
  const total = clipped.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return equalWeights(weights.length);
  return clipped.map((weight) => weight / total);
}

function bootstrapRows(rows: number[][], seed: number): number[][] {
  const out: number[][] = [];
  let state = seed >>> 0 || 1;
  for (let i = 0; i < rows.length; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    out.push(rows[state % rows.length]);
  }
  return out;
}

function scaleMatrix(matrix: number[][], scale: number): number[][] {
  return matrix.map((row) => row.map((value) => value * scale));
}

function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = matrix[i][j];
  return out;
}

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  const rows = a.length;
  const cols = b[0]?.length ?? 0;
  const inner = b.length;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      for (let j = 0; j < cols; j++) out[i][j] += a[i][k] * (b[k]?.[j] ?? 0);
    }
  }
  return out;
}

function add(a: number[][], b: number[][]): number[][] {
  return a.map((row, i) => row.map((value, j) => value + (b[i]?.[j] ?? 0)));
}

function addVectors(a: number[], b: number[]): number[] {
  return a.map((value, index) => value + (b[index] ?? 0));
}

function quadratic(weights: number[], matrix: number[][]): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) total += weights[i] * (matrix[i]?.[j] ?? 0) * (weights[j] ?? 0);
  }
  return total;
}

function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  const a = matrix.map((row, index) => {
    const extra = Array(n).fill(0);
    extra[index] = 1;
    return [...row, ...extra];
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-14) return identity(n);
    const swap = a[col];
    a[col] = a[pivot];
    a[pivot] = swap;
    const scale = a[col][col];
    for (let j = col; j < 2 * n; j++) a[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j < 2 * n; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

function solve(matrix: number[][], rhs: number[]): number[] {
  return multiply(invert(matrix), rhs);
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}
