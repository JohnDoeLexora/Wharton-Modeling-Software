/**
 * Fit a Nelson-Siegel curve to a Treasury par-yield snapshot, and estimate
 * annual factor dynamics from a history of those fits.
 * Yields in the official wide file are percent, including a printed 0.50.
 * A long-form cell is a decimal unless its absolute value is above 1, in which case it is percent.
 * The fit is a description of the file the team imported. It is not a forecast.
 */

import { fitAr1, fitNelsonSiegel, fitSvensson, type Ar1, type FittedCurve } from "./nelson";

export interface ParPoint {
  tenorYears: number;
  /** Decimal par bond-equivalent yield. 0.04 is 4%. */
  parYield: number;
}

export interface CurveSnapshot {
  asOf: string;
  points: ParPoint[];
}

export interface SpotPoint {
  tenor: number;
  parYield: number;
  /** Annual-compounded zero bootstrapped from the par curve. */
  zero: number;
  discount: number;
}

const TENOR_HEADERS: { name: string; years: number }[] = [
  { name: "1 mo", years: 1 / 12 },
  { name: "2 mo", years: 2 / 12 },
  { name: "3 mo", years: 0.25 },
  { name: "4 mo", years: 4 / 12 },
  { name: "6 mo", years: 0.5 },
  { name: "1 yr", years: 1 },
  { name: "2 yr", years: 2 },
  { name: "3 yr", years: 3 },
  { name: "5 yr", years: 5 },
  { name: "7 yr", years: 7 },
  { name: "10 yr", years: 10 },
  { name: "20 yr", years: 20 },
  { name: "30 yr", years: 30 },
];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

function parseYieldCell(raw: string): number | null {
  const text = raw.trim();
  if (text === "" || text.toLowerCase() === "n/a" || text === ".") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function snapshotsFromWide(rows: string[][]): CurveSnapshot[] {
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const dateCol = header.findIndex((cell) => cell === "date" || cell === "as_of" || cell === "as of");
  const columns = TENOR_HEADERS.map((tenor) => ({
    years: tenor.years,
    index: header.findIndex((cell) => cell.replace(/\s+/g, " ") === tenor.name),
  })).filter((column) => column.index >= 0);
  return rows.slice(1).map((row) => {
    const asOf = (row[dateCol >= 0 ? dateCol : 0] ?? "").trim();
    const points: ParPoint[] = [];
    for (const column of columns) {
      const parsed = parseYieldCell(row[column.index] ?? "");
      if (parsed === null) continue;
      // Wide Treasury files are percent, including a bill yield printed as 0.50.
      const parYield = parsed / 100;
      points.push({ tenorYears: column.years, parYield });
    }
    return { asOf, points };
  }).filter((snapshot) => snapshot.points.length > 0);
}

function snapshotsFromLong(rows: string[][]): CurveSnapshot[] {
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const dateCol = header.findIndex((cell) => cell === "as_of" || cell === "date");
  const tenorCol = header.findIndex((cell) => cell === "tenor_years" || cell === "tenor");
  const yieldCol = header.findIndex((cell) => cell === "par_yield" || cell === "yield");
  const grouped = new Map<string, ParPoint[]>();
  for (const row of rows.slice(1)) {
    const asOf = (row[dateCol] ?? "").trim();
    const tenor = Number(row[tenorCol] ?? "");
    const parsed = parseYieldCell(row[yieldCol] ?? "");
    if (!asOf || !Number.isFinite(tenor) || parsed === null || tenor <= 0) continue;
    const parYield = Math.abs(parsed) > 1 ? parsed / 100 : parsed;
    const list = grouped.get(asOf) ?? [];
    list.push({ tenorYears: tenor, parYield });
    grouped.set(asOf, list);
  }
  return [...grouped.entries()].map(([asOf, points]) => ({ asOf, points }));
}

/** Read either the Treasury wide par curve or a long as-of / tenor / par-yield file. */
export function parseYieldCsv(text: string): CurveSnapshot[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  if (header.includes("tenor_years") || header.includes("tenor")) return snapshotsFromLong(rows);
  return snapshotsFromWide(rows);
}

function interpolate(points: ParPoint[], tenor: number): number | null {
  const ordered = [...points].filter((point) => Number.isFinite(point.parYield)).sort((a, b) => a.tenorYears - b.tenorYears);
  if (ordered.length === 0) return null;
  if (tenor <= ordered[0].tenorYears) return ordered[0].parYield;
  const last = ordered[ordered.length - 1];
  if (tenor >= last.tenorYears) return last.parYield;
  for (let i = 1; i < ordered.length; i++) {
    const right = ordered[i];
    const left = ordered[i - 1];
    if (tenor <= right.tenorYears) {
      const span = right.tenorYears - left.tenorYears;
      if (span <= 0) return right.parYield;
      const weight = (tenor - left.tenorYears) / span;
      return left.parYield * (1 - weight) + right.parYield * weight;
    }
  }
  return last.parYield;
}

/**
 * Bootstrap annual-compounded zeros from semiannual par bond-equivalent yields.
 * Tenors at or under one year are discount instruments: DF = 1 / (1 + y/2)^(2τ).
 * Longer knots are par bonds on a semiannual grid. Missing knots use a linear par interpolation.
 */
export function bootstrapZeros(points: ParPoint[]): SpotPoint[] {
  const known = points.filter((point) => point.tenorYears > 0 && Number.isFinite(point.parYield));
  if (known.length === 0) return [];
  const maxTenor = Math.max(...known.map((point) => point.tenorYears));
  const knots: number[] = [];
  for (let half = 1; half <= Math.round(maxTenor * 2); half++) knots.push(half / 2);
  const discounts: number[] = [];
  for (let index = 0; index < knots.length; index++) {
    const tenor = knots[index];
    const par = interpolate(known, tenor);
    if (par === null || par <= -1.99) {
      discounts.push(discounts[discounts.length - 1] ?? 1);
      continue;
    }
    const period = par / 2;
    if (index === 0) {
      discounts.push(1 / (1 + period));
      continue;
    }
    let couponPv = 0;
    for (let earlier = 0; earlier < index; earlier++) couponPv += period * discounts[earlier];
    const denominator = 1 + period;
    discounts.push(denominator === 0 ? 0 : Math.max(0, (1 - couponPv) / denominator));
  }
  const published = [...known].sort((a, b) => a.tenorYears - b.tenorYears);
  return published.map((point) => {
    const steps = Math.max(1, Math.round(point.tenorYears * 2));
    const discount = point.tenorYears <= 1
      ? 1 / Math.pow(1 + point.parYield / 2, point.tenorYears * 2)
      : discounts[Math.min(discounts.length - 1, steps - 1)] ?? 1;
    const zero = discount > 0 ? Math.pow(discount, -1 / point.tenorYears) - 1 : Number.NaN;
    return { tenor: point.tenorYears, parYield: point.parYield, zero, discount };
  }).filter((point) => Number.isFinite(point.zero));
}

export interface Calibration {
  asOf: string;
  spots: SpotPoint[];
  nelson: FittedCurve | null;
  svensson: FittedCurve | null;
}

export function calibrateSnapshot(snapshot: CurveSnapshot, lambda = 0.6, lambda2 = 0.3): Calibration {
  const spots = bootstrapZeros(snapshot.points);
  const zeros = spots.map((spot) => ({ tenor: spot.tenor, zero: spot.zero }));
  return {
    asOf: snapshot.asOf,
    spots,
    nelson: fitNelsonSiegel(zeros, lambda),
    svensson: fitSvensson(zeros, lambda, lambda2),
  };
}

export interface FactorHistory {
  asOf: string;
  year: number;
  beta0: number;
  beta1: number;
  beta2: number;
}

export interface DynamicsEstimate {
  annual: FactorHistory[];
  level: Ar1 | null;
  slope: Ar1 | null;
  curvature: Ar1 | null;
  note: string;
}

/** Calendar year of an as-of date. Accepts YYYY-MM-DD and M/D/YYYY. */
export function asOfYear(asOf: string): number | null {
  const text = asOf.trim();
  const iso = /^(\d{4})-\d{2}-\d{2}/.exec(text);
  if (iso) return Number(iso[1]);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return Number(us[3]);
  const yearOnly = /^(\d{4})$/.exec(text);
  if (yearOnly) return Number(yearOnly[1]);
  return null;
}

function yearOf(asOf: string): number | null {
  return asOfYear(asOf);
}

/**
 * Fit every snapshot, keep the last fit in each calendar year, and run an AR(1)
 * on those annual factors. The speed κ is 1 − φ, which is the annual step in the rate card.
 */
export function estimateDynamics(snapshots: CurveSnapshot[], lambda = 0.6): DynamicsEstimate {
  const fitted: FactorHistory[] = [];
  for (const snapshot of snapshots) {
    const calibration = calibrateSnapshot(snapshot, lambda);
    const nelson = calibration.nelson;
    const year = yearOf(snapshot.asOf);
    if (!nelson || year === null) continue;
    fitted.push({ asOf: snapshot.asOf, year, beta0: nelson.beta0, beta1: nelson.beta1, beta2: nelson.beta2 });
  }
  fitted.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
  const byYear = new Map<number, FactorHistory>();
  for (const row of fitted) byYear.set(row.year, row);
  const annual = [...byYear.values()].sort((a, b) => a.year - b.year);
  const level = fitAr1(annual.map((row) => row.beta0));
  const slope = fitAr1(annual.map((row) => row.beta1));
  const curvature = fitAr1(annual.map((row) => row.beta2));
  const note = annual.length < 4
    ? "Fewer than four year-end curves. The AR(1) needs at least four annual observations."
    : "Annual AR(1) on the last fitted curve in each calendar year. κ = 1 − φ is the speed on the rate card. Residual σ is the factor volatility. This is an estimate from the imported file, not a forecast.";
  return { annual, level, slope, curvature, note };
}
