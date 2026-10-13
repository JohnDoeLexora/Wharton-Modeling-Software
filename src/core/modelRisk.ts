/**
 * The same book under return models, shock models, correlation regimes, and V6 vol estimators.
 * Every row is exploration under the assumptions that produced it. MODEL_SPEC §11.
 */
import type { Assumptions } from "./types";
import { runModel } from "./run";
import { ewmaVariance, fitGarch, realizedAnnual } from "./risk/vol";
import { stdev } from "./risk/stats";

export interface ModelRiskRow {
  family: string;
  shock: string;
  correlation: string;
  returnModel: string;
  funded: number | null;
  p50: number | null;
  mean: number | null;
  note: string;
}

const NOTE = "Exploration under assumptions. Not a recommended allocation.";

export function modelRiskSpread(assumptions: Assumptions, returns: number[] = []): ModelRiskRow[] {
  const trials = Math.min(Math.max(assumptions.trials, 50), 80);
  const base = { ...assumptions, trials, mixes: [] };
  const rows: ModelRiskRow[] = [];
  const axes: { returnModel: Assumptions["returnModel"]; shock: Assumptions["shockModel"]; stress: number; repair: Assumptions["correlationRepair"] }[] = [
    { returnModel: "lognormal", shock: "parametric", stress: 0, repair: "none" },
    { returnModel: "normal", shock: "parametric", stress: 0, repair: "none" },
    { returnModel: "lognormal", shock: "parametric", stress: 1, repair: "higham" },
    { returnModel: "lognormal", shock: "block_bootstrap", stress: 0, repair: "none" },
  ];
  for (const axis of axes) {
    rows.push(runAxis(base, "stated sigma", axis));
  }
  const scales = estimatorScales(returns, base.sleeves[0]?.sigma ?? 0);
  for (const scale of scales) {
    const scaled = scaleSleeves(base, scale.ratio);
    rows.push(runAxis(scaled, scale.name, { returnModel: "lognormal", shock: "parametric", stress: 0, repair: "none" }));
  }
  return rows;
}

function runAxis(
  assumptions: Assumptions,
  family: string,
  axis: { returnModel: Assumptions["returnModel"]; shock: Assumptions["shockModel"]; stress: number; repair: Assumptions["correlationRepair"] },
): ModelRiskRow {
  const next: Assumptions = {
    ...assumptions,
    returnModel: axis.returnModel,
    shockModel: axis.shock,
    correlationStress: axis.stress,
    correlationRepair: axis.repair,
  };
  const output = runModel(next);
  const funded = output.metrics?.fullyFundedProbability ?? null;
  const p50 = output.metrics?.wealthPercentiles["50"] ?? null;
  const mean = output.metrics?.convergence.meanWealth2033 ?? null;
  const note = output.errors[0] ?? NOTE;
  return {
    family,
    shock: axis.shock,
    correlation: axis.repair === "higham" ? `stress ${axis.stress}, Higham` : `stress ${axis.stress}, no repair`,
    returnModel: axis.returnModel,
    funded: output.errors.length > 0 ? null : funded,
    p50: output.errors.length > 0 ? null : p50,
    mean: output.errors.length > 0 ? null : mean,
    note,
  };
}

function scaleSleeves(assumptions: Assumptions, ratio: number): Assumptions {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return assumptions;
  return {
    ...assumptions,
    sleeves: assumptions.sleeves.map((sleeve) => ({ ...sleeve, sigma: sleeve.sigma * ratio })),
  };
}

/** V6 families as a ratio to the sleeve's stated annual sigma. Empty when the series is too short. */
export function estimatorScales(returns: number[], statedSigma: number): { name: string; ratio: number }[] {
  if (returns.length < 30 || !(statedSigma > 0)) return [];
  const sample = stdev(returns) * Math.sqrt(252);
  const ewma = ewmaVariance(returns).annualVol;
  const garch = fitGarch(returns);
  const realized = realizedAnnual(returns.slice(-252), 252);
  const scales = [
    { name: "V6 sample daily", ratio: sample / statedSigma },
    { name: "V6 EWMA", ratio: ewma / statedSigma },
    { name: "V6 realized 1y", ratio: realized / statedSigma },
  ];
  if (garch.ok && Number.isFinite(garch.annualCurrent)) scales.push({ name: "V6 GARCH", ratio: garch.annualCurrent / statedSigma });
  return scales.filter((row) => Number.isFinite(row.ratio) && row.ratio > 0);
}
