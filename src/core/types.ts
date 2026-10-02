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

export type RangeMethod = "scenario_envelope" | "mc_percentile" | "conditional_mc";

export type CandidateKind = "retain_fraction" | "keep_dollars" | "cap_dollars";

export interface Sleeve {
  id: string;
  /** Display name. Placeholder names describe a role, not an asset pick. */
  name: string;
  /** Expected simple annual return for Monte Carlo. */
  mu: number;
  /** Standard deviation of the simple annual return. */
  sigma: number;
  base: number;
  bull: number;
  bear: number;
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
  schemaVersion: 2;
  /** Kept equal to schemaVersion so a reader looking for the v1 field name still sees a version. */
  schema: 2;
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
  /** Portfolio return earned during this calendar year. Null in 2042. */
  yearReturn: number | null;
  sleeveReturns: number[] | null;
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

export interface ModelOutput {
  disclaimer: string;
  errors: string[];
  schemaVersion: 2;
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
}
