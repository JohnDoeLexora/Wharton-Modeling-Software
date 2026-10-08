import { caseContribution, LAST_PROJECTION_YEAR, FIRST_PROJECTION_YEAR, yearIndex } from "./case";
import { prepareCorrelation } from "./correlation";
import { weightsAtYear } from "./glide";
import { correlatedShocks, dot, normalizeSeed, simpleReturn, sum } from "./math";
import { priceTrial, sleeveKindOf, usesPricedModel, type YearSlice } from "./pricing";
import { isBondKind } from "./bonds";
import { STREAM, standardNormal, unitInterval } from "./rng";
import type { Assumptions, ReturnModel, ScenarioName, Sleeve, YearPoint } from "./types";

export interface PathInput {
  sleeves: Sleeve[];
  glide: Assumptions["glide"];
  rebalance: Assumptions["rebalance"];
  inflation: number;
  mode: "scenario" | "mc";
  scenario?: ScenarioName;
  returnModel: ReturnModel;
  normalFloor: number;
  shockModel: Assumptions["shockModel"];
  bootstrapHistory: number[][];
  blockLength: number;
  correlationStress: number;
  correlation: number[][];
  /** Master seed. Ignored on scenario paths. */
  seed: number;
  /** Trial index on stream 1. Ignored on scenario paths. */
  trial: number;
  /** Precomputed Cholesky factor of the stressed correlation. Null draws sleeves independently. */
  factor: number[][] | null;
  /** Full assumption set. Priced sleeves read the rate path, the basket, and costs from here. */
  source?: Assumptions;
}

function sleeveScenarioReturn(sleeve: Sleeve, scenario: ScenarioName): number {
  return sleeve[scenario];
}

/**
 * Sleeve simple returns for one Monte Carlo trial and one calendar year.
 * Parametric draws use stream 1 at (trial, calendarYear, sleeve).
 * Block bootstrap uses stream 3 to pick a row and ignores μ, σ, and the copula.
 * Pass `factor` when the caller has already factored the correlation; otherwise it is computed.
 */
export function mcSleeveReturns(
  assumptions: Assumptions,
  trial: number,
  calendarYear: number,
  factor?: number[][] | null,
): number[] {
  if (!parametricOnly(assumptions)) {
    const resolved =
      factor === undefined ? prepareCorrelation(assumptions.correlation, assumptions.correlationStress).factor : factor;
    const slice = priceTrial({ assumptions, mode: "mc", trial, factor: resolved }).byYear.get(calendarYear);
    if (slice) return slice.mtm;
  }
  if (assumptions.shockModel === "block_bootstrap") {
    return bootstrapSleeveReturns(assumptions, trial, calendarYear);
  }
  const resolved =
    factor === undefined
      ? prepareCorrelation(assumptions.correlation, assumptions.correlationStress).factor
      : factor;
  const seed = normalizeSeed(assumptions.seed);
  const z = assumptions.sleeves.map((_, index) => standardNormal(seed, STREAM.portfolio, trial, calendarYear, index));
  const shocks = resolved ? correlatedShocks(resolved, z) : z;
  return assumptions.sleeves.map((sleeve, index) =>
    simpleReturn(sleeve.mu, sleeve.sigma, shocks[index] ?? 0, assumptions.returnModel, assumptions.normalFloor),
  );
}

function parametricOnly(assumptions: Assumptions): boolean {
  return assumptions.shockModel === "block_bootstrap" || !usesPricedModel(assumptions.sleeves);
}

function bootstrapSleeveReturns(
  assumptions: Pick<Assumptions, "sleeves" | "seed" | "bootstrapHistory" | "blockLength">,
  trial: number,
  calendarYear: number,
): number[] {
  const history = assumptions.bootstrapHistory;
  if (history.length === 0) return assumptions.sleeves.map(() => 0);
  const blockLength = Math.max(1, Math.floor(assumptions.blockLength) || 1);
  const offset = calendarYear - FIRST_PROJECTION_YEAR;
  const block = Math.floor(offset / blockLength);
  const u = unitInterval(normalizeSeed(assumptions.seed), STREAM.bootstrap, trial, block, 0);
  const start = Math.floor(u * history.length) % history.length;
  const pos = (start + (((offset % blockLength) + blockLength) % blockLength)) % history.length;
  const row = history[pos] ?? [];
  return assumptions.sleeves.map((_, index) => {
    const value = row[index];
    return Number.isFinite(value) ? value : 0;
  });
}

function crashReturns(input: PathInput, calendarYear: number, returns: number[]): number[] {
  if (!input.source || input.source.crashYear == null || input.source.crashYear !== calendarYear) return returns;
  const shock = input.source.crashShock ?? 0;
  if (!shock) return returns;
  return returns.map((value, index) => (isBondKind(sleeveKindOf(input.sleeves[index])) ? value : value + shock));
}

function drawReturns(input: PathInput, calendarYear: number): number[] {
  if (input.mode === "scenario") {
    const scenario = input.scenario ?? "base";
    return crashReturns(input, calendarYear, input.sleeves.map((sleeve) => sleeveScenarioReturn(sleeve, scenario)));
  }
  if (!input.source) {
    return input.sleeves.map(() => 0);
  }
  const returns = mcSleeveReturns(input.source, input.trial, calendarYear, input.factor);
  const priced = input.shockModel !== "block_bootstrap" && usesPricedModel(input.sleeves);
  return priced ? returns : crashReturns(input, calendarYear, returns);
}

function turnoverCost(previous: number[] | null, policy: number[], bps: number): number {
  if (!(bps > 0) || !previous) return 0;
  let turnover = 0;
  for (let i = 0; i < policy.length; i++) turnover += Math.abs(policy[i] - (previous[i] ?? 0));
  return (0.5 * turnover * bps) / 10_000;
}

/**
 * Project beginning-of-year wealth from 2027 through 2042.
 * Cash flows land at the start of the year. A return labeled for year Y
 * moves that beginning wealth to the beginning of Y+1. No return is applied
 * during 2042, because the case horizon ends at the 2042 payment date.
 * The portfolio is not split into a reserve or a facility gift here.
 */
function pushPoint(
  rows: YearPoint[],
  input: PathInput,
  year: number,
  contribution: number,
  wealthStart: number,
  wealthStartHtm: number,
  policy: number[],
  actualWeights: number[],
  yearReturn: number | null,
  yearReturnHtm: number | null,
  sleeveReturns: number[] | null,
  priceComponents: number[] | null,
  cashYield: number | null,
): void {
  rows.push({
    calendarYear: year,
    yearIndex: yearIndex(year),
    contribution,
    wealthStart,
    wealthStartHtm,
    realWealthStart: wealthStart / Math.pow(1 + input.inflation, yearIndex(year)),
    policyWeights: policy.slice(),
    actualWeights,
    yearReturn,
    yearReturnHtm,
    sleeveReturns,
    priceComponents,
    cashYield,
  });
}

export function projectPath(input: PathInput): YearPoint[] {
  const count = input.sleeves.length;
  const priced =
    input.source !== undefined &&
    input.shockModel !== "block_bootstrap" &&
    usesPricedModel(input.sleeves);
  if (priced && input.source) {
    return projectPriced(input, input.source);
  }

  let balances = Array(count).fill(0);
  const rows: YearPoint[] = [];
  let previousWeights: number[] | null = null;
  const bps = input.source?.costs.transactionCostBps ?? 0;

  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const contribution = caseContribution(year);
    const policy = weightsAtYear(input.glide, year);
    if (input.rebalance === "annual") {
      const total = sum(balances) + contribution;
      balances = policy.map((weight) => total * weight);
      const cost = turnoverCost(previousWeights, policy, bps);
      if (cost > 0) balances = balances.map((balance) => balance * (1 - cost));
    } else {
      for (let i = 0; i < count; i++) balances[i] += contribution * (policy[i] ?? 0);
    }

    const wealthStart = sum(balances);
    const actualWeights = balances.map((balance, i) => (wealthStart > 0 ? balance / wealthStart : policy[i] ?? 0));

    let yearReturn: number | null = null;
    let sleeveReturns: number[] | null = null;
    if (year < LAST_PROJECTION_YEAR) {
      sleeveReturns = drawReturns(input, year);
      yearReturn = wealthStart > 0 ? dot(actualWeights, sleeveReturns) : dot(policy, sleeveReturns);
      balances = balances.map((balance, i) => balance * (1 + sleeveReturns![i]));
    }

    pushPoint(
      rows,
      input,
      year,
      contribution,
      wealthStart,
      wealthStart,
      policy,
      actualWeights,
      yearReturn,
      yearReturn,
      sleeveReturns,
      sleeveReturns ? sleeveReturns.map(() => 0) : null,
      null,
    );
    previousWeights = actualWeights;
  }

  return rows;
}

function projectPriced(input: PathInput, source: Assumptions): YearPoint[] {
  const count = input.sleeves.length;
  const table = priceTrial({
    assumptions: source,
    mode: input.mode,
    scenario: input.scenario,
    trial: input.trial,
    factor: input.factor,
  });
  let balances = Array(count).fill(0);
  let balancesHtm = Array(count).fill(0);
  const rows: YearPoint[] = [];
  let previousWeights: number[] | null = null;
  const bps = source.costs.transactionCostBps;

  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const contribution = caseContribution(year);
    const policy = weightsAtYear(input.glide, year);
    if (input.rebalance === "annual") {
      const total = sum(balances) + contribution;
      const totalHtm = sum(balancesHtm) + contribution;
      balances = policy.map((weight) => total * weight);
      balancesHtm = policy.map((weight) => totalHtm * weight);
      const cost = turnoverCost(previousWeights, policy, bps);
      if (cost > 0) {
        balances = balances.map((balance) => balance * (1 - cost));
        balancesHtm = balancesHtm.map((balance) => balance * (1 - cost));
      }
    } else {
      for (let i = 0; i < count; i++) {
        balances[i] += contribution * (policy[i] ?? 0);
        balancesHtm[i] += contribution * (policy[i] ?? 0);
      }
    }

    const wealthStart = sum(balances);
    const wealthStartHtm = sum(balancesHtm);
    const actualWeights = balances.map((balance, i) => (wealthStart > 0 ? balance / wealthStart : policy[i] ?? 0));
    const slice: YearSlice | undefined = table.byYear.get(year);
    let yearReturn: number | null = null;
    let yearReturnHtm: number | null = null;
    let sleeveReturns: number[] | null = null;
    let priceComponents: number[] | null = null;
    if (year < LAST_PROJECTION_YEAR && slice) {
      sleeveReturns = slice.mtm;
      priceComponents = slice.price;
      yearReturn = wealthStart > 0 ? dot(actualWeights, slice.mtm) : dot(policy, slice.mtm);
      yearReturnHtm = wealthStartHtm > 0 ? dot(actualWeights, slice.htm) : dot(policy, slice.htm);
      balances = balances.map((balance, i) => balance * (1 + slice.mtm[i]));
      balancesHtm = balancesHtm.map((balance, i) => balance * (1 + slice.htm[i]));
    }

    pushPoint(
      rows,
      input,
      year,
      contribution,
      wealthStart,
      wealthStartHtm,
      policy,
      actualWeights,
      yearReturn,
      yearReturnHtm,
      sleeveReturns,
      priceComponents,
      slice?.cashYield ?? null,
    );
    previousWeights = policy.slice();
  }

  return rows;
}

export function wealthInYear(path: YearPoint[], year: number): number {
  const row = path.find((point) => point.calendarYear === year);
  if (!row) throw new Error(`Year ${year} is outside the projection.`);
  return row.wealthStart;
}
