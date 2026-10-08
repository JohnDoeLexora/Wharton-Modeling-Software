import { describe, expect, it } from "vitest";
import { backtestWindows, historyFromSnapshots, parseFrenchAnnual } from "./backtest";
import { asOfYear, calibrateSnapshot, estimateDynamics, parseYieldCsv } from "./calibrate";
import { OPERATING_PAYMENT } from "./case";
import { zeroAssumptions } from "./defaults";
import { convergenceCurve, metricSpread, modelRisk, seedStability } from "./diagnostics";
import { fanSummary } from "./fanMirror";
import { defaultRules } from "./holdings";
import { assetKeyRates, immunizationGap, liabilityStats, surplusAtRisk } from "./immunize";
import {
  accruedInterest,
  applyFundExpense,
  billEtfReturn,
  billEtfSimpleYield,
  billReinvestment,
  bucketYear,
  dirtyFromCashFlows,
  flatYield,
  fundSnapshot,
  fundYearReturn,
  htmBookValue,
  keyRateDurations,
  mtmValue,
  parseBucketCsv,
  priceTreasury,
  rollBuckets,
  targetMaturityValue,
  treasuryCashFlows,
} from "./instruments";
import {
  FLOOR_POLICY,
  QUOTE_FLOOR,
  discountCurve,
  fitAr1,
  fitNelsonSiegel,
  fitSvensson,
  modelYield,
  quoteYield,
} from "./nelson";
import { evolveShortRate, zeroRateParams } from "./rates";
import { runModel } from "./run";
import { parseFills, trackingReport, winsPnlEntersProjection, WINS_PNL_LABEL } from "./tracking";
import { buildTradeNote, noteCount, TRADE_NOTE_LIMIT } from "./tradeNote";

const factors = {
  beta0: 0.04,
  beta1: 0,
  beta2: 0,
  beta3: 0,
  lambda: 0.6,
  lambda2: 0.3,
};

describe("shared quote floor and Nelson-Siegel discounts", () => {
  it("floors every quote at zero and keeps the factor state", () => {
    expect(QUOTE_FLOOR).toBe(0);
    expect(FLOOR_POLICY).toBe("zero-floor-on-quotes");
    expect(quoteYield(-0.05)).toBe(0);
    const three = evolveShortRate({ ...zeroRateParams(), r0: 0.01, sigma: 1, curveModel: "three_point" }, () => -10);
    expect(Math.min(...three.map((row) => row.short))).toBe(0);
    const deep = evolveShortRate(
      { ...zeroRateParams(), useFactorStart: true, beta0: -0.03, beta1: -0.02, curveModel: "nelson_siegel" },
      () => 0,
    );
    expect(deep[0].short).toBe(0);
    expect(deep[0].beta0).toBeCloseTo(-0.03, 8);
    const shocked = evolveShortRate({ ...zeroRateParams(), r0: 0.02, sigma: 2, curveModel: "nelson_siegel" }, () => -5);
    expect(shocked.every((row) => row.short >= 0 && row.intermediate >= 0 && row.long >= 0)).toBe(true);
  });

  it("keeps discount factors positive and decreasing on a positive curve", () => {
    const strict = discountCurve(factors, [1, 2, 5, 10, 30]);
    expect(strict.every((knot) => knot.df > 0 && knot.df <= 1)).toBe(true);
    for (let index = 1; index < strict.length; index++) expect(strict[index].df).toBeLessThan(strict[index - 1].df);
    const dipped = discountCurve(
      { beta0: 0.05, beta1: -0.2, beta2: 0.3, beta3: 0, lambda: 0.6, lambda2: 0.3 },
      [1, 2, 5, 10, 30],
    );
    for (let index = 1; index < dipped.length; index++) expect(dipped[index].df).toBeLessThanOrEqual(dipped[index - 1].df + 1e-12);
    expect(dipped.every((knot) => knot.df > 0)).toBe(true);
  });
});

describe("cash-flow instruments", () => {
  it("prices a coupon bond as the sum of discounted cash flows", () => {
    const yieldAt = flatYield(0.04);
    const flows = treasuryCashFlows(0.04, 2.25, 100);
    const dirty = dirtyFromCashFlows(flows, yieldAt);
    const manual = flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1.04, flow.time), 0);
    expect(dirty).toBeCloseTo(manual, 8);
    const quote = priceTreasury({ coupon: 0.04, yearsToMaturity: 2.25, face: 100, yieldAt });
    expect(quote.accrued).toBeGreaterThan(0);
    expect(quote.clean).toBeCloseTo(quote.dirty - quote.accrued, 10);
    const onCoupon = priceTreasury({ coupon: 0.04, yearsToMaturity: 2, face: 100, yieldAt: flatYield(0) });
    expect(accruedInterest(0.04, 2, 100)).toBe(0);
    expect(onCoupon.accrued).toBe(0);
    expect(onCoupon.dirty).toBeCloseTo(onCoupon.flows.reduce((sum, flow) => sum + flow.amount, 0), 8);
    expect(onCoupon.clean).toBeCloseTo(onCoupon.dirty, 8);
  });

  it("earns the yield on an unchanged curve and meets at maturity", () => {
    const zero = bucketYear({ maturityYears: 5, weight: 1, coupon: 0 }, flatYield(0.04), flatYield(0.04));
    expect(zero.gross).toBeCloseTo(0.04, 8);
    expect(htmBookValue({ coupon: 0.03, yearsToMaturity: 4, yearsHeld: 4, purchaseYield: 0.02, face: 100 })).toBe(100);
    expect(mtmValue({ coupon: 0.03, yearsToMaturity: 4, yearsHeld: 4, yieldAt: flatYield(0.06), face: 100 })).toBe(100);
    expect(targetMaturityValue(0, flatYield(0.05), 0.03, 100)).toBe(100);
    expect(targetMaturityValue(1, flatYield(0.04), 0, 1)).toBeCloseTo(1 / 1.04, 8);
  });

  it("drags expenses monotonically and shows bill reinvestment", () => {
    const gross = 0.05;
    const none = applyFundExpense(gross, 0);
    const low = applyFundExpense(gross, 0.001);
    const high = applyFundExpense(gross, 0.005);
    expect(none).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(high);
    expect(billEtfSimpleYield(0.04, 0.001)).toBeCloseTo(0.039, 10);
    expect(billEtfReturn(0.04, 0.001)).toBeCloseTo(1.04 * 0.999 - 1, 10);
    const path = billReinvestment([0.04, 0.01], 0.001);
    expect(path.reinvested.at(-1)).not.toBeCloseTo(path.locked.at(-1) ?? 0, 6);
    const book = {
      buckets: [{ maturityYears: 10, weight: 1, coupon: 0 }],
      expenseRatio: 0,
      style: "constant_maturity" as const,
      yearsToTarget: 0,
    };
    const cheap = fundYearReturn(book, flatYield(0.03), flatYield(0.03));
    const costly = fundYearReturn({ ...book, expenseRatio: 0.002 }, flatYield(0.03), flatYield(0.03));
    expect(cheap).toBeGreaterThan(costly);
    const lowCurve = fundSnapshot(book.buckets, flatYield(0.02));
    const highCurve = fundSnapshot(book.buckets, flatYield(0.06));
    expect(lowCurve.duration).not.toBeCloseTo(highCurve.duration, 3);
    expect(rollBuckets(book.buckets, "constant_maturity")[0].maturityYears).toBe(10);
    expect(rollBuckets([{ maturityYears: 7, weight: 1, coupon: 0.02 }], "target_maturity")[0].maturityYears).toBe(6);
  });

  it("reports liability key rates and an immunization gap", () => {
    const yieldAt = flatYield(0);
    const atZero = liabilityStats(2033, yieldAt);
    expect(atZero.pv).toBeCloseTo(OPERATING_PAYMENT * 10, 6);
    const yieldCurve = flatYield(0.04);
    const liability = liabilityStats(2033, yieldCurve);
    expect(liability.pv).toBeLessThan(atZero.pv);
    expect(liability.modifiedDuration).toBeGreaterThan(0);
    expect(liability.convexity).toBeGreaterThan(0);
    expect(liability.keyRates.some((row) => row.krd > 0)).toBe(true);
    const buckets = [{ maturityYears: 10, weight: 1, coupon: 0.04 }];
    const assets = assetKeyRates({ buckets, marketValue: liability.pv, yieldAt: yieldCurve });
    const gap = immunizationGap(assets, liability);
    expect(gap.length).toBeGreaterThan(0);
    expect(gap.every((row) => Number.isFinite(row.gap))).toBe(true);
    expect(gap.reduce((sum, row) => sum + row.gap, 0)).toBeCloseTo(
      gap.reduce((sum, row) => sum + row.assetDollar - row.liabilityDollar, 0),
      6,
    );
    const snap = fundSnapshot(buckets, yieldCurve);
    const shocks = surplusAtRisk({
      assetValue: liability.pv,
      assetDuration: snap.duration,
      assetConvexity: snap.convexity,
      liability,
      yieldAt: yieldCurve,
      shocks: [{ name: "+100bp", dy: 0.01 }],
    });
    expect(shocks[0].liabilityPv).toBeLessThan(liability.pv);
    expect(Number.isFinite(shocks[0].surplusChange)).toBe(true);
    const keys = keyRateDurations({
      price: (curve) => priceTreasury({ coupon: 0, yearsToMaturity: 10, yieldAt: curve }).dirty,
      yieldAt: yieldCurve,
    });
    const ten = keys.find((row) => row.tenor === 10);
    expect(ten && ten.krd).toBeGreaterThan(1);
  });
});

describe("curve calibration and the historical window", () => {
  it("recovers a Nelson-Siegel curve and an AR(1)", () => {
    const flat = fitNelsonSiegel([
      { tenor: 1, zero: 0.04 },
      { tenor: 5, zero: 0.04 },
      { tenor: 10, zero: 0.04 },
    ]);
    expect(flat?.beta0).toBeCloseTo(0.04, 8);
    expect(flat?.beta1).toBeCloseTo(0, 8);
    expect(flat?.beta2).toBeCloseTo(0, 8);
    expect(flat?.rmse).toBeCloseTo(0, 10);
    const known = { beta0: 0.05, beta1: -0.02, beta2: 0.01, beta3: 0.004, lambda: 0.6, lambda2: 0.3 };
    const points = [1, 2, 5, 7, 10, 20, 30].map((tenor) => ({ tenor, zero: modelYield(known, tenor) }));
    const svensson = fitSvensson(points, 0.6, 0.3);
    expect(svensson?.beta0).toBeCloseTo(known.beta0, 6);
    expect(svensson?.beta1).toBeCloseTo(known.beta1, 6);
    expect(svensson?.beta3).toBeCloseTo(known.beta3, 6);
    expect(svensson?.rows.every((row) => Math.abs(row.residual) < 1e-8)).toBe(true);
    const series = [0.02];
    for (let index = 0; index < 6; index++) series.push(0.02 + 0.5 * series[index]);
    const ar = fitAr1(series);
    expect(ar?.phi).toBeCloseTo(0.5, 8);
    expect(ar?.kappa).toBeCloseTo(0.5, 8);
    expect(ar?.theta).toBeCloseTo(0.04, 6);
    expect(ar?.sigma).toBeCloseTo(0, 8);
  });

  it("reads a Treasury wide file as percent and a long file as decimals", () => {
    const wide = parseYieldCsv("Date,1 Mo,3 Mo,2 Yr,10 Yr\n01/02/2024,0.50,5.50,4.25,4.00\n");
    expect(asOfYear(wide[0].asOf)).toBe(2024);
    expect(wide[0].points.find((point) => Math.abs(point.tenorYears - 1 / 12) < 1e-9)?.parYield).toBeCloseTo(0.005, 8);
    expect(wide[0].points.find((point) => point.tenorYears === 10)?.parYield).toBeCloseTo(0.04, 8);
    const long = [
      "as_of,tenor_years,par_yield",
      ...[2018, 2019, 2020, 2021].flatMap((year, index) => [
        `${year}-12-31,1,${(0.02 + index * 0.005).toFixed(3)}`,
        `${year}-12-31,5,${(0.03 + index * 0.004).toFixed(3)}`,
        `${year}-12-31,10,${(0.04 + index * 0.003).toFixed(3)}`,
      ]),
    ].join("\n");
    const snapshots = parseYieldCsv(long);
    expect(snapshots[0].points[0].parYield).toBeCloseTo(0.02, 8);
    const fit = calibrateSnapshot(snapshots[0]);
    expect(fit.nelson?.rows.length).toBe(3);
    expect(fit.spots.every((spot) => Number.isFinite(spot.zero))).toBe(true);
    const dynamics = estimateDynamics(snapshots);
    expect(dynamics.annual).toHaveLength(4);
    expect(dynamics.level?.sigma).toBeGreaterThanOrEqual(0);
    const history = historyFromSnapshots(snapshots, new Map([[2020, 0.1]]));
    expect(history.find((row) => row.year === 2020)?.equity).toBe(0.1);
  });

  it("rolls seven-year windows and skips a gap", () => {
    const history = Array.from({ length: 8 }, (_, index) => ({
      year: 2000 + index,
      short: 0.02,
      intermediate: 0.03,
      long: 0.04,
      equity: 0.08,
    }));
    const report = backtestWindows(history, 7);
    expect(report.windows).toHaveLength(2);
    expect(report.windows[0].billMinFunded).not.toBeNull();
    expect(report.billFundedP5).not.toBeNull();
    expect(Number.isFinite(report.billFundedP5)).toBe(true);
    expect(report.windows[0].equityGrowth).toBeGreaterThan(1);
    expect(backtestWindows(history.filter((row) => row.year !== 2003), 7).windows).toHaveLength(0);
    expect(parseFrenchAnnual("1990  10.00   2   3   4.00\n").get(1990)).toBeCloseTo(0.14, 8);
  });
});

describe("live tracking, notes, and model risk", () => {
  it("keeps WInS profit and loss out of the projection", () => {
    const fills = parseFills("ticker,qty,fill_price,date,mark_price\nEXA,10,20,2026-01-02,25\nEXB,4,50,2026-01-03,50\n");
    const rules = { ...defaultRules(), startingCapital: 450 };
    const report = trackingReport({
      fills,
      holdings: [{ id: "h1", ticker: "EXA", name: "Example A", sleeve: "Growth", weight: 0.5, kind: "stock", country: "", rationale: "Example only." }],
      market: [{ ticker: "EXA", price: 25, avgDailyVolume: 1, asOf: "2026-10-01", kind: "stock", cleanPrice: null, accrued: null, coupon: null, maturity: "", name: "Example A" }],
      rules,
    });
    expect(report.label).toBe(WINS_PNL_LABEL);
    expect(report.label).toBe("WInS P&L");
    expect(report.entersProjection).toBe(false);
    expect(winsPnlEntersProjection()).toBe(false);
    expect(report.pnl).toBeCloseTo(50, 6);
    const drift = report.weights.find((row) => row.ticker === "EXA");
    expect(drift && Math.abs(drift.drift)).toBeGreaterThan(0);
    const blocked = trackingReport({
      fills,
      holdings: [{ id: "h1", ticker: "EXA", name: "", sleeve: "Growth", weight: 1, kind: "stock", country: "", rationale: "" }],
      market: [{ ticker: "EXA", price: 25, avgDailyVolume: 1, asOf: "2026-10-01", kind: "stock", cleanPrice: null, accrued: null, coupon: null, maturity: "", name: "" }],
      rules: { ...defaultRules(), startingCapital: 100_000 },
      tradesUsed: 0,
    });
    expect(blocked.ideas.find((idea) => idea.ticker === "EXA")?.ok).toBe(false);
    expect(blocked.ideas.find((idea) => idea.ticker === "EXA")?.reason).toMatch(/volume/i);
    const budget = trackingReport({
      fills,
      holdings: [{ id: "h1", ticker: "EXA", name: "", sleeve: "Growth", weight: 0.9, kind: "stock", country: "", rationale: "" }],
      market: [{ ticker: "EXA", price: 25, avgDailyVolume: 1_000_000, asOf: "2026-10-01", kind: "stock", cleanPrice: null, accrued: null, coupon: null, maturity: "", name: "" }],
      rules: defaultRules(),
      tradesUsed: 200,
    });
    expect(budget.tradesLeft).toBe(0);
    expect(budget.ideas.some((idea) => idea.reason.includes("200"))).toBe(true);
    const before = runModel(zeroAssumptions()).scenarios.base?.find((point) => point.calendarYear === 2033)?.wealthStart;
    expect(before).toBe(450_000);
  });

  it("builds a trading note inside 300 characters", () => {
    const note = buildTradeNote({
      ticker: "EX-ETF",
      sleeve: "Funding",
      weight: 0.25,
      kind: "etf",
      role: "x".repeat(400),
      duration: 5.25,
      modeledYield: 0.041,
      expense: 0.0015,
    });
    expect(note.length).toBeLessThanOrEqual(TRADE_NOTE_LIMIT);
    expect(noteCount(note).over).toBe(false);
    expect(note).toContain("Funding");
    expect(note).toContain("25.0%");
    expect(noteCount("a".repeat(301)).over).toBe(true);
  });

  it("reports convergence, seed rows, and a model-risk spread", () => {
    const wealth = Array.from({ length: 80 }, (_, index) => 450_000 + ((index % 5) - 2) * 1_000);
    const curve = convergenceCurve(wealth, 500_000);
    expect(curve[0].trials).toBe(25);
    expect(curve.at(-1)?.trials).toBe(80);
    expect(curve.every((point) => Number.isFinite(point.standardErrorMean))).toBe(true);
    const assumptions = zeroAssumptions();
    assumptions.trials = 20;
    assumptions.seed = 7;
    assumptions.rates = { ...assumptions.rates, r0: 0.03, sigma: 0.01, sigmaSlope: 0.02 };
    assumptions.sleeves = assumptions.sleeves.map((sleeve, index) =>
      index === 1 ? { ...sleeve, kind: "intermediate", duration: 5, convexity: 28 } : sleeve,
    );
    const seeds = seedStability(assumptions, [1, 2], 12);
    expect(seeds).toHaveLength(2);
    expect(seeds.every((row) => row.p50 != null)).toBe(true);
    const risk = modelRisk(assumptions, 16);
    expect(risk.map((row) => row.curveModel)).toEqual(["nelson_siegel", "three_point", "nelson_siegel"]);
    const spread = metricSpread(risk, (row) => row.p50);
    expect(spread).not.toBeNull();
    expect(spread ?? 0).toBeGreaterThanOrEqual(0);
    expect(parseBucketCsv("maturity_years,weight,coupon,expense_ratio,style\n2,0.5,0,0.001,constant\n7,0.5,3,0.001,constant\n").expenseRatio).toBeCloseTo(0.001, 8);
  });
});

describe("fixed-point fan", () => {
  it("matches the Bend 16-trial dollars", () => {
    const fan = fanSummary(16);
    expect(fan.trials).toBe(16);
    expect(fan.trial0).toBe(570_859);
    expect(fan.mean).toBe(515_116);
    expect(fan.min).toBe(414_380);
    expect(fan.max).toBe(684_805);
  });
});
