/**
 * V9 carryover. These assertions describe the corrected jump model, the
 * comparison harness, the teaching reserve, and beta labels. They fail on
 * the V8 engine.
 */

import { describe, expect, it } from "vitest";
import { blankName } from "./basket";
import { teachingAssumptions } from "./defaults";
import { singleNameReturn } from "./equity";
import { pvAnnuityDue } from "./math";
import { wealthInYear } from "./project";
import { estimateFromSeries } from "./risk/assemble";
import { betaAgainst, finishBeta, sectorPrior } from "./risk/beta";
import type { CleanSeries } from "./risk/clean";
import { assumptionsForMethod, compareMethods } from "./risk/compare";
import { businessDays } from "./risk/fixture";
import { fitJumps } from "./risk/jumps";
import { TRADING_DAYS } from "./risk/vol";
import { standardNormal, unitInterval } from "./rng";
import { runModel } from "./run";
import type { BasketName } from "./types";

function poissonCount(u: number, lambda: number): number {
  if (!(lambda > 0)) return 0;
  const target = Math.min(1 - 1e-12, Math.max(0, u));
  let term = Math.exp(-lambda);
  let cdf = term;
  let k = 0;
  while (cdf < target && k < 1000) {
    k += 1;
    term *= lambda / k;
    cdf += term;
  }
  return k;
}

function unitStudent(seed: number, index: number, df: number): number {
  const z = standardNormal(seed, 8, index, 0, 0);
  let chi = 0;
  for (let k = 0; k < df; k++) chi += standardNormal(seed, 8, index, 0, k + 1) ** 2;
  const raw = z / Math.sqrt(chi / df);
  return raw / Math.sqrt(df / (df - 2));
}

function seriesOf(returns: number[], role: CleanSeries["role"] = "asset", ticker = "SYN"): CleanSeries {
  const dates = businessDays("2016-01-04", returns.length + 1);
  const prices = [100];
  for (const value of returns) prices.push(prices[prices.length - 1] * (1 + value));
  return {
    ticker,
    sector: "broad",
    role,
    benchmark: "",
    nonsync: false,
    dates,
    prices,
    returnDates: dates.slice(1),
    returns,
    events: returns.map(() => false),
    quality: {
      ticker,
      observations: dates.length,
      returnCount: returns.length,
      missingBusinessDays: 0,
      stalePrints: 0,
      splitAdjustments: 0,
      droppedMultiDayReturns: 0,
      ipoShort: returns.length < 252,
      notes: [],
    },
  };
}

function quietName(patch: Partial<BasketName> = {}): BasketName {
  return {
    ...blankName("T"),
    alpha: 0.05,
    beta: 0,
    idioSigma: 0,
    studentDf: 5,
    jumpProb: 0,
    jumpMean: 0,
    fxSigma: 0,
    geoJumpProb: 0,
    geoJumpMean: 0,
    sectorBeta: 0,
    expenseRatio: 0,
    weight: 1,
    ...patch,
  };
}

function meanReturn(name: BasketName, trials: number): number {
  let sum = 0;
  for (let trial = 0; trial < trials; trial++) {
    sum += singleNameReturn({
      name,
      index: 0,
      market: 0,
      sectorShock: 0,
      mode: "mc",
      seed: 42,
      trial,
      year: 2027,
    });
  }
  return sum / trials;
}

describe("jump model", () => {
  it("keeps a pure Student-t(4) sample near zero intensity", () => {
    const years = 12;
    const returns = Array.from({ length: years * TRADING_DAYS }, (_, index) => 0.01 * unitStudent(11, index, 4));
    const fit = fitJumps({ series: seriesOf(returns, "asset", "FAT") });
    expect(fit.lambdaAnnual).toBeLessThanOrEqual(0.2);
    expect(fit.source).not.toBe("class-fallback");
  });

  it("recovers an injected Poisson intensity and the single-jump mean", () => {
    const years = 10;
    const lambda = 2.4;
    const jump = -0.15;
    const daily = lambda / TRADING_DAYS;
    const returns: number[] = [];
    for (let index = 0; index < years * TRADING_DAYS; index++) {
      const count = poissonCount(unitInterval(2, 8, index, 1, 0), daily);
      const diffusion = 0.01 * standardNormal(2, 8, index, 2, 0);
      returns.push(diffusion + count * jump);
    }
    const fit = fitJumps({ series: seriesOf(returns, "asset", "POI") });
    const se = Math.sqrt(lambda / years);
    expect(Math.abs(fit.lambdaAnnual - lambda)).toBeLessThanOrEqual(2 * se);
    expect(fit.mean).toBeCloseTo(jump, 1);
    expect(Math.abs(fit.size - fit.mean)).toBeLessThan(0.05);
    expect(fit.jumpVariance).toBeCloseTo(fit.lambdaAnnual * fit.meanSquare, 8);
    const report = estimateFromSeries([seriesOf(returns, "asset", "POI")]);
    const card = report.names[0];
    expect(card.proposal.jumpProb).toBe(0);
    expect(card.proposal.jumpMean).toBeCloseTo(fit.mean, 6);
    expect(card.proposal.jumpLambda).toBeCloseTo(fit.lambdaAnnual, 6);
    expect(card.proposal.idioSigma).toBeGreaterThan(0.05);
    expect(card.proposal.studentDf).toBeGreaterThanOrEqual(8);
  });

  it("does not let jump parameters move the expected return", () => {
    const plain = quietName();
    const dragged = quietName({ jumpProb: 0.909, jumpMean: -0.535 });
    expect(
      singleNameReturn({
        name: dragged,
        index: 0,
        market: 0,
        sectorShock: 0,
        mode: "scenario",
        seed: 1,
        trial: 0,
        year: 2027,
      }),
    ).toBeCloseTo(plain.alpha, 8);
    const trials = 4000;
    expect(Math.abs(meanReturn(dragged, trials) - meanReturn(plain, trials))).toBeLessThan(0.02);
    const geo = quietName({ geoJumpProb: 0.5, geoJumpMean: -0.3 });
    expect(Math.abs(meanReturn(geo, trials) - plain.alpha)).toBeLessThan(0.02);
    const poisson = quietName({ jumpLambda: 2.4, jumpMean: -0.2, jumpProb: 0 });
    expect(Math.abs(meanReturn(poisson, trials) - plain.alpha)).toBeLessThan(0.02);
  });

  it("does not apply a class fallback when a long history has no gaps", () => {
    const calm = Array.from({ length: 5 * TRADING_DAYS }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01));
    const fit = fitJumps({ series: seriesOf(calm, "asset", "CALM") });
    expect(fit.source).toBe("name");
    expect(fit.lambdaAnnual).toBe(0);
    expect(fit.fallbackClass).toBeNull();
    const young = Array.from({ length: 40 }, () => 0.001);
    expect(fitJumps({ series: seriesOf(young, "asset", "NEW") }).source).toBe("class-fallback");
  });
});

describe("compare harness and teaching reserve", () => {
  it("uses residual idiosyncratic vol for the legacy method", () => {
    const market = seriesOf(
      Array.from({ length: 5 * TRADING_DAYS }, (_, index) => 0.0002 + 0.01 * Math.sin(index / 3)),
      "market",
      "MKT",
    );
    const assetReturns = market.returns.map((value, index) => 0.8 * value + 0.004 * Math.cos(index / 5));
    const asset = seriesOf(assetReturns, "asset", "NAM");
    const report = estimateFromSeries([market, asset], [{ ticker: "NAM", weight: 1 }]);
    const card = report.names.find((row) => row.ticker === "NAM");
    expect(card).toBeTruthy();
    const monthly = card!.vol.realizedMonthly;
    const beta = Number.isFinite(card!.beta?.monthly.beta) ? card!.beta!.monthly.beta : 0;
    const residual = Math.sqrt(Math.max(0, monthly * monthly - beta * beta * report.marketMonthly * report.marketMonthly));
    const old = assumptionsForMethod(report, "old", 50, 42);
    const row = old.basket.find((name) => name.ticker === "NAM");
    expect(row!.idioSigma).toBeCloseTo(residual, 6);
    expect(row!.idioSigma).toBeLessThan(monthly - 1e-4);
    const base = teachingAssumptions();
    base.equity.marketMu = 0.04;
    base.reserve.discountMode = "fixed_yield";
    base.reserve.discountYield = 0.03;
    const built = assumptionsForMethod(report, "new", 50, 42, base);
    expect(built.equity.marketMu).toBe(0.04);
    expect(built.reserve.discountYield).toBe(0.03);
    const compared = compareMethods(report, 50, 42, base);
    expect(compared.note.toLowerCase()).toContain("paired");
    expect(Number.isFinite(compared.paired.fundedDiff)).toBe(true);
    expect(compared.paired.fundedSe).toBeGreaterThanOrEqual(0);
    expect(compared.paired.label.toLowerCase()).toContain("paired");
  });

  it("prices the teaching reserve at the stated discount yield", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    const output = runModel(assumptions);
    const ladder = pvAnnuityDue(50_000, 10, 0.03);
    expect(output.errors).toEqual([]);
    expect(output.monteCarlo!.reserve[0]).toBeCloseTo(ladder, 4);
    expect(output.monteCarlo!.reserve.every((value) => Math.abs(value - 500_000) > 1)).toBe(true);
    const text = `${output.metrics?.fundedDefinition ?? ""} ${(output as { warnings?: string[] }).warnings?.join(" ") ?? ""}`;
    expect(text.toLowerCase()).toMatch(/stochastic curve/);
  });
});

describe("beta windows", () => {
  it("withholds a beta that has fewer than 24 monthly observations", () => {
    const dates = businessDays("2024-01-02", 80);
    const returns = dates.slice(1).map((_, index) => 0.01 * (index % 5) - 0.02);
    const marketReturns = returns.map((value, index) => value * 0.1 + 0.001 * (index % 3));
    const asset = seriesOf(returns, "asset", "SPCX");
    const market = seriesOf(marketReturns, "market", "MKT");
    asset.returnDates = dates.slice(1);
    market.returnDates = dates.slice(1);
    const partial = betaAgainst(asset, market, false);
    const card = finishBeta(partial, sectorPrior("SPCX", "broad", []));
    expect(card.monthly.n).toBeLessThan(24);
    expect(card.monthly.measured).toBe(false);
    expect(Number.isFinite(card.monthly.beta)).toBe(false);
    expect(Number.isFinite(card.blume.beta)).toBe(false);
    expect(card.blume.label.toLowerCase()).toMatch(/24/);
    expect(card.daily.window.toLowerCase()).toMatch(/daily/);
  });
});

describe("pinned trial wealth", () => {
  it("matches the V5 and V7 teaching path at basis points of zero", () => {
    const assumptions = teachingAssumptions();
    assumptions.trials = 50;
    assumptions.costs.transactionCostBps = 0;
    const output = runModel(assumptions);
    expect(output.monteCarlo!.wealth2033[0]).toBeCloseTo(661189.0679979037, 4);
    expect(output.monteCarlo!.wealth2033[3]).toBeCloseTo(503352.7733807588, 4);
    expect(output.scenarios.base ? wealthInYear(output.scenarios.base, 2033) : null).toBeCloseTo(593470.9265625001, 4);
  });
});
