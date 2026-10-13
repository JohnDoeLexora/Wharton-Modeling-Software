/** Daily adjusted-price import, split and stale cleaning, and a per-name data-quality report. */

export type PriceRole = "asset" | "market" | "fx" | "taiwan" | "index";

export interface PriceRow {
  date: string;
  ticker: string;
  adjClose: number;
  sector: string;
  role: PriceRole;
  benchmark: string;
  event: boolean;
  nonsync: boolean;
}

export interface QualityReport {
  ticker: string;
  observations: number;
  returnCount: number;
  missingBusinessDays: number;
  stalePrints: number;
  splitAdjustments: number;
  droppedMultiDayReturns: number;
  ipoShort: boolean;
  notes: string[];
}

export interface CleanSeries {
  ticker: string;
  sector: string;
  role: PriceRole;
  benchmark: string;
  nonsync: boolean;
  dates: string[];
  prices: number[];
  returnDates: string[];
  returns: number[];
  events: boolean[];
  quality: QualityReport;
}

const SPLIT_FACTORS = [5, 4, 3, 2, 0.5, 1 / 3, 0.25, 0.2];
const IPO_SHORT_DAYS = 252;
const STALE_RUN = 5;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function headerIndex(header: string[], names: string[]): number {
  const lowered = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, "_"));
  for (const name of names) {
    const index = lowered.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function asRole(value: string, ticker: string): PriceRole {
  const text = value.trim().toLowerCase();
  if (text === "market" || text === "fx" || text === "taiwan" || text === "index" || text === "asset") return text;
  const upper = ticker.toUpperCase();
  if (upper === "MKT" || upper === "SPX" || upper === "SPY") return "market";
  if (upper === "FX" || upper === "TWD") return "fx";
  if (upper === "TWN" || upper === "EWT") return "taiwan";
  return "asset";
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const text = value.trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}

/** Long file (`date,ticker,adj_close`) or a wide date × ticker file. */
export function parsePriceCsv(text: string): PriceRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const dateCol = headerIndex(header, ["date", "as_of", "asof"]);
  const tickerCol = headerIndex(header, ["ticker", "symbol"]);
  const priceCol = headerIndex(header, ["adj_close", "adjclose", "adjusted", "adjusted_close", "close", "price"]);
  if (tickerCol >= 0 && priceCol >= 0 && dateCol >= 0) {
    const sectorCol = headerIndex(header, ["sector"]);
    const roleCol = headerIndex(header, ["role", "kind"]);
    const benchCol = headerIndex(header, ["benchmark", "index"]);
    const eventCol = headerIndex(header, ["event", "earnings"]);
    const syncCol = headerIndex(header, ["nonsync", "nonsynchronous", "adr"]);
    const rows: PriceRow[] = [];
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const date = (cells[dateCol] ?? "").slice(0, 10);
      const ticker = (cells[tickerCol] ?? "").trim();
      const price = Number(cells[priceCol] ?? "");
      if (!date || !ticker || !Number.isFinite(price)) continue;
      rows.push({
        date,
        ticker,
        adjClose: price,
        sector: sectorCol >= 0 ? (cells[sectorCol] ?? "").trim() : "",
        role: asRole(roleCol >= 0 ? (cells[roleCol] ?? "") : "", ticker),
        benchmark: benchCol >= 0 ? (cells[benchCol] ?? "").trim() : "",
        event: truthy(cells[eventCol]),
        nonsync: truthy(cells[syncCol]),
      });
    }
    return rows;
  }
  if (dateCol < 0) return [];
  const rows: PriceRow[] = [];
  header.forEach((name, index) => {
    if (index === dateCol || name.trim() === "") return;
    const ticker = name.trim();
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const date = (cells[dateCol] ?? "").slice(0, 10);
      const price = Number(cells[index] ?? "");
      if (!date || !Number.isFinite(price)) continue;
      rows.push({
        date,
        ticker,
        adjClose: price,
        sector: "",
        role: asRole("", ticker),
        benchmark: "",
        event: false,
        nonsync: false,
      });
    }
  });
  return rows;
}

function utcDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function weekdaysBetween(start: string, end: string): number {
  const from = utcDay(start);
  const to = utcDay(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let count = 0;
  for (let t = from + 86_400_000; t < to; t += 86_400_000) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function nearestSplit(ratio: number): number | null {
  let best: number | null = null;
  let error = Infinity;
  for (const factor of SPLIT_FACTORS) {
    const gap = Math.abs(ratio - factor) / factor;
    if (gap < error) {
      error = gap;
      best = factor;
    }
  }
  return best != null && error <= 0.008 ? best : null;
}

function groupRows(rows: PriceRow[]): Map<string, PriceRow[]> {
  const grouped = new Map<string, PriceRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.ticker) ?? [];
    list.push(row);
    grouped.set(row.ticker, list);
  }
  return grouped;
}

/**
 * Sort, drop non-positive and duplicate prints, undo an unadjusted integer split,
 * and leave stale zero-returns out of the estimation sample.
 * A weekday with no print is a missing day. A return that spans a missing weekday is not a one-day return.
 */
export function cleanPrices(rows: PriceRow[]): CleanSeries[] {
  const series: CleanSeries[] = [];
  for (const [ticker, raw] of groupRows(rows)) {
    const notes: string[] = [];
    const byDate = new Map<string, PriceRow>();
    let dropped = 0;
    for (const row of raw) {
      if (!(row.adjClose > 0) || !Number.isFinite(row.adjClose)) {
        dropped += 1;
        continue;
      }
      byDate.set(row.date, row);
    }
    if (dropped > 0) notes.push(`${dropped} non-positive or non-finite prints were dropped.`);
    const ordered = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const prices = ordered.map((row) => row.adjClose);
    let splitAdjustments = 0;
    for (let i = 1; i < prices.length; i++) {
      const ratio = prices[i] / prices[i - 1];
      const factor = nearestSplit(ratio);
      if (factor == null) continue;
      if (i + 1 < prices.length) {
        const back = prices[i + 1] / prices[i];
        if (Math.abs(back * factor - 1) < 0.02) continue;
      }
      for (let j = 0; j < i; j++) prices[j] *= factor;
      splitAdjustments += 1;
    }
    if (splitAdjustments > 0) {
      notes.push(`${splitAdjustments} unadjusted split${splitAdjustments === 1 ? "" : "s"} rescaled prior prices.`);
    }
    const stale = Array(prices.length).fill(false);
    let stalePrints = 0;
    let run = 1;
    for (let i = 1; i <= prices.length; i++) {
      const same = i < prices.length && prices[i] === prices[i - 1];
      if (same) run += 1;
      else {
        if (run >= STALE_RUN) {
          for (let j = i - run; j < i; j++) stale[j] = true;
          stalePrints += run - 1;
        }
        run = 1;
      }
    }
    if (stalePrints > 0) notes.push(`${stalePrints} stale unchanged prints were left out of the estimators.`);
    const returns: number[] = [];
    const returnDates: string[] = [];
    const events: boolean[] = [];
    let missingBusinessDays = 0;
    let droppedMultiDayReturns = 0;
    for (let i = 1; i < prices.length; i++) {
      const gap = weekdaysBetween(ordered[i - 1].date, ordered[i].date);
      missingBusinessDays += gap;
      if (gap > 0) {
        droppedMultiDayReturns += 1;
        continue;
      }
      if (stale[i] || stale[i - 1]) continue;
      const value = prices[i] / prices[i - 1] - 1;
      if (!Number.isFinite(value)) continue;
      returns.push(value);
      returnDates.push(ordered[i].date);
      events.push(ordered[i].event);
    }
    if (missingBusinessDays > 0) {
      notes.push(`${missingBusinessDays} weekday gaps, including exchange holidays. Multi-day returns were not used as one-day returns.`);
    }
    const first = ordered[0];
    const ipoShort = ordered.length < IPO_SHORT_DAYS;
    if (ipoShort) notes.push(`IPO-short history: ${ordered.length} prints, under ${IPO_SHORT_DAYS} sessions.`);
    series.push({
      ticker,
      sector: first?.sector ?? "",
      role: first?.role ?? "asset",
      benchmark: first?.benchmark ?? "",
      nonsync: ordered.some((row) => row.nonsync),
      dates: ordered.map((row) => row.date),
      prices,
      returnDates,
      returns,
      events,
      quality: {
        ticker,
        observations: ordered.length,
        returnCount: returns.length,
        missingBusinessDays,
        stalePrints,
        splitAdjustments,
        droppedMultiDayReturns,
        ipoShort,
        notes,
      },
    });
  }
  series.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return series;
}

export function alignReturns(left: CleanSeries, right: CleanSeries): { dates: string[]; left: number[]; right: number[] } {
  const rightAt = new Map<string, number>();
  right.returnDates.forEach((date, index) => rightAt.set(date, right.returns[index]));
  const dates: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  left.returnDates.forEach((date, index) => {
    const value = rightAt.get(date);
    if (value === undefined) return;
    dates.push(date);
    a.push(left.returns[index]);
    b.push(value);
  });
  return { dates, left: a, right: b };
}
