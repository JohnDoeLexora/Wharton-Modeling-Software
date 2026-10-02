import { caseContribution, LAST_PROJECTION_YEAR, FIRST_PROJECTION_YEAR, yearIndex } from "./case";
import { prepareCorrelation } from "./correlation";
import { weightsAtYear } from "./glide";
import { correlatedShocks, dot, normalizeSeed, simpleReturn, sum } from "./math";
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
  assumptions: Pick<
    Assumptions,
    | "sleeves"
    | "seed"
    | "returnModel"
    | "normalFloor"
    | "shockModel"
    | "bootstrapHistory"
    | "blockLength"
    | "correlation"
    | "correlationStress"
  >,
  trial: number,
  calendarYear: number,
  factor?: number[][] | null,
): number[] {
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

function drawReturns(input: PathInput, calendarYear: number): number[] {
  if (input.mode === "scenario") {
    const scenario = input.scenario ?? "base";
    return input.sleeves.map((sleeve) => sleeveScenarioReturn(sleeve, scenario));
  }
  return mcSleeveReturns(
    {
      sleeves: input.sleeves,
      seed: input.seed,
      returnModel: input.returnModel,
      normalFloor: input.normalFloor,
      shockModel: input.shockModel,
      bootstrapHistory: input.bootstrapHistory,
      blockLength: input.blockLength,
      correlation: input.correlation,
      correlationStress: input.correlationStress,
    },
    input.trial,
    calendarYear,
    input.factor,
  );
}

/**
 * Project beginning-of-year wealth from 2027 through 2042.
 * Cash flows land at the start of the year. A return labeled for year Y
 * moves that beginning wealth to the beginning of Y+1. No return is applied
 * during 2042, because the case horizon ends at the 2042 payment date.
 * The portfolio is not split into a reserve or a facility gift here.
 */
export function projectPath(input: PathInput): YearPoint[] {
  const count = input.sleeves.length;
  let balances = Array(count).fill(0);
  const rows: YearPoint[] = [];

  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const contribution = caseContribution(year);
    const policy = weightsAtYear(input.glide, year);
    if (input.rebalance === "annual") {
      const total = sum(balances) + contribution;
      balances = policy.map((weight) => total * weight);
    } else {
      for (let i = 0; i < count; i++) balances[i] += contribution * policy[i];
    }

    const wealthStart = sum(balances);
    const actualWeights = balances.map((balance, i) =>
      wealthStart > 0 ? balance / wealthStart : policy[i] ?? 0,
    );

    let yearReturn: number | null = null;
    let sleeveReturns: number[] | null = null;
    if (year < LAST_PROJECTION_YEAR) {
      sleeveReturns = drawReturns(input, year);
      yearReturn = wealthStart > 0 ? dot(actualWeights, sleeveReturns) : dot(policy, sleeveReturns);
      balances = balances.map((balance, i) => balance * (1 + sleeveReturns![i]));
    }

    rows.push({
      calendarYear: year,
      yearIndex: yearIndex(year),
      contribution,
      wealthStart,
      realWealthStart: wealthStart / Math.pow(1 + input.inflation, yearIndex(year)),
      policyWeights: policy.slice(),
      actualWeights,
      yearReturn,
      sleeveReturns,
    });
  }

  return rows;
}

export function wealthInYear(path: YearPoint[], year: number): number {
  const row = path.find((point) => point.calendarYear === year);
  if (!row) throw new Error(`Year ${year} is outside the projection.`);
  return row.wealthStart;
}
