/**
 * Named scenarios, historical replays, factor stress, and a two- or three-state Markov fit.
 * Hypothetical rows are labeled as such. MODEL_SPEC §12.
 */

export interface ScenarioShock {
  id: string;
  label: string;
  citation: string;
  /** Factor shocks in the same order the caller lists factors. */
  shocks: Record<string, number>;
  hypothetical: boolean;
}

export const SCENARIO_LIBRARY: ScenarioShock[] = [
  {
    id: "1973-74",
    label: "1973–74 bear market",
    citation: "S&P 500 total return, about −14.7% in 1973 and −26.5% in 1974. Ibbotson SBBI / Damodaran historical returns.",
    shocks: { market: -0.37, rates: 0.02, credit: 0.01, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "1987",
    label: "1987 crash",
    citation: "S&P 500 fell 20.5% in October 1987, including −20.5% on 19 October in the Dow's published daily history. Annual equity shock here is the October move, not a full-year forecast.",
    shocks: { market: -0.205, rates: 0, credit: 0.005, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "2000-02",
    label: "2000–02 bear market",
    citation: "S&P 500 total return was negative in 2000, 2001, and 2002, a cumulative decline of about 43% from the March 2000 peak to October 2002 (Shiller, Irrational Exuberance data).",
    shocks: { market: -0.43, rates: -0.01, credit: 0.01, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "2008",
    label: "2008 credit crisis",
    citation: "S&P 500 total return −37.0% in 2008. ICE BofA US corporate OAS widened by several hundred basis points (FRED series BAMLC0A0CM).",
    shocks: { market: -0.37, rates: -0.02, credit: 0.03, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "2013-taper",
    label: "2013 taper tantrum",
    citation: "US 10-year Treasury yield rose about 100 bp from May to September 2013 after the Federal Reserve discussed tapering. FRED DGS10.",
    shocks: { market: -0.05, rates: 0.01, credit: 0.002, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "2020-covid",
    label: "2020 COVID drawdown",
    citation: "S&P 500 fell about 34% from 19 February to 23 March 2020, then recovered inside the calendar year (S&P Dow Jones Indices).",
    shocks: { market: -0.34, rates: -0.01, credit: 0.02, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "2022-rates",
    label: "2022 rates shock",
    citation: "US 10-year yield rose from about 1.5% at the end of 2021 to about 3.9% at the end of 2022. FRED DGS10. Bloomberg US Aggregate was down about 13% in 2022.",
    shocks: { market: -0.18, rates: 0.024, credit: 0.005, usdTwd: 0 },
    hypothetical: false,
  },
  {
    id: "taiwan-strait",
    label: "Taiwan Strait hypothetical",
    citation: "Team illustration. Not a historical path and not a probability. Equity and USD/TWD shocks are inputs.",
    shocks: { market: -0.25, rates: 0, credit: 0.01, usdTwd: -0.1 },
    hypothetical: true,
  },
  {
    id: "stagflation",
    label: "Stagflation illustration",
    citation: "Team illustration in the shape of 1973–74: equities down and yields up together. The sizes are inputs, not a forecast.",
    shocks: { market: -0.15, rates: 0.02, credit: 0.008, usdTwd: 0 },
    hypothetical: true,
  },
];

export interface ReplayPoint {
  calendarYear: number;
  sourceYear: number;
  returns: Record<string, number>;
}

/** Place a realized annual path onto 2027–2042, starting at `startYear` in the history. */
export function replayPath(args: {
  history: { year: number; returns: Record<string, number> }[];
  startYear: number;
  first?: number;
  last?: number;
}): ReplayPoint[] {
  const first = args.first ?? 2027;
  const last = args.last ?? 2042;
  const byYear = new Map(args.history.map((row) => [row.year, row.returns]));
  const years = args.history.map((row) => row.year).sort((a, b) => a - b);
  const origin = years.indexOf(args.startYear);
  const start = origin >= 0 ? origin : 0;
  const out: ReplayPoint[] = [];
  for (let calendar = first; calendar <= last; calendar++) {
    const source = years[(start + (calendar - first)) % Math.max(1, years.length)];
    out.push({ calendarYear: calendar, sourceYear: source ?? args.startYear, returns: byYear.get(source ?? -1) ?? {} });
  }
  return out;
}

/** Map factor shocks through holdings' exposures. r_i = sum_k B_ik f_k. */
export function applyFactorShock(exposures: number[][], factorNames: string[], shocks: Record<string, number>): number[] {
  return exposures.map((row) => row.reduce((sum, loading, index) => sum + loading * (shocks[factorNames[index]] ?? 0), 0));
}

/**
 * Smallest scalar s ≥ 0 such that wealth * (1 + s * shock) is below the reserve.
 * Returns null when no scalar up to `cap` breaks it.
 */
export function reverseStress(args: { wealth: number; reserve: number; shock: number; cap?: number }): { scale: number | null; shockedReturn: number | null } {
  if (!(args.wealth > 0) || !(args.reserve > 0)) return { scale: null, shockedReturn: null };
  if (args.wealth < args.reserve) return { scale: 0, shockedReturn: 0 };
  if (!(args.shock < 0)) return { scale: null, shockedReturn: null };
  const cap = args.cap ?? 5;
  let lo = 0;
  let hi = cap;
  if (args.wealth * (1 + hi * args.shock) >= args.reserve) return { scale: null, shockedReturn: null };
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (args.wealth * (1 + mid * args.shock) < args.reserve) hi = mid;
    else lo = mid;
  }
  return { scale: hi, shockedReturn: hi * args.shock };
}

export interface MarkovFit {
  states: number;
  transition: number[][];
  standardErrors: (number | null)[][];
  counts: number[];
  note: string;
}

/**
 * Quantile states on a return series, then the transition counts.
 * Two states split at the median. Three states split at the 1/3 and 2/3 quantiles.
 */
export function fitMarkov(returns: number[], states: 2 | 3): MarkovFit {
  const finite = returns.filter((value) => Number.isFinite(value));
  const sorted = finite.slice().sort((a, b) => a - b);
  const edges = states === 2 ? [quantile(sorted, 0.5)] : [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
  const labels = finite.map((value) => stateOf(value, edges));
  const counts = Array(states).fill(0);
  const transitions = Array.from({ length: states }, () => Array(states).fill(0));
  for (let i = 0; i < labels.length - 1; i++) {
    counts[labels[i]] += 1;
    transitions[labels[i]][labels[i + 1]] += 1;
  }
  const transition = transitions.map((row, index) => {
    const n = counts[index];
    return row.map((value) => (n > 0 ? value / n : 1 / states));
  });
  const standardErrors = transition.map((row, index) =>
    row.map((p) => (counts[index] > 0 ? Math.sqrt((p * (1 - p)) / counts[index]) : null)),
  );
  return {
    states,
    transition,
    standardErrors,
    counts,
    note: "States are quantiles of this sample. Standard errors are multinomial, sqrt(p(1−p)/n). Not a forecast of the next regime.",
  };
}

function stateOf(value: number, edges: number[]): number {
  for (let i = 0; i < edges.length; i++) if (value <= edges[i]) return i;
  return edges.length;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sorted[lo];
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}
