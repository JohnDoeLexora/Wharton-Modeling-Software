/**
 * Paired differences under common random numbers. MODEL_SPEC §9.
 * The two wealth vectors must be the same trials in the same order.
 */

export interface PairedSummary {
  n: number;
  mean: number;
  se: number;
}

/** Mean of right − left, with the usual standard error of that mean (n − 1). */
export function pairedDifference(left: number[], right: number[]): PairedSummary {
  const n = Math.min(left.length, right.length);
  if (n < 2) return { n, mean: Number.NaN, se: Number.NaN };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += right[i] - left[i];
  const mean = sum / n;
  let square = 0;
  for (let i = 0; i < n; i++) {
    const gap = right[i] - left[i] - mean;
    square += gap * gap;
  }
  return { n, mean, se: Math.sqrt(square / (n - 1)) / Math.sqrt(n) };
}

/** Paired difference of the funded indicator. Reserves align with the wealth vectors. */
export function pairedFunded(leftWealth: number[], rightWealth: number[], leftReserve: number[], rightReserve: number[]): PairedSummary {
  const n = Math.min(leftWealth.length, rightWealth.length, leftReserve.length, rightReserve.length);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    left.push(leftWealth[i] + 1e-6 >= leftReserve[i] ? 1 : 0);
    right.push(rightWealth[i] + 1e-6 >= rightReserve[i] ? 1 : 0);
  }
  return pairedDifference(left, right);
}
