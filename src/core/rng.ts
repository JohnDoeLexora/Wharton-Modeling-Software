import { normalizeSeed } from "./math";

/**
 * Counter-based streams. One draw is a pure function of
 * (masterSeed, streamId, trial, step, dimension).
 * Call order does not matter, and trial 0 does not change when the trial count changes.
 *
 * Stream 1, portfolio: step is the calendar year of the return (2027–2041),
 * dimension is the sleeve index. Box–Muller pairs dimensions 2k and 2k+1
 * inside that same coordinate. There is no spare normal carried into the next year.
 *
 * Stream 2, reserve: step is the interval after operating payment k (0..8),
 * dimension 0. Same master seed and same trial index as the portfolio, so
 * trial t can be discussed next to portfolio trial t. The shocks are not the
 * portfolio's shocks. The reserve is a different asset.
 *
 * Stream 3, bootstrap: step is the block index, dimension 0. Used only when
 * the shock model is block bootstrap. The uniform picks a starting row.
 *
 * Stream 4, rates: step is the calendar year, dimension 0 is the short-rate shock.
 * One path per trial. Compared mixes share it (common random numbers).
 *
 * Stream 5, credit: step is the calendar year, dimension is the sleeve index.
 * A uniform decides whether that credit sleeve defaults.
 *
 * Stream 6, idiosyncratic: step is the calendar year. Dimensions are spaced by name
 * for the Student-t residual, the jump, the FX shock, and the sector factor.
 *
 * The conditional 2031→2033 band does not have a stream of its own. It reuses
 * stream 1 at calendar years 2031 and 2032 and the same trial index
 * (common random numbers). Wealth is restarted at the anchor and at the 2031
 * policy weights. Drifted balances are not carried into that restart.
 */
export const STREAM = {
  portfolio: 1,
  reserve: 2,
  bootstrap: 3,
  rates: 4,
  credit: 5,
  idio: 6,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

/**
 * SplitMix64 on two uint32 limbs. The recurrence is the public SplitMix64
 * (Steele, 2014) and matches the previous BigInt implementation bit for bit,
 * including the audit word for seed 42. MODEL_SPEC §6.1.
 * A negative coordinate, or one that does not fit in 32 bits, uses the BigInt
 * path so the two's-complement mix stays the same.
 */
const MASK64 = (1n << 64n) - 1n;
const GOLDEN = 0x9e3779b97f4a7c15n;
const MUL_1 = 0xbf58476d1ce4e5b9n;
const MUL_2 = 0x94d049bb133111ebn;
const U32 = 4294967296;

function splitmixBig(x: bigint): bigint {
  let z = (x + GOLDEN) & MASK64;
  z = ((z ^ (z >> 30n)) * MUL_1) & MASK64;
  z = ((z ^ (z >> 27n)) * MUL_2) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

function toBig(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const trunc = Math.trunc(value);
  return trunc < 0 ? -BigInt(-trunc) : BigInt(trunc);
}

function fitsUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

let outHi = 0;
let outLo = 0;

function mixFast(seed: number, streamId: number, trial: number, step: number, dimension: number): void {
  let hi = 0x9e3779b9;
  let lo = 0x7f4a7c15;
  const parts = [seed, streamId, trial, step, dimension];
  for (let i = 0; i < 5; i++) {
    let ah = hi;
    let al = (lo ^ parts[i]) >>> 0;
    let sum = al + 0x7f4a7c15;
    let zh = (ah + 0x9e3779b9 + (sum >= U32 ? 1 : 0)) >>> 0;
    let zl = sum >>> 0;
    let sh = zh >>> 30;
    let sl = ((zh << 2) | (zl >>> 30)) >>> 0;
    ah = (zh ^ sh) >>> 0;
    al = (zl ^ sl) >>> 0;
    let x = al;
    let y = 0x1ce4e5b9;
    let xh = (x >>> 16) & 65535;
    let xl = x & 65535;
    let yh = (y >>> 16) & 65535;
    let yl = y & 65535;
    let ll = xl * yl;
    let lh = xl * yh;
    let hl = xh * yl;
    let hh = xh * yh;
    let mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    let p0lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    let p0hi = (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) >>> 0;
    x = ah;
    y = 0x1ce4e5b9;
    xh = (x >>> 16) & 65535;
    xl = x & 65535;
    yh = (y >>> 16) & 65535;
    yl = y & 65535;
    ll = xl * yl;
    lh = xl * yh;
    hl = xh * yl;
    hh = xh * yh;
    mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    const p1lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    x = al;
    y = 0xbf58476d;
    xh = (x >>> 16) & 65535;
    xl = x & 65535;
    yh = (y >>> 16) & 65535;
    yl = y & 65535;
    ll = xl * yl;
    lh = xl * yh;
    hl = xh * yl;
    hh = xh * yh;
    mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    const p2lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    zh = (p0hi + p1lo + p2lo) >>> 0;
    zl = p0lo;
    sh = zh >>> 27;
    sl = ((zh << 5) | (zl >>> 27)) >>> 0;
    ah = (zh ^ sh) >>> 0;
    al = (zl ^ sl) >>> 0;
    x = al;
    y = 0x133111eb;
    xh = (x >>> 16) & 65535;
    xl = x & 65535;
    yh = (y >>> 16) & 65535;
    yl = y & 65535;
    ll = xl * yl;
    lh = xl * yh;
    hl = xh * yl;
    hh = xh * yh;
    mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    p0lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    p0hi = (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) >>> 0;
    x = ah;
    y = 0x133111eb;
    xh = (x >>> 16) & 65535;
    xl = x & 65535;
    yh = (y >>> 16) & 65535;
    yl = y & 65535;
    ll = xl * yl;
    lh = xl * yh;
    hl = xh * yl;
    hh = xh * yh;
    mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    const q1lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    x = al;
    y = 0x94d049bb;
    xh = (x >>> 16) & 65535;
    xl = x & 65535;
    yh = (y >>> 16) & 65535;
    yl = y & 65535;
    ll = xl * yl;
    lh = xl * yh;
    hl = xh * yl;
    hh = xh * yh;
    mid = (ll >>> 16) + (lh & 65535) + (hl & 65535);
    const q2lo = ((ll & 65535) | ((mid & 65535) << 16)) >>> 0;
    zh = (p0hi + q1lo + q2lo) >>> 0;
    zl = p0lo;
    sh = zh >>> 31;
    sl = ((zh << 1) | (zl >>> 31)) >>> 0;
    hi = (zh ^ sh) >>> 0;
    lo = (zl ^ sl) >>> 0;
  }
  outHi = hi;
  outLo = lo;
}

function mixSlow(seed: number, streamId: number, trial: number, step: number, dimension: number): { hi: number; lo: number } {
  let z = GOLDEN;
  for (const part of [seed, streamId, trial, step, dimension]) z = splitmixBig(z ^ toBig(part));
  return { hi: Number((z >> 32n) & 0xffffffffn), lo: Number(z & 0xffffffffn) };
}

let hotSeed = -1;

function mixWord(masterSeed: number, streamId: number, trial: number, step: number, dimension: number): { hi: number; lo: number } {
  if (masterSeed !== hotSeed) hotSeed = normalizeSeed(masterSeed);
  if (
    fitsUint32(hotSeed) &&
    (streamId | 0) === streamId &&
    streamId >= 0 &&
    (trial | 0) === trial &&
    trial >= 0 &&
    (step | 0) === step &&
    step >= 0 &&
    (dimension | 0) === dimension &&
    dimension >= 0
  ) {
    mixFast(hotSeed, streamId, trial, step, dimension);
    return { hi: outHi, lo: outLo };
  }
  return mixSlow(hotSeed, streamId, trial, step, dimension);
}

/**
 * The raw SplitMix64 word at one coordinate, split into the high and low 32 bits.
 * This is the value Bend prints as `draw_hi` / `draw_lo`. The uniform and the
 * normal are derived from it. Quote the word when a run has to match bit for bit.
 * MODEL_SPEC §6.1.
 */
export function rawWord(
  masterSeed: number,
  streamId: number,
  trial: number,
  step: number,
  dimension: number,
): { hi: number; lo: number } {
  return mixWord(masterSeed, streamId, trial, step, dimension);
}

/** Uniform on (0, 1), never 0 and never 1. MODEL_SPEC §6.1. */
export function unitInterval(
  masterSeed: number,
  streamId: number,
  trial: number,
  step: number,
  dimension: number,
): number {
  if (masterSeed !== hotSeed) hotSeed = normalizeSeed(masterSeed);
  if (
    (streamId | 0) === streamId &&
    streamId >= 0 &&
    (trial | 0) === trial &&
    trial >= 0 &&
    (step | 0) === step &&
    step >= 0 &&
    (dimension | 0) === dimension &&
    dimension >= 0
  ) {
    mixFast(hotSeed, streamId, trial, step, dimension);
    return (outHi * 2097152 + (outLo >>> 11) + 0.5) / 9007199254740992;
  }
  const word = mixSlow(hotSeed, streamId, trial, step, dimension);
  const bits = ((word.hi * 2097152) + (word.lo >>> 11));
  return (bits + 0.5) / 9007199254740992;
}

let pairSeed = Number.NaN;
let pairStream = 0;
let pairTrial = 0;
let pairStep = 0;
let pairIndex = -1;
let pairCos = 0;
let pairSin = 0;

/**
 * Standard normal at one coordinate. Dimension 2k and 2k+1 are a Box–Muller pair
 * built from two uniforms at those dimensions. No generator state is kept:
 * the pair is a pure function of the coordinate. The last pair is remembered
 * only so the sibling dimension does not mix the same two words twice.
 * MODEL_SPEC §6.1.
 */
export function standardNormal(
  masterSeed: number,
  streamId: number,
  trial: number,
  step: number,
  dimension: number,
): number {
  if (dimension < 0 || trial < 0 || step < 0 || streamId < 0) {
    const pairSlow = Math.floor(dimension / 2);
    const uSlow = unitInterval(masterSeed, streamId, trial, step, pairSlow * 2);
    const vSlow = unitInterval(masterSeed, streamId, trial, step, pairSlow * 2 + 1);
    const magnitudeSlow = Math.sqrt(-2 * Math.log(uSlow));
    const angleSlow = 2 * Math.PI * vSlow;
    return dimension % 2 === 0 ? magnitudeSlow * Math.cos(angleSlow) : magnitudeSlow * Math.sin(angleSlow);
  }
  const pair = dimension >> 1;
  if (pairSeed === masterSeed && pairStream === streamId && pairTrial === trial && pairStep === step && pairIndex === pair) {
    return (dimension & 1) === 0 ? pairCos : pairSin;
  }
  if (masterSeed !== hotSeed) hotSeed = normalizeSeed(masterSeed);
  mixFast(hotSeed, streamId, trial, step, pair * 2);
  const u = (outHi * 2097152 + (outLo >>> 11) + 0.5) / 9007199254740992;
  mixFast(hotSeed, streamId, trial, step, pair * 2 + 1);
  const v = (outHi * 2097152 + (outLo >>> 11) + 0.5) / 9007199254740992;
  const magnitude = Math.sqrt(-2 * Math.log(u));
  const angle = 2 * Math.PI * v;
  pairSeed = masterSeed;
  pairStream = streamId;
  pairTrial = trial;
  pairStep = step;
  pairIndex = pair;
  pairCos = magnitude * Math.cos(angle);
  pairSin = magnitude * Math.sin(angle);
  return (dimension & 1) === 0 ? pairCos : pairSin;
}

export interface StreamManifest {
  design: string;
  masterSeed: number;
  portfolio: { id: number; step: string; dimension: string };
  reserve: { id: number; step: string; dimension: string };
  bootstrap: { id: number; step: string; dimension: string };
  rates: { id: number; step: string; dimension: string };
  credit: { id: number; step: string; dimension: string };
  idio: { id: number; step: string; dimension: string };
  conditional: string;
}

export function streamManifest(masterSeed: number): StreamManifest {
  return {
    design:
      "Counter-based SplitMix64. A draw depends only on (masterSeed, streamId, trial, step, dimension). " +
      "It does not depend on call order or on the number of trials.",
    masterSeed: normalizeSeed(masterSeed),
    portfolio: {
      id: STREAM.portfolio,
      step: "calendar year of the return, 2027 through 2041",
      dimension: "sleeve index; Box-Muller pairs 2k and 2k+1 inside that year",
    },
    reserve: {
      id: STREAM.reserve,
      step: "interval 0..8, the return after operating payment k and before payment k+1",
      dimension: "0, one reserve asset",
    },
    bootstrap: {
      id: STREAM.bootstrap,
      step: "block index floor((calendarYear - 2027) / blockLength)",
      dimension: "0, uniform that picks the block start",
    },
    rates: {
      id: STREAM.rates,
      step: "calendar year of the short-rate shock, 2027 through 2041",
      dimension: "0 level, 1 slope, 2 curvature. One path per trial, shared by every mix under this seed",
    },
    credit: {
      id: STREAM.credit,
      step: "calendar year",
      dimension: "sleeve index. A uniform below the default probability is a default",
    },
    idio: {
      id: STREAM.idio,
      step: "calendar year",
      dimension: "name index, jump, FX, and sector factor. Not the market factor",
    },
    conditional:
      "Reuses portfolio stream 1 at calendar years 2031 and 2032, same trial index. " +
      "Not a separate seed. Wealth restarts at the 2031 anchor and at that year's policy weights. " +
      "With annual rebalancing, trial t started from trial t's own 2031 wealth matches trial t's 2033 wealth.",
  };
}
