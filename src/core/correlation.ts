import { cholesky } from "./math";
import { TOLERANCE } from "./tolerance";

export type CorrelationRepair = "none" | "higham";

export interface CorrelationReport {
  raw: number[][];
  /** Sign-preserving blend toward a stressed target. Diagonal stays 1. */
  stressed: number[][];
  /** Matrix actually fed to Cholesky. Equals `stressed` unless Higham repair was requested. */
  used: number[][];
  factor: number[][] | null;
  /** Requested blend weight, clipped to [0, 1]. */
  stress: number;
  /** Blend weight that was applied. Lower than `stress` only when a larger blend would not be PSD. */
  appliedStress: number;
  repair: CorrelationRepair;
  rawMinEigenvalue: number | null;
  usedMinEigenvalue: number | null;
  rawPsd: boolean;
  repaired: boolean;
  /** Always false. A failed factor is an error. Off-diagonals are not silently shrunk. */
  ridged: boolean;
  /** Every off-diagonal kept the sign it had before the stress. */
  signPreserved: boolean;
  warning: string | null;
}

export function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => row.slice());
}

function blendToward(matrix: number[][], target: number[][], alpha: number): number[][] {
  return matrix.map((row, i) => row.map((value, j) => (1 - alpha) * value + alpha * (target[i]?.[j] ?? value)));
}

function signTarget(matrix: number[][]): number[][] {
  return matrix.map((row, i) =>
    row.map((value, j) => {
      if (i === j) return 1;
      if (value > 0) return 1;
      if (value < 0) return -1;
      return 0;
    }),
  );
}

function signsMatch(raw: number[][], stressed: number[][]): boolean {
  return stressed.every((row, i) =>
    row.every((value, j) => {
      if (i === j) return Math.abs(value - 1) < 1e-8;
      const original = raw[i]?.[j] ?? 0;
      if (original === 0) return Math.abs(value) <= 1e-8;
      return value === 0 ? false : Math.sign(value) === Math.sign(original);
    }),
  );
}

export interface StressedCorrelation {
  stressed: number[][];
  /** Requested weight after clipping to [0, 1]. */
  stress: number;
  applied: number;
  signPreserved: boolean;
}

/**
 * Blend ρ toward a target that pushes each pair toward ±1 without flipping its sign.
 * If ρ is PSD, the blend weight is cut back until the result is still PSD.
 * A negative pair stays negative. It is not shifted up through zero.
 */
export function applyCorrelationStress(matrix: number[][], stress: number): number[][] {
  return stressCorrelation(matrix, stress).stressed;
}

export function stressCorrelation(matrix: number[][], stress: number): StressedCorrelation {
  const requested = Number.isFinite(stress) ? Math.min(1, Math.max(0, stress)) : 0;
  if (requested === 0 || matrix.length === 0) {
    return { stressed: cloneMatrix(matrix), stress: requested, applied: 0, signPreserved: true };
  }
  const target = signTarget(matrix);
  const psd = (candidate: number[][]) => minEigenvalue(candidate) >= -1e-9;
  const full = blendToward(matrix, target, requested);
  let stressed = full;
  let applied = requested;
  if (psd(matrix) && !psd(full)) {
    let lo = 0;
    let hi = requested;
    stressed = cloneMatrix(matrix);
    applied = 0;
    for (let step = 0; step < 32; step++) {
      const mid = (lo + hi) / 2;
      const trial = blendToward(matrix, target, mid);
      if (psd(trial)) {
        lo = mid;
        stressed = trial;
        applied = mid;
      } else {
        hi = mid;
      }
    }
  }
  return { stressed, stress: requested, applied, signPreserved: signsMatch(matrix, stressed) };
}

function identity(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** Symmetric Jacobi. Columns of `vectors` are eigenvectors. n is at most 6 in this toolkit. */
export function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row, i) => row.map((value, j) => (i === j ? value : (value + (matrix[j]?.[i] ?? value)) / 2)));
  const vectors = identity(n);
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-28) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const app = a[p][p];
        const aqq = a[q][q];
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const tau = (aqq - app) / (2 * apq);
        const t = Math.sign(tau || 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let k = 0; k < n; k++) {
          if (k === p || k === q) continue;
          const aik = a[k][p];
          const akq = a[k][q];
          const nextP = c * aik - s * akq;
          const nextQ = s * aik + c * akq;
          a[k][p] = nextP;
          a[p][k] = nextP;
          a[k][q] = nextQ;
          a[q][k] = nextQ;
        }
        for (let k = 0; k < n; k++) {
          const vip = vectors[k][p];
          const viq = vectors[k][q];
          vectors[k][p] = c * vip - s * viq;
          vectors[k][q] = s * vip + c * viq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors };
}

export function minEigenvalue(matrix: number[][]): number {
  if (matrix.length === 0) return Number.NaN;
  return Math.min(...jacobiEigen(matrix).values);
}

function isSquare(matrix: number[][]): boolean {
  const n = matrix.length;
  return n > 0 && matrix.every((row) => row.length === n && row.every((value) => Number.isFinite(value)));
}

/** Clip negative eigenvalues, restore a unit diagonal, and rebuild a correlation matrix. */
export function repairCorrelation(matrix: number[][]): { matrix: number[][]; minEigenvalueBefore: number } {
  const n = matrix.length;
  const { values, vectors } = jacobiEigen(matrix);
  const before = Math.min(...values);
  const clipped = values.map((value) => Math.max(0, value));
  const rebuilt = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += vectors[i][k] * clipped[k] * vectors[j][k];
      rebuilt[i][j] = sum;
      rebuilt[j][i] = sum;
    }
  }
  const scales = rebuilt.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  const corr = rebuilt.map((row, i) =>
    row.map((value, j) => {
      if (i === j) return 1;
      const denom = scales[i] * scales[j];
      if (!(denom > 0)) return 0;
      return Math.min(1, Math.max(-1, value / denom));
    }),
  );
  return { matrix: corr, minEigenvalueBefore: before };
}

function projectPsd(matrix: number[][]): number[][] {
  const n = matrix.length;
  const { values, vectors } = jacobiEigen(matrix);
  const clipped = values.map((value) => Math.max(0, value));
  const rebuilt = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += vectors[i][k] * clipped[k] * vectors[j][k];
      rebuilt[i][j] = sum;
      rebuilt[j][i] = sum;
    }
  }
  return rebuilt;
}

/**
 * Higham's alternating projections (with Dykstra's correction) onto the
 * nearest correlation matrix. Used only when the user selects this repair.
 */
export function highamNearestCorrelation(matrix: number[][], maxIter = 48): number[][] {
  const n = matrix.length;
  if (n === 0) return [];
  let current = matrix.map((row, i) => row.map((value, j) => (i === j ? 1 : (value + (matrix[j]?.[i] ?? value)) / 2)));
  const correction = Array.from({ length: n }, () => Array(n).fill(0));
  for (let iter = 0; iter < maxIter; iter++) {
    const residual = current.map((row, i) => row.map((value, j) => value - correction[i][j]));
    const psd = projectPsd(residual);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) correction[i][j] = psd[i][j] - residual[i][j];
    }
    const next = psd.map((row, i) => row.map((value, j) => (i === j ? 1 : Math.max(-1, Math.min(1, value)))));
    let diff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const gap = next[i][j] - current[i][j];
        diff += gap * gap;
      }
    }
    current = next;
    if (diff < 1e-20) break;
  }
  if (minEigenvalue(current) < TOLERANCE.eigenvaluePsdFloor) return repairCorrelation(current).matrix;
  return current;
}

function blankReport(matrix: number[][], stress: number, repair: CorrelationRepair, warning: string): CorrelationReport {
  return {
    raw: cloneMatrix(matrix),
    stressed: cloneMatrix(matrix),
    used: cloneMatrix(matrix),
    factor: null,
    stress,
    appliedStress: 0,
    repair,
    rawMinEigenvalue: null,
    usedMinEigenvalue: null,
    rawPsd: false,
    repaired: false,
    ridged: false,
    signPreserved: false,
    warning,
  };
}

/**
 * Stress, then factor. A null factor is a hard error: sleeves are not drawn
 * independently. Higham repair runs only when `repair` is `"higham"`.
 */
export function prepareCorrelation(
  matrix: number[][],
  stress: number,
  repair: CorrelationRepair = "none",
): CorrelationReport {
  const requested = Number.isFinite(stress) ? stress : 0;
  if (!isSquare(matrix)) {
    return blankReport(matrix, requested, repair, "The correlation matrix is not a square of finite numbers, so it was not factored. Sleeves were not drawn independently.");
  }

  const rawMin = minEigenvalue(matrix);
  const rawPsd = rawMin >= TOLERANCE.eigenvaluePsdFloor;
  const stressed = stressCorrelation(matrix, requested);
  let used = stressed.stressed;
  let repaired = false;
  let warning: string | null = null;
  if (stressed.applied + 1e-12 < stressed.stress) {
    warning =
      `Correlation stress ${stressed.stress} was cut to ${stressed.applied.toFixed(4)} so the matrix stays positive semidefinite and keeps its signs.`;
  }
  const stressedMin = minEigenvalue(used);
  if (repair === "higham") {
    const nearest = highamNearestCorrelation(used);
    const changed = nearest.some((row, i) => row.some((value, j) => Math.abs(value - (used[i]?.[j] ?? 0)) > 1e-8));
    if (changed || stressedMin < TOLERANCE.eigenvaluePsdFloor) {
      used = nearest;
      repaired = true;
      const note = "Higham's nearest correlation matrix was applied because that repair was selected. It was not a silent fallback.";
      warning = warning ? `${warning} ${note}` : note;
    }
  } else if (stressedMin < TOLERANCE.eigenvaluePsdFloor) {
    warning =
      `The correlation matrix is not positive semidefinite (minimum eigenvalue ${stressedMin.toExponential(3)}). ` +
      "It was not repaired and sleeves were not drawn independently. Select Higham repair or change the matrix.";
  }

  const factor = cholesky(used);
  if (!factor && repair !== "higham") {
    const note = "The correlation matrix could not be factored. Independent draws were not substituted.";
    warning = warning ? `${warning} ${note}` : note;
  } else if (!factor) {
    const note = "Higham repair still did not produce a factor. The sample was not run on independent draws.";
    warning = warning ? `${warning} ${note}` : note;
  }

  return {
    raw: cloneMatrix(matrix),
    stressed: stressed.stressed,
    used,
    factor,
    stress: stressed.stress,
    appliedStress: stressed.applied,
    repair,
    rawMinEigenvalue: rawMin,
    usedMinEigenvalue: factor ? minEigenvalue(used) : null,
    rawPsd,
    repaired,
    ridged: false,
    signPreserved: stressed.signPreserved,
    warning: factor ? warning : warning,
  };
}
