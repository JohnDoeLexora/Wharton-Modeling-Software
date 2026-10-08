import { describe, expect, it } from "vitest";
import { zeroAssumptions } from "./defaults";
import { assumptionsFromHoldings } from "./book";
import {
  buildTradeSheet,
  checkOrder,
  defaultRules,
  diffHoldings,
  holdingsFromCsv,
  holdingsToCsv,
  marketFromCsv,
  sleeveTotals,
  standardErrorProbability,
  tradeSheetToCsv,
  type Holding,
  type MarketRow,
} from "./holdings";
import { applyStress, STRESS_PRESETS } from "./stress";

function holding(partial: Partial<Holding> & Pick<Holding, "ticker" | "weight">): Holding {
  return {
    id: partial.ticker,
    name: partial.name ?? partial.ticker,
    sleeve: partial.sleeve ?? "Growth",
    kind: partial.kind ?? "stock",
    country: partial.country ?? "",
    rationale: partial.rationale ?? "example row",
    ...partial,
  };
}

function quote(partial: Partial<MarketRow> & Pick<MarketRow, "ticker" | "price">): MarketRow {
  return {
    avgDailyVolume: 1_000_000,
    asOf: "2026-10-01",
    kind: "stock",
    cleanPrice: null,
    accrued: null,
    coupon: null,
    maturity: "",
    name: partial.ticker,
    ...partial,
  };
}

describe("holdings and the trade sheet", () => {
  it("starts from the 2026 trading-details defaults and an empty book", () => {
    const rules = defaultRules();
    expect(rules.startingCapital).toBe(300_000);
    expect(rules.minStockPrice).toBe(5);
    expect(rules.maxTrades).toBe(200);
    expect(rules.volumeMultiple).toBe(2);
    expect(rules.allowShort).toBe(false);
    expect(rules.allowMargin).toBe(false);
    expect(rules.bondCountries).toEqual(["US", "UK", "DE", "FR", "IT", "NL"]);
    expect(rules.source).toContain("2026 WInS Trading Details");
  });

  it("buys whole shares, leaves cash, and never spends more than the capital", () => {
    const rules = defaultRules();
    const rows = [
      holding({ ticker: "EXA", weight: 0.5, sleeve: "Growth" }),
      holding({ ticker: "EXB", weight: 0.5, sleeve: "Funding" }),
    ];
    const market = [quote({ ticker: "EXA", price: 381 }), quote({ ticker: "EXB", price: 17.5 })];
    const sheet = buildTradeSheet(rows, market, rules);
    expect(sheet.balanced).toBe(true);
    expect(sheet.total).toBe(300_000);
    expect(sheet.cash).toBeGreaterThanOrEqual(0);
    const spent = sheet.orders.reduce((sum, order) => sum + order.amount, 0);
    expect(spent + sheet.cash).toBeCloseTo(300_000, 2);
    expect(spent).toBeLessThanOrEqual(300_000);
    for (const order of sheet.orders) expect(Number.isInteger(order.qty)).toBe(true);
    expect(sheet.orders.every((order) => order.check.ok)).toBe(true);
    expect(sleeveTotals(rows).map((row) => row.sleeve).sort()).toEqual(["Funding", "Growth"]);
  });

  it("rejects a stock under $5, a short, an unknown treasury, and an oversized order", () => {
    const rules = defaultRules();
    const cheap = holding({ ticker: "PENNY", weight: 0.1 });
    expect(checkOrder({ holding: cheap, qty: 10, price: 4, amount: 40, rules, market: quote({ ticker: "PENNY", price: 4 }), orderCount: 1 }).ok).toBe(false);
    const short = holding({ ticker: "EXA", weight: -0.1 });
    expect(checkOrder({ holding: short, qty: -1, price: 10, amount: -10, rules, market: quote({ ticker: "EXA", price: 10 }), orderCount: 1 }).reason).toMatch(/Short/);
    const bond = holding({ ticker: "JP-NOTE", weight: 0.2, kind: "bond", country: "" });
    expect(checkOrder({ holding: bond, qty: 1000, price: 100, amount: 1000, rules, market: undefined, orderCount: 1 }).reason).toMatch(/treasury/);
    const fat = holding({ ticker: "EXA", weight: 0.2 });
    const wide = checkOrder({
      holding: fat,
      qty: 5_000,
      price: 10,
      amount: 50_000,
      rules,
      market: quote({ ticker: "EXA", price: 10, avgDailyVolume: 100 }),
      orderCount: 1,
    });
    expect(wide.ok).toBe(false);
    expect(wide.reason).toMatch(/volume/);
  });

  it("sizes bond face in increments and includes accrued interest", () => {
    const rules = defaultRules();
    const rows = [holding({ ticker: "US-NOTE", weight: 1, kind: "bond", country: "US", sleeve: "Funding" })];
    const market = [
      quote({
        ticker: "US-NOTE",
        price: 100,
        kind: "bond",
        cleanPrice: 99,
        accrued: 1.8,
        coupon: 4,
        maturity: "2033-01-15",
        avgDailyVolume: null,
      }),
    ];
    const sheet = buildTradeSheet(rows, market, rules);
    expect(sheet.orders[0].qty % rules.faceIncrement).toBe(0);
    expect(sheet.orders[0].check.ok).toBe(true);
    expect(sheet.balanced).toBe(true);
    expect(sheet.orders[0].amount + sheet.cash).toBeCloseTo(300_000, 2);
    expect(sheet.orders[0].amount).toBeLessThanOrEqual(300_000);
  });

  it("round-trips holdings and reads weights written as percents", () => {
    const rows = [holding({ ticker: "EXA", weight: 0.25, sleeve: "Growth" })];
    const parsed = holdingsFromCsv(holdingsToCsv(rows));
    expect(parsed[0].ticker).toBe("EXA");
    expect(parsed[0].weight).toBeCloseTo(0.25, 6);
    const percent = holdingsFromCsv("ticker,weight,kind\nEXB,40,etf\n");
    expect(percent[0].weight).toBeCloseTo(0.4, 6);
    expect(percent[0].kind).toBe("etf");
    const market = marketFromCsv("ticker,price,avg_daily_volume,as_of\nEXB,20,1000,2026-10-01\n");
    expect(market[0].avgDailyVolume).toBe(1000);
    const csv = tradeSheetToCsv(buildTradeSheet(rows, [quote({ ticker: "EXA", price: 10 })], defaultRules()));
    expect(csv).toContain("ticker_or_bond");
    expect(csv).toContain("CASH");
    expect(csv).toContain("TOTAL");
  });

  it("diffs two books and leaves assumptions alone when the book is empty", () => {
    const before = [holding({ ticker: "EXA", weight: 0.5, sleeve: "Growth" })];
    const after = [holding({ ticker: "EXA", weight: 0.2, sleeve: "Growth" }), holding({ ticker: "EXB", weight: 0.3, sleeve: "Funding" })];
    const diff = diffHoldings(before, after);
    expect(diff.find((row) => row.ticker === "EXA")?.kind).toBe("changed");
    expect(diff.find((row) => row.ticker === "EXB")?.kind).toBe("added");
    const base = zeroAssumptions();
    expect(assumptionsFromHoldings(base, [])).toBe(base);
    const next = assumptionsFromHoldings(base, after);
    expect(next.tag).toBe("edited");
    expect(next.glide[0].weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
    expect(next.sleeves).toHaveLength(2);
  });

  it("reports a sampling standard error and applies a named stress without inventing a forecast", () => {
    expect(standardErrorProbability(0.5, 100)).toBeCloseTo(0.05, 8);
    const stressed = applyStress(zeroAssumptions(), { ...STRESS_PRESETS[0], crashYear: 2029, crashShock: -0.2 });
    expect(stressed.crashYear).toBe(2029);
    expect(stressed.crashShock).toBe(-0.2);
    expect(stressed.mixes).toEqual([]);
    expect(STRESS_PRESETS.map((row) => row.id)).toEqual(["crash", "taiwan", "tails", "erp", "vol"]);
  });
});
