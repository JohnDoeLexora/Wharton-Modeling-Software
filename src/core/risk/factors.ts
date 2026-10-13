/**
 * Covariance = market + sector + Taiwan + FX, plus idiosyncratic and jump variances,
 * then a Ledoit-Wolf blend with the sample covariance.
 * Both pieces are positive semidefinite, so the blend is too. A numerical miss is clipped and flagged.
 */

import type { CleanSeries } from "./clean";
import { detectGaps } from "./jumps";
import {
  correlationFromCov,
  isPositiveSemidefinite,
  ledoitWolf,
  matMul,
  ols,
  projectPsd,
  scaleCov,
  symmetric,
  transpose,
  variance,
} from "./stats";
import { TRADING_DAYS } from "./vol";

export interface FactorModel {
  names: string[];
  factors: string[];
  /** Rows are names, columns are factors, in `factors` order. */
  betas: number[][];
  /** Annual idiosyncratic variance on non-gap days. */
  idio: number[];
  jumpVar: number[];
  factorCov: number[][];
  structured: number[][];
  sample: number[][];
  shrunk: number[][];
  correlation: number[][];
  shrinkage: number;
  psd: boolean;
  repaired: boolean;
  note: string;
}

function valuesOn(dates: string[], series: CleanSeries): number[] | null {
  const at = new Map(series.returnDates.map((date, index) => [date, series.returns[index]]));
  if (dates.some((date) => !at.has(date))) return null;
  return dates.map((date) => at.get(date) ?? 0);
}

function residualize(y: number[], x: number[]): number[] {
  const fit = ols(y, [Array(y.length).fill(1), x]);
  if (!Number.isFinite(fit.coef[1])) return y.slice();
  return y.map((value, index) => value - fit.coef[0] - fit.coef[1] * x[index]);
}

function covUnbiased(samples: number[][]): number[][] {
  const n = samples.length;
  const p = samples[0]?.length ?? 0;
  const center = Array(p).fill(0);
  for (const row of samples) for (let i = 0; i < p; i++) center[i] += row[i];
  for (let i = 0; i < p; i++) center[i] /= Math.max(1, n);
  const out = Array.from({ length: p }, () => Array(p).fill(0));
  const denom = Math.max(1, n - 1);
  for (const row of samples) {
    for (let i = 0; i < p; i++) {
      for (let j = i; j < p; j++) out[i][j] += (row[i] - center[i]) * (row[j] - center[j]);
    }
  }
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      out[i][j] /= denom;
      out[j][i] = out[i][j];
    }
  }
  return out;
}

export function factorCovariance(args: {
  names: CleanSeries[];
  market: CleanSeries | null;
  fx: CleanSeries | null;
  taiwan: CleanSeries | null;
  jumpVariance: number[];
}): FactorModel {
  const zipped = args.names
    .map((series, index) => ({ series, jump: Math.max(0, args.jumpVariance[index] ?? 0) }))
    .filter((row) => row.series.returns.length > 0 && row.series.role !== "market" && row.series.role !== "fx" && row.series.role !== "taiwan");
  const blank = (note: string): FactorModel => ({
    names: zipped.map((row) => row.series.ticker),
    factors: [],
    betas: [],
    idio: [],
    jumpVar: zipped.map((row) => row.jump),
    factorCov: [],
    structured: [],
    sample: [],
    shrunk: [],
    correlation: [],
    shrinkage: 0,
    psd: true,
    repaired: false,
    note,
  });
  if (zipped.length === 0) return blank("No names.");

  let dates = zipped[0].series.returnDates.filter((date) => zipped.every((row) => row.series.returnDates.includes(date)));
  if (args.market) dates = dates.filter((date) => args.market?.returnDates.includes(date));
  if (args.fx) dates = dates.filter((date) => args.fx?.returnDates.includes(date));
  if (args.taiwan) dates = dates.filter((date) => args.taiwan?.returnDates.includes(date));
  if (dates.length < 10) return blank("Fewer than 10 aligned sessions.");

  const panel = zipped.map((row) => valuesOn(dates, row.series) ?? []);
  const market = args.market ? valuesOn(dates, args.market) : null;
  const fx = args.fx ? valuesOn(dates, args.fx) : null;
  const taiwan = args.taiwan ? valuesOn(dates, args.taiwan) : null;

  const sectorNames = [...new Set(zipped.map((row) => row.series.sector).filter((sector) => sector !== ""))];
  const sectorRaw = new Map<string, number[]>();
  for (const sector of sectorNames) {
    const members = zipped.map((_, index) => index).filter((index) => zipped[index].series.sector === sector);
    if (members.length < 2) continue;
    const basket = dates.map((_, t) => {
      let sum = 0;
      for (const index of members) sum += panel[index][t];
      return sum / members.length;
    });
    sectorRaw.set(sector, market ? residualize(basket, market) : basket);
  }

  const factors: { name: string; values: number[] }[] = [];
  if (market) factors.push({ name: "market", values: market });
  for (const [sector, values] of sectorRaw) factors.push({ name: sector, values });
  if (taiwan) factors.push({ name: "taiwan", values: market ? residualize(taiwan, market) : taiwan });
  if (fx) factors.push({ name: "fx", values: fx });

  const betas: number[][] = [];
  const idio: number[] = [];
  zipped.forEach((row, index) => {
    const beta = Array(factors.length).fill(0);
    const columns: number[][] = [Array(dates.length).fill(1)];
    const slots: number[] = [];
    factors.forEach((factor, factorIndex) => {
      const ownSector = factor.name === row.series.sector;
      if (ownSector) {
        const peers = zipped.map((_, otherIndex) => otherIndex).filter((otherIndex) => otherIndex !== index && zipped[otherIndex].series.sector === row.series.sector);
        if (peers.length === 0) return;
        const basket = dates.map((_, t) => peers.reduce((sum, peer) => sum + panel[peer][t], 0) / peers.length);
        columns.push(market ? residualize(basket, market) : basket);
      } else if (sectorRaw.has(factor.name)) {
        return;
      } else {
        columns.push(factor.values);
      }
      slots.push(factorIndex);
    });
    const fit = ols(panel[index], columns);
    slots.forEach((factorIndex, slot) => {
      beta[factorIndex] = Number.isFinite(fit.coef[slot + 1]) ? fit.coef[slot + 1] : 0;
    });
    betas.push(beta);
    const gaps = detectGaps(panel[index], null);
    const quiet: number[] = [];
    for (let t = 0; t < dates.length; t++) {
      if (gaps[t]) continue;
      let fitted = Number.isFinite(fit.coef[0]) ? fit.coef[0] : 0;
      for (let slot = 0; slot < slots.length; slot++) {
        fitted += (Number.isFinite(fit.coef[slot + 1]) ? fit.coef[slot + 1] : 0) * columns[slot + 1][t];
      }
      quiet.push(panel[index][t] - fitted);
    }
    const daily = quiet.length > 2 ? variance(quiet, true) : variance(panel[index], true);
    idio.push(Math.max(0, Number.isFinite(daily) ? daily : 0) * TRADING_DAYS);
  });

  const factorSamples = dates.map((_, t) => factors.map((factor) => factor.values[t]));
  const factorCov = factors.length ? scaleCov(covUnbiased(factorSamples), TRADING_DAYS) : [];
  const cross = factorCov.length ? matMul(betas, factorCov) : [];
  const core = cross.length
    ? symmetric(matMul(cross, transpose(betas)))
    : Array.from({ length: zipped.length }, () => Array(zipped.length).fill(0));
  const jumpVar = zipped.map((row) => row.jump);
  const structured = core.map((line, i) => line.map((value, j) => value + (i === j ? idio[i] + jumpVar[i] : 0)));
  const samples = dates.map((_, t) => panel.map((column) => column[t]));
  const sample = scaleCov(covUnbiased(samples), TRADING_DAYS);
  const shrinkage = ledoitWolf(samples).shrinkage;
  let shrunk = symmetric(sample.map((line, i) => line.map((value, j) => (1 - shrinkage) * value + shrinkage * structured[i][j])));
  let repaired = false;
  if (!isPositiveSemidefinite(shrunk)) {
    const projected = projectPsd(shrunk);
    shrunk = projected.matrix;
    repaired = true;
  }
  return {
    names: zipped.map((row) => row.series.ticker),
    factors: factors.map((factor) => factor.name),
    betas,
    idio,
    jumpVar,
    factorCov,
    structured,
    sample,
    shrunk,
    correlation: correlationFromCov(shrunk),
    shrinkage,
    psd: isPositiveSemidefinite(shrunk),
    repaired,
    note: repaired
      ? "The Ledoit-Wolf blend was not numerically PSD. Negative eigenvalues were clipped to zero."
      : `Covariance is (1−δ) times the sample plus δ times the factor model. δ = ${shrinkage.toFixed(3)} is the Ledoit-Wolf intensity. Factors are the market, a residual sector portfolio, Taiwan, and FX.`,
  };
}
