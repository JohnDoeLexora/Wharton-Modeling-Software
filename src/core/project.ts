import { isBondKind } from "./bonds";
import { caseContribution, FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR, yearIndex } from "./case";
import { prepareCorrelation } from "./correlation";
import { weightTable, weightsAtYear } from "./glide";
import { sharpeRatio, sortinoRatio } from "./metrics";
import { stepYearMut } from "./yearStep";
import { correlatedShocks, simpleReturn } from "./math";
import { cachedPriceTrial, fillPricedSchedule, sleeveKindOf, usesPricedModel } from "./pricing";
import { ratePath, type EvolvedRate } from "./rates";
import { STREAM, standardNormal, unitInterval } from "./rng";
import { portfolioNormals } from "./shocks";
import type { Assumptions, ReturnModel, ScenarioName, Sleeve, YearPoint } from "./types";
import { emptyHoldings, stepYear, type StepInput, type StepScratch } from "./yearStep";

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
  /**
   * Cholesky factor of the stressed correlation.
   * Null asks the path to factor `correlation`. A failed factor becomes a non-finite return.
   * Independent draws are not substituted.
   */
  factor: number[][] | null;
  /** Full assumption set. Priced sleeves read the rate path, the basket, and costs from here. */
  source?: Assumptions;
}

/** Sleeve returns for 2027–2041, and the beginning-of-year curves through 2042 when a curve is simulated. */
export interface ReturnSchedule {
  mtm: number[][];
  htm: number[][];
  cash: (number | null)[];
  price: number[][];
  rates: EvolvedRate[] | null;
}

export interface Projected {
  points: YearPoint[];
  /** Balances that earn each year's return. Index 0 is 2027. */
  startBalances: number[][];
  startBalancesHtm: number[][];
}

const RETURN_COUNT = LAST_PROJECTION_YEAR - FIRST_PROJECTION_YEAR;

function expenseDrag(value: number, ratio: number): number {
  if (!(ratio > 0) || !Number.isFinite(value)) return value;
  return (1 + value) * (1 - ratio) - 1;
}

function applyCrash(input: PathInput, calendarYear: number, returns: number[]): number[] {
  const source = input.source;
  if (!source || source.crashYear == null || source.crashYear !== calendarYear) return returns;
  const shock = source.crashShock ?? 0;
  if (shock === 0) return returns;
  if (!Number.isFinite(shock)) return returns.map(() => Number.NaN);
  return returns.map((value, index) => (isBondKind(sleeveKindOf(input.sleeves[index])) ? value : value + shock));
}

function historyRow(history: number[][], pos: number, count: number): number[] {
  const row = history[pos] ?? [];
  return Array.from({ length: count }, (_, index) => {
    const value = row[index];
    return Number.isFinite(value) ? value : 0;
  });
}

function bootstrapSleeveReturns(input: PathInput, calendarYear: number): number[] {
  const history = input.bootstrapHistory;
  const count = input.sleeves.length;
  if (history.length === 0) return Array(count).fill(0);
  const scheme = input.source?.bootstrapScheme ?? "stationary";
  const seed = input.seed;
  if (scheme === "circular") {
    const blockLength = Math.max(1, Math.floor(input.blockLength) || 1);
    const offset = calendarYear - FIRST_PROJECTION_YEAR;
    const block = Math.floor(offset / blockLength);
    const u = unitInterval(seed, STREAM.bootstrap, input.trial, block, 0);
    const start = Math.floor(u * history.length) % history.length;
    const pos = (start + (offset % blockLength)) % history.length;
    return historyRow(history, pos, count);
  }
  const mean = Math.max(1, Math.floor(input.blockLength) || 1);
  const probability = 1 / mean;
  let pos = 0;
  for (let year = FIRST_PROJECTION_YEAR; year <= calendarYear; year++) {
    const step = year - FIRST_PROJECTION_YEAR;
    const renew = unitInterval(seed, STREAM.bootstrap, input.trial, step, 0);
    if (year === FIRST_PROJECTION_YEAR || renew < probability) {
      const startU = unitInterval(seed, STREAM.bootstrap, input.trial, step, 1);
      pos = Math.floor(startU * history.length) % history.length;
    } else {
      pos = (pos + 1) % history.length;
    }
  }
  return historyRow(history, pos, count);
}

function resolveFactor(input: PathInput): number[][] | null {
  if (input.factor) return input.factor;
  const repair = input.source?.correlationRepair ?? "none";
  return prepareCorrelation(input.correlation, input.correlationStress, repair).factor;
}

function wantsCurve(input: PathInput): boolean {
  const mode = input.source?.reserve.discountMode;
  return mode === "trial_curve";
}

/**
 * One trial's sleeve returns. Priced books read the cached price path.
 * Parametric and bootstrap books apply the crash overlay here, once.
 */
export function buildSchedule(input: PathInput, into?: ReturnSchedule): ReturnSchedule {
  const priced =
    input.source !== undefined && input.shockModel !== "block_bootstrap" && usesPricedModel(input.sleeves);
  if (priced && input.source && into) {
    if (!into.rates) into.rates = [];
    fillPricedSchedule(
      {
        assumptions: input.source,
        mode: input.mode,
        scenario: input.scenario,
        trial: input.trial,
        factor: resolveFactor(input),
      },
      into,
    );
    return into;
  }
  if (priced && input.source) {
    const table = cachedPriceTrial({
      assumptions: input.source,
      mode: input.mode,
      scenario: input.scenario,
      trial: input.trial,
      factor: resolveFactor(input),
    });
    const mtm: number[][] = [];
    const htm: number[][] = [];
    const cash: (number | null)[] = [];
    const price: number[][] = [];
    for (let offset = 0; offset < RETURN_COUNT; offset++) {
      const year = FIRST_PROJECTION_YEAR + offset;
      const slice = table.byYear.get(year);
      mtm.push(slice ? slice.mtm : input.sleeves.map(() => Number.NaN));
      htm.push(slice ? slice.htm : mtm[offset]);
      cash.push(slice?.cashYield ?? null);
      price.push(slice ? slice.price : input.sleeves.map(() => 0));
    }
    return { mtm, htm, cash, price, rates: table.rates };
  }

  const rates = wantsCurve(input) && input.source
    ? ratePath({
        params: input.source.rates,
        seed: input.seed,
        trial: input.trial,
        mode: input.mode,
        scenario: input.scenario,
      })
    : null;
  const factor = input.mode === "scenario" || input.shockModel === "block_bootstrap" ? input.factor : resolveFactor(input);
  const correctFloor = input.source?.correctNormalFloor === true;
  const mtm: number[][] = [];
  const htm: number[][] = [];
  const cash: (number | null)[] = [];
  const price: number[][] = [];
  for (let offset = 0; offset < RETURN_COUNT; offset++) {
    const year = FIRST_PROJECTION_YEAR + offset;
    let returns: number[];
    if (input.mode === "scenario") {
      const scenario = input.scenario ?? "base";
      returns = input.sleeves.map((sleeve) => sleeve[scenario]);
    } else if (input.shockModel === "block_bootstrap") {
      returns = bootstrapSleeveReturns(input, year);
    } else if (!factor) {
      returns = input.sleeves.map(() => Number.NaN);
    } else {
      const z = portfolioNormals({
        seed: input.seed,
        sampling: input.source?.sampling,
        trial: input.trial,
        year,
        sleeveCount: input.sleeves.length,
      });
      const shocks = correlatedShocks(factor, z);
      returns = input.sleeves.map((sleeve, index) =>
        simpleReturn(sleeve.mu, sleeve.sigma, shocks[index] ?? 0, input.returnModel, input.normalFloor, correctFloor),
      );
    }
    returns = returns.map((value, index) => expenseDrag(value, input.sleeves[index]?.expenseRatio ?? 0));
    returns = applyCrash(input, year, returns);
    mtm.push(returns);
    htm.push(returns.slice());
    cash.push(null);
    price.push(input.sleeves.map(() => 0));
  }
  return { mtm, htm, cash, price, rates };
}

function inflationFor(input: PathInput, year: number): number {
  const base = input.inflation;
  const sigma = input.source?.inflationSigma ?? 0;
  const beta = input.source?.inflationBeta ?? 0;
  if (input.mode !== "mc" || (sigma === 0 && beta === 0)) return base;
  const shock = standardNormal(input.seed, STREAM.rates, input.trial, year, 3);
  const level = standardNormal(input.seed, STREAM.rates, input.trial, year, 0);
  const rate = base + sigma * shock + beta * level;
  return rate > -0.999999 ? rate : -0.999999;
}

function gainTaxRateOf(input: PathInput): number {
  const costs = input.source?.costs;
  if (!costs || costs.account !== "taxable") return 0;
  return costs.gainTaxRate > 0 ? costs.gainTaxRate : 0;
}

export function projectBook(input: PathInput, schedule?: ReturnSchedule): Projected {
  const built = schedule ?? buildSchedule(input);
  const count = input.sleeves.length;
  let holdings = emptyHoldings(count);
  const points: YearPoint[] = [];
  const startBalances: number[][] = [];
  const startBalancesHtm: number[][] = [];
  let priceLevel = 1;
  const bps = input.source?.costs.transactionCostBps ?? 0;
  const gainTaxRate = gainTaxRateOf(input);

  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const offset = year - FIRST_PROJECTION_YEAR;
    const terminal = year === LAST_PROJECTION_YEAR;
    const inflationRate = inflationFor(input, year);
    priceLevel *= 1 + inflationRate;
    const result = stepYear(holdings, {
      contribution: caseContribution(year),
      policy: weightsAtYear(input.glide, year),
      rebalance: input.rebalance,
      transactionCostBps: bps,
      gainTaxRate,
      returns: terminal ? null : built.mtm[offset] ?? null,
      returnsHtm: terminal ? null : built.htm[offset] ?? null,
    });
    holdings = { balances: result.balances, balancesHtm: result.balancesHtm, nav: result.nav };
    startBalances.push(result.balancesAtStart);
    startBalancesHtm.push(result.balancesHtmAtStart);
    const realWealthStart =
      Number.isFinite(priceLevel) && priceLevel > 0 ? result.wealthStart / priceLevel : Number.NaN;
    points.push({
      calendarYear: year,
      yearIndex: yearIndex(year),
      contribution: caseContribution(year),
      wealthStart: result.wealthStart,
      wealthStartHtm: result.wealthStartHtm,
      realWealthStart,
      policyWeights: result.policyWeights,
      actualWeights: result.actualWeights,
      yearReturn: result.yearReturn,
      yearReturnHtm: result.yearReturnHtm,
      twr: result.twr,
      nav: result.nav,
      driftedWeights: result.driftedWeights,
      rebalanceCostFraction: result.rebalanceCostFraction,
      contributionCost: result.contributionCost,
      inflationRate,
      sleeveReturns: result.sleeveReturns,
      priceComponents: terminal ? null : built.price[offset] ?? null,
      cashYield: terminal ? null : built.cash[offset] ?? null,
    });
  }

  return { points, startBalances, startBalancesHtm };
}

export function projectPath(input: PathInput, schedule?: ReturnSchedule): YearPoint[] {
  return projectBook(input, schedule).points;
}

/**
 * Beginning-of-2033 wealth and the unit-NAV max drawdown, without allocating a point per year.
 * The numbers match `projectBook` plus `maxDrawdown`. Mixes use this so a five-mix sample
 * does not build six copies of the year table. MODEL_SPEC §5.1.
 */
export interface TrialSketch {
  wealth2031: number;
  wealth2033: number;
  drawdown: number;
  sharpe: number | null;
  sortino: number | null;
  nonFinite: boolean;
  balances2031: number[];
  weights2031: number[];
  drifted2031: number[];
  cash2031: number | null;
  firstReturn: number;
  priceYears: number;
}

/**
 * One trial, reusing the caller's balance buffers. Policy rows are the 16
 * years 2027..2042. The drawdown and the ratios match `maxDrawdown` and the
 * per-trial Sharpe in `run.ts`. MODEL_SPEC §5.1.
 */
const sharedStep: StepInput = {
  contribution: 0,
  policy: [],
  rebalance: "annual",
  transactionCostBps: 0,
  gainTaxRate: 0,
  returns: null,
  returnsHtm: null,
};
const sharedScratch: StepScratch = {
  wealthStart: 0,
  wealthStartHtm: 0,
  yearReturn: null,
  yearReturnHtm: null,
  twr: null,
  nav: 1,
  fraction: 0,
  contributionCost: 0,
};
const excessBuf: number[] = [];
const contBal: number[] = [];
const contHtm: number[] = [];
const contFlat: number[] = [];

function copyInto(src: number[], dest: number[]): number[] {
  if (dest.length !== src.length) dest.length = src.length;
  for (let i = 0; i < src.length; i++) dest[i] = src[i];
  return dest;
}

export function walkTrial(args: {
  policy: number[][];
  schedule: ReturnSchedule;
  rebalance: PathInput["rebalance"];
  bps: number;
  gainTaxRate: number;
  balances: number[];
  balancesHtm: number[];
  drifted: number[];
  actual: number[];
  start: number[];
  wealthOut: number[] | null;
  fallbackRate: number;
  priceSums: number[] | null;
}): TrialSketch {
  const { balances, balancesHtm, schedule } = args;
  balances.fill(0);
  balancesHtm.fill(0);
  let nav = 1;
  let peak = 1;
  let worst = 0;
  let wealth2031 = Number.NaN;
  let wealth2033 = Number.NaN;
  let nonFinite = false;
  let balances2031: number[] = [];
  let weights2031: number[] = [];
  let drifted2031: number[] = [];
  let cash2031: number | null = null;
  excessBuf.length = 0;
  let priceYears = 0;
  sharedStep.rebalance = args.rebalance;
  sharedStep.transactionCostBps = args.bps;
  sharedStep.gainTaxRate = args.gainTaxRate;
  for (let offset = 0; offset <= LAST_PROJECTION_YEAR - FIRST_PROJECTION_YEAR; offset++) {
    const year = FIRST_PROJECTION_YEAR + offset;
    const terminal = year === LAST_PROJECTION_YEAR;
    const returns = terminal ? null : schedule.mtm[offset] ?? null;
    sharedStep.contribution = caseContribution(year);
    sharedStep.policy = args.policy[offset] ?? [];
    sharedStep.returns = returns;
    sharedStep.returnsHtm = terminal ? null : schedule.htm[offset] ?? null;
    const result = stepYearMut(
      balances,
      balancesHtm,
      1,
      sharedStep,
      args.drifted,
      args.actual,
      args.start,
      sharedScratch,
    );
    if (!Number.isFinite(result.wealthStart)) nonFinite = true;
    if (args.wealthOut) args.wealthOut[offset] = result.wealthStart;
    if (year === 2031) {
      wealth2031 = result.wealthStart;
      balances2031 = args.start.slice();
      weights2031 = args.actual.slice();
      drifted2031 = args.drifted.slice();
      cash2031 = schedule.cash[offset] ?? null;
    } else if (year === 2033) wealth2033 = result.wealthStart;
    const twr = result.twr;
    if (twr !== null && Number.isFinite(twr)) nav *= 1 + twr;
    if (!Number.isFinite(nav)) {
      nonFinite = true;
      worst = Number.NaN;
    } else if (nav > peak) peak = nav;
    if (peak > 0 && Number.isFinite(worst)) {
      const drawdown = (peak - nav) / peak;
      if (drawdown > worst) worst = drawdown;
    }
    if (result.yearReturn !== null && Number.isFinite(result.yearReturn)) {
      const cash = schedule.cash[offset] ?? null;
      const riskFree = cash !== null && Number.isFinite(cash) ? cash : args.fallbackRate;
      excessBuf.push(result.yearReturn - riskFree);
    }
    const price = schedule.price[offset];
    if (!terminal && price && args.priceSums) {
      priceYears += 1;
      for (let i = 0; i < price.length; i++) args.priceSums[i] += price[i] ?? 0;
    }
  }
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (excessBuf.length >= 2) {
    let mean = 0;
    for (const value of excessBuf) mean += value;
    mean /= excessBuf.length;
    let square = 0;
    let down = 0;
    for (const value of excessBuf) {
      const gap = value - mean;
      square += gap * gap;
      const below = value < 0 ? value : 0;
      down += below * below;
    }
    sharpe = sharpeRatio(mean, Math.sqrt(square / (excessBuf.length - 1)));
    sortino = sortinoRatio(mean, Math.sqrt(down / excessBuf.length));
  }
  const first = schedule.mtm[0]?.[0];
  return {
    wealth2031,
    wealth2033,
    drawdown: worst,
    sharpe,
    sortino,
    nonFinite,
    balances2031,
    weights2031,
    drifted2031,
    cash2031,
    firstReturn: Number.isFinite(first) ? (first as number) : Number.NaN,
    priceYears,
  };
}

export function projectSummary(input: PathInput, schedule: ReturnSchedule, policy?: number[][]): { wealth2033: number; drawdown: number } {
  const count = input.sleeves.length;
  const table = policy ?? weightTable(input.glide, FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR);
  const balances = Array(count).fill(0);
  const balancesHtm = Array(count).fill(0);
  const sketch = walkTrial({
    policy: table,
    schedule,
    rebalance: input.rebalance,
    bps: input.source?.costs.transactionCostBps ?? 0,
    gainTaxRate: gainTaxRateOf(input),
    balances,
    balancesHtm,
    drifted: Array(count).fill(0),
    actual: Array(count).fill(0),
    start: Array(count).fill(0),
    wealthOut: null,
    fallbackRate: 0,
    priceSums: null,
  });
  return { wealth2033: sketch.wealth2033, drawdown: sketch.drawdown };
}

export function pathInputFrom(assumptions: Assumptions, trial: number, factor?: number[][] | null): PathInput {
  return {
    sleeves: assumptions.sleeves,
    glide: assumptions.glide,
    rebalance: assumptions.rebalance,
    inflation: assumptions.inflation,
    mode: "mc",
    returnModel: assumptions.returnModel,
    normalFloor: assumptions.normalFloor,
    shockModel: assumptions.shockModel === "block_bootstrap" ? "block_bootstrap" : "parametric",
    bootstrapHistory: assumptions.bootstrapHistory,
    blockLength: assumptions.blockLength,
    correlationStress: assumptions.correlationStress,
    correlation: assumptions.correlation,
    seed: assumptions.seed,
    trial,
    factor: factor === undefined ? null : factor,
    source: assumptions,
  };
}

/**
 * Sleeve simple returns for one Monte Carlo trial and one calendar year.
 * The same schedule feeds the main path, the 2031–2033 range, and the mixes.
 */
export function mcSleeveReturns(
  assumptions: Assumptions,
  trial: number,
  calendarYear: number,
  factor?: number[][] | null,
): number[] {
  const input = pathInputFrom(assumptions, trial, factor);
  const offset = calendarYear - FIRST_PROJECTION_YEAR;
  const schedule = buildSchedule(input);
  return schedule.mtm[offset]?.slice() ?? assumptions.sleeves.map(() => Number.NaN);
}

/**
 * Continue a book that has already been rebalanced at the beginning of 2031.
 * Applies the 2031 return, the full 2032 step, and the 2033 rebalance. No second 2031 cost.
 */
export function continueFromBalances(
  assumptions: Assumptions,
  balances: number[],
  balancesHtm: number[],
  trial: number,
  schedule?: ReturnSchedule,
  policy?: number[][],
): number {
  const built = schedule ?? buildSchedule(pathInputFrom(assumptions, trial));
  const gainTaxRate = assumptions.costs.account === "taxable" && assumptions.costs.gainTaxRate > 0 ? assumptions.costs.gainTaxRate : 0;
  const offset2031 = 2031 - FIRST_PROJECTION_YEAR;
  const returns = built.mtm[offset2031];
  const returnsHtm = built.htm[offset2031] ?? returns;
  if (!returns || returns.some((value) => !Number.isFinite(value))) return Number.NaN;
  const count = balances.length;
  const bal = copyInto(balances, contBal);
  const htm = copyInto(balancesHtm, contHtm);
  if (contFlat.length !== count) {
    contFlat.length = count;
    contFlat.fill(0);
  }
  // Drift and a zero contribution apply the 2031 return without a second rebalance. MODEL_SPEC §5.3.
  sharedStep.contribution = 0;
  sharedStep.policy = contFlat;
  sharedStep.rebalance = "drift";
  sharedStep.transactionCostBps = 0;
  sharedStep.gainTaxRate = gainTaxRate;
  sharedStep.returns = returns;
  sharedStep.returnsHtm = returnsHtm;
  stepYearMut(bal, htm, 1, sharedStep, undefined, undefined, undefined, sharedScratch);
  for (const year of [2032, 2033]) {
    const terminal = year === 2033;
    const offset = year - FIRST_PROJECTION_YEAR;
    sharedStep.contribution = caseContribution(year);
    sharedStep.policy = policy?.[offset] ?? weightsAtYear(assumptions.glide, year);
    sharedStep.rebalance = assumptions.rebalance;
    sharedStep.transactionCostBps = assumptions.costs.transactionCostBps;
    sharedStep.returns = terminal ? null : built.mtm[offset] ?? null;
    sharedStep.returnsHtm = terminal ? null : built.htm[offset] ?? null;
    const result = stepYearMut(bal, htm, 1, sharedStep, undefined, undefined, undefined, sharedScratch);
    if (terminal) return Number.isFinite(result.wealthStart) ? result.wealthStart : Number.NaN;
  }
  return Number.NaN;
}

export function wealthInYear(path: YearPoint[], year: number): number {
  const row = path.find((point) => point.calendarYear === year);
  if (!row) throw new Error(`Year ${year} is outside the projection.`);
  return row.wealthStart;
}
