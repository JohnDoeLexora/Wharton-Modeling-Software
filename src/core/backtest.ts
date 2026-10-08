/**
 * Roll the reserve methods over historical 7-year windows.
 * Each window uses the imported curve as the realized path. Equity total returns,
 * when the file has them, are reported beside the window and are not a portfolio weight.
 * The comparison with a model tail is a sanity check. It does not calibrate a strategy.
 */

import { asOfYear, bootstrapZeros, type CurveSnapshot } from "./calibrate";
import { QUOTE_FLOOR } from "./nelson";
import { pvFromYield } from "./regimeReserve";
import { bondTotalReturn } from "./bonds";
import { OPERATING_PAYMENT, OPERATING_PAYMENTS } from "./case";

export interface HistoryYear {
  year: number;
  short: number;
  intermediate: number;
  long: number;
  /** Public equity total return during the year, if the file has one. */
  equity: number | null;
}

export interface BacktestWindow {
  startYear: number;
  endYear: number;
  billMinFunded: number | null;
  matchedMinFunded: number | null;
  billTerminalShortfall: number;
  matchedTerminalShortfall: number;
  equityGrowth: number | null;
}

export interface BacktestReport {
  windows: BacktestWindow[];
  billFundedP5: number | null;
  matchedFundedP5: number | null;
  note: string;
}

function quantile(values: number[], q: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[index];
}

function yieldAt(row: HistoryYear, tenor: number): number {
  if (tenor <= 1) return row.short;
  if (tenor >= 10) return row.long;
  if (tenor <= 5) {
    const weight = (tenor - 1) / 4;
    return row.short * (1 - weight) + row.intermediate * weight;
  }
  const weight = (tenor - 5) / 5;
  return row.intermediate * (1 - weight) + row.long * weight;
}

function roll(rows: HistoryYear[], style: "bill" | "matched"): { minFunded: number | null; terminalShortfall: number } {
  const curve = rows[0];
  if (!curve) return { minFunded: null, terminalShortfall: Number.NaN };
  let assets = style === "bill"
    ? pvFromYield(() => curve.short)
    : pvFromYield((tenor) => yieldAt(curve, tenor));
  let minFunded: number | null = null;
  let shortfall = 0;
  const years = Math.min(OPERATING_PAYMENTS, rows.length);
  for (let k = 0; k < years; k++) {
    const current = rows[k];
    const next = rows[k + 1] ?? current;
    const pv = pvFromYield((tenor) => yieldAt(current, tenor), years - k);
    if (pv > 0 && Number.isFinite(pv)) {
      const ratio = assets / pv;
      minFunded = minFunded === null ? ratio : Math.min(minFunded, ratio);
    }
    const paid = Math.max(0, Math.min(OPERATING_PAYMENT, assets));
    shortfall += OPERATING_PAYMENT - paid;
    let remaining = assets - paid;
    if (k < years - 1 && remaining > 0) {
      const result = style === "bill"
        ? bondTotalReturn({ yieldPrev: current.short, yieldNext: next.short, duration: 0.25, convexity: 0.05 }).mtm
        : bondTotalReturn({
          yieldPrev: current.intermediate,
          yieldNext: next.intermediate,
          duration: 4.5,
          convexity: 25,
        }).mtm;
      remaining *= 1 + Math.max(-0.999, result);
    }
    assets = Math.max(0, remaining);
  }
  return { minFunded, terminalShortfall: shortfall };
}

/** Seven beginning-of-year curves. Equity, when present, is the total return over each of the six intervals. */
export function backtestWindows(history: HistoryYear[], window = 7): BacktestReport {
  const ordered = [...history].filter((row) => Number.isFinite(row.year)).sort((a, b) => a.year - b.year);
  const windows: BacktestWindow[] = [];
  for (let i = 0; i + window - 1 < ordered.length; i++) {
    const slice = ordered.slice(i, i + window);
    if (slice[slice.length - 1].year - slice[0].year !== window - 1) continue;
    const bill = roll(slice, "bill");
    const matched = roll(slice, "matched");
    let equityGrowth: number | null = 1;
    for (let k = 0; k < slice.length - 1; k++) {
      const equity = slice[k].equity;
      if (equity === null || !Number.isFinite(equity)) {
        equityGrowth = null;
        break;
      }
      equityGrowth *= 1 + equity;
    }
    windows.push({
      startYear: slice[0].year,
      endYear: slice[slice.length - 1].year,
      billMinFunded: bill.minFunded,
      matchedMinFunded: matched.minFunded,
      billTerminalShortfall: bill.terminalShortfall,
      matchedTerminalShortfall: matched.terminalShortfall,
      equityGrowth,
    });
  }
  const equityNote = windows.some((row) => row.equityGrowth !== null)
    ? "Equity growth is the public total-return series compounded over the window. It is not a portfolio weight and it is not fed into the case projection."
    : "No equity total-return column was found, so the windows report only the curve-based reserve rolls.";
  return {
    windows,
    billFundedP5: quantile(windows.map((row) => row.billMinFunded ?? Number.NaN), 0.05),
    matchedFundedP5: quantile(windows.map((row) => row.matchedMinFunded ?? Number.NaN), 0.05),
    note: `Each window rolls a bill book and a duration-style book sized on that window's first curve, using the case $50,000 payments as the withdrawal schedule. ${equityNote} Compare the historical p5 of the minimum funded ratio with the model's left tail on the Decision tab. Matching them is not required.`,
  };
}

/** Last snapshot in each calendar year, with an optional equity total return for that year. */
export function historyFromSnapshots(
  snapshots: CurveSnapshot[],
  equityByYear: Map<number, number> = new Map(),
): HistoryYear[] {
  const rows = new Map<number, HistoryYear>();
  for (const snapshot of snapshots) {
    const year = asOfYear(snapshot.asOf);
    if (year === null) continue;
    const spots = bootstrapZeros(snapshot.points);
    const at = (tenor: number) => {
      const found = spots.find((spot) => Math.abs(spot.tenor - tenor) < 0.05);
      if (found) return Math.max(QUOTE_FLOOR, found.zero);
      const nearest = [...spots].sort((a, b) => Math.abs(a.tenor - tenor) - Math.abs(b.tenor - tenor))[0];
      return nearest ? Math.max(QUOTE_FLOOR, nearest.zero) : 0;
    };
    rows.set(year, {
      year,
      short: at(0.25),
      intermediate: at(5),
      long: at(10),
      equity: equityByYear.get(year) ?? null,
    });
  }
  return [...rows.values()].sort((a, b) => a.year - b.year);
}

/** Ken French annual factor file: a year and a market excess return plus RF, in percent. */
export function parseFrenchAnnual(text: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/[,\s]+/);
    if (cells.length < 5) continue;
    if (!/^\d{4}$/.test(cells[0])) continue;
    const year = Number(cells[0]);
    const excess = Number(cells[1]);
    const rf = Number(cells[4]);
    if (!Number.isFinite(excess) || !Number.isFinite(rf)) continue;
    out.set(year, (excess + rf) / 100);
  }
  return out;
}
