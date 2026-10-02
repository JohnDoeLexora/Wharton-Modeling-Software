/** Floating-point tolerances the engine and the tests share.
 * The methodology footnote quotes these names. Do not silently tighten a check
 * in one place and leave the guide describing another.
 */
export const TOLERANCE = {
  /** Dollar identities such as W = reserve + contribution + flexibility. */
  moneyAbsolute: 1e-6,
  /** Rates, weights, and Cholesky entries. */
  rateAbsolute: 1e-9,
  /** A matched flat ladder should sit this close to a funded ratio of 1. */
  fundedRatioAbsolute: 1e-6,
  /** Counts divided by a trial total. */
  probabilityAbsolute: 1e-12,
  /** An eigenvalue above this floor is treated as numerically PSD. */
  eigenvaluePsdFloor: -1e-8,
  /** Hyndman–Fan type 7 interpolation. Position (n − 1) · p. */
  percentile: "Hyndman-Fan type 7",
  /** UI currency rounds to the nearest dollar. JSON and CSV keep full precision. */
  displayMoney: "nearest dollar in the UI; full precision in JSON and CSV",
} as const;
