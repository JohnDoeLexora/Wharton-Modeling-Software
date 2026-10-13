/**
 * Beta estimators.
 * A measured beta is an OLS (or Dimson) slope and its standard error.
 * Vasicek shrinks that slope toward a sector prior, weighted by precision.
 * Blume (0.67 β + 0.33) is the legacy column. It is not a measured beta.
 */

import { alignReturns, type CleanSeries } from "./clean";
import { ols, seOfSum } from "./stats";
import { monthlyReturns, TRADING_DAYS, weeklyReturns } from "./vol";

export const DEFAULT_NONSYNC = ["TSM", "CHT", "BUD", "PSO"];

export const MEASURED_LABEL = "measured";
export const SHRUNK_LABEL = "Vasicek shrunk (not measured)";
export const BLUME_LABEL = "Blume legacy toward 1 (not measured)";

export interface BetaEstimate {
  beta: number;
  se: number;
  n: number;
  window: string;
  /** True only for a slope computed from returns. A shrunk number is never measured. */
  measured: boolean;
  label: string;
}

export interface VasicekEstimate {
  beta: number;
  weightOnSample: number;
  prior: number;
  priorVar: number;
  priorNote: string;
  measured: false;
  label: string;
}

/** Legacy shrinkage used by the monthly calibration. 0.67 × 0.07 + 0.33 = 0.3769. */
export function blumeBeta(raw: number): number {
  return 0.67 * raw + 0.33;
}

/**
 * Vasicek (1973): weight on the sample is priorVar / (priorVar + se²).
 * The result lies between the raw slope and the prior whenever that weight is in [0, 1].
 */
export function vasicekBeta(raw: number, se: number, prior: number, priorVar: number): { beta: number; weightOnSample: number } {
  const se2 = Number.isFinite(se) ? se * se : Infinity;
  const pv = Math.max(0, priorVar);
  const denom = pv + se2;
  if (!Number.isFinite(denom) || denom <= 0) return { beta: raw, weightOnSample: 1 };
  const weight = pv / denom;
  return { beta: weight * raw + (1 - weight) * prior, weightOnSample: weight };
}

function slope(y: number[], x: number[], window: string): BetaEstimate {
  if (y.length < 5 || y.length !== x.length) {
    return { beta: NaN, se: NaN, n: y.length, window, measured: true, label: MEASURED_LABEL };
  }
  const fit = ols(y, [Array(y.length).fill(1), x]);
  const se = fit.cov ? Math.sqrt(Math.max(0, fit.cov[1][1])) : NaN;
  return { beta: fit.coef[1], se, n: y.length, window, measured: true, label: MEASURED_LABEL };
}

/** Dimson β = β_{−1} + β_0 + β_{+1}. The standard error is the standard error of that sum. */
export function dimsonBeta(asset: number[], market: number[]): BetaEstimate {
  const n = asset.length;
  if (n < 8 || market.length !== n) {
    return { beta: NaN, se: NaN, n: 0, window: "Dimson daily", measured: true, label: MEASURED_LABEL };
  }
  const y: number[] = [];
  const lag: number[] = [];
  const mid: number[] = [];
  const lead: number[] = [];
  const intercept: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    y.push(asset[i]);
    lag.push(market[i - 1]);
    mid.push(market[i]);
    lead.push(market[i + 1]);
    intercept.push(1);
  }
  const fit = ols(y, [intercept, lag, mid, lead]);
  if (!fit.cov) return { beta: NaN, se: NaN, n: y.length, window: "Dimson daily", measured: true, label: MEASURED_LABEL };
  const beta = fit.coef[1] + fit.coef[2] + fit.coef[3];
  return { beta, se: seOfSum(fit.cov, [1, 2, 3]), n: y.length, window: "Dimson daily", measured: true, label: MEASURED_LABEL };
}

export function isNonsync(series: CleanSeries, extra: readonly string[] = DEFAULT_NONSYNC): boolean {
  return series.nonsync || extra.includes(series.ticker.toUpperCase());
}

export interface BetaCard {
  daily: BetaEstimate;
  oneYear: BetaEstimate;
  weekly: BetaEstimate;
  monthly: BetaEstimate;
  dimson: BetaEstimate | null;
  preferred: BetaEstimate;
  vasicek: VasicekEstimate;
  blume: BetaEstimate;
  citation: string;
}

export function sectorPrior(
  ticker: string,
  sector: string,
  peers: { ticker: string; sector: string; beta: number; se: number }[],
): { prior: number; priorVar: number; note: string } {
  const others = peers.filter(
    (peer) => peer.ticker !== ticker && peer.sector !== "" && peer.sector === sector && Number.isFinite(peer.beta) && Number.isFinite(peer.se),
  );
  if (others.length === 0) {
    return { prior: 1, priorVar: 0.25, note: "No sector peer. The prior is 1 with variance 0.25, not a measured beta." };
  }
  let weightSum = 0;
  let betaSum = 0;
  let weightSquare = 0;
  const weights = others.map((peer) => {
    const weight = 1 / Math.max(peer.se * peer.se, 1e-8);
    weightSum += weight;
    weightSquare += weight * weight;
    betaSum += weight * peer.beta;
    return weight;
  });
  const prior = betaSum / weightSum;
  const effective = (weightSum * weightSum) / weightSquare;
  let scatter = 0;
  others.forEach((peer, index) => {
    const gap = peer.beta - prior;
    scatter += weights[index] * gap * gap;
  });
  scatter /= weightSum;
  // One precise peer is not a tight prior. A name measured with a small standard error then stays near its own slope.
  const priorVar = effective < 2 ? 0.25 : Math.max(scatter, 0.05 * 0.05);
  return {
    prior,
    priorVar,
    note:
      effective < 2
        ? `Sector prior is the precision-weighted daily beta of ${others.length} peer${others.length === 1 ? "" : "s"} in ${sector}. Fewer than two effective peers, so the prior variance is 0.25.`
        : `Sector prior is the precision-weighted daily beta of ${others.length} peers in ${sector}.`,
  };
}

export function betaAgainst(series: CleanSeries, market: CleanSeries, nonsync: boolean): Omit<BetaCard, "vasicek" | "blume" | "citation"> & { rawForShrink: BetaEstimate } {
  const aligned = alignReturns(series, market);
  const daily = slope(aligned.left, aligned.right, "full-sample daily");
  const cut = Math.max(0, aligned.left.length - TRADING_DAYS);
  const oneYearWindow = aligned.left.length >= TRADING_DAYS ? "1-yr daily" : `${aligned.left.length}-day daily`;
  const oneYear = slope(aligned.left.slice(cut), aligned.right.slice(cut), oneYearWindow);
  const assetWeeks = weeklyReturns(aligned.left);
  const marketWeeks = weeklyReturns(aligned.right);
  const weekly = slope(assetWeeks, marketWeeks, "weekly");
  const marketMonths = monthlyReturns(aligned.dates, aligned.right);
  const monthMap = new Map(marketMonths.map((row) => [row.month, row.returns[0]]));
  const assetMonthRows = monthlyReturns(aligned.dates, aligned.left);
  const y: number[] = [];
  const x: number[] = [];
  for (const row of assetMonthRows) {
    const marketMonth = monthMap.get(row.month);
    if (marketMonth === undefined) continue;
    y.push(row.returns[0]);
    x.push(marketMonth);
  }
  const monthly = slope(y, x, "monthly");
  const dimson = nonsync ? dimsonBeta(aligned.left, aligned.right) : null;
  const preferred = nonsync && dimson && Number.isFinite(dimson.beta) ? dimson : daily;
  const rawForShrink = preferred;
  return { daily, oneYear, weekly, monthly, dimson, preferred, rawForShrink };
}

export function finishBeta(
  partial: ReturnType<typeof betaAgainst>,
  prior: { prior: number; priorVar: number; note: string },
): BetaCard {
  const raw = partial.rawForShrink;
  const shrunk = vasicekBeta(raw.beta, raw.se, prior.prior, prior.priorVar);
  const vasicek: VasicekEstimate = {
    beta: shrunk.beta,
    weightOnSample: shrunk.weightOnSample,
    prior: prior.prior,
    priorVar: prior.priorVar,
    priorNote: prior.note,
    measured: false,
    label: SHRUNK_LABEL,
  };
  const blumeValue = blumeBeta(partial.monthly.beta);
  const blume: BetaEstimate = {
    beta: blumeValue,
    se: NaN,
    n: partial.monthly.n,
    window: "monthly Blume",
    measured: false,
    label: BLUME_LABEL,
  };
  const cited = partial.oneYear;
  const citation = Number.isFinite(cited.beta)
    ? `${cited.window} beta ${cited.beta.toFixed(2)} (SE ${Number.isFinite(cited.se) ? cited.se.toFixed(2) : "—"})`
    : "beta unavailable";
  return { ...partial, vasicek, blume, citation };
}

export function betaCitation(window: string, beta: number, se: number): string {
  return `${window} beta ${beta.toFixed(2)} (SE ${se.toFixed(2)})`;
}
