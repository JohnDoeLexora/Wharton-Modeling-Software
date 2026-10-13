/**
 * Walk-forward coverage of a p10–p90 two-year band, and a universe VaR summary.
 * A pass is a check of the stated band. It is not a recommendation.
 */

import { percentile } from "./math";

export interface WalkForwardReport {
  windowSessions: number;
  origins: number;
  hits: number;
  coverage: number | null;
  statedBand: "p10-p90";
  note: string;
}

export interface VarBacktestSummary {
  names: number;
  scored: number;
  tooShort: number;
  pass95: number;
  pass99: number;
  note: string;
}

const RANGE_NOTE =
  "At each origin the band is the 10th to 90th percentile of two-year compounded returns that end at or before that origin. " +
  "The next two-year return is scored and does not enter the band. Coverage is the share inside the stated p10–p90 band. " +
  "This checks the 2031-range method on a return history. It is not a recommendation.";

function compoundWindow(returns: number[], start: number, length: number): number {
  let level = 1;
  for (let i = 0; i < length; i++) level *= 1 + returns[start + i];
  return level - 1;
}

/** Expanding walk-forward of a two-year p10–p90 band. `sessionsPerYear` is 252 on a daily file. */
export function walkForwardRange(returns: number[], sessionsPerYear = 252): WalkForwardReport {
  const window = Math.max(2, Math.round(sessionsPerYear * 2));
  const empty = (extra: string): WalkForwardReport => ({
    windowSessions: window,
    origins: 0,
    hits: 0,
    coverage: null,
    statedBand: "p10-p90",
    note: `${RANGE_NOTE} ${extra}`,
  });
  if (returns.length < window * 3 || returns.some((value) => !Number.isFinite(value))) {
    return empty("The series is too short or not finite.");
  }
  const step = Math.max(1, Math.floor(sessionsPerYear / 12));
  let hits = 0;
  let origins = 0;
  for (let origin = window * 2; origin + window <= returns.length; origin += step) {
    const past: number[] = [];
    for (let end = window; end <= origin; end += step) past.push(compoundWindow(returns, end - window, window));
    if (past.length < 4) continue;
    const low = percentile(past, 0.1);
    const high = percentile(past, 0.9);
    const next = compoundWindow(returns, origin, window);
    origins += 1;
    if (next >= low && next <= high) hits += 1;
  }
  if (origins === 0) return empty("No origin had four past windows and a full forward window.");
  return {
    windowSessions: window,
    origins,
    hits,
    coverage: hits / origins,
    statedBand: "p10-p90",
    note: RANGE_NOTE,
  };
}

export interface VarNameRow {
  ticker: string;
  next: { var95: { pValue: number }; var99: { pValue: number } } | null;
}

const VAR_NOTE =
  "A name passes when the Kupiec p-value on the new EWMA Student-t forecast is above 0.05. " +
  "A pass is a coverage check across the universe you supplied. It is not a recommendation.";

/** Count names whose 95% and 99% Kupiec tests pass. Names without a forecast are too short. */
export function varBacktestSummary(rows: VarNameRow[]): VarBacktestSummary {
  let scored = 0;
  let tooShort = 0;
  let pass95 = 0;
  let pass99 = 0;
  for (const row of rows) {
    const p95 = row.next?.var95.pValue;
    const p99 = row.next?.var99.pValue;
    if (p95 === undefined || !Number.isFinite(p95) || p99 === undefined || !Number.isFinite(p99)) {
      tooShort += 1;
      continue;
    }
    scored += 1;
    if (p95 > 0.05) pass95 += 1;
    if (p99 > 0.05) pass99 += 1;
  }
  return { names: rows.length, scored, tooShort, pass95, pass99, note: VAR_NOTE };
}
