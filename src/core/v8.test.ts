import { describe, expect, it } from "vitest";
import { brinson, decomposeRisk, effectiveNumberOfBets, repairCovariance, rollingFactorAttribution, trackingError } from "./attribution";
import { buildBundle, reproduceBundle } from "./bundle";
import { blackLitterman, fundedBreakeven, meanCvar, resampledFrontier, worstCaseMean } from "./frontier";
import {
  binnedCommunicationRange,
  effectiveDuration,
  issuerDefaultProbability,
  kernelEngaged,
  kernelReportFrom,
  markovStep,
  sectorFxReturn,
  sharedStudentScale,
  stepIgSpread,
  targetDuration,
  transitionOf,
  transitionStandardErrors,
} from "./kernel";
import { pairedDifference } from "./paired";
import { billLadder, buildLadderReport, matchCashflows, presentValue, quoteRichness, type LadderBond } from "./ladder";
import { parityConfigs, parityRun } from "./parityKernel";
import { rawWord } from "./rng";
import { fitMarkov, replayPath, reverseStress, SCENARIO_LIBRARY } from "./scenarioLib";
import { tearSheetHtml } from "./tearSheet";
import { citationTable, frameFromCsv, tradingDaysBetween, verifyClaims } from "./verifyStats";
import { textPdf } from "./pdfText";
import { workbookBytes } from "./xlsx";
import { zeroAssumptions } from "./defaults";
import { runModel } from "./run";

describe("kernel overlays", () => {
  it("stays off when the object is absent or empty", () => {
    expect(kernelEngaged(undefined)).toBe(false);
    expect(kernelEngaged({})).toBe(false);
  });

  it("steps a two-state chain on the cumulative row", () => {
    const transition = [
      [0.5, 0.5],
      [1, 0],
    ];
    expect(markovStep(0, 0.4, transition)).toBe(0);
    expect(markovStep(0, 0.6, transition)).toBe(1);
    expect(markovStep(1, 0.2, transition)).toBe(0);
  });

  it("pulls duration to zero at the target year", () => {
    expect(targetDuration(10, 2027, 2037, 2027)).toBeCloseTo(10);
    expect(targetDuration(10, 2032, 2037, 2027)).toBeCloseTo(5);
    expect(targetDuration(10, 2037, 2037, 2027)).toBe(0);
  });

  it("reports a multinomial standard error", () => {
    const se = transitionStandardErrors(
      [
        [0.8, 0.2],
        [0.4, 0.6],
      ],
      [100, 25],
    );
    expect(se[0][1]).toBeCloseTo(Math.sqrt(0.2 * 0.8 / 100));
    expect(se[1][0]).toBeCloseTo(Math.sqrt(0.4 * 0.6 / 25));
  });

  it("shares the market chi-square scale", () => {
    const scale = sharedStudentScale(42, 0, 2027, 5);
    expect(scale).toBeGreaterThan(0);
    expect(sharedStudentScale(42, 0, 2027, 5)).toBe(scale);
  });
});

describe("verified statistics", () => {
  const dates: string[] = [];
  const prices: number[] = [];
  const bench: number[] = [];
  let price = 100;
  let market = 100;
  for (let i = 0; i < 1600; i++) {
    const day = new Date(Date.UTC(2020, 0, 1 + i));
    dates.push(day.toISOString().slice(0, 10));
    price *= 1 + 0.0004 + ((i % 17) - 8) * 0.001;
    market *= 1 + 0.0003 + ((i % 11) - 5) * 0.0008;
    prices.push(price);
    bench.push(market);
  }
  const lines = ["date,LRN,SPX,yield"];
  for (let i = 0; i < dates.length; i++) lines.push(`${dates[i]},${prices[i]},${bench[i]},0.04`);
  const csv = lines.join("\n");
  const frame = frameFromCsv(csv, "prices_LRN.csv", "2024-05-01");

  it("cites three windows, the file hash, and the as-of date", () => {
    const rows = verifyClaims(frame, [{ id: "beta-lrn", stat: "beta", asset: "LRN", benchmark: "SPX", quoted: 0.02 }], "2024-05-10");
    expect(rows[0].text).toContain("β = 0.02");
    expect(rows[0].text).toContain("1y daily, SE");
    expect(rows[0].text).toContain("3y wkly");
    expect(rows[0].text).toContain("5y mo");
    expect(rows[0].text).toContain("prices_LRN.csv");
    expect(rows[0].text).toContain("as of 2024-05-01");
    expect(rows[0].sha256).toHaveLength(64);
    expect(rows[0].stale).toBe(true);
    expect(citationTable(rows)).toContain("beta-lrn");
  });

  it("counts weekdays between the as-of date and today", () => {
    expect(tradingDaysBetween("2024-05-01", "2024-05-08")).toBe(5);
    expect(tradingDaysBetween("2024-05-01", "2024-05-09")).toBe(6);
  });

  it("flags a quote outside the cross-window range", () => {
    const rows = verifyClaims(frame, [{ id: "vol", stat: "vol", asset: "LRN", quoted: 5 }], "2024-05-02");
    expect(rows[0].outsideRange).toBe(true);
    expect(rows[0].stale).toBe(false);
  });
});

describe("kernel overlays that stay behind flags", () => {
  it("prices the overlays and the binned range", () => {
    expect(transitionOf({ markovRegimes: true })).toHaveLength(2);
    expect(transitionOf({ markovRegimes: true, states: 3 })).toHaveLength(3);
    const fx = sectorFxReturn({ base: 0.01, flags: { sectorFx: true, sectorSigma: 0, fxSigma: 0 }, seed: 1, trial: 0, year: 2027 });
    expect(fx).toBeCloseTo(0.01);
    const spread = stepIgSpread({ spread: 0.01, kappa: 0, theta: 0.02, sigma: 0, shock: 1, equity: 0.1, spreadBeta: 0.5 });
    expect(spread).toBeCloseTo(0.01);
    expect(issuerDefaultProbability(0.01, 1, -0.2)).toBeGreaterThan(0.01);
    expect(issuerDefaultProbability(0, 1, -0.2)).toBe(0);
    expect(effectiveDuration({ duration: 8 } as never, 2030, undefined, 2027)).toBe(8);
    const bins = binnedCommunicationRange([1, 2, 3, 4], [10, 20, 30, 40], 2);
    expect(bins.low).toBeCloseTo(15);
    expect(bins.high).toBeCloseTo(35);
    const report = kernelReportFrom({ flags: { binnedRange: true, bins: 2 }, wealth2031: [1, 2, 3, 4], gift: [10, 20, 30, 40] });
    expect(report?.flags).toContain("binnedRange");
    expect(kernelReportFrom({ flags: undefined, wealth2031: [], gift: [] })).toBeUndefined();
  });
});

describe("paired differences and rolling attribution", () => {
  it("reports the mean gap and its standard error", () => {
    const paired = pairedDifference([1, 2, 3, 4], [2, 2, 4, 6]);
    expect(paired.n).toBe(4);
    expect(paired.mean).toBeCloseTo(1);
    expect(paired.se).toBeGreaterThan(0);
    const fit = rollingFactorAttribution([0.01, 0.02, 0, -0.01, 0.03, 0.01], [[0.02, 0.01, 0, -0.02, 0.02, 0]], 4);
    expect(fit.length).toBeGreaterThan(0);
  });
});

describe("attribution and the ladder", () => {
  const model = {
    assetNames: ["equity", "bonds"],
    factorNames: ["market", "rates"],
    exposures: [
      [1, 0],
      [0.1, 4],
    ],
    factorCov: [
      [0.04, 0],
      [0, 0.0001],
    ],
    specific: [0.01, 0.0004],
  };

  it("splits factor and specific risk and sums the Euler components", () => {
    const risk = decomposeRisk([0.6, 0.4], model);
    expect(risk.repaired).toBe(false);
    const sum = risk.component.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(risk.total, 8);
    expect(risk.factor).toBeGreaterThan(0);
    expect(risk.specific).toBeGreaterThan(0);
    expect(risk.effectiveBets).toBeGreaterThan(1);
    expect(risk.diversificationRatio).toBeGreaterThan(1);
  });

  it("repairs a covariance with a negative eigenvalue", () => {
    const repaired = repairCovariance([
      [1, 2],
      [2, 1],
    ]);
    expect(repaired.repaired).toBe(true);
    expect(effectiveNumberOfBets(repaired.cov)).toBeGreaterThan(0);
  });

  it("adds Brinson pieces to the active return", () => {
    const result = brinson({
      names: ["a", "b"],
      portfolioWeights: [0.7, 0.3],
      benchmarkWeights: [0.5, 0.5],
      portfolioReturns: [0.1, 0.02],
      benchmarkReturns: [0.08, 0.03],
    });
    expect(result.allocation + result.selection + result.interaction).toBeCloseTo(result.active);
  });

  it("decomposes tracking error", () => {
    const te = trackingError([0.6, 0.4], [0.5, 0.5], model);
    expect(te.trackingError).toBeGreaterThan(0);
    expect(te.factor ** 2 + te.specific ** 2).toBeCloseTo(te.trackingError ** 2);
  });

  it("matches cash flows inside the capital and prices a bill ladder at a zero yield as the nominal sum", () => {
    expect(presentValue(0)).toBe(500000);
    const bills = billLadder(0);
    expect(bills.cost).toBeCloseTo(500000);
    const bond: LadderBond = {
      id: "strip-2033",
      kind: "strip",
      maturityYear: 2033,
      coupon: 0,
      ask: 100,
      bid: 99.5,
      fair: 100,
      duration: 0,
      convexity: 0,
      yield: 0,
      fairYield: 0.001,
      lot: 1000,
      volume: 5_000_000,
      maxVolumeFraction: 0.1,
    };
    const plan = matchCashflows([bond], 300000, 0);
    expect(plan.cost).toBeLessThanOrEqual(300000);
    expect(plan.trades.every((trade) => trade.face % 1000 === 0)).toBe(true);
    const rich = quoteRichness(bond, 1000);
    expect(rich.richBp).toBeCloseTo(-10);
    const report = buildLadderReport({ universe: [bond], flatYield: 0.03 });
    expect(report.note).toContain("Not a reserve");
    expect(report.immunization.cost).toBeLessThanOrEqual(300000);
  });
});

describe("exploration frontiers and scenarios", () => {
  const scenarios = Array.from({ length: 30 }, (_, i) => [0.01 * ((i % 5) - 2), 0.005 * ((i % 3) - 1)]);

  it("labels mean-CVaR and the resampled cloud as exploration", () => {
    const points = meanCvar({ scenarios, targetMean: -1 });
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.label.includes("Exploration"))).toBe(true);
    expect(points.every((point) => Math.abs(point.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-8)).toBe(true);
    const resampled = resampledFrontier({ scenarios, draws: 4, seed: 3 });
    expect(resampled.label).toContain("Not a recommended");
    expect(resampled.average.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
  });

  it("moves the Black-Litterman mean toward a view and prices the ellipsoid", () => {
    const posterior = blackLitterman({
      marketWeights: [0.6, 0.4],
      covariance: [
        [0.04, 0.01],
        [0.01, 0.02],
      ],
      riskAversion: 2.5,
      tau: 0.05,
      views: [{ assets: [1, 0], mean: 0.08, variance: 0.01 }],
    });
    expect(posterior.label).toContain("Exploration");
    expect(posterior.posterior[0]).not.toBe(posterior.prior[0]);
    const worst = worstCaseMean([0.5, 0.5], [0.06, 0.02], [
      [0.04, 0],
      [0, 0.01],
    ], 1);
    expect(worst.worst).toBeLessThan(0.04);
  });

  it("solves a funded breakeven and a reverse stress", () => {
    const line = fundedBreakeven({ threshold: 0.8, baseMean: 0.06, baseFunded: 0.9, slope: 2 });
    expect(line.equityMean).toBeCloseTo(0.01);
    const stress = reverseStress({ wealth: 600000, reserve: 500000, shock: -0.2 });
    expect(stress.scale).not.toBeNull();
    expect(600000 * (1 + (stress.scale ?? 0) * -0.2)).toBeLessThanOrEqual(500000 + 1);
  });

  it("keeps nine cited scenarios and fits a transition matrix", () => {
    expect(SCENARIO_LIBRARY).toHaveLength(9);
    expect(SCENARIO_LIBRARY.find((row) => row.id === "taiwan-strait")?.hypothetical).toBe(true);
    const fit = fitMarkov([0.1, -0.2, 0.05, -0.3, 0.02, -0.1, 0.08, -0.4], 2);
    expect(fit.transition).toHaveLength(2);
    expect(fit.transition[0].reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(fit.standardErrors[0][0] === null || (fit.standardErrors[0][0] ?? 0) >= 0).toBe(true);
    const replay = replayPath({
      history: [
        { year: 2008, returns: { market: -0.37 } },
        { year: 2009, returns: { market: 0.26 } },
      ],
      startYear: 2008,
      first: 2027,
      last: 2028,
    });
    expect(replay[0].returns.market).toBeCloseTo(-0.37);
    expect(replay[1].sourceYear).toBe(2009);
  });
});

describe("exports", () => {
  it("prefixes the tear sheet and reproduces a short bundle", () => {
    const html = tearSheetHtml({
      audience: "INTERNAL",
      title: "example book",
      asOf: "2026-10-09",
      holdings: [{ name: "Equity index", weight: 0.6, kind: "equity_index" }],
      riskLines: ["Factor vol is an input."],
      citations: [],
      scenarios: [{ label: "2008", note: "Cited drawdown." }],
      reservePv: 500000,
      giftP5: 0,
      giftP50: 1000,
      giftP95: 2000,
      methodology: ["Year step MODEL_SPEC §5."],
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("INTERNAL - example book");
    expect(html).not.toContain("we recommend");
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    const output = runModel(assumptions);
    const bundle = buildBundle(assumptions, output);
    const again = reproduceBundle(bundle);
    expect(again.ok).toBe(true);
    const bytes = workbookBytes([{ name: "Board", rows: [["metric", "value"], ["p50", 1]] }]);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const pdf = textPdf("INTERNAL - note", ["A line of the tear sheet."]);
    expect(pdf[0]).toBe(0x25);
    expect(new TextDecoder().decode(pdf)).toContain("%PDF");
  });
});

describe("python parity cases", () => {
  it("builds twenty golden books and five rich books", () => {
    const rows = parityConfigs();
    expect(rows.filter((row) => !row.rich)).toHaveLength(20);
    expect(rows.filter((row) => row.rich)).toHaveLength(5);
    const sample = parityRun(rows[0].config);
    expect(sample.wealth2033).toHaveLength(rows[0].config.trials);
    expect(sample.path0).toHaveLength(16);
    const word = rawWord(42, 1, 0, 2027, 0);
    expect(word.hi).toBe(2195427346);
    expect(word.lo).toBe(1420824054);
  });
});
