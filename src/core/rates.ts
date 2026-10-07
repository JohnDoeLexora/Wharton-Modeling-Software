import { FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR } from "./case";
import { STREAM, standardNormal } from "./rng";
import type { EquityParams, RateParams, RatePathPoint, RateRegime, ScenarioName } from "./types";

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
    r0: 0,
    kappa: 0,
    theta: 0,
    sigma: 0,
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
    short,
    intermediate: short + params.intermediatePremium,
    long: short + params.longPremium + params.slope,
  };
}

export interface EvolvedRate {
  calendarYear: number;
  short: number;
  intermediate: number;
  long: number;
  drift: number;
  shock: number;
}

/**
 * Short rate at each beginning-of-year date from 2027 through 2042.
 * The shock is applied during the year, so it shows up in the next date.
 * Vasicek / Hull–White style annual step: r + κ(θ − r) + drift + σ z, floored at −5%.
 */
export function evolveShortRate(params: RateParams, shockAt: (year: number) => number, scenarioShift = 0): EvolvedRate[] {
  const rows: EvolvedRate[] = [];
  let short = params.r0;
  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) {
    const drifting = year < LAST_PROJECTION_YEAR;
    const extra = drifting && year === FIRST_PROJECTION_YEAR ? scenarioShift : 0;
    const drift = drifting ? driftDuring(params, year, extra) : 0;
    const shock = drifting ? shockAt(year) : 0;
    const curve = curveFromShort(short, params);
    rows.push({ calendarYear: year, ...curve, drift, shock });
    if (drifting) {
      const next = short + params.kappa * (params.theta - short) + drift + params.sigma * shock;
      short = Math.max(-0.05, next);
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
    (year) => (args.mode === "mc" ? rateShock(args.seed, args.trial, year) : 0),
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
  }));
}

/** Copy the level and premia, then lay a regime template on top with volatility forced to zero. */
export function templateParams(base: RateParams, regime: RateRegime): RateParams {
  const template = REGIME_TEMPLATE[regime];
  return {
    ...base,
    regime,
    sigma: 0,
    driftPerYear: template.driftPerYear,
    driftYears: template.driftYears,
    levelShock: template.levelShock,
    equityRateCorr: template.equityRateCorr,
  };
}
