/**
 * Recompute a quoted statistic on three windows and cite the file it came from.
 * MODEL_SPEC §8. The tool does not decide which window a memo should have used.
 */
import { sha256Hex } from "./hash";

export type StatId = "vol" | "beta" | "correlation" | "maxDrawdown" | "return" | "sharpe" | "yield" | "duration" | "spread";
export type WindowId = "1y_daily" | "3y_weekly" | "5y_monthly";

export interface PriceFrame {
  /** ISO dates, ascending, one row per observation. */
  dates: string[];
  prices: Record<string, number[]>;
  /** Level series (yield, duration, spread) aligned to `dates`. Optional. */
  levels?: Record<string, number[]>;
  asOf: string;
  sourceFile: string;
  sha256: string;
}

export interface Claim {
  id: string;
  stat: StatId;
  asset: string;
  benchmark?: string;
  quoted: number;
}

export interface WindowValue {
  window: WindowId;
  value: number | null;
  se: number | null;
  observations: number;
}

export interface Citation {
  id: string;
  stat: StatId;
  asset: string;
  quoted: number;
  windows: WindowValue[];
  sourceFile: string;
  sha256: string;
  asOf: string;
  estimator: string;
  outsideRange: boolean;
  stale: boolean;
  text: string;
}

const WINDOWS: { id: WindowId; label: string; periods: number; perYear: number; sample: "daily" | "weekly" | "monthly" }[] = [
  { id: "1y_daily", label: "1y daily", periods: 252, perYear: 252, sample: "daily" },
  { id: "3y_weekly", label: "3y wkly", periods: 156, perYear: 52, sample: "weekly" },
  { id: "5y_monthly", label: "5y mo", periods: 60, perYear: 12, sample: "monthly" },
];

const ESTIMATOR: Record<StatId, string> = {
  vol: "sample standard deviation of simple returns, n−1, times sqrt(periods per year)",
  beta: "OLS slope versus the benchmark, with the usual residual standard error",
  correlation: "Pearson correlation of simple returns",
  maxDrawdown: "peak-to-trough decline of the price index inside the window",
  return: "annualized geometric return of simple returns",
  sharpe: "mean simple return divided by its sample standard deviation, times sqrt(periods per year), excess over zero",
  yield: "mean of the yield level inside the window",
  duration: "mean of the duration level inside the window",
  spread: "mean of the spread level inside the window",
};

export function frameFromCsv(text: string, sourceFile: string, asOf?: string): PriceFrame {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("A price file needs a header and one row.");
  const header = splitCsv(lines[0]);
  const dateIndex = header.findIndex((name) => name.toLowerCase() === "date");
  if (dateIndex < 0) throw new Error("A price file needs a date column.");
  const columns = header.map(() => [] as number[]);
  const dates: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    dates.push(cells[dateIndex] ?? "");
    header.forEach((_, index) => {
      if (index === dateIndex) return;
      const value = Number(cells[index]);
      columns[index].push(Number.isFinite(value) ? value : Number.NaN);
    });
  }
  const prices: Record<string, number[]> = {};
  const levels: Record<string, number[]> = {};
  header.forEach((name, index) => {
    if (index === dateIndex) return;
    const key = name.trim();
    if (/yield|duration|spread/i.test(key)) levels[key] = columns[index];
    else prices[key] = columns[index];
  });
  const last = dates[dates.length - 1] ?? "";
  return {
    dates,
    prices,
    levels,
    asOf: asOf ?? last,
    sourceFile,
    sha256: sha256Hex(text),
  };
}

function splitCsv(line: string): string[] {
  return line.split(",").map((cell) => cell.trim());
}

export function tradingDaysBetween(asOf: string, today: string): number {
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  let days = 0;
  for (let t = start + 86_400_000; t <= end; t += 86_400_000) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

export function verifyClaims(frame: PriceFrame, claims: Claim[], today: string): Citation[] {
  return claims.map((claim) => cite(frame, claim, today));
}

export function citationTable(rows: Citation[]): string {
  const header = "| Claim | Citation | Flags |";
  const rule = "| --- | --- | --- |";
  const body = rows.map((row) => `| ${row.id} | ${row.text} | ${flagsOf(row)} |`);
  return [header, rule, ...body].join("\n");
}

function flagsOf(row: Citation): string {
  const flags = [row.outsideRange ? "outside the cross-window range" : "", row.stale ? "stale" : ""].filter(Boolean);
  return flags.length > 0 ? flags.join("; ") : "ok";
}

function cite(frame: PriceFrame, claim: Claim, today: string): Citation {
  const windows = WINDOWS.map((spec) => windowValue(frame, claim, spec));
  const finite = windows.map((row) => row.value).filter((value): value is number => value !== null && Number.isFinite(value));
  const low = finite.length ? Math.min(...finite) : Number.NaN;
  const high = finite.length ? Math.max(...finite) : Number.NaN;
  const outsideRange = finite.length > 0 && (claim.quoted < low - tolerance(low) || claim.quoted > high + tolerance(high));
  const stale = tradingDaysBetween(frame.asOf, today) > 5;
  const text = formatCitation(claim, windows, frame);
  return {
    id: claim.id,
    stat: claim.stat,
    asset: claim.asset,
    quoted: claim.quoted,
    windows,
    sourceFile: frame.sourceFile,
    sha256: frame.sha256,
    asOf: frame.asOf,
    estimator: ESTIMATOR[claim.stat],
    outsideRange,
    stale,
    text,
  };
}

function tolerance(value: number): number {
  return Math.max(1e-12, Math.abs(value) * 1e-9);
}

function formatCitation(claim: Claim, windows: WindowValue[], frame: PriceFrame): string {
  const symbol = claim.stat === "beta" ? "β" : claim.stat;
  const parts = windows.map((row, index) => {
    const spec = WINDOWS[index];
    const shown = row.value === null || !Number.isFinite(row.value) ? "n/a" : formatNum(row.value);
    if (claim.stat === "beta" && index === 0) {
      const se = row.se === null || !Number.isFinite(row.se) ? "n/a" : formatNum(row.se);
      return `${spec.label}, SE ${se}`;
    }
    return `${spec.label} ${shown}`;
  });
  const sha = frame.sha256.slice(0, 4);
  return `${symbol} = ${formatNum(claim.quoted)} (${parts[0]}; ${parts[1]}; ${parts[2]}), src ${frame.sourceFile} sha ${sha}…, as of ${frame.asOf}`;
}

function formatNum(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toPrecision(3);
  return value.toFixed(2);
}

interface WindowSpec {
  id: WindowId;
  label: string;
  periods: number;
  perYear: number;
  sample: "daily" | "weekly" | "monthly";
}

function windowValue(frame: PriceFrame, claim: Claim, spec: WindowSpec): WindowValue {
  if (claim.stat === "yield" || claim.stat === "duration" || claim.stat === "spread") {
    const series = levelSeries(frame, claim.asset, claim.stat);
    const slice = sampleLevels(frame.dates, series, spec);
    return { window: spec.id, value: mean(slice), se: standardError(slice), observations: slice.length };
  }
  const asset = sampleReturns(frame, claim.asset, spec);
  if (claim.stat === "vol") {
    return { window: spec.id, value: annualizedVol(asset, spec.perYear), se: null, observations: asset.length };
  }
  if (claim.stat === "return") {
    return { window: spec.id, value: annualizedReturn(asset, spec.perYear), se: null, observations: asset.length };
  }
  if (claim.stat === "sharpe") {
    return { window: spec.id, value: sharpe(asset, spec.perYear), se: null, observations: asset.length };
  }
  if (claim.stat === "maxDrawdown") {
    const prices = samplePrices(frame, claim.asset, spec);
    return { window: spec.id, value: maxDrawdown(prices), se: null, observations: prices.length };
  }
  const benchmarkName = claim.benchmark ?? "benchmark";
  const benchmark = sampleReturns(frame, benchmarkName, spec);
  const n = Math.min(asset.length, benchmark.length);
  const y = asset.slice(asset.length - n);
  const x = benchmark.slice(benchmark.length - n);
  if (claim.stat === "correlation") {
    return { window: spec.id, value: pearson(y, x), se: null, observations: n };
  }
  const fit = ols(y, x);
  return { window: spec.id, value: fit.slope, se: fit.se, observations: n };
}

function levelSeries(frame: PriceFrame, asset: string, stat: StatId): number[] {
  const levels = frame.levels ?? {};
  const direct = levels[asset] ?? levels[`${asset}_${stat}`] ?? levels[stat];
  if (direct) return direct;
  const match = Object.entries(levels).find(([name]) => name.toLowerCase().includes(asset.toLowerCase()) && name.toLowerCase().includes(stat));
  return match ? match[1] : [];
}

function samplePrices(frame: PriceFrame, name: string, spec: WindowSpec): number[] {
  const prices = frame.prices[name] ?? [];
  return sampleLevels(frame.dates, prices, spec);
}

function sampleReturns(frame: PriceFrame, name: string, spec: WindowSpec): number[] {
  const prices = samplePrices(frame, name, { ...spec, periods: spec.periods + 1 });
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const next = prices[i];
    if (prev > 0 && Number.isFinite(next)) returns.push(next / prev - 1);
  }
  return returns.slice(-spec.periods);
}

function sampleLevels(dates: string[], values: number[], spec: WindowSpec): number[] {
  const paired: { date: string; value: number }[] = [];
  for (let i = 0; i < Math.min(dates.length, values.length); i++) {
    if (Number.isFinite(values[i])) paired.push({ date: dates[i], value: values[i] });
  }
  if (spec.sample === "daily") return paired.slice(-spec.periods).map((row) => row.value);
  if (spec.sample === "weekly") {
    const weekly: number[] = [];
    for (let i = paired.length - 1; i >= 0 && weekly.length < spec.periods; i -= 5) weekly.push(paired[i].value);
    return weekly.reverse();
  }
  const byMonth = new Map<string, number>();
  for (const row of paired) byMonth.set(row.date.slice(0, 7), row.value);
  return [...byMonth.values()].slice(-spec.periods);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values) ?? 0;
  let square = 0;
  for (const value of values) {
    const gap = value - center;
    square += gap * gap;
  }
  return Math.sqrt(square / (values.length - 1));
}

function standardError(values: number[]): number | null {
  const sd = sampleSd(values);
  if (sd === null) return null;
  return sd / Math.sqrt(values.length);
}

function annualizedVol(values: number[], perYear: number): number | null {
  const sd = sampleSd(values);
  if (sd === null) return null;
  return sd * Math.sqrt(perYear);
}

function annualizedReturn(values: number[], perYear: number): number | null {
  if (values.length === 0) return null;
  let growth = 1;
  for (const value of values) growth *= 1 + value;
  if (!(growth > 0)) return null;
  return growth ** (perYear / values.length) - 1;
}

function sharpe(values: number[], perYear: number): number | null {
  const center = mean(values);
  const sd = sampleSd(values);
  if (center === null || sd === null || sd < 1e-12) return null;
  return (center / sd) * Math.sqrt(perYear);
}

function maxDrawdown(prices: number[]): number | null {
  if (prices.length === 0) return null;
  let peak = prices[0];
  let worst = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    if (peak > 0) {
      const drop = (peak - price) / peak;
      if (drop > worst) worst = drop;
    }
  }
  return worst;
}

function pearson(y: number[], x: number[]): number | null {
  const n = Math.min(y.length, x.length);
  if (n < 3) return null;
  const ys = y.slice(0, n);
  const xs = x.slice(0, n);
  const my = mean(ys) ?? 0;
  const mx = mean(xs) ?? 0;
  let num = 0;
  let dy = 0;
  let dx = 0;
  for (let i = 0; i < n; i++) {
    const a = ys[i] - my;
    const b = xs[i] - mx;
    num += a * b;
    dy += a * a;
    dx += b * b;
  }
  if (dy <= 0 || dx <= 0) return null;
  return num / Math.sqrt(dy * dx);
}

function ols(y: number[], x: number[]): { slope: number | null; se: number | null } {
  const n = Math.min(y.length, x.length);
  if (n < 3) return { slope: null, se: null };
  const ys = y.slice(y.length - n);
  const xs = x.slice(x.length - n);
  const mx = mean(xs) ?? 0;
  const my = mean(ys) ?? 0;
  let xx = 0;
  let xy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    xx += a * a;
    xy += a * (ys[i] - my);
  }
  if (xx <= 0) return { slope: null, se: null };
  const slope = xy / xx;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const fitted = my + slope * (xs[i] - mx);
    const gap = ys[i] - fitted;
    sse += gap * gap;
  }
  const se = Math.sqrt(sse / (n - 2)) / Math.sqrt(xx);
  return { slope, se: Number.isFinite(se) ? se : null };
}
