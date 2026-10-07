import { creditFlag, isBondKind, treasuryYield } from "./bonds";
import { effectiveN, heldCount } from "./equity";
import { COMMUNICATION_YEAR, DECISION_YEAR, DISCLAIMER, OPERATING_PAYMENTS } from "./case";
import { prepareCorrelation } from "./correlation";
import { applyRule, contributionsOf, percentileBand, scenarioEnvelope } from "./facility";
import { weightsAtYear, weightsSumToOne } from "./glide";
import {
  cvar5,
  maxDrawdown,
  sharpeRatio,
  sortinoRatio,
  SPEC_PERCENTILES,
  standardErrorMean,
  standardErrorProbability,
  CONVERGENCE_NOTE,
  wealthPercentileRecord,
  welford,
  welfordPush,
  welfordStdev,
} from "./metrics";
import { normalizeSeed, percentile, percentiles } from "./math";
import { priceTrial, usesPricedModel } from "./pricing";
import { mcSleeveReturns, projectPath, wealthInYear } from "./project";
import { ratePath, toRatePathPoints } from "./rates";
import { fundingByRegime, REGIME_TABLE_NOTE } from "./regimeReserve";
import { rollReserve, scheduleReturnsFor, sizeReserve, sizingRate } from "./reserve";
import { STREAM, streamManifest } from "./rng";
import type {
  Assumptions,
  FacilityParams,
  MixResult,
  ModelOutput,
  ModelViews,
  PortfolioFundedRatio,
  RangeCard,
  ReserveMethod,
  ReserveSizing,
  RiskMetrics,
  ScenarioFacilityRow,
  ScenarioName,
  SleeveKind,
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
  if (!Number.isFinite(assumptions.correlationStress)) {
    errors.push("Correlation stress must be a finite number.");
  } else if (square && n > 0) {
    const report = prepareCorrelation(assumptions.correlation, assumptions.correlationStress);
    if (report.factor === null) {
      errors.push(report.warning ?? "The correlation matrix could not be factored.");
    }
  }
  if (assumptions.shockModel !== "parametric" && assumptions.shockModel !== "block_bootstrap") {
    errors.push("The shock model must be parametric or block bootstrap.");
  }
  if (!Number.isInteger(assumptions.blockLength) || assumptions.blockLength < 1) {
    errors.push("Block length must be a whole number of at least 1.");
  }
  if (assumptions.shockModel === "block_bootstrap") {
    if (assumptions.bootstrapHistory.length < 1) {
      errors.push("Block bootstrap needs at least one row of historical sleeve returns.");
    } else if (assumptions.blockLength > assumptions.bootstrapHistory.length) {
      errors.push("Block length cannot exceed the number of historical rows.");
    }
    assumptions.bootstrapHistory.forEach((row, index) => {
      if (!Array.isArray(row) || row.length !== n) {
        errors.push(`Bootstrap row ${index + 1} must have one return per sleeve.`);
        return;
      }
      row.forEach((value, sleeve) => {
        if (!Number.isFinite(value)) errors.push(`Bootstrap row ${index + 1}, sleeve ${sleeve + 1} is not a finite number.`);
        else if (value <= -1) errors.push(`Bootstrap row ${index + 1}, sleeve ${sleeve + 1} must be above −100%.`);
      });
    });
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
  const kinds: SleeveKind[] = ["parametric", "tbill", "intermediate", "long_treasury", "credit", "equity_index", "basket"];
  assumptions.sleeves.forEach((sleeve) => {
    if (!kinds.includes(sleeve.kind)) errors.push(`${sleeve.name}: unknown sleeve kind.`);
    if (!Number.isFinite(sleeve.duration) || sleeve.duration < 0) errors.push(`${sleeve.name}: duration cannot be negative.`);
    if (!Number.isFinite(sleeve.convexity) || sleeve.convexity < 0) errors.push(`${sleeve.name}: convexity cannot be negative.`);
    if (!Number.isFinite(sleeve.expenseRatio) || sleeve.expenseRatio < 0 || sleeve.expenseRatio >= 1) {
      errors.push(`${sleeve.name}: the expense ratio must sit in [0, 1).`);
    }
    if (sleeve.defaultProb < 0 || sleeve.defaultProb > 1) errors.push(`${sleeve.name}: default probability must sit between 0 and 1.`);
    if (sleeve.recovery < 0 || sleeve.recovery > 1) errors.push(`${sleeve.name}: recovery must sit between 0 and 1.`);
    if (!Number.isFinite(sleeve.studentDf) || sleeve.studentDf < 3 || sleeve.studentDf > 30) {
      errors.push(`${sleeve.name}: Student-t degrees of freedom must sit between 3 and 30.`);
    }
  });
  const rates = assumptions.rates;
  if (!rates || rates.sigma < 0) errors.push("Short-rate volatility cannot be negative.");
  if (!rates || !Number.isFinite(rates.kappa) || !Number.isFinite(rates.r0) || !Number.isFinite(rates.theta)) {
    errors.push("The short-rate level, speed, and long-run mean must be finite numbers.");
  }
  if (!rates || rates.driftYears < 0 || rates.driftYears > 20) errors.push("Drift years must sit between 0 and 20.");
  if (!rates || rates.equityRateCorr < -1 || rates.equityRateCorr > 1) errors.push("Equity-rate correlation must sit between −1 and 1.");
  const equity = assumptions.equity;
  if (!equity || equity.studentDf < 3 || equity.studentDf > 30) errors.push("Market-factor degrees of freedom must sit between 3 and 30.");
  if (!equity || equity.marketSigma < 0 || equity.sectorSigma < 0) errors.push("Equity factor volatility cannot be negative.");
  if (!assumptions.costs || assumptions.costs.transactionCostBps < 0 || assumptions.costs.transactionCostBps > 500) {
    errors.push("Transaction cost must sit between 0 and 500 basis points.");
  }
  if (!Array.isArray(assumptions.basket) || assumptions.basket.length > 80) errors.push("The basket can hold at most 80 names.");
  assumptions.basket?.forEach((name) => {
    if (!name.ticker.trim()) errors.push("A basket row needs a ticker.");
    if (name.weight < 0) errors.push(`${name.ticker}: basket weight cannot be negative.`);
    if (name.idioSigma < 0) errors.push(`${name.ticker}: idiosyncratic volatility cannot be negative.`);
    if (name.jumpProb < 0 || name.jumpProb > 1 || name.geoJumpProb < 0 || name.geoJumpProb > 1) {
      errors.push(`${name.ticker}: jump probabilities must sit between 0 and 1.`);
    }
  });
  if (!Array.isArray(assumptions.mixes) || assumptions.mixes.length > 8) errors.push("Compare at most 8 mixes.");
  return [...new Set(errors)];
}

function sampleSettings(assumptions: Assumptions) {
  return {
    trials: assumptions.trials,
    seed: normalizeSeed(assumptions.seed),
    returnModel: assumptions.returnModel,
    normalFloor: assumptions.normalFloor,
    percentiles: assumptions.percentiles,
  };
}

const MC_FORMULA_PARAMETRIC =
  "Parametric z at (master seed, stream 1, trial, calendar year, sleeve). Shocks are Lz, L the Cholesky factor of the stressed correlation. " +
  "Lognormal sets E[1+r] = 1+μ and Var(1+r) = σ². Normal uses max(floor, μ + σ z).";

const MC_FORMULA_BOOTSTRAP =
  "Circular block bootstrap on stream 3. A uniform at (master seed, stream 3, trial, block index, 0) picks the block start. " +
  "μ, σ, and the Gaussian copula are not used on these paths. Bear, base, and bull paths still use the scenario returns. " +
  "Block bootstrap ignores duration pricing.";

const MC_FORMULA_PRICED =
  "Short-rate shock on stream 4 at (seed, trial, calendar year, 0), one path per trial. " +
  "Bond return = yield − duration × change in yield + 0.5 × convexity × change² − default loss. Default is a uniform on stream 5. " +
  "The equity kernel is a unit-variance Student-t on stream 1 from dimension 120, blended with that year's rate shock. " +
  "Single names add beta times the market factor, a sector factor, an idiosyncratic Student-t, an optional jump, and FX on stream 6. " +
  "Parametric sleeves still use stream 1 at the sleeve index. Hold-to-maturity drops the price term and keeps the carry. " +
  "Compared mixes share the seed and the streams.";

const VIEW_FORMULA =
  "Mark-to-market wealth uses the duration price term. Hold-to-maturity wealth earns the beginning yield (and any default loss) and ignores the price term. " +
  "A bill with a short duration shows a small price term. A long bond shows about −duration × the yield change. Neither figure is a forecast.";

export function runModel(assumptions: Assumptions): ModelOutput {
  const errors = validate(assumptions);
  const sample = sampleSettings(assumptions);
  const masterSeed = sample.seed;
  const correlation = prepareCorrelation(
    assumptions.correlation,
    Number.isFinite(assumptions.correlationStress) ? assumptions.correlationStress : 0,
  );
  const streams = streamManifest(masterSeed);
  const shockModel: Assumptions["shockModel"] =
    assumptions.shockModel === "block_bootstrap" ? "block_bootstrap" : "parametric";
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

  const regimeFunding = assumptions.rates ? fundingByRegime(assumptions.rates) : [];
  const reserveBlock = {
    sizings,
    active,
    scheduleReturns,
    schedule,
    scheduleNote,
    regimeFunding,
    regimeNote: REGIME_TABLE_NOTE,
  };
  const baseRates = assumptions.rates
    ? toRatePathPoints(ratePath({ params: assumptions.rates, seed: masterSeed, trial: 0, mode: "scenario", scenario: "base" }))
    : [];
  const identity = {
    schemaVersion: 3 as const,
    masterSeed,
    streams,
    correlation,
    shockModel,
  };
  const blankViews = buildViews(assumptions, undefined, baseRates, correlation.factor);

  if (errors.length > 0) {
    return {
      disclaimer: DISCLAIMER,
      errors,
      ...identity,
      scenarios: {},
      monteCarlo: null,
      reserve: reserveBlock,
      facility: null,
      views: blankViews,
      metrics: null,
      mixes: [],
    };
  }

  const pathBase = {
    sleeves: assumptions.sleeves,
    glide: assumptions.glide,
    rebalance: assumptions.rebalance,
    inflation: assumptions.inflation,
    returnModel: assumptions.returnModel,
    normalFloor: assumptions.normalFloor,
    shockModel,
    bootstrapHistory: assumptions.bootstrapHistory,
    blockLength: assumptions.blockLength,
    correlationStress: assumptions.correlationStress,
    correlation: assumptions.correlation,
    seed: masterSeed,
    factor: correlation.factor,
    source: assumptions,
  };
  const scenarioPaths: Partial<Record<ScenarioName, YearPoint[]>> = {};
  for (const scenario of SCENARIOS) {
    scenarioPaths[scenario] = projectPath({
      ...pathBase,
      mode: "scenario",
      scenario,
      trial: 0,
    });
  }

  const wealth2031: number[] = [];
  const wealth2033: number[] = [];
  const columns = new Map<number, number[]>();
  const drawdowns: number[] = [];
  const excess = welford();
  let downsideSum = 0;
  let downsideCount = 0;
  const priceSums = assumptions.sleeves.map(() => 0);
  let priceYears = 0;
  let nonFinite = false;
  for (let trial = 0; trial < assumptions.trials; trial++) {
    const path = projectPath({
      ...pathBase,
      mode: "mc",
      trial,
    });
    drawdowns.push(maxDrawdown(path));
    for (const point of path) {
      if (!Number.isFinite(point.wealthStart)) nonFinite = true;
      const column = columns.get(point.calendarYear) ?? [];
      column.push(point.wealthStart);
      columns.set(point.calendarYear, column);
      if (point.yearReturn !== null && Number.isFinite(point.yearReturn)) {
        const cash = point.cashYield ?? assumptions.rates?.r0 ?? 0;
        const gap = point.yearReturn - cash;
        welfordPush(excess, gap);
        const below = Math.min(gap, 0);
        downsideSum += below * below;
        downsideCount += 1;
      }
      if (point.priceComponents) {
        priceYears += 1;
        point.priceComponents.forEach((value, index) => {
          priceSums[index] += value;
        });
      }
    }
    wealth2031.push(wealthInYear(path, COMMUNICATION_YEAR));
    wealth2033.push(wealthInYear(path, DECISION_YEAR));
  }

  if (nonFinite) {
    return {
      disclaimer: DISCLAIMER,
      errors: ["A projected wealth was not a finite number. The portfolio sample was discarded."],
      ...identity,
      scenarios: scenarioPaths,
      monteCarlo: null,
      reserve: reserveBlock,
      facility: null,
      views: buildViews(assumptions, scenarioPaths.base, baseRates, correlation.factor),
      metrics: null,
      mixes: [],
    };
  }

  const byYear = [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([calendarYear, values]) => ({
      calendarYear,
      values: percentiles(values, assumptions.percentiles),
    }));

  const facility = buildFacility(assumptions, scenarioPaths, wealth2031, wealth2033, active);
  const metrics = summarizeMetrics({
    assumptions,
    wealth2033,
    drawdowns,
    excessMean: excess.mean,
    excessStdev: welfordStdev(excess),
    downsideDeviation: downsideCount > 0 ? Math.sqrt(downsideSum / downsideCount) : Number.NaN,
    priceSums,
    priceYears,
    facility,
  });

  return {
    disclaimer: DISCLAIMER,
    errors: [],
    ...identity,
    scenarios: scenarioPaths,
    monteCarlo: {
      trials: assumptions.trials,
      seed: masterSeed,
      formula: monteCarloFormula(assumptions, shockModel),
      byYear,
      wealth2031,
      wealth2033,
    },
    reserve: reserveBlock,
    facility,
    views: buildViews(assumptions, scenarioPaths.base, baseRates, correlation.factor),
    metrics,
    mixes: assumptions.mixes.map((mix) => scoreMix(assumptions, mix)),
  };
}

function monteCarloFormula(assumptions: Assumptions, shockModel: Assumptions["shockModel"]): string {
  if (shockModel === "block_bootstrap") return MC_FORMULA_BOOTSTRAP;
  if (usesPricedModel(assumptions.sleeves)) return MC_FORMULA_PRICED;
  return MC_FORMULA_PARAMETRIC;
}

function buildViews(
  assumptions: Assumptions,
  base: YearPoint[] | undefined,
  rateRows: ModelOutput["views"]["ratePath"],
  factor: number[][] | null,
): ModelViews {
  const priced = usesPricedModel(assumptions.sleeves) && assumptions.shockModel !== "block_bootstrap";
  const slice = priced
    ? priceTrial({ assumptions, mode: "scenario", scenario: "base", trial: 0, factor }).byYear.get(2027)
    : undefined;
  const curve = rateRows[0];
  const sleeves = assumptions.sleeves.map((sleeve, index) => {
    const flag = creditFlag(sleeve);
    const scenarioReturn = base?.[0]?.sleeveReturns?.[index];
    const mtm = slice ? slice.mtm[index] : scenarioReturn ?? null;
    const htm = slice ? slice.htm[index] : scenarioReturn ?? null;
    const price = slice ? slice.price[index] : 0;
    const carry = isBondKind(sleeve.kind) && curve ? treasuryYield(sleeve.kind, curve) + (sleeve.kind === "credit" ? sleeve.spread : 0) : null;
    return {
      id: sleeve.id,
      name: sleeve.name,
      kind: sleeve.kind,
      flagged: sleeve.kind === "credit",
      flagReason: flag,
      carry2027: carry,
      price2027: price,
      mtm2027: mtm ?? null,
      htm2027: htm ?? null,
    };
  });
  return {
    ratePath: rateRows,
    wealth: (base ?? []).map((point) => ({
      calendarYear: point.calendarYear,
      mtm: point.wealthStart,
      htm: point.wealthStartHtm,
    })),
    sleeves,
    basketEffectiveN: effectiveN(assumptions.basket.map((name) => name.weight)),
    basketHeld: heldCount(assumptions.basket),
    formula: VIEW_FORMULA,
  };
}

function summarizeMetrics(args: {
  assumptions: Assumptions;
  wealth2033: number[];
  drawdowns: number[];
  excessMean: number;
  excessStdev: number;
  downsideDeviation: number;
  priceSums: number[];
  priceYears: number;
  facility: ModelOutput["facility"];
}): RiskMetrics {
  const { mean, se } = standardErrorMean(args.wealth2033);
  const reserve = args.facility?.reserveTarget ?? null;
  const funded =
    reserve !== null && reserve > 0
      ? args.wealth2033.filter((wealth) => wealth + 1e-6 >= reserve).length / args.wealth2033.length
      : null;
  const conditional = args.facility?.ranges.find((range) => range.method === "conditional_mc") ?? null;
  const drawdownMean = args.drawdowns.length > 0 ? args.drawdowns.reduce((total, value) => total + value, 0) / args.drawdowns.length : null;
  return {
    wealthPercentiles: wealthPercentileRecord(args.wealth2033, args.assumptions.percentiles),
    fullyFundedProbability: funded,
    cvar5: args.wealth2033.length > 0 ? cvar5(args.wealth2033) : null,
    maxDrawdownPercentiles: wealthPercentileRecord(args.drawdowns, SPEC_PERCENTILES),
    meanMaxDrawdown: drawdownMean,
    facilityPercentiles: args.facility ? wealthPercentileRecord(args.facility.contributionSamples, SPEC_PERCENTILES) : {},
    conditionalLow: conditional?.low ?? null,
    conditionalHigh: conditional?.high ?? null,
    conditionalCoverage: conditional?.empiricalCoverage ?? null,
    sharpe: sharpeRatio(args.excessMean, args.excessStdev),
    sortino: sortinoRatio(args.excessMean, args.downsideDeviation),
    convergence: {
      trials: args.assumptions.trials,
      meanWealth2033: mean,
      standardErrorMean: se,
      standardErrorFunded: funded === null ? null : standardErrorProbability(funded, args.wealth2033.length),
      note: CONVERGENCE_NOTE,
    },
    sleeveMtm: args.assumptions.sleeves.map((sleeve, index) => ({
      id: sleeve.id,
      name: sleeve.name,
      kind: sleeve.kind,
      meanPrice: args.priceYears > 0 ? args.priceSums[index] / args.priceYears : 0,
    })),
  };
}

function scoreMix(assumptions: Assumptions, mix: Assumptions["mixes"][number]): MixResult {
  const empty: MixResult = {
    id: mix.id,
    name: mix.name,
    error: null,
    p1: null,
    p5: null,
    p50: null,
    p95: null,
    fullyFundedProbability: null,
    cvar5: null,
    meanMaxDrawdown: null,
  };
  if (mix.weights2027.length !== assumptions.sleeves.length || mix.weights2033.length !== assumptions.sleeves.length) {
    return { ...empty, error: "This mix does not have one weight per sleeve." };
  }
  const next: Assumptions = {
    ...assumptions,
    mixes: [],
    glide: [
      { year: 2027, weights: mix.weights2027 },
      { year: 2033, weights: mix.weights2033 },
    ],
  };
  const output = runModel(next);
  if (output.errors.length > 0 || !output.metrics) {
    return { ...empty, error: output.errors[0] ?? "This mix did not produce a sample." };
  }
  const wealth = output.metrics.wealthPercentiles;
  return {
    ...empty,
    p1: wealth["1"] ?? null,
    p5: wealth["5"] ?? null,
    p50: wealth["50"] ?? null,
    p95: wealth["95"] ?? null,
    fullyFundedProbability: output.metrics.fullyFundedProbability,
    cvar5: output.metrics.cvar5,
    meanMaxDrawdown: output.metrics.meanMaxDrawdown,
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
      portfolioFundedRatio: null,
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
      context: `The band uses ${assumptions.trials.toLocaleString("en-US")} full-horizon draws from 2027 on portfolio stream ${STREAM.portfolio}, master seed ${normalizeSeed(assumptions.seed)}, and beginning-of-2033 wealth after the case contributions only. WInS trading results are not included.`,
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
          : `Conditional on ${anchor.label} ($${Math.round(anchor.value).toLocaleString("en-US")} at the beginning of 2031). Years 2031 and 2032 reuse portfolio stream ${STREAM.portfolio} at those calendar years and the same trial index as the full-horizon sample, master seed ${normalizeSeed(assumptions.seed)}. This is not a separate seed. Wealth restarts at the anchor and at the 2031 policy weights, then the rebalance setting applies. Drifted balances from before 2031 are not carried in. With annual rebalancing, a trial started from its own 2031 wealth lands on its own 2033 wealth. This is the communication problem as it would look in 2031, not the view from 2026.`,
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
    portfolioFundedRatio: fundedRatioOfPortfolio(wealth2033, target.value, assumptions.percentiles),
  };
}

function fundedRatioOfPortfolio(
  wealth2033: number[],
  reserve: number,
  wanted: number[],
): PortfolioFundedRatio | null {
  if (!(reserve > 0) || !Number.isFinite(reserve) || wealth2033.length === 0) return null;
  const ratios = wealth2033.map((wealth) => wealth / reserve);
  return {
    percentiles: percentiles(ratios, wanted),
    shareCovered: wealth2033.filter((wealth) => wealth + 1e-6 >= reserve).length / wealth2033.length,
    formula:
      "Beginning-of-2033 wealth on a portfolio trial (stream 1) divided by the reserve target used on this page. A ratio of at least 1 means that trial can fund the reserve before any facility gift.",
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

/**
 * Two annual returns take beginning-of-2031 wealth to beginning-of-2033 wealth.
 * Sleeve returns are the portfolio stream at 2031 and 2032 (common random numbers
 * with the full-horizon sample). Balances restart at the 2031 policy weights.
 */
export function simulateTwoYearWealth(assumptions: Assumptions, wealth2031: number): number[] {
  const factor = prepareCorrelation(assumptions.correlation, assumptions.correlationStress).factor;
  const out: number[] = [];
  for (let trial = 0; trial < assumptions.trials; trial++) {
    let balances = weightsAtYear(assumptions.glide, COMMUNICATION_YEAR).map((weight) => wealth2031 * weight);
    for (const year of [2031, 2032]) {
      const policy = weightsAtYear(assumptions.glide, year);
      if (assumptions.rebalance === "annual") {
        const total = balances.reduce((sum, value) => sum + value, 0);
        balances = policy.map((weight) => total * weight);
      }
      const returns = mcSleeveReturns(assumptions, trial, year, factor);
      balances = balances.map((balance, index) => balance * (1 + (returns[index] ?? 0)));
    }
    const next = balances.reduce((sum, value) => sum + value, 0);
    out.push(Number.isFinite(next) ? next : 0);
  }
  return out;
}
