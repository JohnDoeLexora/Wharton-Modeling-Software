import { cholesky } from "./math";
import { TOLERANCE } from "./tolerance";

export interface CorrelationReport {
  raw: number[][];
  /** Off-diagonals shifted by `stress`, then clipped to [-0.999, 0.999]. Diagonal stays 1. */
  stressed: number[][];
  /** Matrix actually fed to Cholesky. Equals `stressed` when that matrix is PSD. */
  used: number[][];
  factor: number[][] | null;
  stress: number;
  rawMinEigenvalue: number | null;
  usedMinEigenvalue: number | null;
  rawPsd: boolean;
  repaired: boolean;
  /** Off-diagonals were shrunk slightly so a singular PSD matrix still had a factor. */
  ridged: boolean;
  warning: string | null;
}

export function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => row.slice());
}

export function applyCorrelationStress(matrix: number[][], stress: number): number[][] {
  const shift = Number.isFinite(stress) ? stress : 0;
  if (shift === 0) return cloneMatrix(matrix);
  return matrix.map((row, i) =>
    row.map((value, j) => {
      if (i === j) return 1;
      return Math.min(0.999, Math.max(-0.999, value + shift));
    }),
  );
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

function shrinkOffDiagonal(matrix: number[][]): number[][] {
  return matrix.map((row, i) => row.map((value, j) => (i === j ? 1 : value * 0.999)));
}

/**
 * Stress, PSD check, and repair. A factor of null means the run should stop;
 * ordinary non-PSD input is repaired and comes back with a warning instead.
 */
export function prepareCorrelation(matrix: number[][], stress: number): CorrelationReport {
  if (!isSquare(matrix)) {
    return {
      raw: cloneMatrix(matrix),
      stressed: cloneMatrix(matrix),
      used: cloneMatrix(matrix),
      factor: null,
      stress: Number.isFinite(stress) ? stress : 0,
      rawMinEigenvalue: null,
      usedMinEigenvalue: null,
      rawPsd: false,
      repaired: false,
      ridged: false,
      warning: "The correlation matrix is not a square of finite numbers, so it was not factored.",
    };
  }

  const rawMin = minEigenvalue(matrix);
  const rawPsd = rawMin >= TOLERANCE.eigenvaluePsdFloor;
  const stressed = applyCorrelationStress(matrix, stress);
  const stressedMin = minEigenvalue(stressed);
  const stressedPsd = stressedMin >= TOLERANCE.eigenvaluePsdFloor;

  let used = stressed;
  let repaired = false;
  let warning: string | null = null;
  if (!stressedPsd) {
    used = repairCorrelation(stressed).matrix;
    repaired = true;
    warning =
      `The correlation matrix was not positive semidefinite after the stress shift ` +
      `(minimum eigenvalue ${stressedMin.toExponential(3)}). Negative eigenvalues were clipped to zero ` +
      `and the diagonal was restored to 1. Monte Carlo uses the repaired matrix.`;
  }

  let factor = cholesky(used);
  let ridged = false;
  if (!factor) {
    used = shrinkOffDiagonal(used);
    factor = cholesky(used);
    ridged = true;
    const extra = " Off-diagonal entries were multiplied by 0.999 so a factor could be built.";
    warning = warning ? warning + extra : "The correlation factor needed a 0.999 shrink of the off-diagonals." + extra;
  }

  return {
    raw: cloneMatrix(matrix),
    stressed,
    used,
    factor,
    stress: Number.isFinite(stress) ? stress : 0,
    rawMinEigenvalue: rawMin,
    usedMinEigenvalue: factor ? minEigenvalue(used) : null,
    rawPsd,
    repaired,
    ridged,
    warning: factor ? warning : "The correlation matrix could not be factored after repair.",
  };
}
