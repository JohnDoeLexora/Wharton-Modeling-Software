/** Shared types for the Gao modeling toolkit.
 * Dollar amounts are nominal USD. Rates are decimals (0.05 = 5%).
 * Nothing in these types is a recommended strategy.
 */

import type { CorrelationReport } from "./correlation";
import type { StreamManifest } from "./rng";

export type ScenarioName = "base" | "bull" | "bear";

export type ReturnModel = "lognormal" | "normal";

/** Parametric Gaussian-copula shocks, or a circular block resample of rows the team types. */
export type ShockModel = "parametric" | "block_bootstrap";

export type RebalanceMode = "annual" | "drift";

export type AssumptionTag = "zero-default" | "teaching-example" | "edited";

export type ReserveMethod = "ladder" | "duration" | "stress" | "shortfall";

/** Drift overlay on the level factor. The numbers that go with a regime are assumptions. */
export type RateRegime = "rising" | "flat" | "falling" | "shock-up" | "stagflation";

/**
 * `nelson_siegel` is the curve the portfolio sample uses.
 * `svensson` adds a second curvature factor.
 * `three_point` is the version-4 bills / 5-year / 10-year curve, kept for the model-risk panel.
 */
export type CurveModel = "nelson_siegel" | "svensson" | "three_point";

/**
 * How a sleeve's annual simple return is built.
 * `parametric` is the version-2 μ/σ (or scenario) return and ignores the rate path.
 */
export type SleeveKind =
  | "parametric"
  | "tbill"
  | "intermediate"
  | "long_treasury"
  | "credit"
  | "equity_index"
  | "basket";

export type CurveReserveMethod = "pv_curve" | "nominal" | "tbill_ladder" | "duration_matched";

export type RangeMethod = "scenario_envelope" | "mc_percentile" | "conditional_mc";

export type CandidateKind = "retain_fraction" | "keep_dollars" | "cap_dollars";

export interface Sleeve {
  id: string;
  /** Display name. Placeholder names describe a role, not an asset pick. */
  name: string;
  /** Expected simple annual return for a parametric or equity sleeve. */
  mu: number;
  /** Standard deviation of the simple annual return. */
  sigma: number;
  base: number;
  bull: number;
  bear: number;
  /** Pricing rule. `parametric` keeps the version-2 return. */
  kind: SleeveKind;
  /** Modified duration in years. Used by bill, treasury, and credit sleeves. */
  duration: number;
  /** Convexity in the annual price term 0.5 * convexity * dy². */
  convexity: number;
  /** Annual expense-ratio drag. Zero leaves the return unchanged. */
  expenseRatio: number;
  /** Credit spread over the intermediate treasury yield. */
  spread: number;
  /** Annual default probability. Zero means no default loss. */
  defaultProb: number;
  /** Recovery of par given default. Loss given default is 1 − recovery. */
  recovery: number;
  /** Spread widening (decimal) per unit of negative equity-factor return. */
  spreadBeta: number;
  /** Publicly tradable. A false value is a flag, not a ban on exploring the row. */
  tradable: boolean;
  /** Eligible for the WInS portfolio. Issuer debt that is not eligible stays flagged as credit. */
  winsEligible: boolean;
  /** Student-t degrees of freedom when kind is equity_index. */
  studentDf: number;
  /** Issuer label for a credit sleeve. Empty for other kinds. */
  issuer: string;
}

export interface RateParams {
  regime: RateRegime;
  /** Which curve builds the quotes. Nelson-Siegel is the default. */
  curveModel: CurveModel;
  /** Nelson-Siegel decay. 0.6 puts the curvature hump near 3 years. */
  lambda: number;
  /** Svensson second decay. Ignored by the three-factor curve. */
  lambda2: number;
  /**
   * When true, beta0..beta3 are the starting factors.
   * When false, the factors are the Nelson-Siegel fit to r0 and the two premia,
   * so a zero premium stays a flat curve at r0.
   */
  useFactorStart: boolean;
  beta0: number;
  beta1: number;
  beta2: number;
  beta3: number;
  /** Short rate at the beginning of 2027 when useFactorStart is false. The Nelson-Siegel limit β0+β1. */
  r0: number;
  /** Mean-reversion speed of the level factor per year. */
  kappa: number;
  /** Level the level factor reverts toward, before the regime drift. */
  theta: number;
  /** Annual volatility of the level shock. Zero makes the regime path a single curve. */
  sigma: number;
  /** Mean-reversion speed of the slope factor. */
  kappaSlope: number;
  /** Mean-reversion speed of the curvature factor. */
  kappaCurve: number;
  thetaSlope: number;
  thetaCurve: number;
  /** Annual volatility of the slope shock. Stream 4, dimension 1. */
  sigmaSlope: number;
  /** Annual volatility of the curvature shock. Stream 4, dimension 2. */
  sigmaCurve: number;
  /** Intermediate (~5y) yield minus the short rate. Used when useFactorStart is false, and by the three-point model. */
  intermediatePremium: number;
  /** Long (~10y) yield minus the short rate, before the slope field. */
  longPremium: number;
  /** Added to the long yield. A parallel move lives in the level factor. */
  slope: number;
  /** Correlation of the equity kernel with the level shock (stream 4, dimension 0). Clipped to ±0.999. */
  equityRateCorr: number;
  /**
   * Pace per year, as a positive decimal. Rising and stagflation add it.
   * Falling subtracts it. Flat and shock-up ignore it.
   */
  driftPerYear: number;
  /** How many projection years, from 2027, the pace applies. */
  driftYears: number;
  /** Additive short-rate jump during 2027. Used by shock-up. */
  levelShock: number;
}

export interface EquityParams {
  /** Degrees of freedom of the market-factor Student-t. Around 5 is a fat-tail illustration. */
  studentDf: number;
  /** Market factor used by the basket when no equity-index sleeve is in the mix. */
  marketMu: number;
  marketSigma: number;
  /** Added to equity and single-name expected returns. The stagflation template sets this below zero. */
  regimeDrag: number;
  /** Volatility of each sector factor. Zero turns sector shocks off. */
  sectorSigma: number;
}

export interface CostParams {
  /** Round-trip turnover charge in basis points. Zero leaves wealth unchanged. */
  transactionCostBps: number;
}

export interface BasketName {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  /** Direct, Related, or Diversifier, as in the satellite candidate list. */
  linkNote: string;
  /** Taiwan listing or Taiwan-heavy fund. FX and geopolitical jump fields apply. */
  taiwan: boolean;
  alpha: number;
  beta: number;
  idioSigma: number;
  studentDf: number;
  jumpProb: number;
  jumpMean: number;
  fxSigma: number;
  geoJumpProb: number;
  geoJumpMean: number;
  sectorBeta: number;
  /** Relative weight inside the basket sleeve. Zero means the name is listed and not held. */
  weight: number;
  expenseRatio: number;
  /** Shown next to the row. Placeholder parameters are not forecasts. */
  assumptionNote: string;
}

/** A second glide, scored with the same seed and the same streams as the workspace. */
export interface MixSpec {
  id: string;
  name: string;
  weights2027: number[];
  weights2033: number[];
}

export interface GlideKnot {
  year: number;
  /** Weights aligned to `sleeves`. Each knot should sum to 1. */
  weights: number[];
}

export interface CandidateRule {
  id: string;
  name: string;
  kind: CandidateKind;
  /** Share of post-reserve residual kept in the portfolio. Used by retain_fraction. */
  retainFraction: number;
  /** Dollars of residual kept. Used by keep_dollars. */
  keepDollars: number;
  /** Maximum facility contribution. Used by cap_dollars. */
  capDollars: number;
}

export interface ReserveParams {
  method: ReserveMethod;
  /** Flat annual yield for the ladder, the liability discount rate, and duration. */
  discountYield: number;
  /** Duration method only. Reserve = present value × (1 + surplusMargin). */
  surplusMargin: number;
  /** Flat annual return used to size the stress reserve. */
  stressReturn: number;
  shortfallMu: number;
  shortfallSigma: number;
  /** Fraction of simulated reserve paths the sized reserve should cover. In [0, 1]. */
  shortfallTarget: number;
  /** When true, the schedule is rolled forward on `customReturns` instead of the sizing rate. */
  useCustomSchedule: boolean;
  /** Nine returns, earned after the payments in 2033 through 2041. */
  customReturns: number[];
}

export interface FacilityParams {
  rules: CandidateRule[];
  activeRuleId: string;
  rangeMethod: RangeMethod;
  rangeLowPercentile: number;
  rangeHighPercentile: number;
  envelopeScenarios: ScenarioName[];
  conditionalSource: ScenarioName | "median_2031" | "manual";
  conditionalManualWealth: number;
  useReserveOverride: boolean;
  reserveOverride: number;
}

export interface Assumptions {
  /** Version of this object. Migration in `migrate.ts` brings older snapshots forward. */
  schemaVersion: 3;
  /** Kept equal to schemaVersion so a reader looking for the v1 field name still sees a version. */
  schema: 3;
  tag: AssumptionTag;
  /** Team-written definition. Starts empty. The case does not supply one. */
  certaintyNote: string;
  sleeves: Sleeve[];
  glide: GlideKnot[];
  /** Row-major correlation of Monte Carlo shocks. Gaussian copula. Ignored by block bootstrap. */
  correlation: number[][];
  /**
   * Added to every off-diagonal correlation, then clipped to ±0.999.
   * Zero leaves the typed matrix unchanged. A non-PSD result is repaired and flagged.
   */
  correlationStress: number;
  rebalance: RebalanceMode;
  returnModel: ReturnModel;
  shockModel: ShockModel;
  /**
   * Historical simple returns, one row per period, one column per sleeve, in sleeve order.
   * Used only when shockModel is block_bootstrap. Empty under the parametric model.
   */
  bootstrapHistory: number[][];
  /** Circular block length in rows. 1 resamples single periods. */
  blockLength: number;
  /** Floor on simple returns when returnModel is "normal". */
  normalFloor: number;
  /** Optional purchasing-power deflator. Does not change the nominal $50,000 liability. */
  inflation: number;
  trials: number;
  seed: number;
  percentiles: number[];
  reserve: ReserveParams;
  facility: FacilityParams;
  /** Short-rate model. Parametric sleeves ignore it. Priced sleeves use one path per trial. */
  rates: RateParams;
  equity: EquityParams;
  /** Satellite names. They affect wealth only through a sleeve whose kind is `basket` and whose weights are positive. */
  basket: BasketName[];
  costs: CostParams;
  /** Extra mixes for the comparison table. Empty means the table is not run. */
  mixes: MixSpec[];
  /**
   * Additive simple return applied to non-bond sleeves in this calendar year.
   * Absent or null means the path is unchanged. A stress, not a forecast.
   */
  crashYear?: number | null;
  crashShock?: number;
}

export interface YearPoint {
  calendarYear: number;
  yearIndex: number;
  contribution: number;
  wealthStart: number;
  realWealthStart: number;
  /** Policy mix from the glide path at this year. */
  policyWeights: number[];
  /** Mix that actually earns this year's return, after the rebalance setting. */
  actualWeights: number[];
  /** Portfolio return earned during this calendar year. Null in 2042. Mark-to-market when bonds are priced. */
  yearReturn: number | null;
  sleeveReturns: number[] | null;
  /** Beginning-of-year wealth if bond sleeves had earned carry only (hold to maturity). */
  wealthStartHtm: number;
  /** Hold-to-maturity portfolio return. Equals `yearReturn` when no sleeve is priced as a bond. */
  yearReturnHtm: number | null;
  /** Unfloored price term −D·dy + ½C·dy² by sleeve. Null in 2042. Zeros for non-bonds. */
  priceComponents: number[] | null;
  /** Short yield at the beginning of the year, the cash rate on this path. */
  cashYield: number | null;
}

export interface ReserveYearRow {
  calendarYear: number;
  yearIndex: number;
  boyAssets: number;
  paymentDue: number;
  paymentFunded: number;
  shortfall: number;
  afterPayment: number;
  reinvestmentReturn: number | null;
  eoyAssets: number;
  paymentsLeftIncludingThis: number;
  undiscountedLiability: number;
  pvLiability: number;
  fundedRatio: number | null;
}

export interface PathwiseExample {
  trial: number;
  /** Immunizing reserve on that reserve-stream path, or beginning-of-2033 wealth for the portfolio ratio. */
  requirement: number;
  /** Sized reserve / path requirement. Above 1 means the sized reserve covers the path. */
  fundedRatio: number | null;
}

/** Distribution of sizedReserve / pathImmunizingReserve on stream 2. A ratio, not a promise. */
export interface PathwiseFundedRatio {
  percentiles: Record<string, number>;
  /** Share of finite paths with funded ratio >= 1. Same count as achievedProbability when both exist. */
  shareCovered: number;
  examples: PathwiseExample[];
  formula: string;
}

export interface ReserveSizing {
  method: ReserveMethod;
  reserve: number | null;
  attainableProbability: number | null;
  achievedProbability: number | null;
  macaulayDuration: number | null;
  modifiedDuration: number | null;
  message: string;
  /** Present only for the shortfall method, which is the method with a sample of paths. */
  pathwiseFundedRatio: PathwiseFundedRatio | null;
}

export interface RuleApplication {
  ruleId: string;
  ruleName: string;
  kind: CandidateKind;
  wealth: number;
  reserveTarget: number;
  reserveFunded: number;
  reserveGap: number;
  residual: number;
  contribution: number;
  flexibility: number;
  operatingFullyFunded: boolean;
}

export interface RangeCard {
  method: RangeMethod;
  title: string;
  low: number | null;
  high: number | null;
  empiricalCoverage: number | null;
  operatingShortfallProbability: number | null;
  wording: string;
  detail: string;
}

export interface ScenarioFacilityRow {
  scenario: ScenarioName;
  wealth2031: number;
  wealth2033: number;
  byRule: RuleApplication[];
}

export interface ResearchNote {
  id: string;
  createdAt: string;
  tickerOrTheme: string;
  text: string;
  source: "finbert" | "sample-lexicon";
  modelName: string;
  label: string;
  scores: { positive: number; negative: number; neutral: number };
}

export interface PortfolioFundedRatio {
  percentiles: Record<string, number>;
  /** Share of trials with beginning-of-2033 wealth at least the reserve target. */
  shareCovered: number;
  formula: string;
}

export interface CurvePoint {
  short: number;
  intermediate: number;
  long: number;
}

export interface RatePathPoint {
  calendarYear: number;
  short: number;
  intermediate: number;
  long: number;
  drift: number;
  shock: number;
  beta0: number;
  beta1: number;
  beta2: number;
  curveModel: CurveModel;
}

export interface SleeveMark {
  id: string;
  name: string;
  kind: SleeveKind;
  flagged: boolean;
  flagReason: string | null;
  /** Carry, price, and both returns during 2027 on the base (zero-shock) path. */
  carry2027: number | null;
  price2027: number | null;
  mtm2027: number | null;
  htm2027: number | null;
}

export interface ModelViews {
  /** Deterministic regime curve, shock set to zero. This is the base path's discount curve. */
  ratePath: RatePathPoint[];
  wealth: { calendarYear: number; mtm: number; htm: number }[];
  sleeves: SleeveMark[];
  /** 1 / sum of squared basket weights among names with a positive weight. Zero when nothing is held. */
  basketEffectiveN: number;
  basketHeld: number;
  formula: string;
}

export interface RegimeMethodStatus {
  method: CurveReserveMethod;
  reserve: number;
  minFundedRatio: number | null;
  terminalShortfall: number;
  /** Assets / new present value after an instantaneous +100bp parallel move at the 2033 curve. */
  shockFundedRatio: number | null;
  note: string;
}

export interface RegimeFunding {
  regime: RateRegime;
  /** Short rate at the beginning of 2033 on this regime's template, with volatility set to zero. */
  short2033: number;
  methods: RegimeMethodStatus[];
}

export interface RiskMetrics {
  /** p1, p5, p10, p50, p90, p95 of beginning-of-2033 wealth, plus any percentiles on the assumption list. */
  wealthPercentiles: Record<string, number>;
  /** Share of trials with beginning-of-2033 wealth at least the reserve target. */
  fullyFundedProbability: number | null;
  /** Mean of the worst 5% of beginning-of-2033 wealth figures. */
  cvar5: number | null;
  maxDrawdownPercentiles: Record<string, number>;
  meanMaxDrawdown: number | null;
  facilityPercentiles: Record<string, number>;
  conditionalLow: number | null;
  conditionalHigh: number | null;
  conditionalCoverage: number | null;
  sharpe: number | null;
  sortino: number | null;
  convergence: {
    trials: number;
    meanWealth2033: number;
    standardErrorMean: number;
    standardErrorFunded: number | null;
    note: string;
  };
  /** Average unfloored price term across trials and years. Near zero when duration is near zero. */
  sleeveMtm: { id: string; name: string; kind: SleeveKind; meanPrice: number }[];
}

export interface MixResult {
  id: string;
  name: string;
  error: string | null;
  p1: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  fullyFundedProbability: number | null;
  cvar5: number | null;
  meanMaxDrawdown: number | null;
}

export interface ModelOutput {
  disclaimer: string;
  errors: string[];
  schemaVersion: 3;
  /** Normalized master seed. Stream ids are documented on `streams`. */
  masterSeed: number;
  streams: StreamManifest;
  correlation: CorrelationReport;
  shockModel: ShockModel;
  scenarios: Partial<Record<ScenarioName, YearPoint[]>>;
  monteCarlo: {
    trials: number;
    seed: number;
    /** Name of the draw. Portfolio uses stream 1. See `streams` on the output. */
    formula: string;
    byYear: { calendarYear: number; values: Record<string, number> }[];
    wealth2031: number[];
    wealth2033: number[];
  } | null;
  reserve: {
    sizings: Record<ReserveMethod, ReserveSizing>;
    active: ReserveSizing;
    scheduleReturns: number[];
    schedule: ReserveYearRow[] | null;
    scheduleNote: string;
    /** Template drifts on the team's level and premia. Not the portfolio sample. */
    regimeFunding: RegimeFunding[];
    regimeNote: string;
  };
  facility: {
    reserveTarget: number | null;
    reserveSource: string;
    scenarioRows: ScenarioFacilityRow[];
    ranges: RangeCard[];
    primary: RangeCard | null;
    contributionSamples: number[];
    conditionalAnchor: number | null;
    conditionalAnchorLabel: string;
    /** Wealth_2033 / reserve target, one ratio per portfolio trial (stream 1). Null when the reserve is not a positive finite number. */
    portfolioFundedRatio: PortfolioFundedRatio | null;
  } | null;
  views: ModelViews;
  metrics: RiskMetrics | null;
  /** Same seed and same streams as the main sample. Empty when no mixes are listed. */
  mixes: MixResult[];
}
