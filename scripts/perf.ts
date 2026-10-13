/**
 * Priced mode, 5 mixes, 20,000 trials. The budget is 3 seconds.
 * The median is the stored baseline. A change in p50 is a numeric change, not a speedup.
 */
import { writeFileSync } from "node:fs";
import { newSleeve, zeroAssumptions } from "../src/core/defaults.ts";
import { applyRegimeTemplate } from "../src/core/rates.ts";
import { runModel } from "../src/core/run.ts";

const BUDGET_MS = 3000;
const P50 = 580913.4554481686;

const assumptions = zeroAssumptions();
const templated = applyRegimeTemplate(assumptions.rates, assumptions.equity, "flat");
assumptions.trials = 20000;
assumptions.seed = 42;
assumptions.rates = { ...templated.rates, r0: 0.04, kappa: 0.2, theta: 0.035, sigma: 0.007, intermediatePremium: 0.007, longPremium: 0.014 };
assumptions.equity = { ...templated.equity, studentDf: 5, marketMu: 0.07, marketSigma: 0.16, sectorSigma: 0 };
assumptions.sleeves = [
  { ...newSleeve("e", "eq", 0.07, 0.16, 0.07, 0.1, -0.05), kind: "equity_index", studentDf: 5 },
  { ...newSleeve("b", "bills"), kind: "tbill", duration: 0.4, convexity: 0.15 },
];
assumptions.glide = [
  { year: 2027, weights: [0.6, 0.4] },
  { year: 2033, weights: [0.4, 0.6] },
];
assumptions.correlation = [
  [1, 0.1],
  [0.1, 1],
];
assumptions.mixes = [0, 1, 2, 3, 4].map((i) => ({
  id: "m" + i,
  name: "mix " + i,
  weights2027: [0.5 + i * 0.02, 0.5 - i * 0.02],
  weights2033: [0.3, 0.7],
}));

const started = Date.now();
const output = runModel(assumptions);
const ms = Date.now() - started;
const p50 = output.metrics?.wealthPercentiles["50"] ?? Number.NaN;
const record = {
  budgetMs: BUDGET_MS,
  ms,
  p50,
  mixes: output.mixes.length,
  errors: output.errors,
  note: "Priced mode, five mixes, 20,000 trials, seed 42. The median is the regression lock. The budget is the wall clock of this process.",
};
writeFileSync("docs/perf-baseline.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
if (output.errors.length > 0 || output.mixes.length !== 5) process.exit(1);
if (!(ms < BUDGET_MS)) {
  console.error(`performance budget missed: ${ms} ms`);
  process.exit(1);
}
if (Math.abs(p50 - P50) > 1e-6) {
  console.error(`p50 moved from ${P50} to ${p50}`);
  process.exit(1);
}
