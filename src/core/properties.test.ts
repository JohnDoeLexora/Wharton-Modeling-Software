import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { repairCovariance } from "./attribution";
import { zeroAssumptions } from "./defaults";
import { presentValue } from "./ladder";
import { pvAnnuityDue } from "./math";
import { runModel } from "./run";
import { emptyHoldings, stepYear } from "./yearStep";

function wealthAfter(bps: number, shock: number): number {
  const holdings = emptyHoldings(2);
  holdings.balances = [80, 20];
  const result = stepYear(holdings, {
    contribution: 0,
    policy: [0.5, 0.5],
    rebalance: "annual",
    transactionCostBps: bps,
    gainTaxRate: 0,
    returns: [shock, shock],
    returnsHtm: [shock, shock],
  });
  return result.balances.reduce((sum, value) => sum + value, 0);
}

describe("properties", () => {
  it("does not raise wealth when the rebalance cost rises", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 400, noNaN: true }), fc.double({ min: -0.4, max: 0.4, noNaN: true }), (bps, shock) => {
        const higher = bps + 25;
        expect(wealthAfter(higher, shock)).toBeLessThanOrEqual(wealthAfter(bps, shock) + 1e-8);
      }),
      { numRuns: 30 },
    );
  });

  it("does not raise wealth when the crash is deeper", () => {
    fc.assert(
      fc.property(fc.double({ min: -0.8, max: -0.01, noNaN: true }), (shock) => {
        expect(wealthAfter(0, shock - 0.05)).toBeLessThan(wealthAfter(0, shock));
      }),
      { numRuns: 20 },
    );
  });

  it("repeats a short run under the same seed", () => {
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    const left = runModel(assumptions);
    const right = runModel(assumptions);
    expect(left.masterSeed).toBe(assumptions.seed);
    expect(left.monteCarlo?.wealth2033).toEqual(right.monteCarlo?.wealth2033);
  });

  it("prices the reserve at the annuity-due formula", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.08, noNaN: true }), (yieldPerYear) => {
        expect(presentValue(yieldPerYear)).toBeCloseTo(pvAnnuityDue(50_000, 10, yieldPerYear), 6);
      }),
      { numRuns: 20 },
    );
  });

  it("rebuilds a covariance that is positive semidefinite", () => {
    fc.assert(
      fc.property(fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: 0.1, max: 3, noNaN: true }), (off, scale) => {
        const matrix = [
          [scale, off],
          [off, scale],
        ];
        const repaired = repairCovariance(matrix);
        const weights = [0.3, 0.7];
        let form = 0;
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) form += weights[i] * repaired.cov[i][j] * weights[j];
        }
        expect(form).toBeGreaterThanOrEqual(-1e-8);
      }),
      { numRuns: 25 },
    );
  });
});
