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
 * The conditional 2031→2033 band does not have a stream of its own. It reuses
 * stream 1 at calendar years 2031 and 2032 and the same trial index
 * (common random numbers). Wealth is restarted at the anchor and at the 2031
 * policy weights. Drifted balances are not carried into that restart.
 */
export const STREAM = {
  portfolio: 1,
  reserve: 2,
  bootstrap: 3,
} as const;

export type StreamId = (typeof STREAM)[keyof typeof STREAM];

const MASK = (1n << 64n) - 1n;

function splitmix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & MASK;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
  return (z ^ (z >> 31n)) & MASK;
}

function toBig(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const trunc = Math.trunc(value);
  return trunc < 0 ? -BigInt(-trunc) : BigInt(trunc);
}

/** Uniform on (0, 1), never 0 and never 1. */
export function unitInterval(
  masterSeed: number,
  streamId: number,
  trial: number,
  step: number,
  dimension: number,
): number {
  let z = 0x9e3779b97f4a7c15n;
  for (const part of [normalizeSeed(masterSeed), streamId, trial, step, dimension]) {
    z = splitmix64(z ^ toBig(part));
  }
  const bits = (z >> 11n) & ((1n << 53n) - 1n);
  return (Number(bits) + 0.5) / 2 ** 53;
}

/**
 * Standard normal at one coordinate. Dimension 2k and 2k+1 are a Box–Muller pair
 * built from two uniforms at those dimensions. No generator state is kept.
 */
export function standardNormal(
  masterSeed: number,
  streamId: number,
  trial: number,
  step: number,
  dimension: number,
): number {
  const pair = Math.floor(dimension / 2);
  const u = unitInterval(masterSeed, streamId, trial, step, pair * 2);
  const v = unitInterval(masterSeed, streamId, trial, step, pair * 2 + 1);
  const magnitude = Math.sqrt(-2 * Math.log(u));
  const angle = 2 * Math.PI * v;
  return dimension % 2 === 0 ? magnitude * Math.cos(angle) : magnitude * Math.sin(angle);
}

export interface StreamManifest {
  design: string;
  masterSeed: number;
  portfolio: { id: number; step: string; dimension: string };
  reserve: { id: number; step: string; dimension: string };
  bootstrap: { id: number; step: string; dimension: string };
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
    conditional:
      "Reuses portfolio stream 1 at calendar years 2031 and 2032, same trial index. " +
      "Not a separate seed. Wealth restarts at the 2031 anchor and at that year's policy weights. " +
      "With annual rebalancing, trial t started from trial t's own 2031 wealth matches trial t's 2033 wealth.",
  };
}
