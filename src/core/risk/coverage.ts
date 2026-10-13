/**
 * Rolling one-step VaR and ES coverage.
 * Kupiec tests unconditional coverage. Christoffersen adds an independence test.
 * The probability-integral transform of a calibrated forecast is uniform.
 */

import { fitStudentT } from "./tails";
import {
  chiSquareSurvival,
  gaussianEs,
  normalCdf,
  normalPpf,
  unitStudentCdf,
  unitStudentEs,
  unitStudentPpf,
} from "./stats";
import { ewmaVariance, realizedAnnual, TRADING_DAYS } from "./vol";
import { monthlyReturns } from "./vol";

export interface CoverageTest {
  hits: number;
  n: number;
  hitRate: number;
  lr: number;
  pValue: number;
}

export interface MethodCoverage {
  method: "old-monthly-df5" | "new-ewma-student";
  var95: CoverageTest;
  var99: CoverageTest;
  independence95: CoverageTest;
  conditional95: CoverageTest;
  independence99: CoverageTest;
  conditional99: CoverageTest;
  esRatio95: number;
  esRatio99: number;
  pitKs: number;
  pitPass: boolean;
}

export interface CoverageReport {
  ticker: string;
  n: number;
  old: MethodCoverage | null;
  next: MethodCoverage | null;
  winner: "old" | "new" | "tie" | "too-short";
  scoreOld: number;
  scoreNew: number;
  note: string;
}

/** Kupiec proportion-of-failures statistic. Zero when the hit count equals n·p. */
export function kupiec(hits: number, n: number, p: number): CoverageTest {
  if (n <= 0 || !(p > 0) || !(p < 1)) return { hits, n, hitRate: NaN, lr: NaN, pValue: NaN };
  const rate = hits / n;
  const alt = (hits === 0 ? 0 : hits * Math.log(rate)) + (hits === n ? 0 : (n - hits) * Math.log(1 - rate));
  const nul = hits * Math.log(p) + (n - hits) * Math.log(1 - p);
  const lr = Math.max(0, -2 * (nul - alt));
  return { hits, n, hitRate: rate, lr, pValue: chiSquareSurvival(lr, 1) };
}

/** Christoffersen independence and conditional coverage. Conditional coverage is Kupiec plus independence. */
export function christoffersen(hits: boolean[], p: number): { independence: CoverageTest; conditional: CoverageTest } {
  let n00 = 0;
  let n01 = 0;
  let n10 = 0;
  let n11 = 0;
  for (let i = 1; i < hits.length; i++) {
    const prev = hits[i - 1];
    const cur = hits[i];
    if (!prev && !cur) n00 += 1;
    else if (!prev && cur) n01 += 1;
    else if (prev && !cur) n10 += 1;
    else n11 += 1;
  }
  const n = hits.length;
  const exceptions = hits.filter(Boolean).length;
  const uc = kupiec(exceptions, n, p);
  const denom0 = n00 + n01;
  const denom1 = n10 + n11;
  const pi01 = denom0 > 0 ? n01 / denom0 : 0;
  const pi11 = denom1 > 0 ? n11 / denom1 : 0;
  const pi = n > 1 ? (n01 + n11) / (n - 1) : 0;
  const llInd =
    (n00 === 0 ? 0 : n00 * Math.log(1 - pi01)) +
    (n01 === 0 ? 0 : n01 * Math.log(pi01)) +
    (n10 === 0 ? 0 : n10 * Math.log(1 - pi11)) +
    (n11 === 0 ? 0 : n11 * Math.log(pi11));
  const llPool = (n - 1 - (n01 + n11)) * (1 - pi <= 0 ? 0 : Math.log(1 - pi)) + (n01 + n11 === 0 ? 0 : (n01 + n11) * Math.log(pi || 1));
  let lrInd = 0;
  if (denom0 > 0 && denom1 > 0 && pi > 0 && pi < 1 && pi01 > 0 && pi01 < 1 && pi11 > 0 && pi11 < 1) {
    lrInd = Math.max(0, -2 * (llPool - llInd));
  }
  const independence: CoverageTest = {
    hits: exceptions,
    n,
    hitRate: n ? exceptions / n : NaN,
    lr: lrInd,
    pValue: chiSquareSurvival(lrInd, 1),
  };
  const lrCc = uc.lr + lrInd;
  return {
    independence,
    conditional: { hits: exceptions, n, hitRate: uc.hitRate, lr: lrCc, pValue: chiSquareSurvival(lrCc, 2) },
  };
}

/** Kolmogorov-Smirnov distance of a PIT sample from Uniform(0, 1). */
export function ksUniform(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  let distance = 0;
  for (let i = 0; i < n; i++) {
    const hi = (i + 1) / n;
    const lo = i / n;
    distance = Math.max(distance, Math.abs(sorted[i] - hi), Math.abs(sorted[i] - lo));
  }
  return distance;
}

function esRatio(returns: number[], quantile: number[], es: number[]): number {
  let loss = 0;
  let model = 0;
  let n = 0;
  for (let i = 0; i < returns.length; i++) {
    if (returns[i] < quantile[i]) {
      loss += returns[i];
      model += es[i];
      n += 1;
    }
  }
  if (n === 0 || model === 0) return NaN;
  return loss / model;
}

interface Forecast {
  mean: number;
  sigma: number;
  df: number | null;
}

function quantileOf(forecast: Forecast, p: number): number {
  if (!(forecast.sigma > 0)) return forecast.mean;
  const z = forecast.df == null ? normalPpf(p) : unitStudentPpf(p, forecast.df);
  return forecast.mean + forecast.sigma * z;
}

function esOf(forecast: Forecast, p: number): number {
  if (!(forecast.sigma > 0)) return forecast.mean;
  const z = forecast.df == null ? gaussianEs(p) : unitStudentEs(p, forecast.df);
  return forecast.mean + forecast.sigma * z;
}

function pitOf(value: number, forecast: Forecast): number {
  if (!(forecast.sigma > 0)) return 0.5;
  const z = (value - forecast.mean) / forecast.sigma;
  return forecast.df == null ? normalCdf(z) : unitStudentCdf(z, forecast.df);
}

function scoreMethod(method: MethodCoverage): number {
  const d95 = Math.abs(method.var95.hitRate - 0.05);
  const d99 = Math.abs(method.var99.hitRate - 0.01);
  const reject = (method.var95.pValue < 0.05 ? 1 : 0) + (method.conditional95.pValue < 0.05 ? 1 : 0);
  return d95 + 0.5 * d99 + 0.02 * reject;
}

function pack(method: MethodCoverage["method"], returns: number[], forecasts: Forecast[]): MethodCoverage {
  const q95 = forecasts.map((forecast) => quantileOf(forecast, 0.05));
  const q99 = forecasts.map((forecast) => quantileOf(forecast, 0.01));
  const hits95 = returns.map((value, i) => value < q95[i]);
  const hits99 = returns.map((value, i) => value < q99[i]);
  const c95 = christoffersen(hits95, 0.05);
  const c99 = christoffersen(hits99, 0.01);
  const pits = returns.map((value, i) => pitOf(value, forecasts[i]));
  const ks = ksUniform(pits);
  const critical = 1.36 / Math.sqrt(Math.max(1, pits.length));
  return {
    method,
    var95: kupiec(hits95.filter(Boolean).length, returns.length, 0.05),
    var99: kupiec(hits99.filter(Boolean).length, returns.length, 0.01),
    independence95: c95.independence,
    conditional95: c95.conditional,
    independence99: c99.independence,
    conditional99: c99.conditional,
    esRatio95: esRatio(returns, q95, forecasts.map((forecast) => esOf(forecast, 0.05))),
    esRatio99: esRatio(returns, q99, forecasts.map((forecast) => esOf(forecast, 0.01))),
    pitKs: ks,
    pitPass: Number.isFinite(ks) && ks <= critical,
  };
}

function monthlySigmaBefore(dates: string[], returns: number[], index: number): number {
  const priorDates = dates.slice(0, index);
  const prior = returns.slice(0, index);
  const months = monthlyReturns(priorDates, prior).map((row) => row.returns[0]);
  if (months.length < 4) return NaN;
  const annual = realizedAnnual(months, 12);
  return annual / Math.sqrt(TRADING_DAYS);
}

/**
 * Out-of-sample from a burn-in of max(80, enough months).
 * Old: expanding monthly vol and a Student-t with 5 degrees of freedom.
 * New: RiskMetrics variance known before the session, and a Student-t df refit every 21 sessions.
 */
export function coverSeries(ticker: string, dates: string[], returns: number[]): CoverageReport {
  const burn = Math.max(80, Math.min(returns.length - 5, 126));
  if (returns.length < burn + 20) {
    return {
      ticker,
      n: 0,
      old: null,
      next: null,
      winner: "too-short",
      scoreOld: NaN,
      scoreNew: NaN,
      note: "Too short for a rolling coverage test.",
    };
  }
  const ewma = ewmaVariance(returns);
  const oldForecasts: Forecast[] = [];
  const newForecasts: Forecast[] = [];
  const slice: number[] = [];
  let df = 5;
  let since = 999;
  for (let i = burn; i < returns.length; i++) {
    since += 1;
    if (since >= 21) {
      const window = returns.slice(Math.max(0, i - TRADING_DAYS), i);
      const fit = fitStudentT(window);
      if (fit) df = fit.df;
      since = 0;
    }
    const sigmaOld = monthlySigmaBefore(dates, returns, i);
    oldForecasts.push({ mean: 0, sigma: Number.isFinite(sigmaOld) ? sigmaOld : Math.sqrt(ewma.variance[i]), df: 5 });
    newForecasts.push({ mean: 0, sigma: Math.sqrt(Math.max(ewma.variance[i], 1e-16)), df });
    slice.push(returns[i]);
  }
  const old = pack("old-monthly-df5", slice, oldForecasts);
  const next = pack("new-ewma-student", slice, newForecasts);
  const scoreOld = scoreMethod(old);
  const scoreNew = scoreMethod(next);
  const winner = Math.abs(scoreOld - scoreNew) < 1e-6 ? "tie" : scoreNew < scoreOld ? "new" : "old";
  return {
    ticker,
    n: slice.length,
    old,
    next,
    winner,
    scoreOld,
    scoreNew,
    note: "Lower score wins: |hit rate − 5%| + ½|hit rate − 1%| + a penalty when Kupiec or Christoffersen rejects at 5%. The new forecast is EWMA volatility and a refit Student-t. The old forecast is expanding monthly volatility and df = 5.",
  };
}
