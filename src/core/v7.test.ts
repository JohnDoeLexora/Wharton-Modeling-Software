import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minEigenvalue, prepareCorrelation } from "./correlation";
import { teachingAssumptions, zeroAssumptions } from "./defaults";
import { trialsCsv, trialsParquetBytes } from "./exportData";
import { weightsAtYear } from "./glide";
import { censoredNormalMean, normalFloorAdjustment, normalizeSeed, pvAnnuityDue, simpleReturn } from "./math";
import { maxDrawdown } from "./metrics";
import { readTrialsParquet, trialsParquet } from "./parquet";
import { continueFromBalances, pathInputFrom, projectBook, projectPath, wealthInYear, type ReturnSchedule } from "./project";
import { DATA_AS_OF, FRENCH_SHA256, TREASURY_SHA256, provenanceStamp } from "./provenance";
import { standardNormal } from "./rng";
import { runModel } from "./run";
import { portfolioNormals } from "./shocks";
import { momentErrors, sobolPoint } from "./sobol";
import { stateCoverage } from "./stateRange";
import type { MarketState2031 } from "./types";
import { rebalanceCostFraction } from "./yearStep";

const LOCKED_FIVE_PERCENT = 593_470.9265625;

function scenarioBook(bps: number): ReturnType<typeof projectPath> {
  const assumptions = teachingAssumptions();
  assumptions.inflation = 0;
  assumptions.costs = { transactionCostBps: bps, gainTaxRate: 0, account: "untaxed" };
  return projectPath({ ...pathInputFrom(assumptions, 0), mode: "scenario", scenario: "base" });
}

function flatSchedule(first: number[], later: number[]): ReturnSchedule {
  const row = (offset: number) => (offset === 0 ? first.slice() : later.slice());
  return {
    mtm: Array.from({ length: 15 }, (_, offset) => row(offset)),
    htm: Array.from({ length: 15 }, (_, offset) => row(offset)),
    cash: Array(15).fill(null),
    price: Array.from({ length: 15 }, () => [0, 0]),
    rates: null,
  };
}

describe("V7 review regressions", () => {
  it("charges a flat glide on drifted weights, and a 100% cost wipes W2033", () => {
    const free = scenarioBook(0);
    const charged = scenarioBook(50);
    const wiped = scenarioBook(10_000);
    expect(wealthInYear(free, 2033)).toBeCloseTo(LOCKED_FIVE_PERCENT, 6);
    expect(wealthInYear(charged, 2033)).toBeLessThan(LOCKED_FIVE_PERCENT);
    expect(wealthInYear(wiped, 2033)).toBe(0);
    const year = charged.find((point) => point.calendarYear === 2028)!;
    expect(year.driftedWeights[0]).not.toBeCloseTo(year.policyWeights[0], 6);
    expect(year.rebalanceCostFraction).toBeGreaterThan(0);
    expect(year.rebalanceCostFraction).toBeCloseTo(
      rebalanceCostFraction(year.driftedWeights, year.policyWeights, 50),
      12,
    );
  });

  it("matches the 2031–2033 continuation to the full path under crash, cost, and a three-sleeve glide", () => {
    const assumptions = teachingAssumptions();
    assumptions.costs = { transactionCostBps: 40, gainTaxRate: 0, account: "untaxed" };
    assumptions.crashYear = 2032;
    assumptions.crashShock = -0.4;
    assumptions.sleeves = [
      assumptions.sleeves[0],
      assumptions.sleeves[1],
      { ...assumptions.sleeves[0], id: "third", name: "Third sleeve", mu: 0.04, sigma: 0.1, base: 0.04, bull: 0.08, bear: -0.02 },
    ];
    assumptions.correlation = [
      [1, 0.1, 0],
      [0.1, 1, 0.05],
      [0, 0.05, 1],
    ];
    assumptions.glide = [
      { year: 2027, weights: [0.5, 0.3, 0.2] },
      { year: 2033, weights: [0.2, 0.5, 0.3] },
    ];
    for (const trial of [0, 1, 4]) {
      const book = projectBook(pathInputFrom(assumptions, trial));
      const full = wealthInYear(book.points, 2033);
      const index = 2031 - 2027;
      expect(continueFromBalances(assumptions, book.startBalances[index], book.startBalancesHtm[index], trial)).toBe(full);
      const policy = weightsAtYear(assumptions.glide, 2031);
      const wealth = wealthInYear(book.points, 2031);
      const restarted = policy.map((weight) => weight * wealth);
      expect(continueFromBalances(assumptions, restarted, restarted.slice(), trial)).toBe(full);
    }

    assumptions.rebalance = "drift";
    const drifted = projectBook(pathInputFrom(assumptions, 0));
    const index = 2031 - 2027;
    const full = wealthInYear(drifted.points, 2033);
    expect(continueFromBalances(assumptions, drifted.startBalances[index], drifted.startBalancesHtm[index], 0)).toBe(full);
    const policy = weightsAtYear(assumptions.glide, 2031);
    const wealth = wealthInYear(drifted.points, 2031);
    const restarted = policy.map((weight) => weight * wealth);
    expect(continueFromBalances(assumptions, restarted, restarted.slice(), 0)).not.toBe(full);
  });

  it("keeps a non-finite continuation as NaN and discards the sample", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.crashYear = 2028;
    assumptions.crashShock = Number.NaN;
    const output = runModel(assumptions);
    expect(output.monteCarlo).toBeNull();
    expect(output.errors.join(" ")).toMatch(/discarded/);
    expect(output.errors.join(" ")).not.toMatch(/recorded as zero/);
    expect(continueFromBalances(assumptions, [Number.NaN, Number.NaN], [Number.NaN, Number.NaN], 0)).toBeNaN();
  });

  it("prices each trial's reserve on that trial's 2033 curve and keeps the fixed-yield ladder", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.reserve.discountMode = "trial_curve";
    assumptions.reserve.discountYield = 0.03;
    const output = runModel(assumptions);
    const ladder = pvAnnuityDue(50_000, 10, 0.03);
    expect(ladder).toBeCloseTo(439_305.44609395514, 4);
    expect(output.reserve.sizings.ladder.reserve).toBeCloseTo(ladder, 6);
    expect(output.monteCarlo!.reserve.every((value) => Math.abs(value - ladder) < 1e-6)).toBe(true);
    expect(output.monteCarlo!.gift[0]).toBeCloseTo(output.monteCarlo!.wealth2033[0] - ladder, 6);
    const funded = output.monteCarlo!.wealth2033.filter((wealth) => wealth + 1e-6 >= ladder).length / assumptions.trials;
    expect(output.metrics!.fullyFundedProbability).toBe(funded);
    expect(output.warnings.join(" ")).toMatch(/[Nn]o stochastic curve/);
    expect(output.metrics!.fundedDefinition).toMatch(/stochastic curve/);
    expect(output.trialCurve!.label).toMatch(/[Nn]o stochastic curve/);

    const stochastic = teachingAssumptions();
    stochastic.trials = 50;
    stochastic.reserve.discountMode = "trial_curve";
    stochastic.reserve.discountYield = 0.03;
    stochastic.rates.sigma = 0.01;
    stochastic.rates.kappa = 0.2;
    stochastic.rates.theta = 0.03;
    stochastic.rates.r0 = 0.03;
    const moving = runModel(stochastic);
    expect(moving.errors).toEqual([]);
    expect(moving.warnings).toEqual([]);
    expect(moving.metrics!.fundedDefinition).toMatch(/own 2033 curve/);
    expect(moving.trialCurve!.label).toMatch(/own 2033 curve/);
    expect(moving.trialCurve!.label).toMatch(/not this hurdle/);

    assumptions.reserve.discountMode = "fixed_yield";
    const fixed = runModel(assumptions);
    expect(fixed.monteCarlo!.reserve.every((value) => value === fixed.reserve.active.reserve)).toBe(true);
    expect(fixed.trialCurve!.mode).toBe("fixed_yield");
    expect(fixed.trialCurve!.label).toMatch(/One discount yield/);
    expect(fixed.metrics!.fundedDefinition).toMatch(/fixed reserve/);
  });

  it("reports batch-means standard errors on every headline, including the shortfall reserve", () => {
    const base = teachingAssumptions();
    base.reserve.discountMode = "fixed_yield";
    base.reserve.method = "shortfall";
    base.reserve.shortfallSigma = 0.04;
    const small = runModel({ ...base, trials: 200 });
    const large = runModel({ ...base, trials: 800 });
    for (const output of [small, large]) {
      const convergence = output.metrics!.convergence;
      for (const value of [
        convergence.standardErrorMean,
        convergence.standardErrorFunded,
        convergence.standardErrorCvar,
        convergence.standardErrorP5,
        convergence.standardErrorP50,
        convergence.standardErrorP95,
        convergence.standardErrorMaxDrawdown,
        convergence.standardErrorSharpe,
        convergence.standardErrorReserve,
      ]) {
        expect(value).not.toBeNull();
        expect(Number.isFinite(value as number)).toBe(true);
      }
    }
    const seSmall = small.metrics!.convergence.standardErrorMean * Math.sqrt(200);
    const seLarge = large.metrics!.convergence.standardErrorMean * Math.sqrt(800);
    expect(seLarge / seSmall).toBeGreaterThan(0.35);
    expect(seLarge / seSmall).toBeLessThan(2.8);
    const reserveSmall = small.metrics!.convergence.standardErrorReserve!;
    const reserveLarge = large.metrics!.convergence.standardErrorReserve!;
    expect(reserveSmall).toBeGreaterThan(0);
    expect(reserveLarge).toBeGreaterThan(0);
    expect(reserveLarge).toBeLessThan(reserveSmall);
    expect(small.metrics!.convergence.note).toMatch(/batch means/i);
  });

  it("rejects seeds that are not integers in range instead of colliding on 42", () => {
    expect(() => normalizeSeed(-42)).toThrow(/not run as seed 42/);
    expect(() => normalizeSeed(42.9)).toThrow(/not rounded/);
    expect(() => normalizeSeed(2 ** 32 + 42)).toThrow(/not wrapped/);
    const messages = [-42, 42.9, 2 ** 32 + 42].map((seed) => {
      const assumptions = teachingAssumptions();
      assumptions.trials = 50;
      assumptions.seed = seed;
      const output = runModel(assumptions);
      expect(output.monteCarlo).toBeNull();
      return output.errors.join(" ");
    });
    expect(messages[0]).toMatch(/-42/);
    expect(messages[0]).toMatch(/not run as seed 42/);
    expect(messages[1]).toMatch(/42\.9/);
    expect(messages[1]).toMatch(/not rounded/);
    expect(messages[2]).toMatch(/4294967338/);
    expect(messages[2]).toMatch(/not wrapped/);
    expect(new Set(messages).size).toBe(3);
  });

  it("refuses a correlation that cannot be factored unless Higham repair is requested", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.sleeves = [
      assumptions.sleeves[0],
      assumptions.sleeves[1],
      { ...assumptions.sleeves[0], id: "third", name: "Third sleeve" },
    ];
    assumptions.glide = [
      { year: 2027, weights: [0.5, 0.3, 0.2] },
      { year: 2033, weights: [0.5, 0.3, 0.2] },
    ];
    assumptions.correlation = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ];
    assumptions.correlationRepair = "none";
    const refused = runModel(assumptions);
    expect(refused.monteCarlo).toBeNull();
    expect(refused.errors.join(" ")).toMatch(/Independent draws were not substituted/);
    expect(Number.isNaN(wealthInYear(projectPath(pathInputFrom(assumptions, 3)), 2033))).toBe(true);

    const stressed = prepareCorrelation(
      [
        [1, 0.8],
        [0.8, 1],
      ],
      0.5,
    );
    expect(stressed.used[0][1]).toBeCloseTo(0.9, 8);
    expect(stressed.signPreserved).toBe(true);
    const negative = prepareCorrelation(
      [
        [1, -0.3],
        [-0.3, 1],
      ],
      0.3,
    );
    expect(negative.used[0][1]).toBeCloseTo(-0.51, 8);
    expect(negative.used[0][1]).toBeLessThan(0);
    expect(negative.factor).not.toBeNull();

    assumptions.correlationRepair = "higham";
    const repaired = runModel(assumptions);
    expect(repaired.errors).toEqual([]);
    expect(repaired.monteCarlo!.wealth2033.every((value) => Number.isFinite(value))).toBe(true);
    expect(minEigenvalue(repaired.correlation.used)).toBeGreaterThan(-1e-8);
    expect(repaired.correlation.repaired).toBe(true);
  });

  it("labels the normal-floor bias and puts the censored mean back on μ", () => {
    const mu = 0.05;
    const sigma = 0.25;
    const floor = -0.2;
    const adjustment = normalFloorAdjustment(mu, sigma, floor);
    expect(adjustment.bias).toBeGreaterThan(0.001);
    expect(censoredNormalMean(adjustment.location, sigma, floor)).toBeCloseTo(mu, 6);
    let raw = 0;
    let corrected = 0;
    const count = 4_000;
    for (let trial = 0; trial < count; trial++) {
      const z = standardNormal(7, 1, trial, 2027, 0);
      raw += simpleReturn(mu, sigma, z, "normal", floor, false);
      corrected += simpleReturn(mu, sigma, z, "normal", floor, true);
    }
    expect(raw / count).toBeGreaterThan(mu + adjustment.bias * 0.5);
    expect(Math.abs(corrected / count - mu)).toBeLessThan(Math.abs(raw / count - mu));
    expect(Math.abs(corrected / count - mu)).toBeLessThan(0.015);

    const assumptions = zeroAssumptions();
    assumptions.trials = 80;
    assumptions.returnModel = "normal";
    assumptions.normalFloor = floor;
    assumptions.correctNormalFloor = true;
    assumptions.sleeves[0] = { ...assumptions.sleeves[0], mu, sigma, base: mu, bull: mu, bear: mu };
    assumptions.sleeves[1] = { ...assumptions.sleeves[1], mu: 0.01, sigma: 0.02, base: 0.01, bull: 0.01, bear: 0.01 };
    const output = runModel(assumptions);
    expect(output.metrics!.normalFloorBias).toBeCloseTo(normalFloorAdjustment(mu, sigma, floor).bias, 8);
    expect(output.metrics!.normalFloorCorrected).toBe(true);
  });

  it("measures max drawdown on the unit NAV, so a contribution cannot hide a loss", () => {
    const assumptions = zeroAssumptions();
    assumptions.inflation = 0;
    assumptions.costs = { transactionCostBps: 100, gainTaxRate: 0, account: "untaxed" };
    const path = projectPath(pathInputFrom(assumptions, 0), flatSchedule([-0.25, -0.25], [0, 0]));
    expect(path[0].contributionCost).toBeGreaterThan(0);
    expect(path[0].nav).toBeCloseTo(0.75, 10);
    expect(path[1].wealthStart).toBeGreaterThan(path[0].wealthStart);
    expect(maxDrawdown(path)).toBeCloseTo(0.25, 10);
    const terminal = path.find((point) => point.calendarYear === 2042)!;
    expect(terminal.rebalanceCostFraction).toBe(0);
    const uneven = flatSchedule([0.4, -0.1], [0.2, 0]);
    const drifted = projectPath(
      { ...pathInputFrom({ ...assumptions, costs: { transactionCostBps: 100, gainTaxRate: 0, account: "untaxed" } }, 0), mode: "scenario" },
      uneven,
    );
    const last = drifted.find((point) => point.calendarYear === 2042)!;
    expect(last.rebalanceCostFraction).toBeGreaterThan(0);
    expect(last.twr).toBeCloseTo(-last.rebalanceCostFraction, 12);
    expect(last.nav).toBeLessThan(drifted.find((point) => point.calendarYear === 2041)!.nav);
  });

  it("scores mixes on one return schedule and reports a paired difference", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.reserve.discountMode = "fixed_yield";
    assumptions.mixes = [
      { id: "same", name: "Same glide", weights2027: [0.5, 0.5], weights2033: [0.5, 0.5] },
      { id: "other", name: "Other glide", weights2027: [0.8, 0.2], weights2033: [0.2, 0.8] },
      { id: "bad", name: "Bad weights", weights2027: [0.9, 0.9], weights2033: [0.5, 0.5] },
    ];
    const output = runModel(assumptions);
    expect(output.mixes[0].p50).toBe(output.metrics!.wealthPercentiles["50"]);
    expect(output.mixes[0].pairedMeanDiff).toBe(0);
    expect(output.mixes[0].pairedSe).toBe(0);
    expect(output.mixes[1].pairedMeanDiff).not.toBe(0);
    expect(output.mixes[1].pairedSe).toBeGreaterThan(0);
    expect(output.mixes[2].error).toMatch(/sum to 1/);
    expect(output.mixes[2].p50).toBeNull();
    const book = projectBook(pathInputFrom(assumptions, 0));
    expect(output.monteCarlo!.wealth2033[0]).toBe(wealthInYear(book.points, 2033));
  });

  it("draws antithetic shocks as negations and shrinks the Sobol second-moment error", () => {
    const even = portfolioNormals({ seed: 42, sampling: "antithetic", trial: 2, year: 2027, sleeveCount: 2 });
    const odd = portfolioNormals({ seed: 42, sampling: "antithetic", trial: 3, year: 2027, sleeveCount: 2 });
    expect(odd[0]).toBe(-even[0]);
    expect(odd[1]).toBe(-even[1]);
    const point = sobolPoint(0, 4, 0, false);
    expect(point[0]).toBeCloseTo(0.5 + 0.5 / 2 ** 32, 8);
    expect(point[1]).toBeGreaterThan(0);
    expect(point[1]).toBeLessThan(1);
    const small = Math.abs(momentErrors(3, 128).sobol);
    const large = Math.abs(momentErrors(3, 2048).sobol);
    expect(large).toBeLessThan(small);
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    assumptions.sampling = "sobol";
    assumptions.diagnostics = { samplerComparison: true };
    assumptions.sleeves = assumptions.sleeves.map((sleeve, index) =>
      index === 0 ? { ...sleeve, mu: 0.05, sigma: 0.1, base: 0.05 } : { ...sleeve, mu: 0.01, sigma: 0.02, base: 0.01 },
    );
    const output = runModel(assumptions);
    expect(output.errors).toEqual([]);
    expect(output.monteCarlo!.wealth2033.every((value) => Number.isFinite(value))).toBe(true);
    expect(output.samplerComparison!.note).toMatch(/Sobol/);
    expect(Math.abs(output.samplerComparison!.sobolError)).toBeLessThan(Math.abs(output.samplerComparison!.pseudoError) + 0.05);
  });

  it("scores a 2031 state band out of sample and reports a binomial interval", () => {
    const states: MarketState2031[] = [];
    const wealth: number[] = [];
    for (let trial = 0; trial < 40; trial++) {
      states.push({
        trial,
        wealth: 100,
        balances: [50, 50],
        weights: [0.5, 0.5],
        driftedWeights: [0.5, 0.5],
        shortRate: 0.01,
      });
      wealth.push(trial % 2 === 0 ? 100 : 1_000);
    }
    const report = stateCoverage(states, wealth);
    expect(report.coverage).toBe(0);
    expect(report.coverageSe).toBe(0);
    expect(report.coverageLow).toBe(0);
    expect(report.coverageHigh).toBe(0);
    expect(report.note).toMatch(/Even trials/);

    for (let trial = 0; trial < 40; trial++) {
      states[trial].shortRate = trial % 4 < 2 ? 0.01 : 0.03;
      wealth[trial] = 100 + (trial % 7) * 10;
    }
    const mixed = stateCoverage(states, wealth);
    expect(mixed.coverage).not.toBeNull();
    expect(mixed.coverageLow).toBeCloseTo(Math.max(0, mixed.coverage! - 1.96 * mixed.coverageSe!), 8);
    expect(mixed.coverageHigh).toBeCloseTo(Math.min(1, mixed.coverage! + 1.96 * mixed.coverageSe!), 8);
  });

  it("leaves nominal wealth unchanged at zero inflation risk and taxes only a taxable gain", () => {
    const calm = teachingAssumptions();
    calm.inflation = 0.02;
    calm.inflationSigma = 0;
    calm.inflationBeta = 0;
    const noisy = teachingAssumptions();
    noisy.inflation = 0.02;
    noisy.inflationSigma = 0.03;
    noisy.inflationBeta = 0.4;
    const calmPath = projectPath(pathInputFrom(calm, 0));
    const noisyPath = projectPath(pathInputFrom(noisy, 0));
    expect(wealthInYear(noisyPath, 2033)).toBe(wealthInYear(calmPath, 2033));
    const row = calmPath.find((point) => point.calendarYear === 2033)!;
    expect(row.realWealthStart).toBeCloseTo(row.wealthStart / 1.02 ** 7, 8);
    expect(noisyPath.find((point) => point.calendarYear === 2033)!.realWealthStart).not.toBeCloseTo(row.realWealthStart, 4);

    const taxed = zeroAssumptions();
    taxed.sleeves = taxed.sleeves.map((sleeve) => ({ ...sleeve, base: 0.1, bull: 0.1, bear: 0.1, mu: 0.1 }));
    taxed.costs = { transactionCostBps: 0, gainTaxRate: 0.25, account: "taxable" };
    const untaxed = projectPath({ ...pathInputFrom({ ...taxed, costs: { ...taxed.costs, account: "untaxed" } }, 0), mode: "scenario", scenario: "base" });
    const afterTax = projectPath({ ...pathInputFrom(taxed, 0), mode: "scenario", scenario: "base" });
    expect(wealthInYear(afterTax, 2028)).toBeLessThan(wealthInYear(untaxed, 2028));
    expect(wealthInYear(untaxed, 2027)).toBe(300_000);
  });

  it("round-trips a per-trial Parquet file and stamps provenance on the CSV", () => {
    const bytes = trialsParquet(
      [
        { name: "trial", type: "int32", values: [0, 1, 2] },
        { name: "wealth_2033", type: "double", values: [10.5, 20.25, 30] },
      ],
      { seed: "42", version: "8.0.0", data_as_of: DATA_AS_OF },
    );
    const read = readTrialsParquet(bytes);
    expect(read.columns.map((column) => column.name)).toEqual(["trial", "wealth_2033"]);
    expect(read.columns[0].values).toEqual([0, 1, 2]);
    expect(read.columns[1].values[1]).toBeCloseTo(20.25, 10);
    expect(read.metadata.seed).toBe("42");
    expect(read.metadata.version).toBe("8.0.0");
    expect(read.metadata.data_as_of).toBe(DATA_AS_OF);

    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.diagnostics = { samplerComparison: true };
    const output = runModel(assumptions);
    const csv = trialsCsv(output);
    expect(csv.split("\n")[0]).toContain("wealth_2033");
    expect(csv).toContain(String(output.masterSeed));
    expect(csv).toContain("9.0.0");
    expect(csv).toContain(DATA_AS_OF);
    expect(csv).toContain(TREASURY_SHA256);
    const table = readTrialsParquet(trialsParquetBytes(output));
    expect(table.columns.find((column) => column.name === "wealth_2033")!.values[0]).toBe(output.monteCarlo!.wealth2033[0]);
    expect(table.metadata.git_commit).toBe(output.provenance!.gitCommit);
    expect(output.samplerComparison!.note).toMatch(/raw sample mean/);
    const mean = output.monteCarlo!.wealth2033.reduce((total, value) => total + value, 0) / assumptions.trials;
    expect(output.metrics!.convergence.meanWealth2033).toBeCloseTo(mean, 8);
  });

  it("matches the baked data-file hashes to the files on disk", () => {
    const treasury = createHash("sha256").update(readFileSync("data/treasury_par_yields.csv")).digest("hex");
    const french = createHash("sha256").update(readFileSync("data/french_ff_annual.csv")).digest("hex");
    expect(treasury).toBe(TREASURY_SHA256);
    expect(french).toBe(FRENCH_SHA256);
    const stamp = provenanceStamp(teachingAssumptions(), 42);
    expect(stamp.dataAsOf).toBe("2026-10-08");
    expect(stamp.version).toBe("9.0.0");
    expect(stamp.teachingNote).toMatch(/teaching numbers/);
    expect(stamp.assumptionsHash).toHaveLength(64);
  });
});
