import { describe, expect, it } from "vitest";
import { bondTotalReturn } from "./bonds";
import { caseContribution, OPERATING_PAYMENT, OPERATING_PAYMENTS } from "./case";
import { goldenLines, mtmPpm, PPM } from "./golden";
import { pvAnnuityDue } from "./math";
import { rawWord, STREAM } from "./rng";
import { flatReturns, reserveToImmunize } from "./reserve";

describe("fixed-point golden vectors", () => {
  const lines = Object.fromEntries(goldenLines().map((line) => [line.key, line.value]));

  it("locks case cash flows and the zero-yield reserve", () => {
    expect(lines.cash_2027).toBe("300000");
    expect(lines.cash_2028).toBe("150000");
    expect(lines.cash_sum).toBe(String(caseContribution(2027) + caseContribution(2028)));
    expect(lines.pay_sum).toBe(String(OPERATING_PAYMENT * OPERATING_PAYMENTS));
    expect(lines.boy_2033_annual).toBe("450000");
    expect(lines.reserve_pv0).toBe("500000");
    expect(reserveToImmunize(flatReturns(0))).toBe(500_000);
    expect(pvAnnuityDue(OPERATING_PAYMENT, OPERATING_PAYMENTS, 0)).toBe(500_000);
  });

  it("matches the float bond formula within one part per million", () => {
    const carry = 0.05;
    const duration = 5;
    const dy = 0.01;
    const ppm = mtmPpm(50_000, 5_000, 0, 10_000);
    const floated = bondTotalReturn({ yieldPrev: carry, yieldNext: carry + dy, duration, convexity: 0 }).mtm;
    expect(Math.abs(ppm / PPM - floated)).toBeLessThan(1 / PPM);
    expect(Number(lines.mtm_dy_hi)).toBeLessThan(Number(lines.mtm_dy_lo));
    expect(lines.htm_marked).toBe(lines.htm_unmarked);
    expect(lines.bond_zero_dy).toBe("50000");
  });

  it("reproduces the Bend audit word and the other stream ids", () => {
    const word = rawWord(42, STREAM.portfolio, 0, 2027, 0);
    expect(lines.draw_hi).toBe(String(word.hi));
    expect(lines.draw_lo).toBe("1420824054");
    expect(word.hi).toBe(2_195_427_346);
    expect(rawWord(42, STREAM.rates, 0, 2027, 0).hi).not.toBe(word.hi);
    expect(rawWord(42, STREAM.credit, 0, 2027, 0).lo).not.toBe(rawWord(42, STREAM.idio, 0, 2027, 0).lo);
  });

  it("keeps trade-sheet rounding inside the capital", () => {
    expect(Number(lines.trade_spent) + Number(lines.trade_left)).toBe(300_000);
    expect(Number(lines.trade_spent)).toBeLessThanOrEqual(300_000);
    expect(Number(lines.trade_two_spent) + Number(lines.trade_two_left)).toBe(300_000);
    expect(Number(lines.trade_bond_spent) + Number(lines.trade_bond_left)).toBe(20_000);
    expect(lines.weight_sum).toBe(String(PPM));
    expect(Number(lines.range_low)).toBeLessThanOrEqual(Number(lines.range_high));
    expect(Number(lines.range_low)).toBeGreaterThanOrEqual(0);
  });
});
