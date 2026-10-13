/** Student-t degrees of freedom by profile likelihood. The engine only accepts integers from 3 to 30. */

import { mean, stdev, studentLogPdf } from "./stats";

export interface TailFit {
  df: number;
  scale: number;
  logLik: number;
  source: "name" | "sector-pool";
  note: string;
}

const DF_GRID = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30];
const SCALE_GRID = [0.7, 0.85, 1, 1.15, 1.3];

export function studentTLikelihood(values: number[], df: number, mu: number, scale: number): number {
  if (!(scale > 0) || !(df > 2)) return -Infinity;
  let total = 0;
  for (const value of values) total += studentLogPdf(value, df, mu, scale);
  return total;
}

/** Grid MLE. Ties prefer the smaller degrees of freedom, so a fat tail is not rounded away. */
export function fitStudentT(values: number[]): { df: number; scale: number; logLik: number } | null {
  if (values.length < 30) return null;
  const mu = mean(values);
  const sigma = stdev(values, true);
  if (!(sigma > 0)) return null;
  let best = { df: 5, scale: sigma, logLik: -Infinity };
  for (const df of DF_GRID) {
    for (const multiple of SCALE_GRID) {
      const scale = sigma * multiple;
      const logLik = studentTLikelihood(values, df, mu, scale);
      if (logLik > best.logLik + 1e-8 || (Math.abs(logLik - best.logLik) <= 1e-8 && df < best.df)) {
        best = { df, scale, logLik };
      }
    }
  }
  return best;
}

export function fitTail(values: number[], sectorValues: number[] | null, ipoShort: boolean): TailFit {
  const own = !ipoShort ? fitStudentT(values) : null;
  if (own) {
    return {
      df: own.df,
      scale: own.scale,
      logLik: own.logLik,
      source: "name",
      note: `Student-t MLE on this name. df ${own.df} is the grid maximum, not a global df of 5.`,
    };
  }
  const pooled = sectorValues && sectorValues.length >= 30 ? fitStudentT(sectorValues) : null;
  if (pooled) {
    return {
      df: pooled.df,
      scale: pooled.scale,
      logLik: pooled.logLik,
      source: "sector-pool",
      note: "This history is short. Degrees of freedom are the sector pool's MLE, not a global df of 5.",
    };
  }
  return {
    df: 5,
    scale: stdev(values, true),
    logLik: NaN,
    source: "sector-pool",
    note: "Too few returns to fit a tail. The placeholder df is 5 and is labeled as a fallback.",
  };
}
