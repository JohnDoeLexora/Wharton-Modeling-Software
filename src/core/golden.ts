/**
 * Fixed-point golden vectors shared with bend/main.bend.
 * Dollars are whole. Rates and weights are parts per million (1_000_000 = 1).
 * The arithmetic is written out here so the parity check is not a second copy
 * of the Bend source. Case cash flows come from the locked case module.
 */

import { caseContribution, OPERATING_PAYMENT, OPERATING_PAYMENTS } from "./case";
import { rawWord } from "./rng";

export const PPM = 1_000_000;

export function muldiv(a: number, b: number, d: number): number {
  if (d === 0) return 0;
  return Math.floor((a * b) / d);
}

export function subSat(a: number, b: number): number {
  return a >= b ? a - b : 0;
}

export function durationLossPpm(durationMilli: number, dyPpm: number): number {
  return muldiv(durationMilli, dyPpm, 1000);
}

export function convexityGainPpm(convexityMilli: number, dyPpm: number): number {
  const step = muldiv(convexityMilli, dyPpm, 1000);
  return muldiv(step, dyPpm, 2_000_000);
}

export function mtmPpm(carryPpm: number, durationMilli: number, convexityMilli: number, dyPpm: number): number {
  return subSat(carryPpm + convexityGainPpm(convexityMilli, dyPpm), durationLossPpm(durationMilli, dyPpm));
}

/** Rising template: +75 bp for 3 years, kappa 0, start at 0. Index 6 is the start of 2033. */
export function risingShort2033(): number {
  return 7_500 * 3;
}

export function curveAt(short: number, intermediatePremium: number, longPremium: number, slope: number) {
  return {
    short,
    intermediate: short + intermediatePremium,
    long: short + longPremium + slope,
  };
}

export function expectedLossPpm(pdPpm: number, recoveryPpm: number): number {
  return muldiv(pdPpm, subSat(PPM, recoveryPpm), PPM);
}

export function nameReturnPpm(args: {
  alpha: number;
  betaPpm: number;
  marketPpm: number;
  sectorBetaPpm: number;
  sectorPpm: number;
  jumpProbPpm: number;
  jumpLossPpm: number;
  fxPpm: number;
  expensePpm: number;
}): number {
  const jump = muldiv(args.jumpProbPpm, args.jumpLossPpm, PPM);
  const gross = subSat(
    args.alpha + muldiv(args.betaPpm, args.marketPpm, PPM) + muldiv(args.sectorBetaPpm, args.sectorPpm, PPM),
    jump,
  );
  const withFx = gross + args.fxPpm + muldiv(gross, args.fxPpm, PPM);
  return subSat(withFx, args.expensePpm + muldiv(withFx, args.expensePpm, PPM));
}

/** floor(budget / price), capped by the requested quantity. Price 0 buys nothing. */
export function fillShares(capital: number, price: number, requested: number): { qty: number; spent: number; left: number } {
  const qty = price > 0 ? Math.min(requested, Math.floor(capital / price)) : 0;
  const spent = qty * price;
  return { qty, spent, left: capital - spent };
}

export interface GoldenLine {
  key: string;
  value: string;
}

/** Lines bend/main.bend prints. Values are computed, then compared with that output. */
export function goldenLines(): GoldenLine[] {
  const curve = curveAt(risingShort2033(), 5_000, 15_000, 0);
  const shares = fillShares(300_000, 381, 1_000);
  const first = fillShares(300_000, 100, 500);
  const second = fillShares(first.left, 250, 10_000);
  const bond = fillShares(20_000, 1_018, 1_000_000);
  const word = rawWord(42, 1, 0, 2027, 0);
  const lines: [string, number][] = [
    ["cash_2027", caseContribution(2027)],
    ["cash_2028", caseContribution(2028)],
    ["cash_sum", caseContribution(2027) + caseContribution(2028)],
    ["pay_sum", OPERATING_PAYMENT * OPERATING_PAYMENTS],
    ["bond_zero_dy", mtmPpm(50_000, 16_000, 300_000, 0)],
    ["rising_short_2033", risingShort2033()],
    ["flat_short_2033", 0],
    ["falling_short_2030", 30_000 - 5_000 * 3],
    ["shock_short_2028", 20_000],
    ["stagflation_short_2029", 10_000 * 2],
    ["revert_one_step", muldiv(500_000, 100_000, PPM)],
    ["vol_step", muldiv(10_000, PPM, PPM)],
    ["curve_intermediate_2033", curve.intermediate],
    ["curve_long_2033", curve.long],
    ["credit_expected_loss", expectedLossPpm(10_000, 400_000)],
    ["credit_loss_hit", subSat(PPM, 400_000)],
    ["credit_loss_miss", 0],
    ["credit_mtm", mtmPpm(30_000 + 12_000, 6_000, 40_000, 0) - expectedLossPpm(10_000, 400_000)],
    ["credit_widened", 12_000 + muldiv(800_000, 100_000, PPM)],
    ["name_plain", nameReturnPpm({ alpha: 10_000, betaPpm: PPM, marketPpm: 50_000, sectorBetaPpm: 500_000, sectorPpm: 20_000, jumpProbPpm: 0, jumpLossPpm: 0, fxPpm: 0, expensePpm: 0 })],
    ["name_jump", nameReturnPpm({ alpha: 10_000, betaPpm: PPM, marketPpm: 50_000, sectorBetaPpm: 0, sectorPpm: 0, jumpProbPpm: 200_000, jumpLossPpm: 100_000, fxPpm: 0, expensePpm: 0 })],
    ["name_fx_fee", nameReturnPpm({ alpha: 0, betaPpm: PPM, marketPpm: 50_000, sectorBetaPpm: 0, sectorPpm: 0, jumpProbPpm: 0, jumpLossPpm: 0, fxPpm: 10_000, expensePpm: 10_000 })],
    ["reserve_pv0", 500_000],
    ["reserve_nominal", 500_000],
    ["reserve_bill0", 500_000],
    ["reserve_dur0", 500_000],
    ["htm_marked", 100_000 + 5_000 * 3],
    ["htm_unmarked", 100_000 + 5_000 * 3],
    ["htm_wealth", 100_000 + muldiv(100_000, 50_000, PPM)],
    ["mtm_wealth_zero_dy", 100_000 + muldiv(100_000, mtmPpm(50_000, 16_000, 300_000, 0), PPM)],
    ["mtm_dy_lo", mtmPpm(400_000, 5_000, 0, 10_000)],
    ["mtm_dy_hi", mtmPpm(400_000, 5_000, 0, 20_000)],
    ["range_low", 100_000],
    ["range_high", 400_000],
    ["trade_spent", shares.spent],
    ["trade_left", shares.left],
    ["trade_qty", shares.qty],
    ["trade_two_spent", first.spent + second.spent],
    ["trade_two_left", second.left],
    ["trade_bond_spent", bond.spent],
    ["trade_bond_left", bond.left],
    ["weight_sum", PPM],
    ["rebalance_dollars", 300_000],
    ["draw_hi", word.hi],
    ["draw_lo", word.lo],
    ["boy_2033_annual", 450_000],
    ["ladder_yield_0", 500_000],
  ];
  return lines.map(([key, value]) => ({ key, value: String(value) }));
}

export function parseGolden(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9_]+) (-?\d+)$/.exec(line.trim());
    if (match) out.set(match[1], match[2]);
  }
  return out;
}
