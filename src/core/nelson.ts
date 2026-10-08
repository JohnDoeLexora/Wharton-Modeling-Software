/**
 * Dynamic Nelson-Siegel / Svensson curve.
 *
 * Floor policy `zero-floor-on-quotes`, shared with `bend/ns.bend`:
 * factor states are unrestricted (a negative slope is an upward curve).
 * Every quoted annual zero is max(0, the model yield). Discount factors
 * are 1/(1+z)^τ on that quote, then a running minimum so a longer
 * maturity never has a larger discount factor than a shorter one.
 * The version-4 TypeScript floor of −5% is retired. Bend cannot represent
 * a negative quote; both engines now stop at zero.
 *
 * Nothing here is a forecast or a portfolio.
 */

export const FLOOR_POLICY = "zero-floor-on-quotes";

/** Quoted annual zeros do not go below this. Bend laws use the same zero. */
export const QUOTE_FLOOR = 0;

/** Curvature hump near 3 years when tenors are in years. A calibration can replace it. */
export const DEFAULT_LAMBDA = 0.6;

/** Second Svensson decay. Unused when the fourth factor is zero. */
export const DEFAULT_LAMBDA2 = 0.3;

export const KEY_TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30] as const;

export interface Factors {
  beta0: number;
  beta1: number;
  beta2: number;
  beta3: number;
  lambda: number;
  lambda2: number;
}

export interface DiscountKnot {
  tenor: number;
  /** Quoted annual zero after the floor. */
  zero: number;
  /** 1/(1+zero)^tenor before the running minimum. */
  dfRaw: number;
  /** Positive, and non-increasing in tenor. */
  df: number;
}

export function quoteYield(raw: number, floor = QUOTE_FLOOR): number {
  if (!Number.isFinite(raw)) return floor;
  return raw < floor ? floor : raw;
}

/** Nelson-Siegel loading (1 − e^{−λτ}) / (λτ). The limit at τ = 0 is 1. */
export function loading1(lambda: number, tenor: number): number {
  if (tenor <= 1e-8) return 1;
  const decay = lambda * tenor;
  if (Math.abs(decay) < 1e-8) return 1;
  return (1 - Math.exp(-decay)) / decay;
}

/** Curvature loading. The limit at τ = 0 is 0. */
export function loading2(lambda: number, tenor: number): number {
  if (tenor <= 1e-8) return 0;
  return loading1(lambda, tenor) - Math.exp(-lambda * tenor);
}

/** Unfloored annual zero. Svensson's fourth term is zero when beta3 is zero. */
export function modelYield(factors: Factors, tenor: number): number {
  const l1 = loading1(factors.lambda, tenor);
  const l2 = loading2(factors.lambda, tenor);
  const l3 = factors.beta3 === 0 ? 0 : loading2(factors.lambda2, tenor);
  return factors.beta0 + factors.beta1 * l1 + factors.beta2 * l2 + factors.beta3 * l3;
}

export function quotedZero(factors: Factors, tenor: number, floor = QUOTE_FLOOR): number {
  return quoteYield(modelYield(factors, tenor), floor);
}

/** Annual-compounded discount factor. A non-positive tenor is spot cash, factor 1. */
export function discountFactor(annualZero: number, tenor: number): number {
  if (tenor <= 0) return 1;
  if (annualZero <= -0.999999) return Number.POSITIVE_INFINITY;
  return 1 / Math.pow(1 + annualZero, tenor);
}

/**
 * Discount factors on an ascending tenor grid.
 * `df` is the running minimum of the raw factors, so it stays positive
 * and does not rise with maturity.
 */
export function discountCurve(factors: Factors, tenors: readonly number[], floor = QUOTE_FLOOR): DiscountKnot[] {
  const ordered = [...tenors].sort((a, b) => a - b);
  let prev = 1;
  return ordered.map((tenor) => {
    const zero = quotedZero(factors, tenor, floor);
    const dfRaw = discountFactor(zero, tenor);
    const raw = Number.isFinite(dfRaw) ? dfRaw : 0;
    const df = Math.min(prev, Math.max(0, raw));
    prev = df;
    return { tenor, zero, dfRaw: raw, df };
  });
}

/**
 * Exact Nelson-Siegel fit to three annual zeros: the limit at 0, the 5-year, and the 10-year.
 * A flat curve returns beta0 = that yield and beta1 = beta2 = 0.
 */
export function fitFactorsToThree(
  yield0: number,
  yield5: number,
  yield10: number,
  lambda = DEFAULT_LAMBDA,
): { beta0: number; beta1: number; beta2: number } {
  const safeLambda = Math.abs(lambda) < 1e-8 ? DEFAULT_LAMBDA : lambda;
  const l5 = loading1(safeLambda, 5);
  const c5 = loading2(safeLambda, 5);
  const l10 = loading1(safeLambda, 10);
  const c10 = loading2(safeLambda, 10);
  const a1 = 1 - l5;
  const a2 = 1 - l10;
  const rhs1 = yield5 - yield0 * l5;
  const rhs2 = yield10 - yield0 * l10;
  const det = a1 * c10 - a2 * c5;
  if (Math.abs(det) < 1e-12) {
    return { beta0: yield0, beta1: 0, beta2: 0 };
  }
  const beta0 = (rhs1 * c10 - rhs2 * c5) / det;
  const beta2 = (a1 * rhs2 - a2 * rhs1) / det;
  return { beta0, beta1: yield0 - beta0, beta2 };
}

export interface FittedCurve {
  beta0: number;
  beta1: number;
  beta2: number;
  beta3: number;
  lambda: number;
  lambda2: number;
  rmse: number;
  rows: { tenor: number; observed: number; fitted: number; residual: number }[];
}

function solveLinear(matrix: number[][], target: number[]): number[] | null {
  const n = target.length;
  const a = matrix.map((row, i) => [...row, target[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-14) return null;
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

function ordinaryLeastSquares(design: number[][], observed: number[]): number[] | null {
  const cols = design[0]?.length ?? 0;
  if (cols === 0 || design.length < cols) return null;
  const gram: number[][] = Array.from({ length: cols }, () => Array(cols).fill(0));
  const rhs = Array(cols).fill(0);
  for (let row = 0; row < design.length; row++) {
    for (let i = 0; i < cols; i++) {
      rhs[i] += design[row][i] * observed[row];
      for (let j = 0; j < cols; j++) gram[i][j] += design[row][i] * design[row][j];
    }
  }
  return solveLinear(gram, rhs);
}

function fitReport(
  points: { tenor: number; zero: number }[],
  factors: Factors,
): FittedCurve["rows"] & { rmse: number } {
  const rows = points.map((point) => {
    const fitted = modelYield(factors, point.tenor);
    return { tenor: point.tenor, observed: point.zero, fitted, residual: fitted - point.zero };
  });
  const rmse = rows.length === 0 ? 0 : Math.sqrt(rows.reduce((sum, row) => sum + row.residual * row.residual, 0) / rows.length);
  return Object.assign(rows, { rmse });
}

/** OLS of annual zeros on Nelson-Siegel loadings at a fixed decay. */
export function fitNelsonSiegel(
  points: { tenor: number; zero: number }[],
  lambda = DEFAULT_LAMBDA,
): FittedCurve | null {
  const usable = points.filter((point) => point.tenor > 0 && Number.isFinite(point.zero));
  if (usable.length < 3) return null;
  const safeLambda = Math.abs(lambda) < 1e-8 ? DEFAULT_LAMBDA : lambda;
  const design = usable.map((point) => [1, loading1(safeLambda, point.tenor), loading2(safeLambda, point.tenor)]);
  const beta = ordinaryLeastSquares(design, usable.map((point) => point.zero));
  if (!beta) return null;
  const factors: Factors = {
    beta0: beta[0],
    beta1: beta[1],
    beta2: beta[2],
    beta3: 0,
    lambda: safeLambda,
    lambda2: DEFAULT_LAMBDA2,
  };
  const rows = fitReport(usable, factors);
  return { ...factors, rmse: rows.rmse, rows };
}

/** OLS on the four Svensson loadings. lambda and lambda2 stay fixed. */
export function fitSvensson(
  points: { tenor: number; zero: number }[],
  lambda = DEFAULT_LAMBDA,
  lambda2 = DEFAULT_LAMBDA2,
): FittedCurve | null {
  const usable = points.filter((point) => point.tenor > 0 && Number.isFinite(point.zero));
  if (usable.length < 4) return null;
  const safeLambda = Math.abs(lambda) < 1e-8 ? DEFAULT_LAMBDA : lambda;
  const safeLambda2 = Math.abs(lambda2 - safeLambda) < 1e-6 ? safeLambda * 0.5 : lambda2;
  const design = usable.map((point) => [
    1,
    loading1(safeLambda, point.tenor),
    loading2(safeLambda, point.tenor),
    loading2(safeLambda2, point.tenor),
  ]);
  const beta = ordinaryLeastSquares(design, usable.map((point) => point.zero));
  if (!beta) return null;
  const factors: Factors = {
    beta0: beta[0],
    beta1: beta[1],
    beta2: beta[2],
    beta3: beta[3],
    lambda: safeLambda,
    lambda2: safeLambda2,
  };
  const rows = fitReport(usable, factors);
  return { ...factors, rmse: rows.rmse, rows };
}

export interface Ar1 {
  /** Annual autoregressive coefficient. */
  phi: number;
  intercept: number;
  /** Discrete annual speed in x := x + κ(θ − x). Equals 1 − φ. */
  kappa: number;
  /** Unconditional mean a / κ when κ is not zero. */
  theta: number;
  /** Residual standard deviation, the annual factor volatility. */
  sigma: number;
  observations: number;
}

/** OLS of x[t+1] = a + φ x[t]. Annual observations match the model's annual step. */
export function fitAr1(series: number[]): Ar1 | null {
  const values = series.filter((value) => Number.isFinite(value));
  if (values.length < 4) return null;
  const xs = values.slice(0, -1);
  const ys = values.slice(1);
  const design = xs.map((value) => [1, value]);
  const beta = ordinaryLeastSquares(design, ys);
  if (!beta) return null;
  const intercept = beta[0];
  const phi = beta[1];
  const kappa = 1 - phi;
  const residuals = ys.map((value, index) => value - (intercept + phi * xs[index]));
  const variance = residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length - 1);
  const theta = Math.abs(kappa) < 1e-8 ? xs.reduce((sum, value) => sum + value, 0) / xs.length : intercept / kappa;
  return { phi, intercept, kappa, theta, sigma: Math.sqrt(Math.max(0, variance)), observations: xs.length };
}
