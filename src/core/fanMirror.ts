/**
 * TypeScript mirror of bend/fan.bend.
 * Normals are binary32, then truncated to parts per million.
 * Wealth then moves in whole dollars with the same floor division as bend/fix.bend.
 * The parity check expects these dollars to match Bend exactly.
 */

import { rawWord } from "./rng";

const UNIT = 1_000_000;
const f32 = (value: number) => Math.fround(value);

function ppmF32(ppm: number): number {
  return f32(f32(ppm) / f32(UNIT));
}

function uniformFromHi(hi: number): number {
  const top24 = (hi >>> 8) >>> 0;
  return f32(f32(f32(top24) + f32(0.5)) / f32(16777216));
}

function standardNormalF32(seed: number, stream: number, trial: number, step: number, dim: number): number {
  const even = dim & ~1;
  const u = uniformFromHi(rawWord(seed, stream, trial, step, even).hi);
  const v = uniformFromHi(rawWord(seed, stream, trial, step, even + 1).hi);
  const mag = f32(Math.sqrt(f32(f32(f32(-2)) * f32(Math.log(u)))));
  const ang = f32(f32(f32(2) * f32(Math.PI)) * v);
  return (dim & 1) === 0 ? f32(mag * f32(Math.cos(ang))) : f32(mag * f32(Math.sin(ang)));
}

function rateOf(x: number): { neg: boolean; ppm: number } {
  const neg = x < 0;
  const mag = neg ? f32(-x) : x;
  return { neg, ppm: Math.trunc(f32(mag * f32(1_000_000))) };
}

function normalSimple(mu: number, sigma: number, z: number): number {
  const linear = f32(ppmF32(mu) + f32(ppmF32(sigma) * z));
  const floor = f32(-ppmF32(990_000));
  return linear < floor ? floor : linear;
}

function muldiv(a: number, b: number, d: number): number {
  return Math.floor((a * b) / d);
}

function grow(wealth: number, rate: { neg: boolean; ppm: number }): number {
  if (rate.ppm === 0) return wealth;
  const delta = muldiv(wealth, rate.ppm, UNIT);
  if (!rate.neg) return wealth + delta;
  return delta >= wealth ? 0 : wealth - delta;
}

function quote5y(level: number): number {
  const drop = muldiv(10_000, 316_738, UNIT);
  return level >= drop ? level - drop : 0;
}

function addFloor(level: number, shock: { neg: boolean; ppm: number }): number {
  if (!shock.neg) return level + shock.ppm;
  return shock.ppm >= level ? 0 : level - shock.ppm;
}

function bondNet(carry: number, dyNeg: boolean, dyPpm: number): { neg: boolean; ppm: number } {
  const loss = muldiv(5_000, dyPpm, 1_000);
  if (dyNeg) return { neg: false, ppm: carry + loss };
  if (carry >= loss) return { neg: false, ppm: carry - loss };
  return { neg: true, ppm: loss - carry };
}

export interface FanStep {
  year: number;
  wealthIn: number;
  levelIn: number;
  quote: number;
  shockNeg: boolean;
  shockPpm: number;
  nextLevel: number;
  nextQuote: number;
  dyNeg: boolean;
  dyPpm: number;
  bondNeg: boolean;
  bondPpm: number;
  equityNeg: boolean;
  equityPpm: number;
  wealthOut: number;
}

/** One annual step, shared by the wealth path and the parity trace. */
function stepYear(wealth: number, level: number, year: number, trial: number): FanStep {
  const wealthIn = wealth + (year === 2027 ? 300_000 : year === 2028 ? 150_000 : 0);
  const quote = quote5y(level);
  const shock = rateOf(f32(ppmF32(10_000) * standardNormalF32(42, 4, trial, year, 0)));
  const nextLevel = addFloor(level, shock);
  const nextQuote = quote5y(nextLevel);
  const dyNeg = nextQuote < quote;
  const dyPpm = dyNeg ? quote - nextQuote : nextQuote - quote;
  const bond = bondNet(quote, dyNeg, dyPpm);
  const equity = rateOf(normalSimple(60_000, 150_000, standardNormalF32(42, 1, trial, year, 0)));
  const equityDollars = muldiv(wealthIn, 500_000, UNIT);
  const bondDollars = wealthIn - equityDollars;
  return {
    year,
    wealthIn,
    levelIn: level,
    quote,
    shockNeg: shock.neg,
    shockPpm: shock.ppm,
    nextLevel,
    nextQuote,
    dyNeg,
    dyPpm,
    bondNeg: bond.neg,
    bondPpm: bond.ppm,
    equityNeg: equity.neg,
    equityPpm: equity.ppm,
    wealthOut: grow(equityDollars, equity) + grow(bondDollars, bond),
  };
}

/** Wealth after the first `years` annual steps. `fanTrial` is four steps. */
export function wealthAfter(years: number, trial: number): number {
  let wealth = 0;
  let level = 40_000;
  const calendar = [2027, 2028, 2029, 2030];
  for (let index = 0; index < years; index++) {
    const step = stepYear(wealth, level, calendar[index], trial);
    wealth = step.wealthOut;
    level = step.nextLevel;
  }
  return wealth;
}

export function fanSteps(trial: number): FanStep[] {
  const steps: FanStep[] = [];
  let wealth = 0;
  let level = 40_000;
  for (const year of [2027, 2028, 2029, 2030]) {
    const step = stepYear(wealth, level, year, trial);
    steps.push(step);
    wealth = step.wealthOut;
    level = step.nextLevel;
  }
  return steps;
}

/** Beginning-of-2031 wealth for one trial. Contributions are the case 300,000 and 150,000. */
export function fanTrial(trial: number): number {
  return wealthAfter(4, trial);
}

export interface FanSummary {
  trials: number;
  trial0: number;
  mean: number;
  min: number;
  max: number;
}

export function fanSummary(trials = 16): FanSummary {
  const values = Array.from({ length: trials }, (_, trial) => fanTrial(trial));
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    trials,
    trial0: values[0] ?? 0,
    mean: Math.floor(sum / trials),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
