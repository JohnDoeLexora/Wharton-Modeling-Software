import { describe, expect, it } from "vitest";
import { caseContribution, OPERATING_PAYMENT } from "./case";
import { teachingAssumptions, zeroAssumptions } from "./defaults";
import { facilityCsv, projectionsCsv, toCsv } from "./exportData";
import { applyRule } from "./facility";
import { normalizeWeights, weightsAtYear } from "./glide";
import { sampleLexiconScore } from "./lexicon";
import { cholesky, correlatedShocks, histogram, macaulayDuration, pvAnnuityDue, simpleReturn } from "./math";
import { wealthInYear } from "./project";
import {
  reserveToImmunize,
  rollReserve,
  scheduleFullyFunds,
  sizeShortfallReserve,
} from "./reserve";
import { runModel, simulateTwoYearWealth } from "./run";
import type { Assumptions } from "./types";

function singleSleeve(rate: number, sigma = 0): Assumptions {
  const assumptions = zeroAssumptions();
  assumptions.sleeves = [
    { id: "only", name: "Only sleeve", mu: rate, sigma, base: rate, bull: rate, bear: rate },
  ];
  assumptions.glide = [{ year: 2027, weights: [1] }];
  assumptions.correlation = [[1]];
  assumptions.trials = 80;
  assumptions.seed = 7;
  return assumptions;
}

describe("case cash flows", () => {
  it("uses only the two stated contributions", () => {
    expect(caseContribution(2026)).toBe(0);
    expect(caseContribution(2027)).toBe(300_000);
    expect(caseContribution(2028)).toBe(150_000);
    expect(caseContribution(2033)).toBe(0);
    expect(caseContribution(2042)).toBe(0);
  });
});

describe("liability math", () => {
  it("prices a zero-yield annuity-due at the sum of the payments", () => {
    expect(pvAnnuityDue(OPERATING_PAYMENT, 10, 0)).toBe(500_000);
    expect(reserveToImmunize(Array(9).fill(0))).toBe(500_000);
  });

  it("matches the closed form at 5%", () => {
    const y = 0.05;
    const closed = 50_000 * (1 + (1 - Math.pow(1 + y, -9)) / y);
    expect(pvAnnuityDue(50_000, 10, y)).toBeCloseTo(closed, 6);
    expect(reserveToImmunize(Array(9).fill(y))).toBeCloseTo(closed, 6);
  });

  it("gives the immediate-payment annuity a Macaulay duration of 4.5 years at a 0% yield", () => {
    expect(macaulayDuration(50_000, 10, 0)).toBeCloseTo(4.5, 8);
  });

  it("immunizes a flat ladder: funded ratio stays 1 and the last payment exhausts the reserve", () => {
    const y = 0.03;
    const reserve = reserveToImmunize(Array(9).fill(y));
    const rows = rollReserve({ initial: reserve, returnsBetween: Array(9).fill(y), discountYield: y });
    expect(rows).toHaveLength(10);
    expect(rows[0].calendarYear).toBe(2033);
    expect(rows[9].calendarYear).toBe(2042);
    expect(scheduleFullyFunds(rows)).toBe(true);
    for (const row of rows) expect(row.fundedRatio).toBeCloseTo(1, 6);
    expect(rows[9].afterPayment).toBeCloseTo(0, 4);
    expect(rows[9].reinvestmentReturn).toBeNull();
  });

  it("shows a shortfall when the reserve is smaller than the matched amount", () => {
    const rows = rollReserve({ initial: 0, returnsBetween: Array(9).fill(0), discountYield: 0 });
    expect(rows[0].shortfall).toBe(50_000);
    expect(scheduleFullyFunds(rows)).toBe(false);
  });

  it("sizes a zero-volatility shortfall sample at the immunizing reserve", () => {
    const sized = sizeShortfallReserve({
      mu: 0.02,
      sigma: 0,
      target: 1,
      trials: 40,
      seed: 3,
      returnModel: "lognormal",
      normalFloor: -0.999,
    });
    expect(sized.reserve).toBeCloseTo(reserveToImmunize(Array(9).fill(0.02)), 4);
    expect(sized.achievedProbability).toBe(1);
  });

  it("returns zero when the shortfall target is zero", () => {
    const sized = sizeShortfallReserve({
      mu: 0.02,
      sigma: 0.1,
      target: 0,
      trials: 20,
      seed: 1,
      returnModel: "normal",
      normalFloor: -0.999,
    });
    expect(sized.reserve).toBe(0);
  });

  it("backs out a two-payment reserve", () => {
    expect(reserveToImmunize([1])).toBeCloseTo(75_000, 8);
  });
});

describe("projections", () => {
  it("compounds the case contributions at 5%", () => {
    const output = runModel(singleSleeve(0.05));
    const path = output.scenarios.base!;
    expect(wealthInYear(path, 2027)).toBe(300_000);
    expect(wealthInYear(path, 2028)).toBe(465_000);
    expect(wealthInYear(path, 2033)).toBeCloseTo(593_470.9265625, 4);
    expect(path[0].contribution).toBe(300_000);
    expect(path[1].contribution).toBe(150_000);
    expect(path[2].contribution).toBe(0);
    expect(path[path.length - 1].yearReturn).toBeNull();
  });

  it("blends two sleeves under annual rebalancing", () => {
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    assumptions.sleeves[0].base = 0.1;
    assumptions.sleeves[1].base = 0;
    const output = runModel(assumptions);
    expect(wealthInYear(output.scenarios.base!, 2028)).toBeCloseTo(300_000 * 1.05 + 150_000, 6);
  });

  it("lets sleeve weights drift away from the policy mix", () => {
    const assumptions = zeroAssumptions();
    assumptions.rebalance = "drift";
    assumptions.trials = 50;
    assumptions.sleeves[0].base = 1;
    assumptions.sleeves[1].base = 0;
    const drifted = wealthInYear(runModel(assumptions).scenarios.base!, 2029);
    assumptions.rebalance = "annual";
    const rebalanced = wealthInYear(runModel(assumptions).scenarios.base!, 2029);
    expect(drifted).toBeCloseTo(975_000, 4);
    expect(rebalanced).toBeCloseTo(900_000, 4);
  });

  it("interpolates a glide path and holds the end knot", () => {
    const weights = weightsAtYear(
      [
        { year: 2027, weights: [1, 0] },
        { year: 2033, weights: [0.4, 0.6] },
      ],
      2030,
    );
    expect(weights[0]).toBeCloseTo(0.7, 8);
    expect(weights[1]).toBeCloseTo(0.3, 8);
    expect(weightsAtYear([{ year: 2027, weights: [1, 0] }], 2040)).toEqual([1, 0]);
  });

  it("matches a zero-volatility Monte Carlo path to the mean return", () => {
    const assumptions = singleSleeve(0.07, 0);
    const output = runModel(assumptions);
    const deterministic = wealthInYear(output.scenarios.base!, 2033);
    expect(output.monteCarlo!.wealth2033.every((value) => Math.abs(value - deterministic) < 1e-6)).toBe(true);
  });

  it("repeats when the seed is unchanged and stays above a total loss under lognormal draws", () => {
    const assumptions = singleSleeve(0.06, 0.25);
    assumptions.trials = 60;
    const first = runModel(assumptions).monteCarlo!.wealth2033;
    const second = runModel(assumptions).monteCarlo!.wealth2033;
    expect(second).toEqual(first);
    assumptions.seed = 99;
    const other = runModel(assumptions).monteCarlo!.wealth2033;
    expect(other).not.toEqual(first);
    for (let i = 0; i < 30; i++) {
      const shock = simpleReturn(0.05, 0.8, -3 + i * 0.2, "lognormal", -0.999);
      expect(shock).toBeGreaterThan(-1);
    }
  });

  it("floors normal draws", () => {
    expect(simpleReturn(0, 1, -10, "normal", -0.5)).toBe(-0.5);
  });

  it("deflates by inflation without changing the nominal liability", () => {
    const assumptions = singleSleeve(0);
    assumptions.inflation = 0.02;
    const output = runModel(assumptions);
    const nominal = wealthInYear(output.scenarios.base!, 2033);
    const row = output.scenarios.base!.find((point) => point.calendarYear === 2033)!;
    expect(nominal).toBe(450_000);
    expect(row.realWealthStart).toBeCloseTo(450_000 / Math.pow(1.02, 7), 6);
    expect(output.reserve.sizings.ladder.reserve).toBe(500_000);
  });

  it("stops and explains when weights do not sum to 1", () => {
    const assumptions = zeroAssumptions();
    assumptions.glide[0].weights = [0.8, 0.8];
    const output = runModel(assumptions);
    expect(output.errors.length).toBeGreaterThan(0);
    expect(output.scenarios.base).toBeUndefined();
    expect(output.facility).toBeNull();
    expect(output.reserve.sizings.ladder.reserve).toBe(500_000);
  });
});

describe("facility contribution and ranges", () => {
  it("keeps the reserve whole before any facility dollar is counted", () => {
    const poor = applyRule(450_000, 500_000, {
      id: "all",
      name: "All residual",
      kind: "retain_fraction",
      retainFraction: 0,
      keepDollars: 0,
      capDollars: 0,
    });
    expect(poor.contribution).toBe(0);
    expect(poor.reserveGap).toBe(50_000);
    expect(poor.operatingFullyFunded).toBe(false);

    const rich = applyRule(800_000, 500_000, {
      id: "half",
      name: "Keep half",
      kind: "retain_fraction",
      retainFraction: 0.4,
      keepDollars: 0,
      capDollars: 0,
    });
    expect(rich.residual).toBe(300_000);
    expect(rich.contribution).toBeCloseTo(180_000, 6);
    expect(rich.flexibility).toBeCloseTo(120_000, 6);
    expect(rich.reserveFunded + rich.contribution + rich.flexibility).toBeCloseTo(800_000, 6);

    const buffer = applyRule(800_000, 500_000, {
      id: "buffer",
      name: "Buffer",
      kind: "keep_dollars",
      retainFraction: 0,
      keepDollars: 50_000,
      capDollars: 0,
    });
    expect(buffer.contribution).toBe(250_000);
    expect(buffer.flexibility).toBe(50_000);

    const cap = applyRule(800_000, 500_000, {
      id: "cap",
      name: "Cap",
      kind: "cap_dollars",
      retainFraction: 0,
      keepDollars: 0,
      capDollars: 100_000,
    });
    expect(cap.contribution).toBe(100_000);
    expect(cap.flexibility).toBe(200_000);
  });

  it("starts from a zero-return case where the undiscounted liability exceeds the contributions", () => {
    const output = runModel(zeroAssumptions());
    expect(output.errors).toEqual([]);
    expect(wealthInYear(output.scenarios.base!, 2033)).toBe(450_000);
    expect(output.reserve.active.reserve).toBe(500_000);
    const base = output.facility!.scenarioRows.find((row) => row.scenario === "base")!;
    expect(base.byRule.every((rule) => rule.contribution === 0)).toBe(true);
    const envelope = output.facility!.ranges.find((range) => range.method === "scenario_envelope")!;
    expect(envelope.low).toBe(0);
    expect(envelope.high).toBe(0);
    expect(envelope.operatingShortfallProbability).toBe(1);
    expect(envelope.wording.toLowerCase()).toContain("exploratory");
    expect(envelope.wording.toLowerCase()).not.toContain("recommend");
  });

  it("orders bull, base, and bear wealth and builds a two-year conditional path", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 100;
    const output = runModel(assumptions);
    const wealth = (name: "bear" | "base" | "bull") =>
      output.facility!.scenarioRows.find((row) => row.scenario === name)!.wealth2033;
    expect(wealth("bull")).toBeGreaterThan(wealth("base"));
    expect(wealth("base")).toBeGreaterThan(wealth("bear"));
    expect(wealth("base")).toBeCloseTo(593_470.9265625, 2);

    const anchor = output.facility!.scenarioRows.find((row) => row.scenario === "base")!.wealth2031;
    const forward = simulateTwoYearWealth(assumptions, anchor);
    const expected = anchor * 1.05 * 1.05;
    expect(forward.every((value) => Math.abs(value - expected) < 1)).toBe(false);
    assumptions.sleeves[0].sigma = 0;
    assumptions.sleeves[1].sigma = 0;
    const calm = simulateTwoYearWealth(assumptions, 100_000);
    expect(calm.every((value) => Math.abs(value - 100_000 * 1.05 * 1.05) < 1e-4)).toBe(true);
  });

  it("covers a degenerate percentile band", () => {
    const output = runModel(zeroAssumptions());
    const band = output.facility!.ranges.find((range) => range.method === "mc_percentile")!;
    expect(band.low).toBe(0);
    expect(band.high).toBe(0);
    expect(band.empiricalCoverage).toBe(1);
  });
});

describe("linear algebra, export, and the demo lexicon", () => {
  it("factors a 2×2 correlation", () => {
    const lower = cholesky([
      [1, 0.6],
      [0.6, 1],
    ]);
    expect(lower).not.toBeNull();
    expect(lower![1][0]).toBeCloseTo(0.6, 8);
    expect(lower![1][1]).toBeCloseTo(0.8, 8);
    expect(correlatedShocks(lower!, [1, 0])[1]).toBeCloseTo(0.6, 8);
    expect(cholesky([[1, 1.2], [1.2, 1]])).toBeNull();
  });

  it("normalizes weights and escapes CSV cells", () => {
    expect(normalizeWeights([1, 1])).toEqual([0.5, 0.5]);
    const csv = toCsv([
      ["note", 'he said "hi"', 12],
      ["=cmd", "plain", null],
    ]);
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"=cmd"');
    expect(histogram([1, 1, 1], 4)).toEqual([{ lo: 1, hi: 1, count: 3 }]);
  });

  it("writes projection and facility tables", () => {
    const output = runModel(singleSleeve(0));
    const projections = projectionsCsv(output);
    expect(projections.split("\n")[0]).toContain("wealth_start");
    expect(projections).toContain("300000");
    const facility = facilityCsv(output);
    expect(facility).toContain("scenario_envelope");
    expect(facility.toLowerCase()).not.toContain("recommend");
  });

  it("scores the demo lexicon without pretending to be FinBERT", () => {
    expect(sampleLexiconScore("record profit growth").label).toBe("positive");
    expect(sampleLexiconScore("demand softened and the firm cuts guidance").label).toBe("negative");
    expect(sampleLexiconScore("the board met on Tuesday").label).toBe("neutral");
    expect(sampleLexiconScore("a profit warning").label).toBe("neutral");
  });
});
