/** Volatility estimators. Annual figures use 252 trading days, 12 months, and trading weeks of 5 sessions. */

import type { CleanSeries } from "./clean";
import { mean, meanSquare, stdev, variance } from "./stats";

export const TRADING_DAYS = 252;
export const RISKMETRICS_LAMBDA = 0.94;
export const DISAGREEMENT_RATIO = 1.5;

export interface EwmaResult {
  lambda: number;
  /** Forecast variance of each observed return, before that return is seen. */
  variance: number[];
  /** Variance forecast for the next session. */
  next: number;
  annualVol: number;
}

/**
 * RiskMetrics EWMA. σ² starts at the mean square of the first 20 returns (at least 1e-12)
 * and updates as σ² ← λ σ² + (1−λ) r². A positive start and λ in (0, 1) keep every step positive.
 */
export function ewmaVariance(returns: number[], lambda = RISKMETRICS_LAMBDA): EwmaResult {
  const warm = returns.slice(0, Math.min(20, returns.length));
  let next = Math.max(meanSquare(warm), 1e-12);
  if (!Number.isFinite(next)) next = 1e-12;
  const path: number[] = [];
  const clipped = Math.min(0.999, Math.max(0.001, lambda));
  for (const value of returns) {
    path.push(next);
    const squared = Number.isFinite(value) ? value * value : 0;
    next = clipped * next + (1 - clipped) * squared;
    if (!(next > 0)) next = 1e-12;
  }
  return { lambda: clipped, variance: path, next, annualVol: Math.sqrt(next * TRADING_DAYS) };
}

export interface GarchFit {
  ok: boolean;
  omega: number;
  alpha: number;
  beta: number;
  /** Unconditional variance, the variance-target (mean square of demeaned returns). */
  longRun: number;
  /** Conditional variance of the next session. */
  current: number;
  /** Conditional variance of each observed return, before that return is seen. Empty when the fit failed. */
  path: number[];
  logLik: number;
  annualCurrent: number;
  annualLongRun: number;
  note: string;
}

const garchCache = new Map<string, GarchFit>();

/** Content key so the same series is not fit three times in one report. */
export function seriesKey(returns: number[]): string {
  let sum = 0;
  let sumsq = 0;
  let weighted = 0;
  for (let i = 0; i < returns.length; i++) {
    const value = returns[i];
    sum += value;
    sumsq += value * value;
    weighted += (i + 1) * value;
  }
  return `${returns.length}|${sum}|${sumsq}|${weighted}|${returns[0] ?? ""}|${returns[returns.length - 1] ?? ""}`;
}

function garchPath(demeaned: number[], longRun: number, alpha: number, beta: number): { path: number[]; next: number; logLik: number } {
  const omega = longRun * (1 - alpha - beta);
  let next = longRun;
  let logLik = 0;
  const path: number[] = [];
  for (const value of demeaned) {
    path.push(next);
    const variance = Math.max(next, 1e-16);
    logLik += -0.5 * (Math.log(2 * Math.PI) + Math.log(variance) + (value * value) / variance);
    next = omega + alpha * value * value + beta * variance;
    if (!(next > 0)) next = 1e-16;
  }
  return { path, next, logLik };
}

/**
 * Gaussian GARCH(1,1) with variance targeting. ω = σ̄² (1 − α − β).
 * α and β are chosen on a fixed grid (α = 0, 0.01, … 0.20; β = 0.50, 0.52, … 0.98)
 * with α + β < 0.995. Ties prefer the smaller α, then the smaller β.
 */
export function fitGarch(returns: number[]): GarchFit {
  const key = seriesKey(returns);
  const cached = garchCache.get(key);
  if (cached) return cached;
  const fit = fitGarchUncached(returns);
  garchCache.set(key, fit);
  if (garchCache.size > 48) {
    const oldest = garchCache.keys().next().value;
    if (oldest !== undefined) garchCache.delete(oldest);
  }
  return fit;
}

function fitGarchUncached(returns: number[]): GarchFit {
  const fail = (note: string): GarchFit => ({
    ok: false,
    omega: NaN,
    alpha: NaN,
    beta: NaN,
    longRun: NaN,
    current: NaN,
    path: [],
    logLik: NaN,
    annualCurrent: NaN,
    annualLongRun: NaN,
    note,
  });
  if (returns.length < 30) return fail("Fewer than 30 returns. GARCH was not fit. EWMA is the fallback.");
  if (returns.some((value) => !Number.isFinite(value))) return fail("A return was not finite. GARCH was not fit. EWMA is the fallback.");
  const center = mean(returns);
  if (!Number.isFinite(center)) return fail("The return mean was not finite. GARCH was not fit. EWMA is the fallback.");
  const demeaned = returns.map((value) => value - center);
  const longRun = Math.max(meanSquare(demeaned), 1e-12);
  if (!Number.isFinite(longRun)) return fail("The long-run variance was not finite. GARCH was not fit. EWMA is the fallback.");
  let bestA = 0;
  let bestB = 0.9;
  let bestLl = -Infinity;
  for (let ai = 0; ai <= 20; ai++) {
    const alpha = ai / 100;
    for (let bi = 50; bi <= 98; bi += 2) {
      const beta = bi / 100;
      if (alpha + beta >= 0.995) continue;
      const { logLik } = garchPath(demeaned, longRun, alpha, beta);
      if (!Number.isFinite(logLik)) continue;
      const better = logLik > bestLl + 1e-9;
      const tie = Math.abs(logLik - bestLl) <= 1e-9 && (alpha < bestA || (alpha === bestA && beta < bestB));
      if (better || tie) {
        bestLl = logLik;
        bestA = alpha;
        bestB = beta;
      }
    }
  }
  if (!Number.isFinite(bestLl)) return fail("GARCH likelihood did not converge. EWMA is the fallback.");
  const fitted = garchPath(demeaned, longRun, bestA, bestB);
  if (!fitted.path.every((value) => Number.isFinite(value) && value > 0)) {
    return fail("GARCH variance path was not usable. EWMA is the fallback.");
  }
  const omega = longRun * (1 - bestA - bestB);
  return {
    ok: true,
    omega,
    alpha: bestA,
    beta: bestB,
    longRun,
    current: fitted.next,
    path: fitted.path,
    logLik: fitted.logLik,
    annualCurrent: Math.sqrt(fitted.next * TRADING_DAYS),
    annualLongRun: Math.sqrt(longRun * TRADING_DAYS),
    note: "Variance-targeted Gaussian GARCH(1,1). The long-run variance is the mean square of demeaned returns.",
  };
}

export interface ConditionalVol {
  sigma: number[];
  source: "garch" | "ewma";
  /** Null when GARCH supplied the path. Set when the screen should show the fallback. */
  flag: string | null;
}

/** Ex-ante volatility of each return. GARCH when the fit converges, otherwise EWMA, with a flag. */
export function conditionalSigma(returns: number[], lambda = RISKMETRICS_LAMBDA): ConditionalVol {
  const garch = fitGarch(returns);
  if (garch.ok && garch.path.length === returns.length) {
    return { sigma: garch.path.map((value) => Math.sqrt(value)), source: "garch", flag: null };
  }
  const ewma = ewmaVariance(returns, lambda);
  const sigma = ewma.variance.map((value) => Math.sqrt(Math.max(value, 1e-12)));
  return {
    sigma,
    source: "ewma",
    flag: garch.note || "GARCH was not fit. EWMA variance is the fallback.",
  };
}

/**
 * Average variance over the next `horizonDays` sessions.
 * E[σ²_{t+h}] = v∞ + φ^{h−1} (v0 − v∞). The average sits between v0 and v∞ when φ is in (0, 1).
 */
export function horizonVariance(current: number, longRun: number, persistence: number, horizonDays: number): number {
  const phi = Math.min(0.999, Math.max(0, persistence));
  const horizon = Math.max(1, horizonDays);
  const decay = Math.abs(1 - phi) < 1e-8 ? 1 : (1 - Math.pow(phi, horizon)) / (horizon * (1 - phi));
  return longRun + (current - longRun) * decay;
}

export function horizonAnnualVol(currentDaily: number, longRunDaily: number, persistence: number, horizonDays = TRADING_DAYS): number {
  return Math.sqrt(Math.max(0, horizonVariance(currentDaily, longRunDaily, persistence, horizonDays)) * TRADING_DAYS);
}

export function realizedAnnual(returns: number[], periodsPerYear: number): number {
  const sigma = stdev(returns, true);
  return Number.isFinite(sigma) ? sigma * Math.sqrt(periodsPerYear) : NaN;
}

export function compound(returns: number[]): number {
  let level = 1;
  for (const value of returns) level *= 1 + value;
  return level - 1;
}

export function monthlyReturns(dates: string[], returns: number[]): { month: string; returns: number[] }[] {
  const groups = new Map<string, number[]>();
  dates.forEach((date, index) => {
    const month = date.slice(0, 7);
    const list = groups.get(month) ?? [];
    list.push(returns[index]);
    groups.set(month, list);
  });
  return [...groups.entries()].map(([month, values]) => ({ month, returns: [compound(values)] }));
}

export function weeklyReturns(returns: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 5 <= returns.length; i += 5) out.push(compound(returns.slice(i, i + 5)));
  return out;
}

export interface VolCard {
  realizedDaily: number;
  realizedMonthly: number;
  realizedWeekly: number;
  realized1y: number;
  ewma: number;
  ewmaLambda: number;
  garchCurrent: number;
  garchLongRun: number;
  garchAlpha: number;
  garchBeta: number;
  garchOk: boolean;
  horizon: number;
  horizonDays: number;
  blended: number;
  /** Legacy column: full-sample monthly realized vol. */
  oldMonthly: number;
  disagreement: boolean;
  ratio: number;
  note: string;
}

export function volCard(series: CleanSeries, lambda = RISKMETRICS_LAMBDA): VolCard {
  const daily = realizedAnnual(series.returns, TRADING_DAYS);
  const months = monthlyReturns(series.returnDates, series.returns).map((row) => row.returns[0]);
  const monthly = realizedAnnual(months, 12);
  const weekly = realizedAnnual(weeklyReturns(series.returns), TRADING_DAYS / 5);
  const last = series.returns.slice(-TRADING_DAYS);
  const realized1y = last.length >= 40 ? realizedAnnual(last, TRADING_DAYS) : NaN;
  const ewma = ewmaVariance(series.returns, lambda);
  const garch = fitGarch(series.returns);
  const persistence = garch.ok ? garch.alpha + garch.beta : lambda;
  const current = garch.ok ? garch.current : ewma.next;
  const longRun = garch.ok ? garch.longRun : Math.max(variance(series.returns, false), 1e-12);
  const horizon = horizonAnnualVol(current, longRun, persistence, TRADING_DAYS);
  const pieces = [ewma.annualVol, daily, monthly].filter((value) => Number.isFinite(value) && value > 0);
  const blended = pieces.length ? Math.sqrt(pieces.reduce((sum, value) => sum + value * value, 0) / pieces.length) : NaN;
  const compared = [daily, monthly, realized1y, ewma.annualVol, garch.ok ? garch.annualCurrent : NaN, horizon].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  const hi = compared.length ? Math.max(...compared) : NaN;
  const lo = compared.length ? Math.min(...compared) : NaN;
  const ratio = lo > 0 ? hi / lo : NaN;
  const disagreement = Number.isFinite(ratio) && ratio > DISAGREEMENT_RATIO;
  const band = disagreement
    ? `Estimators differ by ${ratio.toFixed(2)}×, above ${DISAGREEMENT_RATIO}. Monthly smoothing and a calm older sample can hide a recent gap regime.`
    : "The annualized estimators sit within a 1.5× band.";
  return {
    realizedDaily: daily,
    realizedMonthly: monthly,
    realizedWeekly: weekly,
    realized1y,
    ewma: ewma.annualVol,
    ewmaLambda: ewma.lambda,
    garchCurrent: garch.ok ? garch.annualCurrent : NaN,
    garchLongRun: garch.ok ? garch.annualLongRun : NaN,
    garchAlpha: garch.alpha,
    garchBeta: garch.beta,
    garchOk: garch.ok,
    horizon,
    horizonDays: TRADING_DAYS,
    blended,
    oldMonthly: monthly,
    disagreement,
    ratio,
    note: garch.ok ? band : `${band} ${garch.note}`,
  };
}
