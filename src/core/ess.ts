/**
 * Initial-positive-sequence effective sample size.
 * ESS = n γ0 / (γ0 + 2 Σ pairs). A pair of autocovariances that is not positive ends the sum.
 */
export function effectiveSampleSize(values: number[], maxLag = 40): number {
  const n = values.length;
  if (n < 2) return n === 0 ? Number.NaN : n;
  for (let i = 0; i < n; i++) if (!Number.isFinite(values[i])) return Number.NaN;
  let total = 0;
  for (let i = 0; i < n; i++) total += values[i];
  const center = total / n;
  const gammaAt = (lag: number): number => {
    let sum = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) sum += (values[i] - center) * (values[i + lag] - center);
    return sum / n;
  };
  const g0 = gammaAt(0);
  if (!(g0 > 0)) return n;
  let acc = 0;
  const cap = Math.min(maxLag, n - 2);
  for (let lag = 1; lag <= cap; lag += 2) {
    const first = gammaAt(lag);
    const second = lag + 1 <= cap ? gammaAt(lag + 1) : 0;
    const pair = first + second;
    if (!(pair > 0)) break;
    acc += pair;
  }
  const denom = g0 + 2 * acc;
  if (!(denom > 0)) return n;
  const ess = (n * g0) / denom;
  if (!Number.isFinite(ess)) return Number.NaN;
  return Math.min(n, Math.max(1, ess));
}
