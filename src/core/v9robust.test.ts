/**
 * V9 numerical robustness, convergence lab, and out-of-sample checks.
 * Day-count pins and the curve/GARCH fallbacks fail if those paths are removed.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runUntilStandardError, samplerErrorCurve } from "./convergence";
import { teachingAssumptions } from "./defaults";
import { effectiveSampleSize } from "./ess";
import {
  WINS_SETTLEMENT,
  accruedAtSettlement,
  accruedInterest,
  actActIcma,
  thirty360Period,
} from "./instruments";
import { fitCurveRobust, fitNelsonSiegel } from "./nelson";
import { conditionalSigma, fitGarch } from "./risk/vol";
import { varBacktestSummary, walkForwardRange } from "./validationReport";

const PREV = "2026-02-15";
const MID = "2026-05-15";
const NEXT = "2026-08-15";

describe("dated day counts", () => {
  it("uses ACT/ACT 89/181 and 30/360 90/180 on the May settlement", () => {
    const act = actActIcma(PREV, MID, NEXT);
    const corp = thirty360Period(PREV, MID, NEXT);
    expect(act.elapsed).toBe(89);
    expect(act.period).toBe(181);
    expect(act.fraction).toBeCloseTo(89 / 181, 12);
    expect(corp.elapsed).toBe(90);
    expect(corp.period).toBe(180);
    expect(corp.fraction).toBeCloseTo(90 / 180, 12);
    const treasury = accruedAtSettlement({
      coupon: 0.025,
      face: 100,
      prevCoupon: PREV,
      settle: MID,
      nextCoupon: NEXT,
      convention: "act_act",
    });
    const corporate = accruedAtSettlement({
      coupon: 0.02,
      face: 100,
      prevCoupon: PREV,
      settle: MID,
      nextCoupon: NEXT,
      convention: "thirty_360",
    });
    expect(treasury.exCoupon).toBe(false);
    expect(treasury.accrued).toBeCloseTo((0.025 / 2) * 100 * (89 / 181), 10);
    expect(corporate.accrued).toBeCloseTo((0.02 / 2) * 100 * (90 / 180), 10);
    expect(treasury.dirtyFromClean(99)).toBeCloseTo(99 + treasury.accrued, 10);
    expect(corporate.dirtyFromClean(corporate.accrued * 0 + 101) - 101).toBeCloseTo(corporate.accrued, 10);
  });

  it("accrues a negative amount inside the ex-coupon window", () => {
    const quote = accruedAtSettlement({
      coupon: 0.02,
      face: 100,
      prevCoupon: PREV,
      settle: "2026-08-12",
      nextCoupon: NEXT,
      convention: "act_act",
      exCouponDays: 7,
    });
    expect(quote.exCoupon).toBe(true);
    expect(quote.fraction).toBeCloseTo(-3 / 181, 12);
    expect(quote.accrued).toBeLessThan(0);
    expect(quote.dirtyFromClean(100)).toBeLessThan(100);
    const corp = accruedAtSettlement({
      coupon: 0.02,
      face: 100,
      prevCoupon: PREV,
      settle: "2026-08-12",
      nextCoupon: NEXT,
      convention: "thirty_360",
      exCouponDays: 7,
    });
    expect(corp.fraction).toBeCloseTo(-3 / 180, 12);
    expect(corp.accrued).toBeLessThan(0);
  });

  it("prices the illustrative WInS settlement without changing the tenor accrued identity", () => {
    expect(WINS_SETTLEMENT).toBe("2026-02-20");
    const quote = accruedAtSettlement({
      coupon: 0.025,
      face: 100,
      prevCoupon: PREV,
      settle: WINS_SETTLEMENT,
      nextCoupon: NEXT,
      convention: "act_act",
    });
    expect(quote.elapsed).toBe(5);
    expect(quote.period).toBe(181);
    expect(quote.accrued).toBeGreaterThan(0);
    expect(accruedInterest(0.04, 2, 100)).toBe(0);
  });
});

describe("curve and GARCH fallbacks", () => {
  it("falls back to a flat median when Nelson-Siegel does not converge", () => {
    const singular = [
      { tenor: 2, zero: 0.03 },
      { tenor: 2, zero: 0.05 },
      { tenor: 2, zero: 0.04 },
    ];
    expect(fitNelsonSiegel(singular)).toBeNull();
    const robust = fitCurveRobust(singular);
    expect(robust.ok).toBe(false);
    expect(robust.fallback).toBe("median-flat");
    expect(robust.flag).toMatch(/did not converge/);
    expect(robust.curve?.beta0).toBeCloseTo(0.04, 10);
    expect(robust.curve?.beta1).toBe(0);
    const empty = fitCurveRobust([{ tenor: 1, zero: Number.NaN }]);
    expect(empty.ok).toBe(false);
    expect(empty.curve).toBeNull();
    expect(empty.flag).toMatch(/no finite zero/);
    const ok = fitCurveRobust([
      { tenor: 1, zero: 0.02 },
      { tenor: 5, zero: 0.03 },
      { tenor: 10, zero: 0.035 },
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.fallback).toBeNull();
    expect(ok.flag).toBeNull();
  });

  it("does not throw on empty, non-finite, or huge returns and flags the EWMA fallback", () => {
    expect(() => fitGarch([])).not.toThrow();
    expect(conditionalSigma([]).flag).toMatch(/EWMA/);
    expect(conditionalSigma([]).source).toBe("ewma");
    const dirty = Array.from({ length: 40 }, () => Number.NaN);
    expect(fitGarch(dirty).ok).toBe(false);
    expect(conditionalSigma(dirty).flag).toMatch(/EWMA/);
    const huge = Array.from({ length: 40 }, () => 1e308);
    expect(fitGarch(huge).ok).toBe(false);
    expect(conditionalSigma(huge).source).toBe("ewma");
    const calm = Array.from({ length: 40 }, () => 0.001);
    const calmFit = conditionalSigma(calm);
    expect(calmFit.source === "garch" || calmFit.flag !== null).toBe(true);
    fc.assert(
      fc.property(fc.array(fc.double({ noDefaultInfinity: false, noNaN: false, min: -1e6, max: 1e6 }), { maxLength: 36 }), (values) => {
        const fit = fitGarch(values);
        const vol = conditionalSigma(values);
        expect(vol.sigma).toHaveLength(values.length);
        if (!fit.ok) expect(vol.flag && vol.flag.length > 0).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

describe("convergence lab", () => {
  it("stops at the minimum sample when the target standard error is huge", () => {
    const stopped = runUntilStandardError(teachingAssumptions(), 1e9, { maxTrials: 50 });
    expect(stopped.trials).toBe(50);
    expect(stopped.stopped).toBe(true);
    expect(stopped.standardError).toBeGreaterThan(0);
    expect(stopped.flag).toBeNull();
  });

  it("reports a standard error for each sampler on the sizes it is given", () => {
    const curve = samplerErrorCurve(teachingAssumptions(), [50, 100]);
    expect(curve.map((row) => row.sampler)).toEqual([
      "pseudo",
      "pseudo",
      "antithetic",
      "antithetic",
      "sobol",
      "sobol",
    ]);
    for (const row of curve) {
      expect(row.standardError).toBeGreaterThan(0);
      expect(Number.isFinite(row.mean)).toBe(true);
    }
    expect(curve.filter((row) => row.trials === 100)).toHaveLength(3);
    expect(curve.filter((row) => row.trials === 50)).toHaveLength(3);
  });

  it("shrinks the effective sample size when the series is strongly dependent", () => {
    const calm = Array.from({ length: 80 }, () => 1);
    expect(effectiveSampleSize(calm)).toBe(80);
    const trend = Array.from({ length: 200 }, (_, index) => index);
    expect(effectiveSampleSize(trend)).toBeLessThan(40);
    expect(effectiveSampleSize([])).toBeNaN();
  });
});

describe("out-of-sample validation", () => {
  it("covers a constant history and misses a crash that sits outside the band", () => {
    const calm = walkForwardRange(Array.from({ length: 48 }, () => 0.0004), 4);
    expect(calm.coverage).toBe(1);
    expect(calm.statedBand).toBe("p10-p90");
    expect(calm.origins).toBeGreaterThan(0);
    const crashed = Array.from({ length: 48 }, (_, index) => (index >= 32 ? -0.2 : 0.0004));
    const scored = walkForwardRange(crashed, 4);
    expect(scored.coverage).not.toBeNull();
    expect(scored.coverage as number).toBeLessThan(1);
    expect(walkForwardRange([0.01, 0.02], 4).coverage).toBeNull();
  });

  it("counts Kupiec passes and leaves short names out of the pass total", () => {
    const summary = varBacktestSummary([
      { ticker: "A", next: { var95: { pValue: 0.4 }, var99: { pValue: 0.2 } } },
      { ticker: "B", next: { var95: { pValue: 0.01 }, var99: { pValue: 0.9 } } },
      { ticker: "C", next: null },
    ]);
    expect(summary.names).toBe(3);
    expect(summary.scored).toBe(2);
    expect(summary.tooShort).toBe(1);
    expect(summary.pass95).toBe(1);
    expect(summary.pass99).toBe(2);
    expect(summary.note).toMatch(/not a recommendation/i);
  });
});
