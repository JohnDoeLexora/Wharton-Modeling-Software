import { describe, expect, it } from "vitest";
import { satelliteCatalog } from "./basket";
import { bondTotalReturn } from "./bonds";
import { newSleeve, zeroAssumptions } from "./defaults";
import { projectionsCsv } from "./exportData";
import { effectiveN, studentT } from "./equity";
import { migrateAssumptions } from "./migrate";
import { wealthInYear } from "./project";
import { applyRegimeTemplate, templateParams, zeroRateParams } from "./rates";
import { fundingByRegime, fundingForParams } from "./regimeReserve";
import { runModel } from "./run";
import { assumptionsForSweep, buildSweepSpecs, runSweepSpec } from "./sweep";
import type { Assumptions, Sleeve } from "./types";

function book(sleeve: Sleeve, rates?: Partial<Assumptions["rates"]>): Assumptions {
  const assumptions = zeroAssumptions();
  assumptions.sleeves = [sleeve];
  assumptions.glide = [{ year: 2027, weights: [1] }];
  assumptions.correlation = [[1]];
  assumptions.trials = 50;
  assumptions.seed = 42;
  assumptions.rates = { ...assumptions.rates, ...rates };
  return assumptions;
}

describe("bond pricing identities", () => {
  it("returns the carry when the yield does not change", () => {
    const parts = bondTotalReturn({ yieldPrev: 0.04, yieldNext: 0.04, duration: 16, convexity: 280 });
    expect(parts.price).toBeCloseTo(0, 12);
    expect(parts.mtm).toBeCloseTo(0.04, 12);
    expect(parts.htm).toBeCloseTo(0.04, 12);
  });

  it("prices a long bond near duration times the yield change, and a bill much less", () => {
    const long = bondTotalReturn({ yieldPrev: 0, yieldNext: 0.01, duration: 15, convexity: 0 });
    const bill = bondTotalReturn({ yieldPrev: 0, yieldNext: 0.01, duration: 0.4, convexity: 0 });
    expect(long.mtm).toBeCloseTo(-0.15, 12);
    expect(bill.mtm).toBeCloseTo(-0.004, 12);
    expect(Math.abs(bill.price)).toBeLessThan(Math.abs(long.price) / 10);
  });

  it("earns the short yield on a flat path and loses about D·dy when the rising template moves", () => {
    const flatSleeve = book(
      { ...newSleeve("bill", "Bills"), kind: "tbill", duration: 0.4, convexity: 0 },
      { regime: "flat", r0: 0.04, kappa: 0, sigma: 0 },
    );
    const flatOut = runModel(flatSleeve);
    expect(flatOut.errors).toEqual([]);
    expect(flatOut.scenarios.base?.find((point) => point.calendarYear === 2027)?.yearReturn).toBeCloseTo(0.04, 8);
    expect(flatOut.views.sleeves[0].htm2027).toBeCloseTo(0.04, 8);
    expect(flatOut.views.sleeves[0].price2027).toBeCloseTo(0, 8);

    const rising = book(
      { ...newSleeve("long", "Long"), kind: "long_treasury", duration: 15, convexity: 0 },
      { regime: "rising", r0: 0, kappa: 0, theta: 0, sigma: 0, driftPerYear: 0.01, driftYears: 3 },
    );
    const longOut = runModel(rising);
    expect(longOut.errors).toEqual([]);
    expect(longOut.scenarios.base?.find((point) => point.calendarYear === 2027)?.yearReturn).toBeCloseTo(-0.15, 8);

    const billRising = book(
      { ...newSleeve("bill", "Bills"), kind: "tbill", duration: 0.4, convexity: 0 },
      { regime: "rising", r0: 0, kappa: 0, theta: 0, sigma: 0, driftPerYear: 0.01, driftYears: 3 },
    );
    const billOut = runModel(billRising);
    expect(billOut.scenarios.base?.find((point) => point.calendarYear === 2027)?.yearReturn).toBeCloseTo(-0.004, 8);
  });
});

describe("schema 3 behavior that version 2 left parametric", () => {
  it("keeps the locked 450,000 path when a parametric book is shown a rising regime", () => {
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    const templated = applyRegimeTemplate(assumptions.rates, assumptions.equity, "rising");
    assumptions.rates = { ...templated.rates, driftPerYear: 0.02, driftYears: 5 };
    assumptions.equity = templated.equity;
    const output = runModel(assumptions);
    expect(output.errors).toEqual([]);
    expect(output.schemaVersion).toBe(3);
    expect(wealthInYear(output.scenarios.base ?? [], 2033)).toBe(450_000);
    expect(output.scenarios.base?.[0].wealthStartHtm).toBe(output.scenarios.base?.[0].wealthStart);
  });

  it("repeats a sample and keeps common random numbers across mixes", () => {
    const assumptions = book(newSleeve("only", "Only", 0.05, 0.12, 0.05, 0.05, 0.05));
    assumptions.mixes = [
      { id: "a", name: "Same book", weights2027: [1], weights2033: [1] },
      { id: "b", name: "Same book again", weights2027: [1], weights2033: [1] },
    ];
    const first = runModel(assumptions);
    const second = runModel(assumptions);
    expect(first.errors).toEqual([]);
    expect(first.monteCarlo?.wealth2033).toEqual(second.monteCarlo?.wealth2033);
    expect(first.mixes[0].p50).toBe(first.mixes[1].p50);
    expect(first.mixes[0].p50).toBe(first.metrics?.wealthPercentiles["50"]);
    const alone = runModel({ ...assumptions, mixes: [] });
    expect(alone.monteCarlo?.wealth2033).toEqual(first.monteCarlo?.wealth2033);
  });

  it("migrates a version-2 object onto parametric sleeves, a flat zero curve, and a zero-weight catalog", () => {
    const migrated = migrateAssumptions({
      schemaVersion: 2,
      schema: 2,
      tag: "edited",
      sleeves: [{ id: "growth", name: "Growth", mu: 0, sigma: 0, base: 0, bull: 0, bear: 0 }],
      glide: [{ year: 2027, weights: [1] }],
      correlation: [[1]],
      trials: 50,
      seed: 11,
    });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.schema).toBe(3);
    expect(migrated.sleeves[0].kind).toBe("parametric");
    expect(migrated.rates).toEqual(zeroRateParams());
    expect(migrated.basket.length).toBeGreaterThanOrEqual(60);
    expect(migrated.basket.every((name) => name.weight === 0)).toBe(true);
    for (const ticker of ["EWT", "TSM", "GOOGL", "NFLX", "BRK-B", "XLU"]) {
      expect(migrated.basket.some((name) => name.ticker === ticker)).toBe(true);
    }
    expect(runModel(migrated).errors).toEqual([]);
    expect(wealthInYear(runModel(migrated).scenarios.base ?? [], 2033)).toBe(450_000);
  });

  it("labels satellite parameters as assumptions and reports effective N", () => {
    const catalog = satelliteCatalog();
    const tsm = catalog.find((name) => name.ticker === "TSM");
    const ewt = catalog.find((name) => name.ticker === "EWT");
    expect(tsm?.fxSigma).toBe(0.08);
    expect(tsm?.taiwan).toBe(true);
    expect(ewt?.expenseRatio).toBe(0.0059);
    expect(tsm?.assumptionNote.toLowerCase()).toContain("placeholder assumption");
    expect(tsm?.assumptionNote.toLowerCase()).toContain("not a forecast");
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    assumptions.basket = assumptions.basket.map((name) =>
      name.ticker === "TSM" || name.ticker === "AAPL" ? { ...name, weight: 1 } : name,
    );
    expect(effectiveN(assumptions.basket.map((name) => name.weight))).toBeCloseTo(2, 8);
    expect(runModel(assumptions).views.basketEffectiveN).toBeCloseTo(2, 8);
  });

  it("draws a finite, repeatable Student-t", () => {
    const first = studentT(7, 1, 0, 2027, 120, 5);
    const second = studentT(7, 1, 0, 2027, 120, 5);
    expect(first).toBe(second);
    expect(Number.isFinite(first)).toBe(true);
  });

  it("writes both wealth columns", () => {
    const csv = projectionsCsv(runModel(book(newSleeve("only", "Only"))));
    expect(csv.split("\n")[0]).toContain("wealth_start");
    expect(csv.split("\n")[0]).toContain("wealth_start_htm");
  });
});

describe("reserve funding under rate regimes", () => {
  it("sizes every method at 500,000 on a zero curve, and duration matching absorbs a 100bp shock better than bills", () => {
    const flat = fundingByRegime(zeroRateParams()).find((row) => row.regime === "flat");
    expect(flat?.short2033).toBeCloseTo(0, 10);
    expect(flat?.methods.every((method) => method.reserve === 500_000)).toBe(true);
    const matched = flat?.methods.find((method) => method.method === "duration_matched");
    const bills = flat?.methods.find((method) => method.method === "tbill_ladder");
    expect(matched?.shockFundedRatio).not.toBeNull();
    expect(bills?.shockFundedRatio).not.toBeNull();
    expect(Math.abs((matched?.shockFundedRatio ?? 0) - 1)).toBeLessThan(Math.abs((bills?.shockFundedRatio ?? 0) - 1));
  });

  it("discounts the rising template below the nominal 500,000", () => {
    const rising = fundingForParams(templateParams(zeroRateParams(), "rising"), "rising");
    expect(rising.short2033).toBeCloseTo(0.0225, 8);
    const nominal = rising.methods.find((method) => method.method === "nominal")?.reserve;
    const pv = rising.methods.find((method) => method.method === "pv_curve")?.reserve;
    expect(nominal).toBe(500_000);
    expect(pv).toBeLessThan(500_000);
  });
});

describe("sweep grid", () => {
  it("prices a credit sleeve in the credit family and finishes one spec", () => {
    const spec = buildSweepSpecs().find((row) => row.family === "credit_sleeve" && row.regime === "flat");
    expect(spec).toBeDefined();
    const assumptions = assumptionsForSweep(spec!, 50, 42);
    expect(assumptions.sleeves.map((sleeve) => sleeve.kind)).toEqual(["equity_index", "intermediate", "credit"]);
    const row = runSweepSpec(spec!, 50, 42);
    expect(row.errors).toBe("");
    expect(row.note.toLowerCase()).not.toContain("recommend");
    expect(row.p50).not.toBeNull();
  });
});
