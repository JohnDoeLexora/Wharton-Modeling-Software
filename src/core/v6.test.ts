import { describe, expect, it } from "vitest";
import pricesExample from "../../examples/daily-prices-sample.csv?raw";
import bookExample from "../../examples/risk-book.csv?raw";
import { caseContribution, OPERATING_PAYMENT } from "./case";
import { buildTradeNote } from "./tradeNote";
import { betaCitation, blumeBeta, vasicekBeta } from "./risk/beta";
import { cleanPrices, parsePriceCsv, weekdaysBetween } from "./risk/clean";
import { christoffersen, ksUniform, kupiec } from "./risk/coverage";
import { goldenEwma, goldenJumpVar, goldenShrunkCov, goldenVasicek, vasicekIsBetween } from "./risk/fixed";
import { buildSampleCsv, sampleBook, sampleBookCsv } from "./risk/fixture";
import { JUMP_CLASSES, bernoulliMatch, doubleExponential, jumpVariance } from "./risk/jumps";
import { componentRisk } from "./risk/portfolio";
import { parityHits, paritySeries } from "./risk/index";
import { estimateFromSeries } from "./risk/assemble";
import { compareMethods } from "./risk/compare";
import { isPositiveSemidefinite, ledoitWolf, normalPpf, ols, studentCdf } from "./risk/stats";
import { fitStudentT, studentTLikelihood } from "./risk/tails";
import { ewmaVariance, fitGarch, horizonVariance, realizedAnnual } from "./risk/vol";

describe("risk identities", () => {
  it("keeps an EWMA variance positive and matches the integer step", () => {
    expect(goldenEwma()).toBe(955_000);
    expect(goldenEwma()).toBeGreaterThan(0);
    const path = ewmaVariance([0.01, -0.02, 0.0, 0.03, -0.01]);
    expect(path.variance.every((value) => value > 0)).toBe(true);
    expect(path.next).toBeGreaterThan(0);
  });

  it("places a Vasicek beta between the raw slope and the prior", () => {
    expect(goldenVasicek()).toBe(628_000);
    expect(vasicekIsBetween(70_000, 1_000_000, goldenVasicek())).toBe(true);
    const tight = vasicekBeta(0.07, 0, 1, 0.25);
    expect(tight.beta).toBeCloseTo(0.07, 10);
    expect(tight.weightOnSample).toBe(1);
    const none = vasicekBeta(0.07, 0.4, 1, 0);
    expect(none.beta).toBeCloseTo(1, 10);
    const mid = vasicekBeta(0.07, 0.2, 1, 0.25);
    expect(mid.beta).toBeGreaterThan(0.07);
    expect(mid.beta).toBeLessThan(1);
    expect(blumeBeta(0.072)).toBeCloseTo(0.378, 3);
  });

  it("keeps jump-adjusted variance at least the diffusion variance", () => {
    expect(goldenJumpVar()).toBe(18_000);
    expect(goldenJumpVar()).toBeGreaterThanOrEqual(8_000);
    expect(jumpVariance(0.04, 2, 0.03)).toBeGreaterThanOrEqual(0.04);
    const matched = bernoulliMatch(0.4, -0.2, 0.05);
    expect(matched.prob).toBeGreaterThan(0);
    expect(matched.prob).toBeLessThanOrEqual(1);
    expect(JUMP_CLASSES.small.prob).toBe(0.04);
    expect(JUMP_CLASSES.small.mean).toBe(-0.5);
    const tails = doubleExponential([0.1, 0.1, -0.2, -0.2]);
    expect(tails.upProb).toBeCloseTo(0.5);
    expect(tails.upRate).toBeCloseTo(10);
    expect(tails.downRate).toBeCloseTo(5);
  });

  it("shrinks a 2×2 covariance to a positive semidefinite matrix", () => {
    const cov = goldenShrunkCov();
    expect(cov.det).toBe(7729);
    expect(cov.s11).toBeGreaterThan(0);
    expect(cov.det).toBeGreaterThan(0);
    const samples = [
      [0.01, 0.02],
      [-0.02, -0.01],
      [0.015, 0.0],
      [0.005, 0.01],
      [-0.01, 0.02],
      [0.0, -0.015],
      [0.02, 0.01],
      [-0.005, 0.0],
    ];
    const shrunk = ledoitWolf(samples);
    expect(shrunk.shrinkage).toBeGreaterThanOrEqual(0);
    expect(shrunk.shrinkage).toBeLessThanOrEqual(1);
    expect(isPositiveSemidefinite(shrunk.cov)).toBe(true);
    expect(shrunk.cov[0][1]).toBeCloseTo(shrunk.cov[1][0], 12);
  });

  it("recovers an OLS slope and a normal quantile", () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((value) => 1 + 0.5 * value);
    const fit = ols(y, [x.map(() => 1), x]);
    expect(fit.coef[0]).toBeCloseTo(1, 8);
    expect(fit.coef[1]).toBeCloseTo(0.5, 8);
    expect(fit.cov?.[1][1]).toBeCloseTo(0, 8);
    expect(normalPpf(0.05)).toBeCloseTo(-1.64485362695, 4);
    expect(studentCdf(0, 5)).toBeCloseTo(0.5, 6);
  });

  it("targets GARCH long-run variance and keeps the horizon between the ends", () => {
    const calm = Array.from({ length: 80 }, (_, i) => ((i % 7) - 3) / 200);
    const fit = fitGarch(calm);
    expect(fit.ok).toBe(true);
    expect(fit.alpha).toBeGreaterThanOrEqual(0);
    expect(fit.beta).toBeGreaterThanOrEqual(0);
    expect(fit.alpha + fit.beta).toBeLessThan(1);
    expect(fit.omega).toBeCloseTo(fit.longRun * (1 - fit.alpha - fit.beta), 12);
    expect(fit.current).toBeGreaterThan(0);
    const average = horizonVariance(0.02, 0.005, fit.alpha + fit.beta, 60);
    expect(average).toBeGreaterThan(0.005);
    expect(average).toBeLessThan(0.02);
    expect(realizedAnnual([0.01, -0.01, 0.01, -0.01], 252)).toBeGreaterThan(0);
  });

  it("scores a Kupiec likelihood of zero when the hit rate matches", () => {
    const hits = parityHits();
    const test = kupiec(hits.filter(Boolean).length, hits.length, 0.05);
    expect(test.hits).toBe(5);
    expect(test.lr).toBeCloseTo(0, 8);
    expect(test.pValue).toBeCloseTo(1, 6);
    const independent = Array.from({ length: 40 }, (_, index) => index % 2 === 0);
    const chris = christoffersen(independent, 0.5);
    expect(chris.independence.lr).toBeCloseTo(0, 6);
    const uniform = Array.from({ length: 20 }, (_, index) => (index + 0.5) / 20);
    expect(ksUniform(uniform)).toBeLessThan(0.05);
  });

  it("fits a fatter tail to a series with outliers", () => {
    const calm = Array.from({ length: 80 }, (_, i) => ((i % 5) - 2) / 50);
    const wild = calm.map((value, i) => (i % 10 === 0 ? value * 8 : value));
    const calmFit = fitStudentT(calm);
    const wildFit = fitStudentT(wild);
    expect(calmFit).not.toBeNull();
    expect(wildFit).not.toBeNull();
    expect(wildFit!.df).toBeLessThanOrEqual(calmFit!.df);
    const ll = studentTLikelihood([0, 0, 0], 5, 0, 1);
    expect(Number.isFinite(ll)).toBe(true);
  });

  it("adds component risk up to portfolio vol", () => {
    const weights = [0.5, 0.5];
    const cov = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const risk = componentRisk(weights, cov);
    const sum = risk.component.reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(risk.vol, 8);
    expect(risk.vol).toBeGreaterThan(0);
  });

  it("cites the estimator and the window in a trading note", () => {
    const citation = betaCitation("1-yr daily", 0.02, 0.15);
    expect(citation).toBe("1-yr daily beta 0.02 (SE 0.15)");
    const note = buildTradeNote({
      ticker: "GAP",
      sleeve: "Growth",
      weight: 0.4,
      kind: "stock",
      role: "Example",
      duration: null,
      modeledYield: null,
      expense: null,
      riskCitation: citation,
    });
    expect(note).toContain("1-yr daily beta 0.02 (SE 0.15)");
    expect(note.length).toBeLessThanOrEqual(300);
  });
});

describe("daily history", () => {
  const generated = buildSampleCsv();
  const rows = parsePriceCsv(generated);
  const series = cleanPrices(rows);

  it("cleans splits, stale prints, gaps, and a short history", () => {
    const stale = series.find((row) => row.ticker === "STALE");
    expect(stale?.quality.splitAdjustments).toBe(1);
    expect(stale?.quality.stalePrints).toBeGreaterThan(0);
    expect(stale?.quality.missingBusinessDays).toBeGreaterThan(0);
    expect(stale?.returns.some((value) => value < -0.4)).toBe(false);
    const young = series.find((row) => row.ticker === "NEWCO");
    expect(young?.quality.ipoShort).toBe(true);
    expect(weekdaysBetween("2024-01-05", "2024-01-08")).toBe(0);
    expect(weekdaysBetween("2024-01-05", "2024-01-09")).toBe(1);
  });

  it("flags a gap name, shrinks with a prior, and uses Dimson on the ADR", () => {
    const report = estimateFromSeries(series, sampleBook().map((row) => ({ ticker: row.ticker, weight: row.weight })));
    const gap = report.names.find((card) => card.ticker === "GAP");
    const calm = report.names.find((card) => card.ticker === "CALM");
    const adr = report.names.find((card) => card.ticker === "ADR");
    expect(gap?.vol.disagreement).toBe(true);
    expect(gap?.beta?.vasicek.measured).toBe(false);
    expect(gap?.beta?.vasicek.label).toContain("not measured");
    expect(gap?.beta?.oneYear.measured).toBe(true);
    expect(gap?.beta?.citation).toMatch(/beta .+ \(SE .+\)/);
    expect(gap?.jumps.source).not.toBe("class-fallback");
    expect(gap?.jumps.totalVariance).toBeGreaterThanOrEqual(gap?.jumps.diffusionVariance ?? 0);
    const shrunk = gap?.beta?.vasicek.beta ?? 0;
    const raw = gap?.beta?.preferred.beta ?? 0;
    const prior = gap?.beta?.vasicek.prior ?? 0;
    expect(shrunk).toBeGreaterThanOrEqual(Math.min(raw, prior) - 1e-9);
    expect(shrunk).toBeLessThanOrEqual(Math.max(raw, prior) + 1e-9);
    expect(adr?.nonsync).toBe(true);
    expect(adr?.beta?.dimson?.beta).toBeGreaterThan((adr?.beta?.daily.beta ?? 1) - 0.05);
    expect(calm?.vol.disagreement).toBe(false);
    expect(report.factors.psd).toBe(true);
    expect(report.book?.components.reduce((sum, row) => sum + row.component, 0)).toBeCloseTo(report.book?.vol ?? 0, 6);
    expect(report.book?.worstTicker).toBe("GAP");
    const etf = report.names.find((card) => card.ticker === "ETF");
    expect(etf?.fund?.feeDrag).toBeGreaterThan(0);
    expect(etf?.fund?.trackingError).toBeLessThan(0.05);
    const coverage = report.coverage.find((row) => row.ticker === "CALM");
    expect(coverage?.winner === "old" || coverage?.winner === "new" || coverage?.winner === "tie").toBe(true);
    expect(coverage?.next?.var95.n).toBeGreaterThan(50);
  });

  it("matches the committed example files", () => {
    expect(pricesExample).toBe(generated);
    expect(bookExample).toBe(sampleBookCsv());
  });

  it("runs the case comparison without touching locked cash flows", () => {
    const report = estimateFromSeries(
      series,
      sampleBook().map((row) => ({ ticker: row.ticker, weight: row.weight })),
      [],
      { coverage: false },
    );
    const paired = compareMethods(report, 50, 42);
    expect(paired.cash2027).toBe(300_000);
    expect(paired.cash2028).toBe(150_000);
    expect(paired.payment).toBe(50_000);
    expect(caseContribution(2027)).toBe(300_000);
    expect(OPERATING_PAYMENT).toBe(50_000);
    expect(paired.old.errors).toEqual([]);
    expect(paired.next.errors).toEqual([]);
    expect(paired.old.funded).not.toBeNull();
    expect(paired.next.p5).not.toBeNull();
    expect(Number.isFinite(paired.next.giftP50)).toBe(true);
    const gapOld = paired.old.betas.find((row) => row.ticker === "GAP");
    const gapNew = paired.next.betas.find((row) => row.ticker === "GAP");
    expect(gapOld?.measured).toBe(false);
    expect(gapNew?.measured).toBe(false);
    expect(gapOld?.label).toContain("not measured");
    expect(gapNew?.label).toContain("not measured");
  });
});

describe("parity series", () => {
  it("is long enough for the cross-check", () => {
    const series = paritySeries();
    expect(series.asset).toHaveLength(80);
    expect(series.market).toHaveLength(80);
    const fit = fitGarch(series.asset);
    expect(fit.ok).toBe(true);
  });
});
