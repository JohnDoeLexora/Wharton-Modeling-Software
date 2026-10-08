import { describe, expect, it } from "vitest";
import { cholesky } from "./math";
import { jacobiEigen, minEigenvalue, prepareCorrelation } from "./correlation";
import { newSleeve, teachingAssumptions, zeroAssumptions } from "./defaults";
import { sha256Hex } from "./hash";
import { caseLiabilityPv, caseLiabilitySchedule } from "./liability";
import { assumptionsHash, createLedgerEntry, diffAssumptions } from "./ledger";
import { migrateAssumptions, migrateStoredWorkspace } from "./migrate";
import { buildRunPackage } from "./package";
import { mcSleeveReturns } from "./project";
import { reserveToImmunize, rollReserve, sizeShortfallReserve } from "./reserve";
import { STREAM, standardNormal, unitInterval } from "./rng";
import { runModel, simulateTwoYearWealth } from "./run";
import { runSensitivity } from "./sensitivity";
import { percentileSorted, simpleReturn } from "./math";
import type { Assumptions } from "./types";

function singleSleeve(rate: number, sigma = 0): Assumptions {
  const assumptions = zeroAssumptions();
  const baseSleeve = assumptions.sleeves[0];
  assumptions.sleeves = [{ ...baseSleeve, id: "only", name: "Only sleeve", mu: rate, sigma, base: rate, bull: rate, bear: rate }];
  assumptions.glide = [{ year: 2027, weights: [1] }];
  assumptions.correlation = [[1]];
  assumptions.trials = 50;
  assumptions.seed = 42;
  return assumptions;
}

describe("random streams", () => {
  it("draws a uniform in (0, 1) that does not depend on call order", () => {
    const first = unitInterval(42, STREAM.portfolio, 5, 2031, 1);
    unitInterval(1, 1, 0, 0, 0);
    const again = unitInterval(42, STREAM.portfolio, 5, 2031, 1);
    expect(again).toBe(first);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(1);
    expect(standardNormal(42, STREAM.portfolio, 0, 2033, 0)).not.toBe(standardNormal(42, STREAM.reserve, 0, 0, 0));
    expect(standardNormal(42, STREAM.portfolio, 0, 2031, 0)).not.toBe(standardNormal(42, STREAM.portfolio, 0, 2032, 0));
  });

  it("keeps trial 0 fixed when the trial count changes", () => {
    const small = singleSleeve(0.04, 0.18);
    small.trials = 50;
    const large = singleSleeve(0.04, 0.18);
    large.trials = 80;
    const a = runModel(small).monteCarlo!;
    const b = runModel(large).monteCarlo!;
    expect(b.wealth2033[0]).toBe(a.wealth2033[0]);
    expect(b.wealth2031[0]).toBe(a.wealth2031[0]);
    expect(b.wealth2033[0]).not.toBe(b.wealth2033[1]);
  });

  it("reuses portfolio-stream shocks for the conditional band under annual rebalancing", () => {
    const assumptions = singleSleeve(0.05, 0.22);
    assumptions.trials = 50;
    const output = runModel(assumptions);
    const forwardFromOwn = simulateTwoYearWealth(assumptions, output.monteCarlo!.wealth2031[0]);
    expect(forwardFromOwn[0]).toBeCloseTo(output.monteCarlo!.wealth2033[0], 6);
    expect(forwardFromOwn[4]).not.toBeCloseTo(output.monteCarlo!.wealth2033[4], 4);

    const two = zeroAssumptions();
    two.trials = 50;
    two.seed = 11;
    two.sleeves[0].mu = 0.08;
    two.sleeves[0].sigma = 0.15;
    two.sleeves[1].mu = 0.02;
    two.sleeves[1].sigma = 0.04;
    const paired = runModel(two);
    for (const trial of [0, 3, 9]) {
      const anchor = paired.monteCarlo!.wealth2031[trial];
      const forward = simulateTwoYearWealth(two, anchor);
      expect(forward[trial]).toBeCloseTo(paired.monteCarlo!.wealth2033[trial], 5);
    }
    expect(paired.streams.conditional).toContain("stream 1");
    expect(paired.streams.portfolio.id).toBe(STREAM.portfolio);
    expect(paired.streams.reserve.id).toBe(STREAM.reserve);
    const conditional = paired.facility!.ranges.find((range) => range.method === "conditional_mc")!;
    expect(conditional.detail).not.toMatch(/seed \d+ \+ 7/);
    expect(conditional.detail).toContain("stream 1");
    expect(paired.reserve.sizings.shortfall.message).toContain("stream 2");
  });

  it("matches sleeve shocks across calls and keeps drift from pretending balances were shared", () => {
    const assumptions = zeroAssumptions();
    assumptions.rebalance = "drift";
    assumptions.trials = 50;
    assumptions.sleeves[0].mu = 0.12;
    assumptions.sleeves[0].sigma = 0.2;
    assumptions.sleeves[1].mu = 0;
    assumptions.sleeves[1].sigma = 0.01;
    expect(mcSleeveReturns(assumptions, 2, 2031)).toEqual(mcSleeveReturns(assumptions, 2, 2031));
    const output = runModel(assumptions);
    expect(output.errors).toEqual([]);
    const anchor = output.monteCarlo!.wealth2031[0];
    const restarted = simulateTwoYearWealth(assumptions, anchor)[0];
    expect(Number.isFinite(restarted)).toBe(true);
    expect(Number.isFinite(output.monteCarlo!.wealth2033[0])).toBe(true);
  });
});

describe("correlation stress and repair", () => {
  it("leaves a PSD matrix unchanged when the stress is zero", () => {
    const matrix = [
      [1, 0.25],
      [0.25, 1],
    ];
    const report = prepareCorrelation(matrix, 0);
    expect(report.repaired).toBe(false);
    expect(report.ridged).toBe(false);
    expect(report.warning).toBeNull();
    expect(report.used).toEqual(matrix);
    expect(report.factor).not.toBeNull();
    const values = jacobiEigen(matrix).values.slice().sort((a, b) => a - b);
    expect(values[0]).toBeCloseTo(0.75, 8);
    expect(values[1]).toBeCloseTo(1.25, 8);
  });

  it("repairs a matrix that is not positive semidefinite and still runs the model", () => {
    const matrix = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ];
    expect(cholesky(matrix)).toBeNull();
    expect(minEigenvalue(matrix)).toBeLessThan(0);
    const report = prepareCorrelation(matrix, 0);
    expect(report.repaired).toBe(true);
    expect(report.warning).toMatch(/repaired/i);
    expect(report.factor).not.toBeNull();
    expect(report.used[0][0]).toBe(1);
    expect(minEigenvalue(report.used)).toBeGreaterThan(-1e-8);

    const assumptions = zeroAssumptions();
    assumptions.sleeves = [
      newSleeve("a", "A", 0.04, 0.1, 0.04, 0.04, 0.04),
      newSleeve("b", "B", 0.03, 0.08, 0.03, 0.03, 0.03),
      newSleeve("c", "C", 0.02, 0.05, 0.02, 0.02, 0.02),
    ];
    assumptions.glide = [{ year: 2027, weights: [1 / 3, 1 / 3, 1 / 3] }];
    assumptions.correlation = matrix;
    assumptions.trials = 50;
    const output = runModel(assumptions);
    expect(output.errors).toEqual([]);
    expect(output.correlation.repaired).toBe(true);
    expect(output.monteCarlo!.wealth2033.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("shifts off-diagonals by the stress and clips them", () => {
    const report = prepareCorrelation(
      [
        [1, 0.8],
        [0.8, 1],
      ],
      0.5,
    );
    expect(report.stressed[0][1]).toBeCloseTo(0.999, 8);
    expect(report.stressed[1][1]).toBe(1);
  });
});

describe("schema migration, ledger, and the run package", () => {
  it("hashes abc and an empty string with SHA-256", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("migrates a version-1 assumptions object onto schema 3", () => {
    const current = zeroAssumptions();
    const raw = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    delete raw.schemaVersion;
    delete raw.correlationStress;
    delete raw.shockModel;
    delete raw.bootstrapHistory;
    delete raw.blockLength;
    raw.schema = 1;
    const migrated = migrateAssumptions(raw);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.schema).toBe(3);
    expect(migrated.correlationStress).toBe(0);
    expect(migrated.shockModel).toBe("parametric");
    expect(migrated.blockLength).toBe(1);
    expect(migrated.bootstrapHistory).toEqual([]);
    expect(runModel(migrated).errors).toEqual([]);
    const stored = migrateStoredWorkspace({ v: 1, assumptions: raw, notes: [], ledger: [] });
    expect(stored.assumptions.schemaVersion).toBe(3);
    expect(stored.ledger).toEqual([]);
  });

  it("saves an immutable ledger row and diffs the seed", () => {
    const assumptions = zeroAssumptions();
    const output = runModel(assumptions);
    const entry = createLedgerEntry("Zero case", assumptions, output, "2026-10-02T12:00:00.000Z");
    assumptions.seed = 99;
    expect(entry.assumptions.seed).toBe(42);
    expect(entry.assumptionsHash).toBe(assumptionsHash(entry.assumptions));
    expect(entry.schemaVersion).toBe(3);
    const diff = diffAssumptions(entry.assumptions, assumptions);
    expect(diff.rows.some((row) => row.path === "seed")).toBe(true);
    expect(diff.rows.some((row) => row.path === "sleeves[0].mu")).toBe(false);
  });

  it("packs methodology, streams, and CSV without calling the result a recommendation", () => {
    const assumptions = zeroAssumptions();
    const output = runModel(assumptions);
    const pack = buildRunPackage(assumptions, output, [], "2026-10-02T00:00:00.000Z");
    expect(pack.packageVersion).toBe(1);
    expect(pack.software.version).toBe("4.0.0");
    expect(pack.assumptionsHash).toHaveLength(64);
    expect(pack.winsTradingPnlIncluded).toBe(false);
    expect(pack.finbertInProjection).toBe(false);
    expect(pack.methodology).toContain("Stream 1");
    expect(pack.methodology).toContain("Stream 2");
    expect(pack.methodology.toLowerCase()).toContain("not an investment recommendation");
    expect(pack.methodology.toLowerCase()).not.toContain("we recommend");
    expect(pack.csv.projections).toContain("wealth_start");
    expect(pack.liability.nominalSum).toBe(500_000);
    expect(pack.liability.inflationLinked).toBe(false);
    expect(pack.exportedAt).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("numerical hygiene", () => {
  it("prices the case liability at the published yields", () => {
    const schedule = caseLiabilitySchedule();
    expect(schedule.payments).toHaveLength(10);
    expect(schedule.payments[0].calendarYear).toBe(2033);
    expect(schedule.payments[9].calendarYear).toBe(2042);
    expect(schedule.payments[0].k).toBe(0);
    expect(caseLiabilityPv(0)).toBe(500_000);
    expect(caseLiabilityPv(0.03)).toBeCloseTo(439_305.44609395514, 6);
    expect(caseLiabilityPv(0.04)).toBeCloseTo(421_766.58052646136, 6);
    expect(caseLiabilityPv(0.05)).toBeCloseTo(405_391.08378220256, 6);
  });

  it("keeps a flat ladder funded near 1 across yields", () => {
    for (const yieldPerYear of [0, 0.01, 0.02, 0.03, 0.05, 0.1]) {
      const reserve = reserveToImmunize(Array(9).fill(yieldPerYear));
      const rows = rollReserve({
        initial: reserve,
        returnsBetween: Array(9).fill(yieldPerYear),
        discountYield: yieldPerYear,
      });
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(Number.isFinite(row.boyAssets)).toBe(true);
        expect(row.fundedRatio).toBeCloseTo(1, 6);
      }
      expect(rows[9].afterPayment).toBeCloseTo(0, 3);
    }
  });

  it("uses the Hyndman-Fan type 7 percentile", () => {
    expect(percentileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileSorted([1, 2, 3, 4], 1)).toBe(4);
    const sorted = [1, 2, 3, 4, 5];
    expect(percentileSorted(sorted, 0.25)).toBeLessThan(percentileSorted(sorted, 0.75));
  });

  it("keeps lognormal returns finite and above a total loss", () => {
    for (const mu of [-0.2, 0, 0.07]) {
      for (const sigma of [0, 0.1, 1]) {
        for (let z = -8; z <= 8; z += 0.5) {
          const value = simpleReturn(mu, sigma, z, "lognormal", -0.999);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(-1);
        }
      }
    }
    expect(Number.isFinite(simpleReturn(0.05, 2, 40, "lognormal", -0.999))).toBe(true);
    expect(simpleReturn(Number.NaN, 0.1, 0, "lognormal", -0.999)).toBeNaN();
  });

  it("reports a pathwise funded ratio of 1 when reserve volatility is zero", () => {
    const sized = sizeShortfallReserve({
      mu: 0.02,
      sigma: 0,
      target: 0.9,
      trials: 20,
      seed: 4,
      returnModel: "lognormal",
      normalFloor: -0.999,
      percentiles: [0.5],
    });
    expect(sized.pathwiseFundedRatio!.percentiles["50"]).toBeCloseTo(1, 6);
    expect(sized.pathwiseFundedRatio!.shareCovered).toBe(1);
    expect(sized.pathwiseFundedRatio!.examples[0].fundedRatio).toBeCloseTo(1, 6);
  });

  it("rejects a non-finite expected return instead of projecting it", () => {
    const assumptions = zeroAssumptions();
    assumptions.sleeves[0].mu = Number.NaN;
    const output = runModel(assumptions);
    expect(output.errors.length).toBeGreaterThan(0);
    expect(output.monteCarlo).toBeNull();
    expect(output.schemaVersion).toBe(3);
  });

  it("resamples only the typed history in a block bootstrap", () => {
    const assumptions = singleSleeve(0.2, 0.3);
    assumptions.shockModel = "block_bootstrap";
    assumptions.bootstrapHistory = [[0.1], [-0.05], [0.02]];
    assumptions.blockLength = 3;
    assumptions.trials = 50;
    const history = [0.1, -0.05, 0.02];
    for (let trial = 0; trial < 8; trial++) {
      const block = [2027, 2028, 2029].map((year) => mcSleeveReturns(assumptions, trial, year)[0]);
      expect(block.every((value) => history.includes(value))).toBe(true);
      const contiguous = history.some((_, start) => block.every((value, index) => value === history[(start + index) % 3]));
      expect(contiguous).toBe(true);
    }
    const output = runModel(assumptions);
    expect(output.errors).toEqual([]);
    expect(output.monteCarlo!.formula).toContain("stream 3");
    expect(output.monteCarlo!.wealth2033.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe("local sensitivity", () => {
  it("moves scenario wealth with the base return and Monte Carlo wealth with μ", () => {
    const assumptions = singleSleeve(0.05, 0);
    assumptions.trials = 50;
    assumptions.facility.rules[0].retainFraction = 0;
    assumptions.reserve.discountYield = 0;
    assumptions.facility.rangeMethod = "scenario_envelope";
    const report = runSensitivity(assumptions);
    const mu = report.factors.find((factor) => factor.id === "mu")!;
    const baseReturn = report.factors.find((factor) => factor.id === "scenarioBase")!;
    const yieldFactor = report.factors.find((factor) => factor.id === "discountYield")!;
    const glide = report.factors.find((factor) => factor.id === "glide")!;

    expect(mu.metrics.baseWealth2033.greek).toBeCloseTo(0, 4);
    expect(mu.metrics.mcP50Wealth2033.deltaUp!).toBeGreaterThan(1000);
    expect(baseReturn.metrics.baseWealth2033.up).toBeCloseTo(626_289.5703168003, 2);
    expect(baseReturn.metrics.baseWealth2033.down).toBeCloseTo(562_093.6409088001, 2);
    expect(baseReturn.metrics.mcP50Wealth2033.greek).toBeCloseTo(0, 2);
    expect(yieldFactor.metrics.baseWealth2033.greek).toBeCloseTo(0, 4);
    expect(yieldFactor.metrics.rangeHigh.deltaUp!).toBeGreaterThan(0);
    expect(glide.clamped).toBe(true);
    expect(report.formula).toContain("(V(x+h) − V(x−h)) / (2h)");
  });

  it("raises base-path wealth when the higher-return sleeve gains weight", () => {
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    assumptions.sleeves[0].base = 0.1;
    assumptions.sleeves[1].base = 0;
    const report = runSensitivity(assumptions);
    const glide = report.factors.find((factor) => factor.id === "glide")!;
    expect(glide.metrics.baseWealth2033.deltaUp!).toBeGreaterThan(0);
  });
});

describe("a few thousand trials stay finite", () => {
  it("finishes 5,000 two-sleeve trials with finite wealth", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 5000;
    const started = Date.now();
    const output = runModel(assumptions);
    const elapsed = Date.now() - started;
    expect(output.errors).toEqual([]);
    expect(output.monteCarlo!.wealth2033).toHaveLength(5000);
    expect(output.monteCarlo!.wealth2033.every((value) => Number.isFinite(value))).toBe(true);
    expect(elapsed).toBeLessThan(8000);
  });
});
