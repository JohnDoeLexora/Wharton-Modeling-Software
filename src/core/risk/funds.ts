/** Equity-ETF tracking difference, tracking error, and a fee-drag estimate from NAV versus an index. */

import { alignReturns, type CleanSeries } from "./clean";
import { stdev, mean } from "./stats";
import { TRADING_DAYS } from "./vol";

export interface FundTrack {
  ticker: string;
  benchmark: string;
  n: number;
  trackingDifference: number;
  trackingError: number;
  /** max(0, −tracking difference). An estimate from the gap, not a prospectus fee. */
  feeDrag: number;
  note: string;
}

export function trackFund(nav: CleanSeries, index: CleanSeries): FundTrack | null {
  const aligned = alignReturns(nav, index);
  if (aligned.left.length < 20) return null;
  const active = aligned.left.map((value, i) => value - aligned.right[i]);
  const trackingDifference = mean(active) * TRADING_DAYS;
  const trackingError = stdev(active, true) * Math.sqrt(TRADING_DAYS);
  const feeDrag = Math.max(0, -trackingDifference);
  return {
    ticker: nav.ticker,
    benchmark: index.ticker,
    n: aligned.left.length,
    trackingDifference,
    trackingError,
    feeDrag,
    note: `Tracking difference is the mean of NAV minus ${index.ticker}, times 252. Fee drag is the negative part of that difference. It is not a prospectus expense ratio. Bond ETFs stay on the holdings pricer.`,
  };
}
