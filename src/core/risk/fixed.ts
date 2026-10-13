/**
 * Integer risk identities shared with bend/risk.bend and reference/python/risk.py.
 * Parts per million: 1_000_000 is 1. These are arithmetic checks, not a forecast.
 */

export const PPM = 1_000_000;

export function muldiv(a: number, b: number, d: number): number {
  if (d === 0) return 0;
  return Math.floor((a * b) / d);
}

/** One RiskMetrics step: λ v + (1−λ) r², in caller units. λ is ppm. */
export function ewmaStepPpm(lambdaPpm: number, variance: number, squaredReturn: number): number {
  return muldiv(lambdaPpm, variance, PPM) + muldiv(PPM - lambdaPpm, squaredReturn, PPM);
}

/** Vasicek: (raw × priorVar + prior × se²) / (priorVar + se²), two exact floor divisions. */
export function vasicekPpm(raw: number, prior: number, priorVar: number, se2: number): number {
  const denom = priorVar + se2;
  if (denom === 0) return raw;
  return muldiv(raw, priorVar, denom) + muldiv(prior, se2, denom);
}

/** Diffusion variance plus λ E[J²]. The sum is at least the diffusion piece. */
export function jumpVariancePpm(diffusion: number, lambda: number, meanSquare: number): number {
  return diffusion + lambda * meanSquare;
}

export function goldenEwma(): number {
  return ewmaStepPpm(940_000, 1_000_000, 250_000);
}

export function goldenVasicek(): number {
  return vasicekPpm(70_000, 1_000_000, 40_000, 60_000);
}

export function goldenJumpVar(): number {
  return jumpVariancePpm(8_000, 4, 2_500);
}

/** 2×2 Ledoit-Wolf step toward μ I. δ = 0.25, μ = 90, S = [[100, 20], [20, 80]]. */
export function goldenShrunkCov(): { s11: number; s12: number; s22: number; det: number } {
  const delta = 250_000;
  const keep = PPM - delta;
  const mu = 90;
  const s11 = muldiv(keep, 100, PPM) + muldiv(delta, mu, PPM);
  const s22 = muldiv(keep, 80, PPM) + muldiv(delta, mu, PPM);
  const s12 = muldiv(keep, 20, PPM);
  return { s11, s12, s22, det: s11 * s22 - s12 * s12 };
}

export function vasicekIsBetween(raw: number, prior: number, shrunk: number): boolean {
  const lo = Math.min(raw, prior);
  const hi = Math.max(raw, prior);
  return shrunk >= lo && shrunk <= hi;
}
