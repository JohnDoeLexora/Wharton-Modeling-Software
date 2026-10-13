/**
 * Old versus new risk inputs on the locked case model.
 * Old: monthly vol, Blume beta toward 1, a fixed jump class, df = 5.
 * New: horizon vol, Vasicek beta (not measured), fitted jumps, fitted df.
 * Cash flows are read from the case module and are not edited.
 */

import { caseContribution, OPERATING_PAYMENT } from "../case";
import { zeroAssumptions } from "../defaults";
import { pairedDifference, pairedFunded } from "../paired";
import { runModel } from "../run";
import type { Assumptions, BasketName, ModelOutput } from "../types";
import type { NameCard, RiskReport } from "./assemble";
import { blumeBeta } from "./beta";
import { fallbackJumpClass, JUMP_CLASSES } from "./jumps";

export interface MethodSummary {
  label: string;
  funded: number | null;
  p5: number | null;
  p50: number | null;
  giftP5: number | null;
  giftP50: number | null;
  betas: { ticker: string; beta: number; measured: boolean; label: string }[];
  vols: { ticker: string; vol: number; label: string }[];
  errors: string[];
}

export interface PairedDelta {
  /** New method minus old method, same trials. */
  fundedDiff: number;
  fundedSe: number;
  wealthDiff: number;
  wealthSe: number;
  label: string;
}

export interface PairedComparison {
  trials: number;
  seed: number;
  old: MethodSummary;
  next: MethodSummary;
  paired: PairedDelta;
  cash2027: number;
  cash2028: number;
  payment: number;
  note: string;
}

function heldCards(report: RiskReport): { card: NameCard; weight: number }[] {
  const rows = report.book?.components.filter((row) => row.weight > 0) ?? [];
  return rows
    .map((row) => {
      const card = report.names.find((name) => name.ticker === row.ticker);
      return card ? { card, weight: row.weight } : null;
    })
    .filter((row): row is { card: NameCard; weight: number } => row !== null);
}

function residualMonthly(card: NameCard, marketMonthly: number): number {
  const monthlyVol = Number.isFinite(card.vol.realizedMonthly) ? card.vol.realizedMonthly : card.vol.realizedDaily;
  const beta = card.beta?.monthly.beta;
  const systematic = beta !== undefined && Number.isFinite(beta) ? beta * beta * marketMonthly * marketMonthly : 0;
  return Math.sqrt(Math.max(0, monthlyVol * monthlyVol - systematic));
}

function basketRow(card: NameCard, weight: number, mode: "old" | "new", marketMonthly: number): BasketName {
  const monthlyBeta = card.beta?.monthly.beta;
  const blume = Number.isFinite(monthlyBeta) ? blumeBeta(monthlyBeta as number) : 1;
  const klass = JUMP_CLASSES[fallbackJumpClass(card.role, card.quality.ipoShort, card.vol.realizedDaily)];
  const oldIdio = residualMonthly(card, marketMonthly);
  const useNew = mode === "new";
  const beta = useNew ? card.proposal.beta : blume;
  return {
    id: `risk-${card.ticker.toLowerCase()}`,
    ticker: card.ticker,
    name: card.ticker,
    sector: card.sector || "broad",
    linkNote: "Example",
    taiwan: false,
    alpha: 0,
    beta,
    idioSigma: useNew ? card.proposal.idioSigma : oldIdio,
    studentDf: useNew ? card.proposal.studentDf : 5,
    jumpProb: useNew ? card.proposal.jumpProb : klass.prob,
    jumpMean: useNew ? card.proposal.jumpMean : klass.mean,
    jumpLambda: useNew ? card.proposal.jumpLambda : undefined,
    fxSigma: 0,
    geoJumpProb: 0,
    geoJumpMean: 0,
    sectorBeta: 0,
    weight,
    expenseRatio: card.fund ? card.fund.feeDrag : 0,
    assumptionNote: useNew
      ? `${card.proposal.betaNote} Horizon vol. Jump source ${card.jumps.source}. Not a forecast.`
      : `Legacy monthly vol, Blume beta ${blume.toFixed(2)} (not measured), jump class ${klass.id}. Not a forecast.`,
  };
}

export function assumptionsForMethod(
  report: RiskReport,
  mode: "old" | "new",
  trials: number,
  seed = 42,
  base?: Assumptions,
): Assumptions {
  const assumptions = base ? structuredClone(base) : zeroAssumptions();
  const marketMu = assumptions.equity.marketMu;
  assumptions.trials = trials;
  assumptions.seed = seed;
  assumptions.tag = "edited";
  assumptions.sleeves = assumptions.sleeves.map((sleeve, index) =>
    index === 0 ? { ...sleeve, kind: "basket" as const, name: "Risk example sleeve" } : sleeve,
  );
  assumptions.glide = [
    { year: 2027, weights: [1, 0] },
    { year: 2033, weights: [1, 0] },
  ];
  assumptions.equity = {
    ...assumptions.equity,
    marketMu,
    marketSigma: mode === "new" ? report.marketHorizon : report.marketMonthly,
    studentDf: mode === "new" ? Math.min(30, Math.max(3, Math.round(report.marketDf))) : 5,
    sectorSigma: 0,
  };
  assumptions.basket = heldCards(report).map((row) => basketRow(row.card, row.weight, mode, report.marketMonthly));
  assumptions.mixes = [];
  assumptions.diagnostics = undefined;
  return assumptions;
}

function summarize(label: string, assumptions: Assumptions, report: RiskReport, mode: "old" | "new", output: ModelOutput): MethodSummary {
  const metrics = output.metrics;
  const rows = heldCards(report);
  return {
    label,
    funded: metrics?.fullyFundedProbability ?? null,
    p5: metrics?.wealthPercentiles["5"] ?? null,
    p50: metrics?.wealthPercentiles["50"] ?? null,
    giftP5: metrics?.facilityPercentiles["5"] ?? null,
    giftP50: metrics?.facilityPercentiles["50"] ?? null,
    betas: rows.map((row) => {
      const name = assumptions.basket.find((item) => item.ticker === row.card.ticker);
      return {
        ticker: row.card.ticker,
        beta: name?.beta ?? NaN,
        measured: false,
        label: mode === "new" ? "Vasicek shrunk (not measured)" : "Blume legacy toward 1 (not measured)",
      };
    }),
    vols: rows.map((row) => ({
      ticker: row.card.ticker,
      vol: mode === "new" ? row.card.modelVol : row.card.vol.oldMonthly,
      label: mode === "new" ? "horizon forecast" : "full-sample monthly",
    })),
    errors: output.errors,
  };
}

/** Paired case-model run. The example book is an input. It is not a recommendation. */
export function compareMethods(report: RiskReport, trials = 200, seed = 42, base?: Assumptions): PairedComparison {
  const oldAssumptions = assumptionsForMethod(report, "old", trials, seed, base);
  const newAssumptions = assumptionsForMethod(report, "new", trials, seed, base);
  const oldOutput = runModel(oldAssumptions);
  const newOutput = runModel(newAssumptions);
  const oldWealth = oldOutput.monteCarlo?.wealth2033 ?? [];
  const newWealth = newOutput.monteCarlo?.wealth2033 ?? [];
  const funded = pairedFunded(oldWealth, newWealth, oldOutput.monteCarlo?.reserve ?? [], newOutput.monteCarlo?.reserve ?? []);
  const wealth = pairedDifference(oldWealth, newWealth);
  const paired: PairedDelta = {
    fundedDiff: funded.mean,
    fundedSe: funded.se,
    wealthDiff: wealth.mean,
    wealthSe: wealth.se,
    label: "Paired difference (new − old) under common random numbers. Levels of P(funded) are not the comparison.",
  };
  const mu = oldAssumptions.equity.marketMu;
  return {
    trials,
    seed,
    old: summarize("old monthly + Blume + jump class", oldAssumptions, report, "old", oldOutput),
    next: summarize("new horizon + Vasicek + fitted jumps", newAssumptions, report, "new", newOutput),
    paired,
    cash2027: caseContribution(2027),
    cash2028: caseContribution(2028),
    payment: OPERATING_PAYMENT,
    note: `Paired difference of the new method minus the old method. Market drift is the caller's market μ (${mu}). Reserve settings are the caller's. ${paired.label}`,
  };
}

/** Copy new estimates onto matching basket rows. Shrunk betas stay labeled as not measured. */
export function copyProposals(assumptions: Assumptions, report: RiskReport): Assumptions {
  const byTicker = new Map(report.names.map((card) => [card.ticker, card]));
  const seen = new Set<string>();
  const basket = assumptions.basket.map((name) => {
    const card = byTicker.get(name.ticker);
    if (!card) return name;
    seen.add(name.ticker);
    const row = basketRow(card, name.weight, "new", report.marketMonthly);
    return { ...name, ...row, id: name.id, weight: name.weight, linkNote: name.linkNote };
  });
  for (const component of report.book?.components ?? []) {
    if (seen.has(component.ticker)) continue;
    const card = byTicker.get(component.ticker);
    if (!card) continue;
    basket.push(basketRow(card, component.weight, "new", report.marketMonthly));
  }
  return { ...assumptions, basket, tag: "edited" };
}
