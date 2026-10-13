/** Ex-ante book risk: volatility, beta, marginal and component contributions, and a historical-gap stress. */

import { matVec } from "./stats";

export interface ComponentRisk {
  ticker: string;
  weight: number;
  marginal: number;
  component: number;
  percent: number;
  betaRaw: number;
  /** Window of the slope in `betaRaw`, for example "full-sample daily" or "Dimson daily". */
  betaWindow: string;
  betaShrunk: number;
  largestGap: number;
  stress: number;
}

export interface BookRisk {
  vol: number;
  betaRaw: number;
  /** Window shared by the measured betas, or "mixed windows" when names differ. */
  betaWindow: string;
  betaShrunk: number;
  components: ComponentRisk[];
  factorShare: number;
  idioShare: number;
  jumpShare: number;
  worstTicker: string;
  worstStress: number;
  note: string;
}

export function componentRisk(weights: number[], cov: number[][]): { vol: number; marginal: number[]; component: number[] } {
  const n = weights.length;
  if (n === 0 || cov.length !== n) return { vol: NaN, marginal: [], component: [] };
  const exposure = matVec(cov, weights);
  let variance = 0;
  for (let i = 0; i < n; i++) variance += weights[i] * exposure[i];
  const vol = Math.sqrt(Math.max(0, variance));
  if (!(vol > 0)) return { vol: 0, marginal: Array(n).fill(0), component: Array(n).fill(0) };
  const marginal = exposure.map((value) => value / vol);
  const component = marginal.map((value, i) => weights[i] * value);
  return { vol, marginal, component };
}

export function bookRisk(args: {
  tickers: string[];
  weights: number[];
  cov: number[][];
  betaRaw: number[];
  betaWindow?: string[];
  betaShrunk: number[];
  idioVariance: number[];
  jumpVariance: number[];
  factorVariance: number;
  largestGap: number[];
}): BookRisk {
  const total = args.weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
  const weights = args.weights.map((weight) => (total > 0 && weight > 0 ? weight / total : 0));
  const risk = componentRisk(weights, args.cov);
  let betaRaw = 0;
  let betaShrunk = 0;
  let betaMass = 0;
  let shrunkMass = 0;
  let idio = 0;
  let jump = 0;
  for (let i = 0; i < weights.length; i++) {
    if (Number.isFinite(args.betaRaw[i])) {
      betaRaw += weights[i] * args.betaRaw[i];
      betaMass += weights[i];
    }
    if (Number.isFinite(args.betaShrunk[i])) {
      betaShrunk += weights[i] * args.betaShrunk[i];
      shrunkMass += weights[i];
    }
    idio += weights[i] * weights[i] * Math.max(0, args.idioVariance[i] ?? 0);
    jump += weights[i] * weights[i] * Math.max(0, args.jumpVariance[i] ?? 0);
  }
  betaRaw = betaMass > 0 ? betaRaw / betaMass : NaN;
  betaShrunk = shrunkMass > 0 ? betaShrunk / shrunkMass : NaN;
  const modelVar = Math.max(0, args.factorVariance) + idio + jump;
  const components: ComponentRisk[] = args.tickers.map((ticker, i) => ({
    ticker,
    weight: weights[i],
    marginal: risk.marginal[i] ?? 0,
    component: risk.component[i] ?? 0,
    percent: risk.vol > 0 ? (risk.component[i] ?? 0) / risk.vol : 0,
    betaRaw: args.betaRaw[i] ?? NaN,
    betaWindow: args.betaWindow?.[i] ?? "",
    betaShrunk: args.betaShrunk[i] ?? NaN,
    largestGap: args.largestGap[i] ?? 0,
    stress: weights[i] * (args.largestGap[i] ?? 0),
  }));
  let worstTicker = "";
  let worstStress = 0;
  for (const row of components) {
    if (row.stress < worstStress) {
      worstStress = row.stress;
      worstTicker = row.ticker;
    }
  }
  const windows = [...new Set((args.betaWindow ?? []).filter((window) => window.length > 0))];
  return {
    vol: risk.vol,
    betaRaw,
    betaWindow: windows.length === 0 ? "" : windows.length === 1 ? windows[0] : "mixed windows",
    betaShrunk,
    components,
    factorShare: modelVar > 0 ? args.factorVariance / modelVar : NaN,
    idioShare: modelVar > 0 ? idio / modelVar : NaN,
    jumpShare: modelVar > 0 ? jump / modelVar : NaN,
    worstTicker,
    worstStress,
    note: "Ex-ante vol and component risk use the shrunk covariance. Component risk sums to that vol. Idiosyncratic and jump shares use the factor decomposition, not a second copy of the shrunk matrix. The shrunk beta is not a measured beta. The stress applies each name's worst historical one-day gap to its weight and leaves the other names unchanged.",
  };
}
