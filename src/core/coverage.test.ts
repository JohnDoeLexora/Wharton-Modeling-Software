import { describe, expect, it } from "vitest";
import { rollingFactorAttribution } from "./attribution";
import { buildBundle, reproduceBundle } from "./bundle";
import { blackLitterman, fundedBreakeven, meanCvar, resampledFrontier, worstCaseMean } from "./frontier";
import {
  activeFlags,
  binnedCommunicationRange,
  dragOf,
  effectiveDuration,
  issuerDefaultProbability,
  kernelReportFrom,
  markovStep,
  regimeDragAt,
  sectorFxReturn,
  stepIgSpread,
  targetDuration,
  transitionOf,
  transitionStandardErrors,
} from "./kernel";
import { durationMatch, liabilityConvexity, liabilityKeyRates, presentValue } from "./ladder";
import { boxMuller, cholesky, histogram, seedProblem } from "./math";
import { pairedDifference, pairedFunded } from "./paired";
import { applyFactorShock, fitMarkov, replayPath, reverseStress } from "./scenarioLib";
import type { Sleeve } from "./types";
import { citationTable, frameFromCsv, tradingDaysBetween, verifyClaims } from "./verifyStats";
import { zeroAssumptions } from "./defaults";
import { runModel } from "./run";
import { stepYearMut } from "./yearStep";

describe("coverage of kernel, stats, and edge branches", () => {
  it("walks every overlay flag and the degenerate Markov cases", () => {
    expect(activeFlags({
      markovRegimes: true,
      sharedStudent: true,
      sectorFx: true,
      igSpread: true,
      issuerCredit: true,
      targetMaturity: true,
      binnedRange: true,
    })).toHaveLength(7);
    expect(transitionOf({ transition: [[0.2, 0.8], [0.5, 0.5]] })).toHaveLength(2);
    expect(transitionOf({ transition: [[1]] }).length).toBe(2);
    expect(dragOf({ stateDrag: [] }, 9)).toBeCloseTo(-0.18);
    expect(dragOf({ stateDrag: [0.04] }, 4)).toBeCloseTo(0.04);
    expect(markovStep(0, 0.5, [[0, 0]])).toBe(0);
    expect(markovStep(4, 2, [[0.2, 0.8]])).toBe(1);
    expect(transitionStandardErrors([[1.2, -0.1]], [0])[0][0]).toBeNull();
    const stepped = regimeDragAt({ flags: { markovRegimes: true }, seed: 7, trial: 1, year: 2028, state: 0 });
    expect(stepped.drag).toBeTypeOf("number");
    const shocked = sectorFxReturn({ base: 0.02, flags: { sectorSigma: 0.01, fxSigma: 0.01 }, seed: 3, trial: 0, year: 2027 });
    expect(Number.isFinite(shocked)).toBe(true);
    const spread = stepIgSpread({ spread: 0.01, kappa: 0.4, theta: 0.02, sigma: 0.01, shock: -1, equity: -0.3, spreadBeta: 0.2 });
    expect(spread).not.toBeCloseTo(0.01);
    expect(issuerDefaultProbability(2, 1, -1)).toBe(1);
    expect(targetDuration(8, 2026, 2027, 2027)).toBe(8);
    expect(targetDuration(8, 2028, 2027, 2027)).toBe(0);
    expect(targetDuration(-4, 2030, 2037, 2027)).toBe(0);
    const sleeve = { duration: 8, targetYear: 2033 } as Sleeve;
    expect(effectiveDuration(sleeve, 2030, { targetMaturity: true }, 2027)).toBeCloseTo(8 * 3 / 6);
    expect(effectiveDuration({ duration: 8 } as Sleeve, 2030, { targetMaturity: true }, 2027)).toBe(8);
    expect(binnedCommunicationRange([1, Number.NaN], [2, 3], 2).low).toBeNull();
    expect(binnedCommunicationRange([1], [10], 2).low).toBeNull();
    const report = kernelReportFrom({
      flags: { markovRegimes: true, binnedRange: true, bins: 2, transitionCount: [10, 4] },
      wealth2031: [1, 2, 3, 4],
      gift: [10, 20, 30, 40],
    });
    expect(report?.transitionSe?.[0][0]).not.toBeNull();
    expect(report?.binnedLow).toBeCloseTo(15);
  });

  it("cites return, Sharpe, drawdown, correlation, yield, duration, and spread", () => {
    const lines = ["date,LRN,SPX,yield,duration,spread"];
    let price = 100;
    let market = 80;
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10);
      price = i === 20 ? -5 : price * (1 + ((i % 5) - 2) * 0.01);
      market *= 1 + ((i % 3) - 1) * 0.005;
      lines.push(`${day},${price},${market},${0.04 + i * 0.0001},${6 + i * 0.01},${0.01 + i * 0.0001}`);
    }
    const frame = frameFromCsv(lines.join("\n"), "prices_wide.csv", "2024-01-02");
    const rows = verifyClaims(frame, [
      { id: "ret", stat: "return", asset: "LRN", quoted: 0.01 },
      { id: "shp", stat: "sharpe", asset: "LRN", quoted: 0.2 },
      { id: "dd", stat: "maxDrawdown", asset: "LRN", quoted: 0.2 },
      { id: "corr", stat: "correlation", asset: "LRN", benchmark: "SPX", quoted: 0.1 },
      { id: "y", stat: "yield", asset: "yield", quoted: 0.04 },
      { id: "dur", stat: "duration", asset: "duration", quoted: 6 },
      { id: "spr", stat: "spread", asset: "spread", quoted: 0.01 },
      { id: "missing", stat: "beta", asset: "NOPE", benchmark: "FLAT", quoted: 0.000001 },
    ], "2024-01-04");
    expect(rows.map((row) => row.stat)).toContain("sharpe");
    expect(rows.find((row) => row.id === "y")?.windows[0].se).not.toBeNull();
    expect(citationTable(rows)).toContain("src prices_wide.csv");
    expect(tradingDaysBetween("2024-06-01", "2024-05-01")).toBe(0);
    const flat = frameFromCsv("date,LRN,SPX\n2024-01-02,10,10\n2024-01-03,10,10\n2024-01-04,10,10\n", "flat.csv");
    const quiet = verifyClaims(flat, [
      { id: "flat-sharpe", stat: "sharpe", asset: "LRN", quoted: 1 },
      { id: "flat-corr", stat: "correlation", asset: "LRN", benchmark: "SPX", quoted: 0 },
      { id: "flat-beta", stat: "beta", asset: "LRN", benchmark: "SPX", quoted: 0 },
    ], flat.asOf);
    expect(quiet[0].windows[0].value).toBeNull();
    expect(quiet[2].text).toContain("SE n/a");
    expect(() => frameFromCsv("only-a-header", "bad.csv")).toThrow(/header/);
    expect(() => frameFromCsv("name\n1", "bad.csv")).toThrow(/date/);
  });

  it("covers paired funding, a failed reproduce, and the tax year step", () => {
    expect(pairedDifference([1], [1]).n).toBe(1);
    const funded = pairedFunded([100, 40], [80, 90], [50, 50], [50, 50]);
    expect(funded.n).toBe(2);
    const assumptions = zeroAssumptions();
    assumptions.trials = 50;
    const output = runModel(assumptions);
    const bundle = buildBundle(assumptions, output);
    bundle.wealth2033 = bundle.wealth2033.map((value) => value + 1);
    expect(reproduceBundle(bundle).ok).toBe(false);
    const balances = [100, 0];
    const balancesHtm = [0, 0];
    const taxed = stepYearMut(balances, balancesHtm, 1, {
      contribution: 0,
      policy: [1, 0],
      rebalance: "drift",
      transactionCostBps: 0,
      gainTaxRate: 0.25,
      returns: [0.2, 0],
      returnsHtm: null,
    });
    expect(taxed.yearReturn).toBeLessThan(0.2);
    const halted = stepYearMut([0, 0], [0, 0], 1, {
      contribution: 0,
      policy: [1, 0],
      rebalance: "drift",
      transactionCostBps: 0,
      gainTaxRate: 0,
      returns: null,
      returnsHtm: null,
    });
    expect(halted.yearReturn).toBeNull();
  });

  it("covers the ladder duration match, factor shock, and frontier edges", () => {
    expect(presentValue(0.02, 2033)).toBeGreaterThan(0);
    expect(durationMatch([], 0.03).trades).toHaveLength(0);
    const match = durationMatch([{
      id: "note",
      kind: "coupon",
      maturityYear: 2035,
      coupon: 0.03,
      ask: 99,
      bid: 98,
      fair: 100,
      duration: 7,
      convexity: 60,
      yield: 0.031,
      fairYield: 0.03,
      lot: 1000,
      volume: 1_000_000,
      maxVolumeFraction: 0.05,
    }], 0.03);
    expect(match.cost).toBeGreaterThan(0);
    expect(liabilityConvexity(0.03)).toBeGreaterThan(0);
    expect(liabilityKeyRates(0.03)[0].duration).toBeTypeOf("number");
    expect(applyFactorShock([[1, 0.5]], ["market", "other"], { market: -0.2 })[0]).toBeCloseTo(-0.2);
    expect(reverseStress({ wealth: 0, reserve: 1, shock: -0.2 }).scale).toBeNull();
    expect(reverseStress({ wealth: 10, reserve: 20, shock: -0.2 }).scale).toBe(0);
    expect(reverseStress({ wealth: 100, reserve: 50, shock: 0.1 }).scale).toBeNull();
    expect(reverseStress({ wealth: 100, reserve: 50, shock: -0.01, cap: 1 }).scale).toBeNull();
    const replay = replayPath({ history: [], startYear: 1999, first: 2027, last: 2027 });
    expect(replay[0].sourceYear).toBe(1999);
    expect(fitMarkov([], 3).states).toBe(3);
    expect(fitMarkov([0.2, -0.1, 0.05, -0.4, 0.01, -0.2, 0.3, 0.0, -0.05], 3).transition).toHaveLength(3);
    expect(meanCvar({ scenarios: [[0.01, 0.02]], targetMean: 0 })).toHaveLength(0);
    expect(resampledFrontier({ scenarios: [[0.01, 0.02], [0, 0.01], [-0.01, 0], [0.02, 0], [0.01, -0.01]], draws: 0, seed: 1 }).average).toHaveLength(2);
    const priorOnly = blackLitterman({
      marketWeights: [1],
      covariance: [[0.04]],
      riskAversion: 2,
      tau: 0.05,
      views: [],
    });
    expect(priorOnly.posterior[0]).toBeCloseTo(priorOnly.prior[0]);
    const singular = blackLitterman({
      marketWeights: [0.5, 0.5],
      covariance: [[0, 0], [0, 0]],
      riskAversion: 2,
      tau: 0.05,
      views: [{ assets: [1, 0], mean: 0.04, variance: 0.01 }],
    });
    expect(singular.posterior).toHaveLength(2);
    expect(fundedBreakeven({ threshold: 0.5, baseMean: 0.05, baseFunded: 0.5, slope: 0 }).equityMean).toBeNull();
    const worst = worstCaseMean([1, -1], [0.05, 0.02], [[1, 2], [2, 1]], 1);
    expect(worst.worst).toBeCloseTo(0.03);
    const roll = rollingFactorAttribution([0.01, 0.02], [[0.01, 0.02]], 4);
    expect(roll).toHaveLength(0);
    expect(histogram([1, 2, 3, 4, 8], 3).reduce((sum, bin) => sum + bin.count, 0)).toBe(5);
    expect(histogram([], 3)).toHaveLength(0);
    const factor = cholesky([[0, 0], [0, 1]]);
    expect(factor?.[1][0]).toBe(0);
    const normal = boxMuller(() => 0.3);
    expect(normal()).not.toBe(normal());
    const draws = [0, 0.4, 0, 0.7];
    let cursor = 0;
    const retry = boxMuller(() => draws[cursor++] ?? 0.5);
    expect(Number.isFinite(retry())).toBe(true);
    expect(seedProblem(Number.NaN)).toContain("finite");
    expect(seedProblem(1.5)).toContain("integer");
    expect(seedProblem(-2)).toContain("negative");
    expect(seedProblem(2 ** 32)).toContain("outside");
  });
});
