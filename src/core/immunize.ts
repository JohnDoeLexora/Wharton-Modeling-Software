/**
 * Liability present value, duration, convexity, and key-rate durations
 * at any case year, plus the gap against a set of asset buckets.
 * Surplus-at-risk is the change in assets minus liability PV under a yield shock.
 * It is a report, not a reserve policy.
 */

import { OPERATING_FIRST_YEAR, OPERATING_LAST_YEAR, OPERATING_PAYMENT } from "./case";
import { keyRateDurations, priceTreasury, type MaturityBucket, type YieldFn } from "./instruments";
import { QUOTE_FLOOR, quoteYield } from "./nelson";

export interface LiabilityFlow {
  calendarYear: number;
  /** Years after the valuation date. The payment due today has time 0. */
  time: number;
  amount: number;
}

export function liabilityFlows(asOfYear: number): LiabilityFlow[] {
  const flows: LiabilityFlow[] = [];
  for (let year = OPERATING_FIRST_YEAR; year <= OPERATING_LAST_YEAR; year++) {
    if (year < asOfYear) continue;
    flows.push({ calendarYear: year, time: year - asOfYear, amount: OPERATING_PAYMENT });
  }
  return flows;
}

export interface LiabilityStats {
  asOfYear: number;
  pv: number;
  modifiedDuration: number;
  convexity: number;
  keyRates: { tenor: number; krd: number; dollarKrd: number }[];
  flows: LiabilityFlow[];
}

function pvOf(flows: LiabilityFlow[], yieldAt: YieldFn): number {
  let total = 0;
  for (const flow of flows) {
    if (flow.time <= 0) {
      total += flow.amount;
      continue;
    }
    const yieldK = quoteYield(yieldAt(flow.time));
    if (yieldK <= -0.999999) return Number.POSITIVE_INFINITY;
    total += flow.amount / Math.pow(1 + yieldK, flow.time);
  }
  return total;
}

export function liabilityStats(asOfYear: number, yieldAt: YieldFn, bump = 0.0001): LiabilityStats {
  const flows = liabilityFlows(asOfYear);
  const pv = pvOf(flows, yieldAt);
  const up = pvOf(flows, (tenor) => quoteYield(yieldAt(tenor) + bump));
  const down = pvOf(flows, (tenor) => Math.max(QUOTE_FLOOR, yieldAt(tenor) - bump));
  const modifiedDuration = pv > 0 && Number.isFinite(up) && Number.isFinite(down) ? -(up - down) / (2 * bump * pv) : Number.NaN;
  const convexity = pv > 0 && Number.isFinite(up) && Number.isFinite(down) ? (up + down - 2 * pv) / (pv * bump * bump) : Number.NaN;
  const keys = keyRateDurations({
    price: (curve) => pvOf(flows, curve),
    yieldAt,
    bump,
  });
  return {
    asOfYear,
    pv,
    modifiedDuration,
    convexity,
    keyRates: keys.map((key) => ({ ...key, dollarKrd: Number.isFinite(key.krd) ? key.krd * pv : Number.NaN })),
    flows,
  };
}

export interface AssetKey {
  tenor: number;
  krd: number;
  dollarKrd: number;
}

export function assetKeyRates(args: {
  buckets: MaturityBucket[];
  marketValue: number;
  yieldAt: YieldFn;
}): AssetKey[] {
  const keys = keyRateDurations({
    price: (curve) => {
      let total = 0;
      for (const bucket of args.buckets) {
        if (!(bucket.weight > 0)) continue;
        const quote = priceTreasury({
          coupon: bucket.coupon,
          yearsToMaturity: Math.max(bucket.maturityYears, 1e-6),
          yieldAt: curve,
        });
        total += bucket.weight * quote.dirty;
      }
      return total;
    },
    yieldAt: args.yieldAt,
  });
  const weight = args.buckets.reduce((sum, bucket) => sum + (bucket.weight > 0 ? bucket.weight : 0), 0);
  return keys.map((key) => ({
    tenor: key.tenor,
    krd: weight > 0 && Number.isFinite(key.krd) ? key.krd / weight : key.krd,
    dollarKrd: Number.isFinite(key.krd) && weight > 0 ? (key.krd / weight) * args.marketValue : Number.NaN,
  }));
}

export interface GapRow {
  tenor: number;
  assetKrd: number;
  liabilityKrd: number;
  assetDollar: number;
  liabilityDollar: number;
  /** Asset dollar key-rate duration minus liability dollar key-rate duration. */
  gap: number;
}

export function immunizationGap(assets: AssetKey[], liability: LiabilityStats): GapRow[] {
  const tenors = [...new Set([...assets.map((row) => row.tenor), ...liability.keyRates.map((row) => row.tenor)])].sort((a, b) => a - b);
  return tenors.map((tenor) => {
    const asset = assets.find((row) => row.tenor === tenor);
    const debt = liability.keyRates.find((row) => row.tenor === tenor);
    const assetDollar = asset?.dollarKrd ?? 0;
    const liabilityDollar = debt?.dollarKrd ?? 0;
    return {
      tenor,
      assetKrd: asset?.krd ?? 0,
      liabilityKrd: debt?.krd ?? 0,
      assetDollar,
      liabilityDollar,
      gap: assetDollar - liabilityDollar,
    };
  });
}

export interface SurplusShock {
  name: string;
  dy: number;
  assetValue: number;
  liabilityPv: number;
  surplus: number;
  surplusChange: number;
}

/**
 * Surplus after a parallel quote shift.
 * Assets use duration and convexity. The liability is repriced on the shifted curve.
 */
export function surplusAtRisk(args: {
  assetValue: number;
  assetDuration: number;
  assetConvexity: number;
  liability: LiabilityStats;
  yieldAt: YieldFn;
  shocks: { name: string; dy: number }[];
}): SurplusShock[] {
  const baseSurplus = args.assetValue - args.liability.pv;
  return args.shocks.map((shock) => {
    const price = -args.assetDuration * shock.dy + 0.5 * args.assetConvexity * shock.dy * shock.dy;
    const assetValue = args.assetValue * (1 + price);
    const flows = args.liability.flows;
    let liabilityPv = 0;
    for (const flow of flows) {
      if (flow.time <= 0) {
        liabilityPv += flow.amount;
        continue;
      }
      const yieldK = Math.max(QUOTE_FLOOR, args.yieldAt(flow.time) + shock.dy);
      liabilityPv += flow.amount / Math.pow(1 + yieldK, flow.time);
    }
    const surplus = assetValue - liabilityPv;
    return { name: shock.name, dy: shock.dy, assetValue, liabilityPv, surplus, surplusChange: surplus - baseSurplus };
  });
}
