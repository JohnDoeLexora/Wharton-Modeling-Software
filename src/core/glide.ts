import type { GlideKnot } from "./types";

export function weightsAtYear(knots: GlideKnot[], year: number): number[] {
  if (knots.length === 0) return [];
  const sorted = knots.slice().sort((a, b) => a.year - b.year);
  if (year <= sorted[0].year) return sorted[0].weights.slice();
  const last = sorted[sorted.length - 1];
  if (year >= last.year) return last.weights.slice();
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (year >= left.year && year <= right.year) {
      const span = right.year - left.year;
      const t = span === 0 ? 0 : (year - left.year) / span;
      return left.weights.map((weight, index) => weight + (right.weights[index] - weight) * t);
    }
  }
  return last.weights.slice();
}

export function normalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => (weights.length > 0 ? 1 / weights.length : 0));
  return weights.map((weight) => weight / total);
}

export function weightsSumToOne(weights: number[]): boolean {
  if (weights.length === 0) return false;
  if (weights.some((weight) => !Number.isFinite(weight) || weight < -1e-9)) return false;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1) < 1e-6;
}
