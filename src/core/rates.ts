import { FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR } from "./case";
import {
  DEFAULT_LAMBDA,
  DEFAULT_LAMBDA2,
  fitFactorsToThree,
  quoteYield,
  quotedZero,
  type Factors,
} from "./nelson";
import { STREAM, standardNormal } from "./rng";
import type { CurveModel, EquityParams, RateParams, RatePathPoint, RateRegime, ScenarioName } from "./types";

export { FLOOR_POLICY, QUOTE_FLOOR } from "./nelson";

export const RATE_REGIMES: RateRegime[] = ["rising", "flat", "falling", "shock-up", "stagflation"];

export interface RegimeTemplate {
  driftPerYear: number;
  driftYears: number;
  levelShock: number;
  equityRateCorr: number;
  regimeDrag: number;
  label: string;
}

/** Illustrative drifts. Applying one copies these numbers into the editable fields. They are not forecasts. */
export const REGIME_TEMPLATE: Record<RateRegime, RegimeTemplate> = {
  rising: {
    driftPerYear: 0.0075,
    driftYears: 3,
    levelShock: 0,
    equityRateCorr: 0,
    regimeDrag: 0,
    label: "Rising: +75 bp per year for 3 years, then the pace stops. Illustration, not a forecast.",
  },
  flat: {
    driftPerYear: 0,
    driftYears: 0,
    levelShock: 0,
    equityRateCorr: 0,
    regimeDrag: 0,
    label: "Flat: no drift and no one-year shock.",
  },
  falling: {
    driftPerYear: 0.005,
    driftYears: 3,
    levelShock: 0,
    equityRateCorr: 0,
    regimeDrag: 0,
    label: "Falling: −50 bp per year for 3 years. The pace field stays positive; this regime subtracts it.",
  },
  "shock-up": {
    driftPerYear: 0,
    driftYears: 0,
    levelShock: 0.02,
    equityRateCorr: -0.3,
    regimeDrag: 0,
    label: "Shock-up: +200 bp during 2027. Equity correlation is an illustration.",
  },
  stagflation: {
    driftPerYear: 0.01,
    driftYears: 2,
    levelShock: 0,
    equityRateCorr: -0.5,
    regimeDrag: -0.08,
    label: "Stagflation: rates up and a negative equity drag, with a negative rate correlation. Illustration, not a forecast.",
  },
};

export function zeroRateParams(): RateParams {
  return {
    regime: "flat",
    curveModel: "nelson_siegel",
    lambda: DEFAULT_LAMBDA,
    lambda2: DEFAULT_LAMBDA2,
    useFactorStart: false,
    beta0: 0,
    beta1: 0,
    beta2: 0,
    beta3: 0,
    r0: 0,
    kappa: 0,
    theta: 0,
    sigma: 0,
    kappaSlope: 0,
    kappaCurve: 0,
    thetaSlope: 0,
    thetaCurve: 0,
    sigmaSlope: 0,
    sigmaCurve: 0,
    intermediatePremium: 0,
    longPremium: 0,
    slope: 0,
    equityRateCorr: 0,
    driftPerYear: 0,
    driftYears: 0,
    levelShock: 0,
  };
}

export function zeroEquityParams(): EquityParams {
  return { studentDf: 5, marketMu: 0, marketSigma: 0, regimeDrag: 0, sectorSigma: 0 };
}

export function applyRegimeTemplate(
  rates: RateParams,
  equity: EquityParams,
  regime: RateRegime,
): { rates: RateParams; equity: EquityParams } {
  const template = REGIME_TEMPLATE[regime];
  return {
    rates: {
      ...rates,
      regime,
      driftPerYear: template.driftPerYear,
      driftYears: template.driftYears,
      levelShock: template.levelShock,
      equityRateCorr: template.equityRateCorr,
    },
    equity: { ...equity, regimeDrag: template.regimeDrag },
  };
}

/** Pace during the year that ends at the next beginning-of-year date. `extra` is a scenario parallel shift. */
export function driftDuring(params: RateParams, year: number, extra = 0): number {
  const index = year - FIRST_PROJECTION_YEAR;
  let drift = extra;
  if (index < 0) return drift;
  if ((params.regime === "rising" || params.regime === "stagflation") && index < params.driftYears) {
    drift += params.driftPerYear;
  } else if (params.regime === "falling" && index < params.driftYears) {
    drift -= Math.abs(params.driftPerYear);
  } else if (params.regime === "shock-up" && index === 0) {
    drift += params.levelShock;
  }
  return drift;
}

export function curveFromShort(short: number, params: RateParams): { short: number; intermediate: number; long: number } {
  return {
    short: quoteYield(short),
    intermediate: quoteYield(short + params.intermediatePremium),
    long: quoteYield(short + params.longPremium + params.slope),
  };
}

/** Starting factors. A zero premium and a flat r0 stay a flat Nelson-Siegel curve. */
export function initialFactors(params: RateParams): Factors {
  const lambda = Math.abs(params.lambda) < 1e-8 ? DEFAULT_LAMBDA : params.lambda;
  const lambda2 = Math.abs(params.lambda2) < 1e-8 ? DEFAULT_LAMBDA2 : params.lambda2;
  if (params.useFactorStart) {
    return {
      beta0: params.beta0,
      beta1: params.beta1,
      beta2: params.beta2,
      beta3: params.curveModel === "svensson" ? params.beta3 : 0,
      lambda,
      lambda2,
    };
  }
  const fitted = fitFactorsToThree(
    params.r0,
    params.r0 + params.intermediatePremium,
    params.r0 + params.longPremium + params.slope,
    lambda,
  );
  return {
    ...fitted,
    beta3: params.curveModel === "svensson" ? params.beta3 : 0,
    lambda,
    lambda2,
  };
}

export function yieldOnPath(row: EvolvedRate, tenor: number): number {
  if (row.curveModel === "three_point") {
    if (tenor <= 1) return row.short;
    if (tenor >= 10) return row.long;
    if (tenor <= 5) {
      const weight = (tenor - 1) / 4;
      return row.short * (1 - weight) + row.intermediate * weight;
    }
    const weight = (tenor - 5) / 5;
    return row.intermediate * (1 - weight) + row.long * weight;
  }
  return quotedZero(
    {
      beta0: row.beta0,
      beta1: row.beta1,
      beta2: row.beta2,
      beta3: row.beta3,
      lambda: row.lambda,
      lambda2: row.lambda2,
    },
    tenor,
  );
}

export interface EvolvedRate {
  calendarYear: number;
  short: number;
  intermediate: number;
  long: number;
  drift: number;
  shock: number;
  beta0: number;
  beta1: number;
  beta2: number;
  beta3: number;
  lambda: number;
  lambda2: number;
  curveModel: CurveModel;
}

function blankFactors(factors: Factors, curveModel: CurveModel): Pick<
  EvolvedRate,
  "beta0" | "beta1" | "beta2" | "beta3" | "lambda" | "lambda2" | "curveModel"
> {
  return {
    beta0: factors.beta0,
    beta1: factors.beta1,
    beta2: factors.beta2,
    beta3: factors.beta3,
    lambda: factors.lambda,
    lambda2: factors.lambda2,
    curveModel,
  };
}

/**
 * One curve per beginning-of-year date from 2027 through 2042.
 * The shock is applied during the year, so it shows up in the next date.
 * Nelson-Siegel steps the level, slope, and curvature. The regime drift is added to the level.
 * Quotes use the zero floor. The three-point model floors its short-rate state at the same zero.
 */
export function evolveShortRate(
  params: RateParams,
  shockAt: (year: number, dimension?: number) => number,
  scenarioShift = 0,
): EvolvedRate[] {
  if ((params.curveModel ?? "nelson_siegel") === "three_point") return evolveThreePoint(params, shockAt, scenarioShift);
  return evolveFactors(params, shockAt, scenarioShift);
}

function evolveThreePoint(
  params: RateParams,
  shockAt: (year: number, dimension?: number) => number,
  scenarioShift: number,
): EvolvedRate[] {
  const rows: EvolvedRate[] = [];
  let short = quoteYield(params.r0);
  const factors = initialFactors({ ...params, curveModel: "nelson_siegel", useFactorStart: false });
  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const drifting = year < LAST_PROJECTION_YEAR;
    const extra = drifting && year === FIRST_PROJECTION_YEAR ? scenarioShift : 0;
    const drift = drifting ? driftDuring(params, year, extra) : 0;
    const shock = drifting ? shockAt(year, 0) : 0;
    const curve = curveFromShort(short, params);
    rows.push({ calendarYear: year, ...curve, drift, shock, ...blankFactors({ ...factors, beta0: short }, "three_point") });
    if (drifting) {
      const next = short + params.kappa * (params.theta - short) + drift + params.sigma * shock;
      short = quoteYield(next);
    }
  }
  return rows;
}

function evolveFactors(
  params: RateParams,
  shockAt: (year: number, dimension?: number) => number,
  scenarioShift: number,
): EvolvedRate[] {
  const rows: EvolvedRate[] = [];
  let factors = initialFactors(params);
  const curveModel = params.curveModel === "svensson" ? "svensson" : "nelson_siegel";
  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const drifting = year < LAST_PROJECTION_YEAR;
    const extra = drifting && year === FIRST_PROJECTION_YEAR ? scenarioShift : 0;
    const drift = drifting ? driftDuring(params, year, extra) : 0;
    const shock = drifting ? shockAt(year, 0) : 0;
    const slopeShock = drifting ? shockAt(year, 1) : 0;
    const curveShock = drifting ? shockAt(year, 2) : 0;
    rows.push({
      calendarYear: year,
      short: quotedZero(factors, 0),
      intermediate: quotedZero(factors, 5),
      long: quotedZero(factors, 10),
      drift,
      shock,
      ...blankFactors(factors, curveModel),
    });
    if (drifting) {
      factors = {
        ...factors,
        beta0: factors.beta0 + params.kappa * (params.theta - factors.beta0) + drift + params.sigma * shock,
        beta1: factors.beta1 + params.kappaSlope * (params.thetaSlope - factors.beta1) + params.sigmaSlope * slopeShock,
        beta2: factors.beta2 + params.kappaCurve * (params.thetaCurve - factors.beta2) + params.sigmaCurve * curveShock,
      };
    }
  }
  return rows;
}

/** Standard normal on stream 4. Shared by every mix that uses this seed, trial, and year. */
export function rateShock(seed: number, trial: number, year: number): number {
  return standardNormal(seed, STREAM.rates, trial, year, 0);
}

export function scenarioShift(scenario: ScenarioName | undefined): number {
  if (scenario === "bear") return 0.01;
  if (scenario === "bull") return -0.01;
  return 0;
}

export function ratePath(args: {
  params: RateParams;
  seed: number;
  trial: number;
  mode: "mc" | "scenario";
  scenario?: ScenarioName;
}): EvolvedRate[] {
  const shift = args.mode === "scenario" ? scenarioShift(args.scenario) : 0;
  return evolveShortRate(
    args.params,
    (year, dimension = 0) => (args.mode === "mc" ? standardNormal(args.seed, STREAM.rates, args.trial, year, dimension) : 0),
    shift,
  );
}

export function toRatePathPoints(rows: EvolvedRate[]): RatePathPoint[] {
  return rows.map((row) => ({
    calendarYear: row.calendarYear,
    short: row.short,
    intermediate: row.intermediate,
    long: row.long,
    drift: row.drift,
    shock: row.shock,
    beta0: row.beta0,
    beta1: row.beta1,
    beta2: row.beta2,
    curveModel: row.curveModel,
  }));
}

/** Copy the level and premia, then lay a regime template on top with volatility forced to zero. */
export function templateParams(base: RateParams, regime: RateRegime): RateParams {
  const template = REGIME_TEMPLATE[regime];
  return {
    ...base,
    regime,
    sigma: 0,
    sigmaSlope: 0,
    sigmaCurve: 0,
    driftPerYear: template.driftPerYear,
    driftYears: template.driftYears,
    levelShock: template.levelShock,
    equityRateCorr: template.equityRateCorr,
  };
}
