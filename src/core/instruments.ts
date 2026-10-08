/**
 * Cash-flow prices for Treasuries, bond ETFs, and a rolling bills ETF.
 * Discount factors use the quoted annual zero: DF(τ) = 1/(1+z)^τ.
 * A semiannual coupon six months before the horizon is not reinvested inside the year.
 * Expense drag is multiplicative and monotone in the expense ratio.
 * None of these functions picks a holding.
 */

import { discountFactor, quoteYield, quotedZero, type Factors } from "./nelson";

export interface CashFlow {
  /** Years from the valuation date. */
  time: number;
  /** Dollars per 1 face, unless the caller passed another face. */
  amount: number;
}

export type YieldFn = (tenorYears: number) => number;

export function flatYield(annualZero: number): YieldFn {
  const quote = quoteYield(annualZero);
  return () => quote;
}

export function factorYield(factors: Factors): YieldFn {
  return (tenor) => quotedZero(factors, tenor);
}

/** Semiannual Treasury schedule. On a coupon date the first coupon is one full period away and accrued interest is zero. */
export function treasuryCashFlows(coupon: number, yearsToMaturity: number, face = 1, frequency = 2): CashFlow[] {
  if (!(yearsToMaturity > 0)) return [{ time: 0, amount: face }];
  const period = 1 / frequency;
  const couponCash = (coupon / frequency) * face;
  let time = yearsToMaturity % period;
  if (time < 1e-10) time = period;
  const flows: CashFlow[] = [];
  while (time < yearsToMaturity - 1e-8) {
    flows.push({ time, amount: couponCash });
    time += period;
  }
  flows.push({ time: yearsToMaturity, amount: couponCash + face });
  return flows;
}

export function accruedInterest(coupon: number, yearsToMaturity: number, face = 1, frequency = 2): number {
  if (!(yearsToMaturity > 0) || coupon === 0) return 0;
  const period = 1 / frequency;
  let timeToNext = yearsToMaturity % period;
  if (timeToNext < 1e-10) return 0;
  const elapsed = period - timeToNext;
  return (coupon / frequency) * face * (elapsed / period);
}

/** Dirty price is the sum of cash flows discounted on the quoted curve. */
export function dirtyFromCashFlows(flows: CashFlow[], yieldAt: YieldFn): number {
  let total = 0;
  for (const flow of flows) {
    const df = discountFactor(quoteYield(yieldAt(flow.time)), flow.time);
    if (!Number.isFinite(df)) return Number.NaN;
    total += flow.amount * df;
  }
  return total;
}

export interface BondQuote {
  dirty: number;
  clean: number;
  accrued: number;
  yieldUsed: number;
  flows: CashFlow[];
  modifiedDuration: number;
  convexity: number;
}

export function priceTreasury(args: {
  coupon: number;
  yearsToMaturity: number;
  face?: number;
  yieldAt: YieldFn;
  bump?: number;
}): BondQuote {
  const face = args.face ?? 1;
  const bump = args.bump ?? 0.0001;
  const flows = treasuryCashFlows(args.coupon, args.yearsToMaturity, face);
  const dirty = dirtyFromCashFlows(flows, args.yieldAt);
  const accrued = accruedInterest(args.coupon, args.yearsToMaturity, face);
  const up = dirtyFromCashFlows(flows, (tenor) => quoteYield(args.yieldAt(tenor) + bump));
  const down = dirtyFromCashFlows(flows, (tenor) => quoteYield(args.yieldAt(tenor) - bump));
  const modifiedDuration = dirty > 0 && Number.isFinite(up) && Number.isFinite(down) ? -(up - down) / (2 * bump * dirty) : Number.NaN;
  const convexity = dirty > 0 && Number.isFinite(up) && Number.isFinite(down) ? (up + down - 2 * dirty) / (dirty * bump * bump) : Number.NaN;
  const yieldUsed = quoteYield(args.yieldAt(Math.max(args.yearsToMaturity, 0)));
  return { dirty, clean: dirty - accrued, accrued, yieldUsed, flows, modifiedDuration, convexity };
}

/**
 * Hold-to-maturity book value discounts the remaining cash flows at the purchase yield.
 * Mark-to-market uses the current curve. At maturity both are the face amount.
 */
export function htmBookValue(args: {
  coupon: number;
  yearsToMaturity: number;
  yearsHeld: number;
  purchaseYield: number;
  face?: number;
}): number {
  const face = args.face ?? 1;
  const left = args.yearsToMaturity - args.yearsHeld;
  if (left <= 1e-8) return face;
  return dirtyFromCashFlows(treasuryCashFlows(args.coupon, left, face), flatYield(args.purchaseYield));
}

export function mtmValue(args: {
  coupon: number;
  yearsToMaturity: number;
  yearsHeld: number;
  yieldAt: YieldFn;
  face?: number;
}): number {
  const face = args.face ?? 1;
  const left = args.yearsToMaturity - args.yearsHeld;
  if (left <= 1e-8) return face;
  return dirtyFromCashFlows(treasuryCashFlows(args.coupon, left, face), args.yieldAt);
}

export interface KeyRate {
  tenor: number;
  /** −(ΔP/P) / Δy. Years, per 1 of dirty price. */
  krd: number;
}

const DEFAULT_KEYS = [1, 2, 5, 10, 30];

function tent(tenor: number, key: number, keys: number[]): number {
  const lower = [...keys].filter((item) => item < key).sort((a, b) => b - a)[0];
  const upper = [...keys].filter((item) => item > key).sort((a, b) => a - b)[0];
  if (Math.abs(tenor - key) < 1e-10) return 1;
  if (tenor < key) {
    const left = lower ?? 0;
    if (tenor <= left) return left === 0 && tenor >= 0 ? (key === keys[0] ? 1 - (key - tenor) / key : 0) : 0;
    return (tenor - left) / (key - left);
  }
  if (upper === undefined) return 0;
  if (tenor >= upper) return 0;
  return (upper - tenor) / (upper - key);
}

/** Key-rate durations from tent-shaped bumps of the quoted zero curve. */
export function keyRateDurations(args: {
  price: (yieldAt: YieldFn) => number;
  yieldAt: YieldFn;
  tenors?: number[];
  bump?: number;
}): KeyRate[] {
  const keys = args.tenors ?? DEFAULT_KEYS;
  const bump = args.bump ?? 0.0001;
  const base = args.price(args.yieldAt);
  if (!(base > 0) || !Number.isFinite(base)) return keys.map((tenor) => ({ tenor, krd: Number.NaN }));
  return keys.map((key) => {
    const bumped: YieldFn = (tenor) => quoteYield(args.yieldAt(tenor) + tent(tenor, key, keys) * bump);
    const next = args.price(bumped);
    return { tenor: key, krd: Number.isFinite(next) ? -(next - base) / base / bump : Number.NaN };
  });
}

export interface MaturityBucket {
  maturityYears: number;
  /** Share of fund face. Weights are renormalized when they are positive. */
  weight: number;
  /** Annual coupon rate. Zero is a bill or a strip. */
  coupon: number;
}

export type FundStyle = "constant_maturity" | "target_maturity";

export interface FundBook {
  buckets: MaturityBucket[];
  expenseRatio: number;
  style: FundStyle;
  /** Years until a target-maturity fund liquidates. Ignored by constant maturity. */
  yearsToTarget: number;
}

export function normalizeBuckets(buckets: MaturityBucket[]): MaturityBucket[] {
  const usable = buckets.filter((bucket) => bucket.weight > 0 && bucket.maturityYears >= 0 && Number.isFinite(bucket.coupon));
  const total = usable.reduce((sum, bucket) => sum + bucket.weight, 0);
  if (!(total > 0)) return [];
  return usable.map((bucket) => ({ ...bucket, weight: bucket.weight / total }));
}

export function parseBucketCsv(text: string): FundBook {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (rows.length === 0) return { buckets: [], expenseRatio: 0, style: "constant_maturity", yearsToTarget: 0 };
  const header = rows[0].split(",").map((cell) => cell.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const body = idx("maturity_years") >= 0 ? rows.slice(1) : rows;
  const maturityCol = idx("maturity_years") >= 0 ? idx("maturity_years") : 0;
  const weightCol = idx("weight") >= 0 ? idx("weight") : 1;
  const couponCol = idx("coupon") >= 0 ? idx("coupon") : 2;
  const buckets: MaturityBucket[] = [];
  let expense = 0;
  let style: FundStyle = "constant_maturity";
  let yearsToTarget = 0;
  for (const line of body) {
    const cells = line.split(",");
    const maturityYears = Number(cells[maturityCol] ?? "");
    const weight = Number(cells[weightCol] ?? "");
    const couponRaw = Number(cells[couponCol] ?? "0");
    if (!Number.isFinite(maturityYears) || !Number.isFinite(weight)) continue;
    const coupon = Number.isFinite(couponRaw) ? (Math.abs(couponRaw) > 1 ? couponRaw / 100 : couponRaw) : 0;
    buckets.push({ maturityYears, weight, coupon });
    const expenseCell = idx("expense_ratio") >= 0 ? Number(cells[idx("expense_ratio")] ?? "") : Number.NaN;
    if (Number.isFinite(expenseCell)) expense = Math.abs(expenseCell) > 1 ? expenseCell / 100 : expenseCell;
    const styleCell = (idx("style") >= 0 ? cells[idx("style")] : "").trim().toLowerCase();
    if (styleCell.includes("target")) style = "target_maturity";
    const targetCell = idx("years_to_target") >= 0 ? Number(cells[idx("years_to_target")] ?? "") : Number.NaN;
    if (Number.isFinite(targetCell)) yearsToTarget = targetCell;
  }
  return { buckets: normalizeBuckets(buckets), expenseRatio: expense, style, yearsToTarget };
}

function bucketPrice(bucket: MaturityBucket, yieldAt: YieldFn): number {
  if (bucket.maturityYears <= 1e-8) return 1;
  return dirtyFromCashFlows(treasuryCashFlows(bucket.coupon, bucket.maturityYears, 1), yieldAt);
}

export interface FundSnapshot {
  dirty: number;
  duration: number;
  convexity: number;
  yieldToMaturity: number;
}

/** Value, duration, and convexity of one face of the fund, before the expense ratio. */
export function fundSnapshot(buckets: MaturityBucket[], yieldAt: YieldFn): FundSnapshot {
  const book = normalizeBuckets(buckets);
  if (book.length === 0) return { dirty: Number.NaN, duration: Number.NaN, convexity: Number.NaN, yieldToMaturity: Number.NaN };
  let dirty = 0;
  let duration = 0;
  let convexity = 0;
  let ytm = 0;
  for (const bucket of book) {
    const quote = priceTreasury({ coupon: bucket.coupon, yearsToMaturity: Math.max(bucket.maturityYears, 1e-6), yieldAt });
    const weight = bucket.weight;
    dirty += weight * (bucket.maturityYears <= 1e-8 ? 1 : quote.dirty);
    duration += weight * (Number.isFinite(quote.modifiedDuration) ? quote.modifiedDuration : 0);
    convexity += weight * (Number.isFinite(quote.convexity) ? quote.convexity : 0);
    ytm += weight * quote.yieldUsed;
  }
  return { dirty, duration, convexity, yieldToMaturity: ytm };
}

export interface HoldingYear {
  gross: number;
  net: number;
  price0: number;
  price1: number;
  coupons: number;
}

/**
 * One-year total return of a bucket that rolls down by one year.
 * Constant-maturity rebalancing sells that rolled bond and buys the original maturity at the model price,
 * which does not change wealth. The next year keeps the original maturity only when the style says so.
 */
export function bucketYear(bucket: MaturityBucket, yieldPrev: YieldFn, yieldNext: YieldFn): HoldingYear {
  if (bucket.maturityYears <= 1e-8) {
    return { gross: 0, net: 0, price0: 1, price1: 1, coupons: 0 };
  }
  const price0 = bucketPrice(bucket, yieldPrev);
  const left = bucket.maturityYears - 1;
  let price1 = 1;
  let coupons = 0;
  if (left <= 1e-8) {
    const flows = treasuryCashFlows(bucket.coupon, bucket.maturityYears, 1);
    coupons = flows.reduce((sum, flow) => sum + flow.amount, 0) - 1;
    price1 = 1;
  } else {
    price1 = bucketPrice({ ...bucket, maturityYears: left }, yieldNext);
    coupons = bucket.coupon;
  }
  const gross = price0 > 0 ? (price1 + coupons) / price0 - 1 : Number.NaN;
  return { gross, net: gross, price0, price1, coupons };
}

/** Multiplicative expense drag. A higher expense ratio never raises the net return. */
export function applyFundExpense(gross: number, expenseRatio: number): number {
  if (!Number.isFinite(gross)) return gross;
  const expense = expenseRatio > 0 ? expenseRatio : 0;
  return (1 + gross) * (1 - expense) - 1;
}

export function fundYearReturn(book: FundBook, yieldPrev: YieldFn, yieldNext: YieldFn): number {
  const buckets = normalizeBuckets(book.buckets);
  if (buckets.length === 0) return Number.NaN;
  let gross = 0;
  for (const bucket of buckets) {
    const matured = book.style === "target_maturity" ? Math.min(bucket.maturityYears, Math.max(book.yearsToTarget, 0)) : bucket.maturityYears;
    gross += bucket.weight * bucketYear({ ...bucket, maturityYears: matured }, yieldPrev, yieldNext).gross;
  }
  return applyFundExpense(gross, book.expenseRatio);
}

/**
 * A target-maturity fund at its liquidation date is cash.
 * Before that date the value is the dirty price of whatever maturity is left, after no extra terminal fee.
 */
export function targetMaturityValue(yearsLeft: number, yieldAt: YieldFn, coupon = 0, face = 1): number {
  if (yearsLeft <= 1e-8) return face;
  return dirtyFromCashFlows(treasuryCashFlows(coupon, yearsLeft, face), yieldAt);
}

export function rollBuckets(buckets: MaturityBucket[], style: FundStyle): MaturityBucket[] {
  return normalizeBuckets(buckets.map((bucket) => {
    if (style === "constant_maturity") return bucket;
    return { ...bucket, maturityYears: Math.max(0, bucket.maturityYears - 1), coupon: bucket.maturityYears - 1 <= 1e-8 ? 0 : bucket.coupon };
  }));
}

/** Bills ETF: the year's yield is the simulated short end, and the expense is subtracted multiplicatively. */
export function billEtfReturn(shortQuote: number, expenseRatio: number): number {
  return applyFundExpense(quoteYield(shortQuote), expenseRatio);
}

/** Simple difference the label also shows: short quote minus the expense ratio. */
export function billEtfSimpleYield(shortQuote: number, expenseRatio: number): number {
  return quoteYield(shortQuote) - (expenseRatio > 0 ? expenseRatio : 0);
}

export interface ReinvestmentPath {
  /** Wealth of 1 reinvested each year at that year's bill yield. */
  reinvested: number[];
  /** Wealth of 1 locked at the first year's yield. */
  locked: number[];
}

/** The gap between these two paths is the reinvestment risk of rolling bills. */
export function billReinvestment(shorts: number[], expenseRatio: number): ReinvestmentPath {
  const reinvested = [1];
  const locked = [1];
  const first = billEtfReturn(shorts[0] ?? 0, expenseRatio);
  for (let i = 0; i < shorts.length; i++) {
    reinvested.push(reinvested[i] * (1 + billEtfReturn(shorts[i], expenseRatio)));
    locked.push(locked[i] * (1 + first));
  }
  return { reinvested, locked };
}
