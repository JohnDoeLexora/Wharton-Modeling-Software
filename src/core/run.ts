import { creditFlag, isBondKind, treasuryYield } from "./bonds";
import { effectiveN, heldCount } from "./equity";
import { COMMUNICATION_YEAR, DECISION_YEAR, DISCLAIMER, OPERATING_PAYMENTS } from "./case";
import { prepareCorrelation } from "./correlation";
import { applyRule, contributionsPathwise, percentileBand, scenarioEnvelope } from "./facility";
import { weightsAtYear, weightsSumToOne } from "./glide";
import { provenanceStamp } from "./provenance";
import {
  batchMeansError,
  cvar5,
  maxDrawdown,
  sharpeRatio,
  sortinoRatio,
  SPEC_PERCENTILES,
  standardErrorMean,
  CONVERGENCE_NOTE,
  wealthPercentileRecord,
} from "./metrics";
import { normalFloorAdjustment, normalizeSeed, percentile, percentiles, seedProblem } from "./math";
import { priceTrial, usesPricedModel } from "./pricing";
import { buildSchedule, continueFromBalances, projectBook, projectPath, wealthInYear } from "./project";
import { ratePath, toRatePathPoints } from "./rates";
import { fundingByRegime, REGIME_TABLE_NOTE } from "./regimeReserve";
import { reserveFromCurve, rollReserve, scheduleReturnsFor, shortfallOrderStatistic, shortfallRequirementSample, sizeReserve, sizingRate } from "./reserve";
import { samplerConvergence } from "./sobol";
import { stateCoverage } from "./stateRange";
import { STREAM, streamManifest } from "./rng";
import type {
  Assumptions,
  FacilityParams,
  MarketState2031,
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
  if (!Number.isFinite(assumptions.correlationStress) || assumptions.correlationStress < 0 || assumptions.correlationStress > 1) {
    errors.push("Correlation stress is a blend weight and must sit between 0 and 1.");
  } else if (square && n > 0) {
    const report = prepareCorrelation(
      assumptions.correlation,
      assumptions.correlationStress,
      assumptions.correlationRepair === "higham" ? "higham" : "none",
    );
    if (report.factor === null) {
      errors.push(report.warning ?? "The correlation matrix could not be factored. Independent draws were not substituted.");
    }
  }
  const seedIssue = seedProblem(assumptions.seed);
  if (seedIssue) errors.push(seedIssue);
  if (assumptions.sampling !== "pseudo" && assumptions.sampling !== "antithetic" && assumptions.sampling !== "sobol") {
    errors.push("Sampling must be pseudo-random, antithetic, or Sobol.");
  }
  if (!Number.isFinite(assumptions.inflationSigma) || assumptions.inflationSigma < 0) {
    errors.push("Inflation volatility cannot be negative.");
  }
  if (!Number.isFinite(assumptions.inflationBeta)) errors.push("The inflation-rate beta must be a finite number.");
  if (assumptions.reserve.discountMode !== "fixed_yield" && assumptions.reserve.discountMode !== "trial_curve") {
    errors.push("Reserve discounting must be the fixed yield or each trial's curve.");
  }
  if (assumptions.shockModel !== "parametric" && assumptions.shockModel !== "block_bootstrap") {
    errors.push("The shock model must be parametric or block bootstrap.");
  }
  if (!Number.isInteger(assumptions.blockLength) || assumptions.blockLength < 1) {
    errors.push("Block length must be a whole number of at least 1.");
  }
  if (assumptions.shockModel === "block_bootstrap") {
    if (assumptions.bootstrapHistory.length < 8) {
      errors.push("Block bootstrap needs at least 8 historical rows. A shorter history mostly repeats the same years.");
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
  const gainTaxRate = assumptions.costs?.gainTaxRate ?? 0;
  if (!Number.isFinite(gainTaxRate) || gainTaxRate < 0 || gainTaxRate > 1) {
    errors.push("The gain-tax rate must sit between 0 and 1.");
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
const MC_FORMULA_PARAMETRIC =
  "Parametric z at (master seed, stream 1, trial, calendar year, sleeve), or a Sobol Brownian bridge, or an antithetic pair. " +
  "Shocks are Lz, L the Cholesky factor of the stressed correlation. A matrix that does not factor is an error. " +
  "Lognormal sets E[1+r] = 1+μ and Var(1+r) = σ². Normal uses max(floor, center + σ z). " +
  "When mean correction is on, center is chosen so the censored mean equals μ. The reported bias is the lift before that correction.";

const MC_FORMULA_BOOTSTRAP =
  "Block bootstrap on stream 3. Circular blocks keep a fixed length. Stationary blocks (Politis–Romano) renew with probability 1 / block length. " +
  "μ, σ, and the Gaussian copula are not used on these paths. Bear, base, and bull paths still use the scenario returns. " +
  "Block bootstrap ignores duration pricing. At least 8 historical rows are required.";

const MC_FORMULA_PRICED =
  "Short-rate shock on stream 4 at (seed, trial, calendar year, 0), one path per trial. The priced path is cached and reused by every mix. " +
  "Bond return = yield − duration × change in yield + 0.5 × convexity × change² − default loss. Default is a uniform on stream 5. " +
  "The equity kernel is a unit-variance Student-t on stream 1 from dimension 120, blended with that year's rate shock. " +
  "Single names add beta times the market factor, a sector factor, an idiosyncratic Student-t, an optional jump, and FX on stream 6. " +
  "Parametric sleeves still use stream 1 at the sleeve index. Hold-to-maturity drops the price term and keeps the carry. " +
  "Compared mixes share the seed, the streams, and the sleeve-return schedule.";

const VIEW_FORMULA =
  "Mark-to-market wealth uses the duration price term. Hold-to-maturity wealth earns the beginning yield (and any default loss) and ignores the price term. " +
  "A bill with a short duration shows a small price term. A long bond shows about −duration × the yield change. Neither figure is a forecast.";

export interface RunHooks {
  onProgress?: (done: number, total: number) => void;
}

function blankStreams(seed: number) {
  const base = streamManifest(0);
  return { ...base, masterSeed: seed, design: `${base.design} The typed seed was rejected, so this manifest is not that run.` };
}

function halted(args: {
  errors: string[];
  masterSeed: number;
  streams: ModelOutput["streams"];
  correlation: ModelOutput["correlation"];
  shockModel: Assumptions["shockModel"];
  scenarios: ModelOutput["scenarios"];
  reserve: ModelOutput["reserve"];
  views: ModelViews;
  provenance: ModelOutput["provenance"];
}): ModelOutput {
  return {
    disclaimer: DISCLAIMER,
    errors: args.errors,
    schemaVersion: 3,
    masterSeed: args.masterSeed,
    streams: args.streams,
    correlation: args.correlation,
    shockModel: args.shockModel,
    scenarios: args.scenarios,
    monteCarlo: null,
    reserve: args.reserve,
    facility: null,
    views: args.views,
    metrics: null,
    trialCurve: null,
    stateRange: null,
    samplerComparison: null,
    provenance: args.provenance,
    mixes: [],
  };
}

export function runModel(assumptions: Assumptions, hooks?: RunHooks): ModelOutput {
  const errors = validate(assumptions);
  const seedOk = seedProblem(assumptions.seed) === null;
  const masterSeed = seedOk ? assumptions.seed : 0;
  const correlation = prepareCorrelation(
    assumptions.correlation,
    Number.isFinite(assumptions.correlationStress) ? assumptions.correlationStress : 0,
    assumptions.correlationRepair === "higham" ? "higham" : "none",
  );
  const streams = seedOk ? streamManifest(masterSeed) : blankStreams(0);
  const shockModel: Assumptions["shockModel"] = assumptions.shockModel === "block_bootstrap" ? "block_bootstrap" : "parametric";
  const sample = {
    trials: assumptions.trials,
    seed: assumptions.seed,
    returnModel: assumptions.returnModel,
    normalFloor: assumptions.normalFloor,
    percentiles: assumptions.percentiles,
  };
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
  const provenance = provenanceStamp(assumptions, masterSeed);
  const views = buildViews(assumptions, undefined, baseRates, correlation.factor);

  if (errors.length > 0) {
    return halted({
      errors,
      masterSeed,
      streams,
      correlation,
      shockModel,
      scenarios: {},
      reserve: reserveBlock,
      views,
      provenance,
    });
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
    scenarioPaths[scenario] = projectPath({ ...pathBase, mode: "scenario", scenario, trial: 0 });
  }

  const wealth2031: number[] = [];
  const wealth2033: number[] = [];
  const reserves: number[] = [];
  const gifts: number[] = [];
  const drawdowns: number[] = [];
  const sharpes: number[] = [];
  const sortinos: number[] = [];
  const states: MarketState2031[] = [];
  const sleeve0: number[] = [];
  const columns = new Map<number, number[]>();
  const priceSums = assumptions.sleeves.map(() => 0);
  let priceYears = 0;
  let nonFinite = false;
  const mixPlans = assumptions.mixes.map((mix) => {
    const badLength = mix.weights2027.length !== assumptions.sleeves.length || mix.weights2033.length !== assumptions.sleeves.length;
    const badWeights = !badLength && (!weightsSumToOne(mix.weights2027) || !weightsSumToOne(mix.weights2033));
    return {
      mix,
      error: badLength ? "This mix does not have one weight per sleeve." : badWeights ? "This mix's weights must be non-negative and sum to 1." : null,
      wealth: [] as number[],
      drawdowns: [] as number[],
    };
  });
  const fallbackRate = assumptions.rates?.r0 ?? 0;
  const index2031 = COMMUNICATION_YEAR - 2027;

  for (let trial = 0; trial < assumptions.trials; trial++) {
    const input = { ...pathBase, mode: "mc" as const, trial };
    const returns = buildSchedule(input);
    const book = projectBook(input, returns);
    const path = book.points;
    const drawdown = maxDrawdown(path);
    drawdowns.push(drawdown);
    const ratios = trialRatios(path, fallbackRate);
    if (ratios.sharpe !== null) sharpes.push(ratios.sharpe);
    if (ratios.sortino !== null) sortinos.push(ratios.sortino);
    for (const point of path) {
      if (!Number.isFinite(point.wealthStart)) nonFinite = true;
      const column = columns.get(point.calendarYear) ?? [];
      column.push(point.wealthStart);
      columns.set(point.calendarYear, column);
      if (point.priceComponents) {
        priceYears += 1;
        point.priceComponents.forEach((value, index) => {
          priceSums[index] += value;
        });
      }
    }
    const w2031 = wealthInYear(path, COMMUNICATION_YEAR);
    const w2033 = wealthInYear(path, DECISION_YEAR);
    const reserveT = trialReserve(assumptions, returns, active.reserve);
    if (!Number.isFinite(w2031) || !Number.isFinite(w2033) || !Number.isFinite(reserveT)) nonFinite = true;
    wealth2031.push(w2031);
    wealth2033.push(w2033);
    reserves.push(reserveT);
    gifts.push(w2033 - reserveT);
    const point2031 = path.find((point) => point.calendarYear === COMMUNICATION_YEAR);
    const curve2031 = returns.rates?.find((row) => row.calendarYear === COMMUNICATION_YEAR)?.short ?? null;
    states.push({
      trial,
      wealth: w2031,
      balances: book.startBalances[index2031] ?? [],
      weights: point2031?.actualWeights ?? [],
      driftedWeights: point2031?.driftedWeights ?? [],
      shortRate: point2031?.cashYield ?? curve2031,
    });
    const firstReturn = path[0]?.sleeveReturns?.[0];
    sleeve0.push(Number.isFinite(firstReturn) ? (firstReturn as number) : Number.NaN);
    for (const plan of mixPlans) {
      if (plan.error) continue;
      const mixBook = projectBook(
        {
          ...input,
          glide: [
            { year: 2027, weights: plan.mix.weights2027 },
            { year: 2033, weights: plan.mix.weights2033 },
          ],
        },
        returns,
      );
      plan.wealth.push(wealthInYear(mixBook.points, DECISION_YEAR));
      plan.drawdowns.push(maxDrawdown(mixBook.points));
    }
    if (hooks?.onProgress && (trial % 50 === 49 || trial + 1 === assumptions.trials)) {
      hooks.onProgress(trial + 1, assumptions.trials);
    }
  }

  if (nonFinite) {
    return halted({
      errors: ["A projected wealth was not a finite number. The portfolio sample was discarded."],
      masterSeed,
      streams,
      correlation,
      shockModel,
      scenarios: scenarioPaths,
      reserve: reserveBlock,
      views: buildViews(assumptions, scenarioPaths.base, baseRates, correlation.factor),
      provenance,
    });
  }

  const conditional = simulateTwoYearWealth(assumptions, conditionalAnchorValue(assumptions, scenarioPaths, wealth2031));
  if (conditional.some((value) => !Number.isFinite(value))) {
    return halted({
      errors: ["A 2031–2033 continuation was not a finite number. The sample was discarded instead of being recorded as zero."],
      masterSeed,
      streams,
      correlation,
      shockModel,
      scenarios: scenarioPaths,
      reserve: reserveBlock,
      views: buildViews(assumptions, scenarioPaths.base, baseRates, correlation.factor),
      provenance,
    });
  }

  const byYear = [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([calendarYear, values]) => ({ calendarYear, values: percentiles(values, assumptions.percentiles) }));
  const facility = buildFacility(assumptions, scenarioPaths, wealth2031, wealth2033, reserves, active, conditional);
  const metrics = summarizeMetrics({
    assumptions,
    wealth2033,
    reserves,
    drawdowns,
    sharpes,
    sortinos,
    priceSums,
    priceYears,
    facility,
    reserveSamplingError: active.standardError,
  });
  const comparison = samplerConvergence(masterSeed);
  const control = controlVariateNote(assumptions, wealth2033, sleeve0);
  const mixes = mixPlans.map((plan) => scoreStoredMix(plan, wealth2033, reserves, assumptions));

  return {
    disclaimer: DISCLAIMER,
    errors: [],
    schemaVersion: 3,
    masterSeed,
    streams,
    correlation,
    shockModel,
    scenarios: scenarioPaths,
    monteCarlo: {
      trials: assumptions.trials,
      seed: masterSeed,
      formula: monteCarloFormula(assumptions, shockModel),
      byYear,
      wealth2031,
      wealth2033,
      reserve: reserves,
      gift: gifts,
      drawdown: drawdowns,
    },
    reserve: reserveBlock,
    facility,
    views: buildViews(assumptions, scenarioPaths.base, baseRates, correlation.factor),
    metrics,
    trialCurve: trialCurveSummary(assumptions, reserves),
    stateRange: stateCoverage(states, wealth2033),
    samplerComparison: { ...comparison, note: control ? `${comparison.note} ${control}` : comparison.note },
    provenance,
    mixes,
  };
}

function trialReserve(assumptions: Assumptions, schedule: { rates: { calendarYear: number }[] | null }, fixed: number | null): number {
  if (assumptions.facility.useReserveOverride) return assumptions.facility.reserveOverride;
  if (assumptions.reserve.discountMode === "trial_curve") {
    const row = schedule.rates?.find((item) => item.calendarYear === DECISION_YEAR) ?? null;
    return reserveFromCurve(row as Parameters<typeof reserveFromCurve>[0]);
  }
  return fixed ?? Number.NaN;
}

function curveReserve(assumptions: Assumptions, scenario: ScenarioName): number {
  const rows = ratePath({ params: assumptions.rates, seed: assumptions.seed, trial: 0, mode: "scenario", scenario });
  return reserveFromCurve(rows.find((row) => row.calendarYear === DECISION_YEAR) ?? null);
}

function trialRatios(path: YearPoint[], fallback: number): { sharpe: number | null; sortino: number | null } {
  const excess: number[] = [];
  for (const point of path) {
    if (point.yearReturn === null || !Number.isFinite(point.yearReturn)) continue;
    const cash = point.cashYield;
    const riskFree = cash !== null && Number.isFinite(cash) ? cash : fallback;
    excess.push(point.yearReturn - riskFree);
  }
  if (excess.length < 2) return { sharpe: null, sortino: null };
  const mean = excess.reduce((total, value) => total + value, 0) / excess.length;
  let square = 0;
  let down = 0;
  for (const value of excess) {
    const gap = value - mean;
    square += gap * gap;
    const below = Math.min(value, 0);
    down += below * below;
  }
  return {
    sharpe: sharpeRatio(mean, Math.sqrt(square / (excess.length - 1))),
    sortino: sortinoRatio(mean, Math.sqrt(down / excess.length)),
  };
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function batchOf(values: number[], reduce: (slice: number[]) => number): number | null {
  const error = batchMeansError(values.length, (start, end) => reduce(values.slice(start, end)));
  return Number.isFinite(error) ? error : null;
}

function finiteSe(value: number): number | null {
  return Number.isFinite(value) ? value : null;
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
    wealth: (base ?? []).map((point) => ({ calendarYear: point.calendarYear, mtm: point.wealthStart, htm: point.wealthStartHtm })),
    sleeves,
    basketEffectiveN: effectiveN(assumptions.basket.map((name) => name.weight)),
    basketHeld: heldCount(assumptions.basket),
    formula: VIEW_FORMULA,
  };
}

function summarizeMetrics(args: {
  assumptions: Assumptions;
  wealth2033: number[];
  reserves: number[];
  drawdowns: number[];
  sharpes: number[];
  sortinos: number[];
  priceSums: number[];
  priceYears: number;
  facility: ModelOutput["facility"];
  reserveSamplingError: number | null;
}): RiskMetrics {
  const { assumptions, wealth2033, reserves, drawdowns, sharpes, sortinos } = args;
  const { mean, se } = standardErrorMean(wealth2033);
  const batchMean = batchOf(wealth2033, (slice) => slice.reduce((total, value) => total + value, 0) / slice.length);
  const fundedFlags = wealth2033.map((wealth, index) => wealth + 1e-6 >= reserves[index]);
  const funded = fundedFlags.length > 0 ? fundedFlags.filter(Boolean).length / fundedFlags.length : null;
  const conditional = args.facility?.ranges.find((range) => range.method === "conditional_mc") ?? null;
  const drawdownMean = meanOf(drawdowns);
  const sharpe = meanOf(sharpes);
  const sortino = meanOf(sortinos);
  const first = assumptions.sleeves[0];
  const floor = assumptions.returnModel === "normal" && first ? normalFloorAdjustment(first.mu, first.sigma, assumptions.normalFloor) : null;
  const priced = usesPricedModel(assumptions.sleeves) && assumptions.shockModel !== "block_bootstrap";
  const requirements =
    assumptions.reserve.method === "shortfall" && assumptions.reserve.discountMode === "fixed_yield" && !assumptions.facility.useReserveOverride
      ? shortfallRequirementSample({
          mu: assumptions.reserve.shortfallMu,
          sigma: assumptions.reserve.shortfallSigma,
          trials: assumptions.trials,
          seed: assumptions.seed,
          returnModel: assumptions.returnModel,
          normalFloor: assumptions.normalFloor,
        })
      : null;
  const fundedSe = finiteSe(
    requirements
      ? batchMeansError(wealth2033.length, (start, end) => {
          const hurdle = shortfallOrderStatistic(requirements.slice(start, end), assumptions.reserve.shortfallTarget);
          let ok = 0;
          for (let i = start; i < end; i++) if (wealth2033[i] + 1e-6 >= hurdle) ok += 1;
          return ok / (end - start);
        })
      : batchMeansError(wealth2033.length, (start, end) => {
          let ok = 0;
          for (let i = start; i < end; i++) if (wealth2033[i] + 1e-6 >= reserves[i]) ok += 1;
          return ok / (end - start);
        }),
  );
  const reserveSe =
    assumptions.reserve.discountMode === "trial_curve"
      ? batchOf(reserves, (slice) => slice.reduce((total, value) => total + value, 0) / slice.length)
      : null;
  return {
    wealthPercentiles: wealthPercentileRecord(wealth2033, assumptions.percentiles),
    fullyFundedProbability: funded,
    cvar5: wealth2033.length > 0 ? cvar5(wealth2033) : null,
    maxDrawdownPercentiles: wealthPercentileRecord(drawdowns, SPEC_PERCENTILES),
    meanMaxDrawdown: drawdownMean,
    facilityPercentiles: args.facility ? wealthPercentileRecord(args.facility.contributionSamples, SPEC_PERCENTILES) : {},
    conditionalLow: conditional?.low ?? null,
    conditionalHigh: conditional?.high ?? null,
    conditionalCoverage: conditional?.empiricalCoverage ?? null,
    sharpe,
    sortino,
    sharpeNote: priced
      ? "Mean of per-trial Sharpe ratios. Each year subtracts that trial's cash yield, the short rate on the priced path."
      : `Mean of per-trial Sharpe ratios. Each year subtracts the rate card's short rate r0 (${assumptions.rates.r0}). Parametric sleeves are not priced as a bill, so this is the stated cash yield.`,
    fundedDefinition:
      assumptions.reserve.discountMode === "trial_curve" && !assumptions.facility.useReserveOverride
        ? "Share of trials whose beginning-of-2033 wealth covers the present value of the ten $50,000 payments, 2033 through 2042, on that trial's own 2033 curve. The first payment is immediate."
        : "Share of trials whose beginning-of-2033 wealth covers one fixed reserve. The simulated curve does not move that hurdle. Fixed yield is labeled on the reserve page.",
    normalFloorBias: floor ? floor.bias : null,
    normalFloorCorrected: assumptions.returnModel === "normal" && assumptions.correctNormalFloor === true,
    riskFree: priced ? "Path cash yield" : `r0 = ${assumptions.rates.r0}`,
    convergence: {
      trials: assumptions.trials,
      meanWealth2033: mean,
      standardErrorMean: batchMean ?? se,
      standardErrorFunded: fundedSe,
      standardErrorCvar: batchOf(wealth2033, (slice) => cvar5(slice)),
      standardErrorP5: batchOf(wealth2033, (slice) => percentile(slice, 0.05)),
      standardErrorP50: batchOf(wealth2033, (slice) => percentile(slice, 0.5)),
      standardErrorP95: batchOf(wealth2033, (slice) => percentile(slice, 0.95)),
      standardErrorMaxDrawdown: batchOf(drawdowns, (slice) => slice.reduce((total, value) => total + value, 0) / slice.length),
      standardErrorSharpe: batchOf(sharpes, (slice) => slice.reduce((total, value) => total + value, 0) / slice.length),
      standardErrorReserve: assumptions.reserve.discountMode === "trial_curve" ? reserveSe : args.reserveSamplingError,
    note: CONVERGENCE_NOTE,
    },
    sleeveMtm: assumptions.sleeves.map((sleeve, index) => ({
      id: sleeve.id,
      name: sleeve.name,
      kind: sleeve.kind,
      meanPrice: args.priceYears > 0 ? args.priceSums[index] / args.priceYears : 0,
    })),
  };
}

function scoreStoredMix(
  plan: { mix: Assumptions["mixes"][number]; error: string | null; wealth: number[]; drawdowns: number[] },
  main: number[],
  reserves: number[],
  assumptions: Assumptions,
): MixResult {
  const empty: MixResult = {
    id: plan.mix.id,
    name: plan.mix.name,
    error: plan.error,
    p1: null,
    p5: null,
    p50: null,
    p95: null,
    fullyFundedProbability: null,
    cvar5: null,
    meanMaxDrawdown: null,
    pairedMeanDiff: null,
    pairedSe: null,
  };
  if (plan.error || plan.wealth.length === 0) return empty;
  const record = wealthPercentileRecord(plan.wealth, assumptions.percentiles);
  const diffs = plan.wealth.map((value, index) => value - main[index]);
  const paired = standardErrorMean(diffs);
  const funded = plan.wealth.filter((value, index) => value + 1e-6 >= reserves[index]).length / plan.wealth.length;
  return {
    ...empty,
    error: null,
    p1: record["1"] ?? null,
    p5: record["5"] ?? null,
    p50: record["50"] ?? null,
    p95: record["95"] ?? null,
    fullyFundedProbability: funded,
    cvar5: cvar5(plan.wealth),
    meanMaxDrawdown: meanOf(plan.drawdowns),
    pairedMeanDiff: paired.mean,
    pairedSe: paired.se,
  };
}

function trialCurveSummary(assumptions: Assumptions, reserves: number[]): ModelOutput["trialCurve"] {
  const finite = reserves.filter((value) => Number.isFinite(value));
  const mean = meanOf(finite);
  const error = batchOf(finite, (slice) => slice.reduce((total, value) => total + value, 0) / slice.length);
  const trial = assumptions.reserve.discountMode === "trial_curve";
  return {
    mode: trial ? "trial_curve" : "fixed_yield",
    label: trial
      ? "Each trial discounts the ten payments on its own 2033 curve. The discount yield is not this hurdle."
      : "One discount yield prices the reserve on every trial. The simulated curve is not used.",
    p5: finite.length ? percentile(finite, 0.05) : null,
    p50: finite.length ? percentile(finite, 0.5) : null,
    p95: finite.length ? percentile(finite, 0.95) : null,
    mean,
    standardError: error,
  };
}

function controlVariateNote(assumptions: Assumptions, wealth: number[], sleeve0: number[]): string | null {
  if (assumptions.returnModel !== "lognormal" || assumptions.sampling !== "pseudo") return null;
  const mu = assumptions.sleeves[0]?.mu;
  if (mu === undefined) return null;
  const pairs = wealth.map((value, index) => ({ wealth: value, y: sleeve0[index] })).filter((pair) => Number.isFinite(pair.y));
  if (pairs.length < 10) return null;
  const meanX = pairs.reduce((total, pair) => total + pair.wealth, 0) / pairs.length;
  const meanY = pairs.reduce((total, pair) => total + pair.y, 0) / pairs.length;
  let cov = 0;
  let vary = 0;
  for (const pair of pairs) {
    cov += (pair.wealth - meanX) * (pair.y - meanY);
    vary += (pair.y - meanY) * (pair.y - meanY);
  }
  if (!(vary > 0)) return null;
  const beta = cov / vary;
  const adjusted = meanX - beta * (meanY - mu);
  return `A control variate on the first sleeve's 2027 return (analytic mean ${mu}) moves the 2033 mean from ${meanX.toFixed(2)} to ${adjusted.toFixed(2)}. The published mean is the raw sample mean.`;
}

function reserveTargetOf(assumptions: Assumptions, active: ReserveSizing): { value: number | null; source: string } {
  if (assumptions.facility.useReserveOverride) {
    return {
      value: assumptions.facility.reserveOverride,
      source: "Override typed on the facility page. The reserve methods are still computed, but this illustration does not use them.",
    };
  }
  if (assumptions.reserve.discountMode === "trial_curve") {
    const value = curveReserve(assumptions, "base");
    return {
      value: Number.isFinite(value) ? value : null,
      source:
        "Base-scenario present value of the ten payments on the 2033 curve. Each Monte Carlo trial uses its own curve. The discount yield is the fixed-yield illustration and is not this hurdle.",
    };
  }
  if (active.reserve === null) return { value: null, source: "The selected reserve method did not return a finite amount." };
  return {
    value: active.reserve,
    source: `Fixed yield. Sized by the “${active.method}” method. The simulated curve does not move this number.`,
  };
}

function conditionalAnchorValue(
  assumptions: Assumptions,
  scenarios: Partial<Record<ScenarioName, YearPoint[]>>,
  wealth2031: number[],
): number {
  const rows = SCENARIOS.map((scenario) => ({
    scenario,
    wealth2031: wealthInYear(scenarios[scenario] ?? [], COMMUNICATION_YEAR),
  }));
  return conditionalAnchor(assumptions.facility, rows as ScenarioFacilityRow[], wealth2031).value ?? 0;
}

function buildFacility(
  assumptions: Assumptions,
  scenarios: Partial<Record<ScenarioName, YearPoint[]>>,
  wealth2031: number[],
  wealth2033: number[],
  reserves: number[],
  active: ReserveSizing,
  conditionalWealth: number[],
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

  const scenarioReserve = (scenario: ScenarioName): number => {
    if (assumptions.facility.useReserveOverride || assumptions.reserve.discountMode !== "trial_curve") return target.value as number;
    const value = curveReserve(assumptions, scenario);
    return Number.isFinite(value) ? value : (target.value as number);
  };
  const scenarioRows: ScenarioFacilityRow[] = SCENARIOS.map((scenario) => {
    const path = scenarios[scenario];
    if (!path) throw new Error("Missing scenario path.");
    const wealthAt2033 = wealthInYear(path, DECISION_YEAR);
    const hurdle = scenarioReserve(scenario);
    return {
      scenario,
      wealth2031: wealthInYear(path, COMMUNICATION_YEAR),
      wealth2033: wealthAt2033,
      byRule: rules.map((rule) => applyRule(wealthAt2033, hurdle, rule)),
    };
  });
  const envelopeInputs = scenarioRows
    .filter((row) => assumptions.facility.envelopeScenarios.includes(row.scenario))
    .map((row) => {
      const applied = row.byRule.find((item) => item.ruleId === activeRule.id)!;
      return { scenario: row.scenario, contribution: applied.contribution, funded: applied.operatingFullyFunded };
    });
  const exAnte = contributionsPathwise(wealth2033, reserves, activeRule);
  const anchor = conditionalAnchor(assumptions.facility, scenarioRows, wealth2031);
  const conditionalReserves = conditionalWealth.map((_, index) => reserves[index] ?? target.value ?? 0);
  const conditional = contributionsPathwise(conditionalWealth, conditionalReserves, activeRule);
  const ranges: RangeCard[] = [
    scenarioEnvelope({ contributions: envelopeInputs, reserveTarget: target.value, ruleName: activeRule.name }),
    percentileBand({
      method: "mc_percentile",
      contributions: exAnte.contributions,
      fundedFlags: exAnte.fundedFlags,
      lowPercentile: assumptions.facility.rangeLowPercentile,
      highPercentile: assumptions.facility.rangeHighPercentile,
      reserveTarget: target.value,
      ruleName: activeRule.name,
      context: `The band uses ${assumptions.trials.toLocaleString("en-US")} full-horizon draws from 2027 on portfolio stream ${STREAM.portfolio}, master seed ${normalizeSeed(assumptions.seed)}. ${target.source} WInS trading results are not included.`,
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
          : `Conditional on ${anchor.label} ($${Math.round(anchor.value).toLocaleString("en-US")} at the beginning of 2031). Years 2031 and 2032 use the same year step as the full path, including the crash overlay and rebalancing costs, on portfolio stream ${STREAM.portfolio}, master seed ${normalizeSeed(assumptions.seed)}. The 2031 rebalance is not charged twice. With annual rebalancing, a trial started from its own 2031 wealth lands on its own 2033 wealth.`,
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
    portfolioFundedRatio: fundedRatioOfPortfolio(wealth2033, reserves, assumptions.percentiles),
  };
}

function fundedRatioOfPortfolio(wealth2033: number[], reserves: number[], wanted: number[]): PortfolioFundedRatio | null {
  if (wealth2033.length === 0) return null;
  const ratios = wealth2033.map((wealth, index) => (reserves[index] > 0 ? wealth / reserves[index] : Number.NaN)).filter((value) => Number.isFinite(value));
  if (ratios.length === 0) return null;
  const covered = wealth2033.filter((wealth, index) => wealth + 1e-6 >= reserves[index]).length / wealth2033.length;
  return {
    percentiles: percentiles(ratios, wanted),
    shareCovered: covered,
    formula:
      "Beginning-of-2033 wealth on a portfolio trial divided by that trial's reserve. Fixed yield uses one reserve. Trial curve uses the present value on that trial's 2033 curve. A ratio of at least 1 means the trial can fund the payments before any facility gift.",
  };
}

function conditionalAnchor(
  facility: FacilityParams,
  rows: ScenarioFacilityRow[],
  wealth2031: number[],
): { value: number | null; label: string } {
  if (facility.conditionalSource === "manual") return { value: facility.conditionalManualWealth, label: "the manual 2031 wealth you typed" };
  if (facility.conditionalSource === "median_2031") return { value: percentile(wealth2031, 0.5), label: "the median simulated beginning-of-2031 wealth" };
  const row = rows.find((item) => item.scenario === facility.conditionalSource);
  if (!row) return { value: null, label: "missing scenario" };
  return { value: row.wealth2031, label: `beginning-of-2031 wealth on the ${facility.conditionalSource} path` };
}

/**
 * Two annual steps take one 2031 wealth to beginning-of-2033 wealth.
 * The continuation uses the shared year step: 2031 return only, then 2032, then the 2033 rebalance.
 */
export function simulateTwoYearWealth(assumptions: Assumptions, wealth2031: number): number[] {
  const policy = weightsAtYear(assumptions.glide, COMMUNICATION_YEAR);
  const out: number[] = [];
  for (let trial = 0; trial < assumptions.trials; trial++) {
    const balances = policy.map((weight) => wealth2031 * weight);
    out.push(continueFromBalances(assumptions, balances, balances.slice(), trial));
  }
  return out;
}
