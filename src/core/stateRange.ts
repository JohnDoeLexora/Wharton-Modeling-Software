import { percentile } from "./math";
import { standardErrorProbability } from "./metrics";
import type { MarketState2031, StateBin, StateRangeReport } from "./types";

/**
 * Out-of-sample coverage of a p10–p90 band.
 * Even trials train the bins. Odd trials are scored and never enter the bin edges.
 */
export function stateCoverage(states: MarketState2031[], wealth2033: number[]): StateRangeReport {
  const note =
    "Even trials set the bin edges. Odd trials are scored against those edges and do not move them. " +
    "The band is the 10th to 90th percentile of 2033 wealth inside a wealth bin and, when the 2031 short rate moves, a rate bin. " +
    "Coverage is the share of scored trials that land inside their bin. The interval is a normal approximation to that share.";
  const even: number[] = [];
  const odd: number[] = [];
  for (let i = 0; i < states.length; i++) (i % 2 === 0 ? even : odd).push(i);
  if (even.length < 16 || odd.length < 16) {
    return { coverage: null, coverageSe: null, coverageLow: null, coverageHigh: null, bins: [], note: `${note} This run does not have enough trials to score a bin.` };
  }

  const trainWealth = even.map((index) => states[index].wealth).sort((a, b) => a - b);
  const wealthEdges = [trainWealth[0], percentile(trainWealth, 0.5), trainWealth[trainWealth.length - 1]];
  const rates = even.map((index) => states[index].shortRate).filter((value): value is number => value !== null && Number.isFinite(value));
  const rateVaries = rates.length > 0 && Math.max(...rates) - Math.min(...rates) > 1e-8;
  const rateMid = rateVaries ? percentile(rates, 0.5) : null;
  const rateLo = rateVaries ? Math.min(...rates) : null;
  const rateHi = rateVaries ? Math.max(...rates) : null;

  function wealthBin(wealth: number): number {
    return wealth <= wealthEdges[1] ? 0 : 1;
  }
  function rateBin(rate: number | null): number {
    if (!rateVaries || rateMid === null || rate === null) return 0;
    return rate <= rateMid ? 0 : 1;
  }

  const groups = new Map<string, number[]>();
  for (const index of even) {
    const key = `${wealthBin(states[index].wealth)}|${rateBin(states[index].shortRate)}`;
    const list = groups.get(key) ?? [];
    list.push(wealth2033[index]);
    groups.set(key, list);
  }

  const bins: StateBin[] = [];
  const edges = new Map<string, { low: number; high: number }>();
  for (const [key, values] of groups) {
    const [w, r] = key.split("|").map(Number);
    const finite = values.filter((value) => Number.isFinite(value));
    const low = finite.length >= 8 ? percentile(finite, 0.1) : null;
    const high = finite.length >= 8 ? percentile(finite, 0.9) : null;
    if (low !== null && high !== null) edges.set(key, { low, high });
    bins.push({
      wealthLo: w === 0 ? wealthEdges[0] : wealthEdges[1],
      wealthHi: w === 0 ? wealthEdges[1] : wealthEdges[2],
      rateLo: !rateVaries || r === 0 ? rateLo ?? 0 : rateMid ?? 0,
      rateHi: !rateVaries || r === 1 ? rateHi ?? 0 : rateMid ?? 0,
      trainCount: finite.length,
      low,
      high,
    });
  }

  let hits = 0;
  let scored = 0;
  for (const index of odd) {
    const key = `${wealthBin(states[index].wealth)}|${rateBin(states[index].shortRate)}`;
    const edge = edges.get(key);
    if (!edge) continue;
    const wealth = wealth2033[index];
    if (!Number.isFinite(wealth)) continue;
    scored += 1;
    if (wealth >= edge.low && wealth <= edge.high) hits += 1;
  }
  if (scored === 0) {
    return { coverage: null, coverageSe: null, coverageLow: null, coverageHigh: null, bins, note };
  }
  const coverage = hits / scored;
  const coverageSe = standardErrorProbability(coverage, scored);
  const half = coverageSe === null ? null : 1.96 * coverageSe;
  return {
    coverage,
    coverageSe,
    coverageLow: half === null ? null : Math.max(0, coverage - half),
    coverageHigh: half === null ? null : Math.min(1, coverage + half),
    bins,
    note,
  };
}
