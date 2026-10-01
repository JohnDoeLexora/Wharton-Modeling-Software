import { caseContribution, LAST_PROJECTION_YEAR, FIRST_PROJECTION_YEAR, yearIndex } from "./case";
import { weightsAtYear } from "./glide";
import { correlatedShocks, dot, simpleReturn, sum } from "./math";
import type { Assumptions, ReturnModel, ScenarioName, Sleeve, YearPoint } from "./types";

export interface PathInput {
  sleeves: Sleeve[];
  glide: Assumptions["glide"];
  rebalance: Assumptions["rebalance"];
  inflation: number;
  mode: "scenario" | "mc";
  scenario?: ScenarioName;
  randn?: () => number;
  cholesky?: number[][] | null;
  returnModel: ReturnModel;
  normalFloor: number;
}

function sleeveScenarioReturn(sleeve: Sleeve, scenario: ScenarioName): number {
  return sleeve[scenario];
}

function drawReturns(input: PathInput): number[] {
  if (input.mode === "scenario") {
    const scenario = input.scenario ?? "base";
    return input.sleeves.map((sleeve) => sleeveScenarioReturn(sleeve, scenario));
  }
  const randn = input.randn;
  if (!randn) throw new Error("Monte Carlo paths need a normal generator.");
  const raw = input.sleeves.map(() => randn());
  const shocks = input.cholesky ? correlatedShocks(input.cholesky, raw) : raw;
  return input.sleeves.map((sleeve, index) =>
    simpleReturn(sleeve.mu, sleeve.sigma, shocks[index], input.returnModel, input.normalFloor),
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
      sleeveReturns = drawReturns(input);
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
