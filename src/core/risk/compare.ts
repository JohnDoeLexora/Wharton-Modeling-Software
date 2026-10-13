/**
 * Old versus new risk inputs on the locked case model.
 * Old: monthly vol, Blume beta toward 1, a fixed jump class, df = 5.
 * New: horizon vol, Vasicek beta (not measured), fitted jumps, fitted df.
 * Cash flows are read from the case module and are not edited.
 */

import { caseContribution, OPERATING_PAYMENT } from "../case";
import { zeroAssumptions } from "../defaults";
import { runModel } from "../run";
import type { Assumptions, BasketName } from "../types";
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

export interface PairedComparison {
  trials: number;
  seed: number;
  old: MethodSummary;
  next: MethodSummary;
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

function basketRow(card: NameCard, weight: number, mode: "old" | "new"): BasketName {
  const monthlyBeta = card.beta?.monthly.beta ?? 0;
  const blume = Number.isFinite(monthlyBeta) ? blumeBeta(monthlyBeta) : 1;
  const monthlyVol = Number.isFinite(card.vol.realizedMonthly) ? card.vol.realizedMonthly : card.vol.realizedDaily;
  const klass = JUMP_CLASSES[fallbackJumpClass(card.role, card.quality.ipoShort, card.vol.realizedDaily)];
  const oldIdio = Math.sqrt(Math.max(0, monthlyVol * monthlyVol));
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

export function assumptionsForMethod(report: RiskReport, mode: "old" | "new", trials: number, seed = 42): Assumptions {
  const assumptions = zeroAssumptions();
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
    marketMu: 0,
    marketSigma: mode === "new" ? report.marketHorizon : report.marketMonthly,
    studentDf: mode === "new" ? Math.min(30, Math.max(3, Math.round(report.marketDf))) : 5,
    sectorSigma: 0,
    regimeDrag: 0,
  };
  assumptions.basket = heldCards(report).map((row) => basketRow(row.card, row.weight, mode));
  assumptions.mixes = [];
  return assumptions;
}

function summarize(label: string, assumptions: Assumptions, report: RiskReport, mode: "old" | "new"): MethodSummary {
  const output = runModel(assumptions);
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
export function compareMethods(report: RiskReport, trials = 200, seed = 42): PairedComparison {
  const oldAssumptions = assumptionsForMethod(report, "old", trials, seed);
  const newAssumptions = assumptionsForMethod(report, "new", trials, seed);
  return {
    trials,
    seed,
    old: summarize("old monthly + Blume + jump class", oldAssumptions, report, "old"),
    next: summarize("new horizon + Vasicek + fitted jumps", newAssumptions, report, "new"),
    cash2027: caseContribution(2027),
    cash2028: caseContribution(2028),
    payment: OPERATING_PAYMENT,
    note: "Same seed, same locked cash flows, same zero rate path. The only change is the equity risk inputs. P(funded), p5 wealth, and gift percentiles are sample results, not a recommendation.",
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
    const row = basketRow(card, name.weight, "new");
    return { ...name, ...row, id: name.id, weight: name.weight, linkNote: name.linkNote };
  });
  for (const component of report.book?.components ?? []) {
    if (seen.has(component.ticker)) continue;
    const card = byTicker.get(component.ticker);
    if (!card) continue;
    basket.push(basketRow(card, component.weight, "new"));
  }
  return { ...assumptions, basket, tag: "edited" };
}
