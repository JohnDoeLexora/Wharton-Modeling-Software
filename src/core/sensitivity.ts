import { DECISION_YEAR } from "./case";
import { percentile } from "./math";
import { runModel } from "./run";
import type { Assumptions, ModelOutput, Sleeve } from "./types";

export interface GreekCell {
  base: number | null;
  up: number | null;
  down: number | null;
  /** (V(x+h) − V(x−h)) / (2h). Dollars per 1.0 unit of the input. */
  greek: number | null;
  /** V(x+h) − V(x). The one-at-a-time effect of the upward bump. */
  deltaUp: number | null;
  deltaDown: number | null;
  note: string;
}

export interface SensitivityFactor {
  id: string;
  label: string;
  input: string;
  bump: number;
  bumpLabel: string;
  clamped: boolean;
  formula: string;
  metrics: {
    baseWealth2033: GreekCell;
    mcP50Wealth2033: GreekCell;
    rangeLow: GreekCell;
    rangeHigh: GreekCell;
  };
}

export interface SensitivityReport {
  formula: string;
  trials: number;
  seed: number;
  rangeMethod: string;
  factors: SensitivityFactor[];
}

interface Metrics {
  baseWealth2033: number | null;
  mcP50Wealth2033: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  errors: string[];
}

const FORMULA =
  "Central difference (V(x+h) − V(x−h)) / (2h), and the one-at-a-time gaps V(x+h) − V(x) and V(x−h) − V(x). " +
  "h is 0.01 for μ, σ, and the scenario base return; 0.05 for the first-sleeve glide weight; 0.005 for the discount yield. " +
  "μ and σ move the Monte Carlo only. The scenario base return moves bear/base/bull paths only. The discount yield moves the reserve, and through it the contribution band, not portfolio wealth. " +
  "The median is the type-7 50th percentile of beginning-of-2033 wealth, even if that percentile is not on the chart list. " +
  "Range endpoints are the active communication method.";

export function runSensitivity(assumptions: Assumptions): SensitivityReport {
  const baseOutput = runModel(assumptions);
  const base = metricsOf(baseOutput);
  const factors = [
    factor(assumptions, base, {
      id: "mu",
      label: "Parallel μ",
      input: "sleeve.mu",
      bump: 0.01,
      bumpLabel: "1 percentage point on every sleeve μ",
      formula: "μ feeds the parametric Monte Carlo. It does not change the bear, base, or bull paths.",
      apply: (current, direction) => bumpField(current, "mu", direction * 0.01),
    }),
    factor(assumptions, base, {
      id: "sigma",
      label: "Parallel σ",
      input: "sleeve.sigma",
      bump: 0.01,
      bumpLabel: "1 percentage point on every sleeve σ, floored at 0",
      formula: "σ feeds the parametric Monte Carlo. A downward bump that would pass below 0 is floored, and the cell is marked clamped.",
      apply: (current, direction) => bumpField(current, "sigma", direction * 0.01),
    }),
    factor(assumptions, base, {
      id: "scenarioBase",
      label: "Parallel scenario base return",
      input: "sleeve.base",
      bump: 0.01,
      bumpLabel: "1 percentage point on every sleeve base return",
      formula: "The base column is the deterministic base path. It is not μ. Bull and bear are left unchanged.",
      apply: (current, direction) => bumpField(current, "base", direction * 0.01),
    }),
    factor(assumptions, base, {
      id: "glide",
      label: "First-sleeve glide weight",
      input: "glide.weights[0]",
      bump: 0.05,
      bumpLabel: "5 percentage points added to the first sleeve at every knot, then the other weights are rescaled",
      formula: "Other sleeves share what remains so each knot still sums to 1. A one-sleeve glide cannot move, and the cell is marked clamped.",
      apply: (current, direction) => bumpGlide(current, direction * 0.05),
    }),
    factor(assumptions, base, {
      id: "discountYield",
      label: "Discount yield",
      input: "reserve.discountYield",
      bump: 0.005,
      bumpLabel: "0.5 percentage point on the discount yield y",
      formula: "y sizes the ladder and the duration reserve and sets the funded-ratio discount. It does not change portfolio wealth.",
      apply: (current, direction) => ({
        next: {
          ...current,
          reserve: { ...current.reserve, discountYield: current.reserve.discountYield + direction * 0.005 },
        },
        clamped: false,
      }),
    }),
  ];
  return {
    formula: FORMULA,
    trials: assumptions.trials,
    seed: baseOutput.masterSeed,
    rangeMethod: assumptions.facility.rangeMethod,
    factors,
  };
}

function factor(
  assumptions: Assumptions,
  base: Metrics,
  spec: {
    id: string;
    label: string;
    input: string;
    bump: number;
    bumpLabel: string;
    formula: string;
    apply: (current: Assumptions, direction: 1 | -1) => { next: Assumptions; clamped: boolean };
  },
): SensitivityFactor {
  const upBump = spec.apply(assumptions, 1);
  const downBump = spec.apply(assumptions, -1);
  const up = metricsOf(runModel(upBump.next));
  const down = metricsOf(runModel(downBump.next));
  const keys = ["baseWealth2033", "mcP50Wealth2033", "rangeLow", "rangeHigh"] as const;
  const metrics = Object.fromEntries(
    keys.map((key) => [key, cell(base[key], up[key], down[key], spec.bump, up.errors, down.errors)]),
  ) as SensitivityFactor["metrics"];
  return {
    id: spec.id,
    label: spec.label,
    input: spec.input,
    bump: spec.bump,
    bumpLabel: spec.bumpLabel,
    clamped: upBump.clamped || downBump.clamped,
    formula: spec.formula,
    metrics,
  };
}

function cell(
  base: number | null,
  up: number | null,
  down: number | null,
  bump: number,
  upErrors: string[],
  downErrors: string[],
): GreekCell {
  const notes: string[] = [];
  if (upErrors.length > 0) notes.push(`Up bump did not run: ${upErrors[0]}`);
  if (downErrors.length > 0) notes.push(`Down bump did not run: ${downErrors[0]}`);
  const raw = up !== null && down !== null ? (up - down) / (2 * bump) : null;
  if (notes.length === 0) notes.push("Central difference (V(x+h) − V(x−h)) / (2h).");
  return {
    base,
    up,
    down,
    greek: raw !== null && Number.isFinite(raw) ? raw : null,
    deltaUp: up !== null && base !== null ? up - base : null,
    deltaDown: down !== null && base !== null ? down - base : null,
    note: notes.join(" "),
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

function metricsOf(output: ModelOutput): Metrics {
  const baseWealth = output.scenarios.base?.find((point) => point.calendarYear === DECISION_YEAR)?.wealthStart;
  const mcP50 = output.monteCarlo ? percentile(output.monteCarlo.wealth2033, 0.5) : null;
  const range = output.facility?.primary ?? null;
  return {
    baseWealth2033: finiteOrNull(baseWealth),
    mcP50Wealth2033: finiteOrNull(mcP50),
    rangeLow: finiteOrNull(range?.low),
    rangeHigh: finiteOrNull(range?.high),
    errors: output.errors,
  };
}

function bumpField(
  assumptions: Assumptions,
  key: "mu" | "sigma" | "base",
  delta: number,
): { next: Assumptions; clamped: boolean } {
  let clamped = false;
  const sleeves: Sleeve[] = assumptions.sleeves.map((sleeve) => {
    const raw = sleeve[key] + delta;
    const value = key === "sigma" ? Math.max(0, raw) : raw;
    if (value !== raw) clamped = true;
    return { ...sleeve, [key]: value };
  });
  return { next: { ...assumptions, sleeves }, clamped };
}

function bumpGlide(assumptions: Assumptions, delta: number): { next: Assumptions; clamped: boolean } {
  if (assumptions.sleeves.length < 2) return { next: assumptions, clamped: true };
  let clamped = false;
  const glide = assumptions.glide.map((knot) => {
    const weights = knot.weights.slice();
    const shifted = (weights[0] ?? 0) + delta;
    const clipped = Math.min(1, Math.max(0, shifted));
    if (clipped !== shifted) clamped = true;
    const rest = weights.slice(1).map((weight) => Math.max(0, weight));
    const restSum = rest.reduce((sum, weight) => sum + weight, 0);
    const target = 1 - clipped;
    const next = [clipped];
    if (restSum <= 1e-12) {
      const share = rest.length > 0 ? target / rest.length : 0;
      for (let i = 0; i < rest.length; i++) next.push(share);
    } else {
      for (const weight of rest) next.push((weight / restSum) * target);
    }
    return { ...knot, weights: next };
  });
  return { next: { ...assumptions, glide }, clamped };
}
