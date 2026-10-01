/** Shared types for the Gao modeling toolkit.
 * Dollar amounts are nominal USD. Rates are decimals (0.05 = 5%).
 * Nothing in these types is a recommended strategy.
 */

export type ScenarioName = "base" | "bull" | "bear";

export type ReturnModel = "lognormal" | "normal";

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
  schema: 1;
  tag: AssumptionTag;
  /** Team-written definition. Starts empty. The case does not supply one. */
  certaintyNote: string;
  sleeves: Sleeve[];
  glide: GlideKnot[];
  /** Row-major correlation of Monte Carlo shocks. Gaussian copula. */
  correlation: number[][];
  rebalance: RebalanceMode;
  returnModel: ReturnModel;
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

export interface ReserveSizing {
  method: ReserveMethod;
  reserve: number | null;
  attainableProbability: number | null;
  achievedProbability: number | null;
  macaulayDuration: number | null;
  modifiedDuration: number | null;
  message: string;
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

export interface ModelOutput {
  disclaimer: string;
  errors: string[];
  scenarios: Partial<Record<ScenarioName, YearPoint[]>>;
  monteCarlo: {
    trials: number;
    seed: number;
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
  } | null;
}
