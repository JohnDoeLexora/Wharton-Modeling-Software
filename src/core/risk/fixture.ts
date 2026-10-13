/**
 * Synthetic daily history for the example files and the tests.
 * Tickers are made up. The paths illustrate estimator disagreement, Dimson lag,
 * a split, a stale print, and a short history. They are not market data and not a book.
 */

import { holdingsFromCsv } from "../holdings";
import type { BookRow } from "./assemble";
import type { PriceRow } from "./clean";

export interface SampleBookRow {
  ticker: string;
  name: string;
  sleeve: string;
  weight: number;
  kind: "stock" | "etf";
  rationale: string;
}

const START = "2021-01-04";
const SESSIONS = 1260;

function unitNoise(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export function businessDays(start: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pricesFrom(returns: number[], start = 100): number[] {
  const prices = [start];
  for (const value of returns) prices.push(prices[prices.length - 1] * (1 + value));
  return prices;
}

function marketReturn(t: number): number {
  return 0.0002 + 0.011 * unitNoise(t, 1);
}

function gapReturn(t: number, market: number): { value: number; event: boolean } {
  const recent = t >= 1008;
  const noise = (recent ? 0.055 : 0.012) * unitNoise(t, 2);
  const beta = recent ? 0 : 0.04;
  const event = recent && t % 21 === 0;
  const jump = event ? -0.2 : 0;
  return { value: beta * market + noise + jump, event };
}

export function samplePaths(): { dates: string[]; rows: PriceRow[] } {
  const dates = businessDays(START, SESSIONS);
  const market: number[] = [];
  for (let t = 0; t < SESSIONS; t++) market.push(marketReturn(t));
  const series: { ticker: string; sector: string; role: PriceRow["role"]; benchmark: string; nonsync: boolean; returns: number[]; events: boolean[]; prices?: number[] }[] = [];

  const gap = market.map((value, t) => gapReturn(t, value));
  series.push({
    ticker: "GAP",
    sector: "education",
    role: "asset",
    benchmark: "",
    nonsync: false,
    returns: gap.map((row) => row.value),
    events: gap.map((row) => row.event),
  });
  series.push({
    ticker: "EDU",
    sector: "education",
    role: "asset",
    benchmark: "",
    nonsync: false,
    returns: market.map((value, t) => 1.05 * value + 0.008 * unitNoise(t, 3)),
    events: market.map(() => false),
  });
  series.push({
    ticker: "ADR",
    sector: "chips",
    role: "asset",
    benchmark: "",
    nonsync: true,
    returns: market.map((value, t) => 0.35 * value + 0.3 * (t > 0 ? market[t - 1] : 0) + 0.004 * unitNoise(t, 4)),
    events: market.map(() => false),
  });
  series.push({
    ticker: "CALM",
    sector: "broad",
    role: "asset",
    benchmark: "",
    nonsync: false,
    returns: market.map((value, t) => 0.8 * value + 0.004 * unitNoise(t, 5)),
    events: market.map(() => false),
  });
  series.push({
    ticker: "ETF",
    sector: "broad",
    role: "asset",
    benchmark: "MKT",
    nonsync: false,
    returns: market.map((value, t) => value - 0.002 / 252 + 0.00015 * unitNoise(t, 6)),
    events: market.map(() => false),
  });
  const staleReturns = market.map((value, t) => 0.2 * value + 0.006 * unitNoise(t, 7));
  const stalePrices = pricesFrom(staleReturns);
  for (let i = 120; i <= 127; i++) stalePrices[i] = stalePrices[120];
  for (let i = 400; i < stalePrices.length; i++) stalePrices[i] *= 0.5;
  series.push({
    ticker: "NEWCO",
    sector: "education",
    role: "asset",
    benchmark: "",
    nonsync: false,
    returns: market.slice(-40).map((value, t) => 0.1 * value + 0.03 * unitNoise(t, 8)),
    events: Array(40).fill(false),
  });

  const rows: PriceRow[] = [];
  const pushPrices = (ticker: string, sector: string, role: PriceRow["role"], benchmark: string, nonsync: boolean, prices: number[], events: boolean[], dateList: string[]) => {
    dateList.forEach((date, index) => {
      rows.push({
        date,
        ticker,
        adjClose: Math.round(prices[index] * 10000) / 10000,
        sector,
        role,
        benchmark,
        event: events[index] ?? false,
        nonsync,
      });
    });
  };

  pushPrices("MKT", "", "market", "", false, pricesFrom(market), market.map(() => false), dates);
  pushPrices(
    "FX",
    "",
    "fx",
    "",
    false,
    pricesFrom(market.map((_, t) => 0.004 * unitNoise(t, 9)), 30),
    market.map(() => false),
    dates,
  );
  pushPrices(
    "TWN",
    "region",
    "taiwan",
    "",
    false,
    pricesFrom(market.map((value, t) => 0.55 * value + 0.01 * unitNoise(t, 10))),
    market.map(() => false),
    dates,
  );
  for (const item of series) {
    if (item.ticker === "NEWCO") {
      pushPrices(item.ticker, item.sector, item.role, item.benchmark, item.nonsync, pricesFrom(item.returns, 20), item.events, dates.slice(-40));
      continue;
    }
    pushPrices(item.ticker, item.sector, item.role, item.benchmark, item.nonsync, pricesFrom(item.returns), item.events, dates);
  }
  const staleDates = dates.filter((_, index) => index !== 220);
  const staleEvents = staleDates.map(() => false);
  const staleKept = stalePrices.filter((_, index) => index !== 220);
  pushPrices("STALE", "broad", "asset", "", false, staleKept, staleEvents, staleDates);
  return { dates, rows };
}

function csvCell(value: string | number | boolean): string {
  const text = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  return text.includes(",") ? `"${text}"` : text;
}

export function buildSampleCsv(): string {
  const { rows } = samplePaths();
  const header = "date,ticker,adj_close,sector,role,benchmark,event,nonsync";
  const lines = rows.map((row) =>
    [row.date, row.ticker, row.adjClose, row.sector, row.role, row.benchmark, row.event, row.nonsync].map(csvCell).join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}

export function sampleBook(): SampleBookRow[] {
  return [
    { ticker: "GAP", name: "Example gap name", sleeve: "Growth", weight: 0.4, kind: "stock", rationale: "Example row. Not a holding. Estimators on this name disagree." },
    { ticker: "ADR", name: "Example ADR", sleeve: "Growth", weight: 0.25, kind: "stock", rationale: "Example row. Not a holding. Non-synchronous beta uses Dimson." },
    { ticker: "CALM", name: "Example calm name", sleeve: "Growth", weight: 0.2, kind: "stock", rationale: "Example row. Not a holding." },
    { ticker: "ETF", name: "Example equity ETF", sleeve: "Growth", weight: 0.15, kind: "etf", rationale: "Example row. Not a holding." },
  ];
}

/** Holdings weights from a book CSV. A column with a value outside [-1, 1] is percent. */
export function bookFromCsv(text: string): BookRow[] {
  return holdingsFromCsv(text)
    .filter((row) => row.ticker !== "")
    .map((row) => ({ ticker: row.ticker, weight: row.weight }));
}

export function sampleBookCsv(): string {
  const header = "ticker,name,sleeve,weight,kind,country,rationale";
  const lines = sampleBook().map((row) =>
    [row.ticker, row.name, row.sleeve, Math.round(row.weight * 100), row.kind, "", row.rationale].join(","),
  );
  return `${header}\n${lines.join("\n")}\n`;
}
