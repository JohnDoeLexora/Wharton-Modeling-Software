import { COMMUNICATION_YEAR, DECISION_YEAR, DISCLAIMER, OPERATING_PAYMENTS } from "./case";
import { applyRule, contributionsOf, percentileBand, scenarioEnvelope } from "./facility";
import { weightsAtYear, weightsSumToOne } from "./glide";
import { boxMuller, cholesky, correlatedShocks, mulberry32, normalizeSeed, percentile, percentiles, simpleReturn } from "./math";
import { projectPath, wealthInYear } from "./project";
import { rollReserve, scheduleReturnsFor, sizeReserve, sizingRate } from "./reserve";
import type {
  Assumptions,
  FacilityParams,
  ModelOutput,
  RangeCard,
  ReserveMethod,
  ReserveSizing,
  ScenarioFacilityRow,
  ScenarioName,
  YearPoint,
} from "./types";

const SCENARIOS: ScenarioName[] = ["bear", "base", "bull"];
const METHODS: ReserveMethod[] = ["ladder", "duration", "stress", "shortfall"];

export function validate(assumptions: Assumptions): string[] {
  const errors: string[] = [];
  if (assumptions.sleeves.length < 1 || assumptions.sleeves.length > 6) {
    errors.push("Use between 1 and 6 sleeves.");
  }
  const n = assumptions.sleeves.length;
  assumptions.sleeves.forEach((sleeve, index) => {
    if (!sleeve.name.trim()) errors.push(`Sleeve ${index + 1} needs a name.`);
    for (const key of ["mu", "sigma", "base", "bull", "bear"] as const) {
      if (!Number.isFinite(sleeve[key])) errors.push(`${sleeve.name}: ${key} is not a number.`);
    }
    if (sleeve.sigma < 0) errors.push(`${sleeve.name}: volatility cannot be negative.`);
    for (const key of ["base", "bull", "bear"] as const) {
      if (sleeve[key] <= -1) errors.push(`${sleeve.name}: the ${key} return must be above -100%.`);
    }
    if (assumptions.returnModel === "lognormal" && sleeve.mu <= -1) {
      errors.push(`${sleeve.name}: lognormal expected return must be above -100%.`);
    }
  });

  if (assumptions.glide.length < 1) errors.push("Add at least one glide-path knot.");
  const years = new Set<number>();
  for (const knot of assumptions.glide) {
    if (years.has(knot.year)) errors.push(`Two glide knots share ${knot.year}.`);
    years.add(knot.year);
    if (knot.weights.length !== n) errors.push(`The ${knot.year} knot does not match the sleeve count.`);
    else if (!weightsSumToOne(knot.weights)) {
      errors.push(`Weights in ${knot.year} must be non-negative and sum to 1. They currently do not.`);
    }
  }

  if (assumptions.correlation.length !== n) errors.push("The correlation matrix must have one row per sleeve.");
  for (let i = 0; i < n; i++) {
    const row = assumptions.correlation[i] ?? [];
    if (row.length !== n) errors.push("The correlation matrix must be square.");
    for (let j = 0; j < n; j++) {
      const value = row[j];
      if (!Number.isFinite(value)) errors.push("Correlation entries must be numbers.");
      if (i !== j && (value < -1 || value > 1)) errors.push("Off-diagonal correlations must sit between -1 and 1.");
      if (i === j && Math.abs(value - 1) > 1e-6) errors.push("Diagonal correlations must be 1.");
      if (j > i && Math.abs(value - (assumptions.correlation[j]?.[i] ?? NaN)) > 1e-6) {
        errors.push("The correlation matrix must be symmetric.");
      }
    }
  }
  const square =
    assumptions.correlation.length === n && assumptions.correlation.every((row) => row?.length === n);
  if (square && n > 0 && cholesky(assumptions.correlation) === null) {
    errors.push("The correlation matrix is not positive semidefinite, so correlated draws cannot be built.");
  }
  const reserveNumbers: [string, number][] = [
    ["Discount yield", assumptions.reserve.discountYield],
    ["Surplus margin", assumptions.reserve.surplusMargin],
    ["Stress return", assumptions.reserve.stressReturn],
    ["Shortfall mean return", assumptions.reserve.shortfallMu],
    ["Shortfall volatility", assumptions.reserve.shortfallSigma],
  ];
  for (const [label, value] of reserveNumbers) {
    if (!Number.isFinite(value)) errors.push(`${label} is not a number.`);
  }
  if (assumptions.reserve.surplusMargin < -1) {
    errors.push("The surplus margin cannot be below -100% of present value.");
  }

  if (assumptions.inflation <= -1) errors.push("Inflation must be above -100%.");
  if (!Number.isInteger(assumptions.trials) || assumptions.trials < 50 || assumptions.trials > 20000) {
    errors.push("Monte Carlo trials must be a whole number from 50 to 20,000.");
  }
  if (assumptions.percentiles.length === 0 || assumptions.percentiles.some((p) => p < 0 || p > 1)) {
    errors.push("Percentiles must sit between 0 and 1.");
  }
  if (assumptions.reserve.customReturns.length !== OPERATING_PAYMENTS - 1) {
    errors.push("The custom reserve path needs exactly 9 returns (after the 2033 payment through after the 2041 payment).");
  }
  if (assumptions.reserve.shortfallTarget < 0 || assumptions.reserve.shortfallTarget > 1) {
    errors.push("The shortfall target must sit between 0 and 1.");
  }
  if (assumptions.reserve.shortfallSigma < 0) errors.push("Reserve volatility cannot be negative.");
  if (assumptions.facility.rangeLowPercentile < 0 || assumptions.facility.rangeHighPercentile > 1) {
    errors.push("Range percentiles must sit between 0 and 1.");
  }
  if (assumptions.facility.rangeLowPercentile > assumptions.facility.rangeHighPercentile) {
    errors.push("The low percentile of the communication band cannot exceed the high percentile.");
  }
  if (!assumptions.facility.rules.some((rule) => rule.id === assumptions.facility.activeRuleId)) {
    errors.push("Pick a facility rule to use in the communication range.");
  }
  if (assumptions.facility.useReserveOverride && assumptions.facility.reserveOverride < 0) {
    errors.push("A reserve override cannot be negative.");
  }
  return [...new Set(errors)];
}

function sampleSettings(assumptions: Assumptions) {
  return {
    trials: assumptions.trials,
    seed: normalizeSeed(assumptions.seed) + 917,
    returnModel: assumptions.returnModel,
    normalFloor: assumptions.normalFloor,
  };
}

export function runModel(assumptions: Assumptions): ModelOutput {
  const errors = validate(assumptions);
  const sample = sampleSettings(assumptions);
  const sizings = Object.fromEntries(
    METHODS.map((method) => [method, sizeReserve(method, assumptions.reserve, sample)]),
  ) as Record<ReserveMethod, ReserveSizing>;
  const active = sizings[assumptions.reserve.method];
  const rate = sizingRate(assumptions.reserve.method, assumptions.reserve);
  const scheduleReturns = active.reserve === null ? [] : scheduleReturnsFor(assumptions.reserve, rate);
  const schedule =
    active.reserve === null
      ? null
      : rollReserve({
          initial: active.reserve,
          returnsBetween: scheduleReturns,
          discountYield: assumptions.reserve.discountYield,
        });
  const scheduleNote = assumptions.reserve.useCustomSchedule
    ? "The schedule uses your 9 custom reinvestment rates. Sizing still uses the method's own rate, unless those rates happen to match. A surplus or a shortfall in the table is the gap between those two choices."
    : "The schedule reinvests at the single rate used to illustrate this method (the discount yield, the stress return, or the shortfall mean).";

  const reserveBlock = { sizings, active, scheduleReturns, schedule, scheduleNote };

  if (errors.length > 0) {
    return {
      disclaimer: DISCLAIMER,
      errors,
      scenarios: {},
      monteCarlo: null,
      reserve: reserveBlock,
      facility: null,
    };
  }

  const factor = cholesky(assumptions.correlation);
  const scenarioPaths: Partial<Record<ScenarioName, YearPoint[]>> = {};
  for (const scenario of SCENARIOS) {
    scenarioPaths[scenario] = projectPath({
      sleeves: assumptions.sleeves,
      glide: assumptions.glide,
      rebalance: assumptions.rebalance,
      inflation: assumptions.inflation,
      mode: "scenario",
      scenario,
      returnModel: assumptions.returnModel,
      normalFloor: assumptions.normalFloor,
    });
  }

  const randn = boxMuller(mulberry32(normalizeSeed(assumptions.seed)));
  const wealth2031: number[] = [];
  const wealth2033: number[] = [];
  const columns = new Map<number, number[]>();
  for (let trial = 0; trial < assumptions.trials; trial++) {
    const path = projectPath({
      sleeves: assumptions.sleeves,
      glide: assumptions.glide,
      rebalance: assumptions.rebalance,
      inflation: assumptions.inflation,
      mode: "mc",
      randn,
      cholesky: factor,
      returnModel: assumptions.returnModel,
      normalFloor: assumptions.normalFloor,
    });
    for (const point of path) {
      const column = columns.get(point.calendarYear) ?? [];
      column.push(point.wealthStart);
      columns.set(point.calendarYear, column);
    }
    wealth2031.push(wealthInYear(path, COMMUNICATION_YEAR));
    wealth2033.push(wealthInYear(path, DECISION_YEAR));
  }

  const byYear = [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([calendarYear, values]) => ({
      calendarYear,
      values: percentiles(values, assumptions.percentiles),
    }));

  const facility = buildFacility(assumptions, scenarioPaths, wealth2031, wealth2033, active);

  return {
    disclaimer: DISCLAIMER,
    errors: [],
    scenarios: scenarioPaths,
    monteCarlo: {
      trials: assumptions.trials,
      seed: normalizeSeed(assumptions.seed),
      byYear,
      wealth2031,
      wealth2033,
    },
    reserve: reserveBlock,
    facility,
  };
}

function reserveTargetOf(assumptions: Assumptions, active: ReserveSizing): { value: number | null; source: string } {
  if (assumptions.facility.useReserveOverride) {
    return {
      value: assumptions.facility.reserveOverride,
      source: "Override typed on the facility page. The reserve methods are still computed, but this illustration does not use them.",
    };
  }
  if (active.reserve === null) {
    return { value: null, source: "The selected reserve method did not return a finite amount." };
  }
  return {
    value: active.reserve,
    source: `Sized by the “${active.method}” method under the current reserve inputs.`,
  };
}

function buildFacility(
  assumptions: Assumptions,
  scenarios: Partial<Record<ScenarioName, YearPoint[]>>,
  wealth2031: number[],
  wealth2033: number[],
  active: ReserveSizing,
): ModelOutput["facility"] {
  const target = reserveTargetOf(assumptions, active);
  const rules = assumptions.facility.rules;
  const activeRule = rules.find((rule) => rule.id === assumptions.facility.activeRuleId) ?? rules[0];

  if (target.value === null || !activeRule) {
    return {
      reserveTarget: null,
      reserveSource: target.source,
      scenarioRows: [],
      ranges: [],
      primary: null,
      contributionSamples: [],
      conditionalAnchor: null,
      conditionalAnchorLabel: "Unavailable until the reserve and the portfolio assumptions are valid.",
    };
  }

  const scenarioRows: ScenarioFacilityRow[] = SCENARIOS.map((scenario) => {
    const path = scenarios[scenario];
    if (!path) throw new Error("Missing scenario path.");
    const wealthAt2033 = wealthInYear(path, DECISION_YEAR);
    return {
      scenario,
      wealth2031: wealthInYear(path, COMMUNICATION_YEAR),
      wealth2033: wealthAt2033,
      byRule: rules.map((rule) => applyRule(wealthAt2033, target.value as number, rule)),
    };
  });

  const envelopeInputs = scenarioRows
    .filter((row) => assumptions.facility.envelopeScenarios.includes(row.scenario))
    .map((row) => {
      const applied = row.byRule.find((item) => item.ruleId === activeRule.id)!;
      return { scenario: row.scenario, contribution: applied.contribution, funded: applied.operatingFullyFunded };
    });

  const exAnte = contributionsOf(wealth2033, target.value, activeRule);
  const anchor = conditionalAnchor(assumptions.facility, scenarioRows, wealth2031);
  const conditionalWealth = anchor.value === null ? [] : simulateTwoYearWealth(assumptions, anchor.value);
  const conditional = contributionsOf(conditionalWealth, target.value, activeRule);

  const ranges: RangeCard[] = [
    scenarioEnvelope({
      contributions: envelopeInputs,
      reserveTarget: target.value,
      ruleName: activeRule.name,
    }),
    percentileBand({
      method: "mc_percentile",
      contributions: exAnte.contributions,
      fundedFlags: exAnte.fundedFlags,
      lowPercentile: assumptions.facility.rangeLowPercentile,
      highPercentile: assumptions.facility.rangeHighPercentile,
      reserveTarget: target.value,
      ruleName: activeRule.name,
      context: `The band uses ${assumptions.trials.toLocaleString("en-US")} full-horizon draws from 2027, seed ${normalizeSeed(assumptions.seed)}, and beginning-of-2033 wealth after the case contributions only. WInS trading results are not included.`,
    }),
    percentileBand({
      method: "conditional_mc",
      contributions: conditional.contributions,
      fundedFlags: conditional.fundedFlags,
      lowPercentile: assumptions.facility.rangeLowPercentile,
      highPercentile: assumptions.facility.rangeHighPercentile,
      reserveTarget: target.value,
      ruleName: activeRule.name,
      context:
        anchor.value === null
          ? "No 2031 anchor is available."
          : `Conditional on ${anchor.label} ($${Math.round(anchor.value).toLocaleString("en-US")} at the beginning of 2031). The next two years, 2031 and 2032, are resimulated with seed ${normalizeSeed(assumptions.seed) + 7}. Wealth is invested at the 2031 glide weights, then your rebalance setting applies. This is the communication problem as it would look in 2031, not the view from 2026.`,
    }),
  ];

  const primary = ranges.find((range) => range.method === assumptions.facility.rangeMethod) ?? null;
  return {
    reserveTarget: target.value,
    reserveSource: target.source,
    scenarioRows,
    ranges,
    primary,
    contributionSamples: exAnte.contributions,
    conditionalAnchor: anchor.value,
    conditionalAnchorLabel: anchor.label,
  };
}

function conditionalAnchor(
  facility: FacilityParams,
  rows: ScenarioFacilityRow[],
  wealth2031: number[],
): { value: number | null; label: string } {
  if (facility.conditionalSource === "manual") {
    return { value: facility.conditionalManualWealth, label: "the manual 2031 wealth you typed" };
  }
  if (facility.conditionalSource === "median_2031") {
    return { value: percentile(wealth2031, 0.5), label: "the median simulated beginning-of-2031 wealth" };
  }
  const row = rows.find((item) => item.scenario === facility.conditionalSource);
  if (!row) return { value: null, label: "missing scenario" };
  return { value: row.wealth2031, label: `beginning-of-2031 wealth on the ${facility.conditionalSource} path` };
}

/** Two annual returns take beginning-of-2031 wealth to beginning-of-2033 wealth. */
export function simulateTwoYearWealth(assumptions: Assumptions, wealth2031: number): number[] {
  const factor = cholesky(assumptions.correlation);
  const randn = boxMuller(mulberry32(normalizeSeed(assumptions.seed) + 7));
  const out: number[] = [];
  for (let trial = 0; trial < assumptions.trials; trial++) {
    let balances = weightsAtYear(assumptions.glide, COMMUNICATION_YEAR).map((weight) => wealth2031 * weight);
    for (const year of [2031, 2032]) {
      const policy = weightsAtYear(assumptions.glide, year);
      if (assumptions.rebalance === "annual") {
        const total = balances.reduce((sum, value) => sum + value, 0);
        balances = policy.map((weight) => total * weight);
      }
      const raw = assumptions.sleeves.map(() => randn());
      const shocks = factor ? correlatedShocks(factor, raw) : raw;
      const returns = assumptions.sleeves.map((sleeve, index) =>
        simpleReturn(sleeve.mu, sleeve.sigma, shocks[index], assumptions.returnModel, assumptions.normalFloor),
      );
      balances = balances.map((balance, index) => balance * (1 + returns[index]));
    }
    out.push(balances.reduce((sum, value) => sum + value, 0));
  }
  return out;
}
