/**
 * Timing checks that do not belong in `npm run verify`.
 * A loaded box can miss a wall-clock budget. That is not a logic failure.
 *
 *   npm run bench
 */
import { writeFileSync } from "node:fs";
import { teachingAssumptions } from "../src/core/defaults.ts";
import { effectiveSampleSize } from "../src/core/ess.ts";
import { convergenceCurve } from "../src/core/diagnostics.ts";
import { runModel } from "../src/core/run.ts";

const PARAMETRIC_BUDGET_MS = 8000;
const INTERACTION_BUDGET_MS = 100;

const assumptions = teachingAssumptions();
assumptions.trials = 5000;
assumptions.seed = 42;
assumptions.diagnostics = { samplerComparison: false };

const started = Date.now();
const output = runModel(assumptions);
const parametricMs = Date.now() - started;

const interactionStarted = Date.now();
const wealth = output.monteCarlo?.wealth2033 ?? [];
convergenceCurve(wealth, output.reserve.active.reserve);
effectiveSampleSize(wealth);
const interactionMs = Date.now() - interactionStarted;

const record = {
  parametricTrials: 5000,
  parametricMs,
  parametricBudgetMs: PARAMETRIC_BUDGET_MS,
  interactionMs,
  interactionBudgetMs: INTERACTION_BUDGET_MS,
  funded: output.metrics?.fullyFundedProbability ?? null,
  reserve0: output.monteCarlo?.reserve[0] ?? null,
  note: "Teaching book, parametric, sampler comparison off. The interaction row is the synchronous chart and effective-sample-size work, not a browser click. Browser clicks are outside verify.",
};
writeFileSync("docs/bench-baseline.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
if (output.errors.length > 0) {
  console.error(output.errors.join("\n"));
  process.exit(1);
}
if (!(parametricMs < PARAMETRIC_BUDGET_MS)) {
  console.error(`parametric budget missed: ${parametricMs} ms`);
  process.exit(1);
}
if (!(interactionMs < INTERACTION_BUDGET_MS)) {
  console.error(`interaction budget missed: ${interactionMs} ms`);
  process.exit(1);
}
