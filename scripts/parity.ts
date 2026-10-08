/**
 * Deterministic parity: Bend stdout versus the TypeScript golden lines.
 * Monte Carlo parity: one fixed parametric book, written for the Python
 * cross-check in reference/python/parity_check.py.
 *
 * Bend does not run the multi-trial sample. The statistical comparison is
 * TypeScript versus the independent Python copy of the same contract.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zeroAssumptions } from "../src/core/defaults.ts";
import { goldenLines, parseGolden } from "../src/core/golden.ts";
import { runModel } from "../src/core/run.ts";

const bend = spawnSync("bend", ["bend/main.bend"], { encoding: "utf8" });
if (bend.status !== 0) {
  console.error(bend.stderr || bend.stdout);
  console.error("bend bend/main.bend failed");
  process.exit(1);
}

const printed = parseGolden(bend.stdout);
const expected = goldenLines();
const problems: string[] = [];
for (const line of expected) {
  const actual = printed.get(line.key);
  if (actual === undefined) problems.push(`missing ${line.key}`);
  else if (actual !== line.value) problems.push(`${line.key}: bend ${actual} vs ts ${line.value}`);
}

const onePct = printed.get("reserve_pv_1pct");
if (onePct === undefined) problems.push("missing reserve_pv_1pct");
else if (onePct !== String(ladderAtOnePercent())) problems.push(`reserve_pv_1pct: bend ${onePct} vs ts ${ladderAtOnePercent()}`);

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`deterministic ${expected.length} keys agree, including cash flows, bond ppm, reserve PV, and the SplitMix word`);

const assumptions = zeroAssumptions();
assumptions.trials = 200;
assumptions.seed = 42;
assumptions.returnModel = "lognormal";
assumptions.rebalance = "annual";
assumptions.inflation = 0;
assumptions.correlationStress = 0;
assumptions.costs = { transactionCostBps: 0 };
assumptions.mixes = [];
assumptions.sleeves = assumptions.sleeves.map((sleeve, index) =>
  index === 0 ? { ...sleeve, mu: 0.06, sigma: 0.15, base: 0.06, bull: 0.06, bear: 0.06 } : { ...sleeve, mu: 0.02, sigma: 0.04, base: 0.02, bull: 0.02, bear: 0.02 },
);
assumptions.glide = [
  { year: 2027, weights: [0.6, 0.4] },
  { year: 2033, weights: [0.6, 0.4] },
];
assumptions.correlation = [
  [1, 0],
  [0, 1],
];

const output = runModel(assumptions);
const metrics = output.metrics;
if (!metrics || !output.monteCarlo) {
  console.error(output.errors.join("\n") || "no sample");
  process.exit(1);
}
const payload = {
  trials: output.monteCarlo.trials,
  seed: output.masterSeed,
  funded: metrics.fullyFundedProbability,
  p5: metrics.wealthPercentiles["5"],
  p50: metrics.wealthPercentiles["50"],
  se: metrics.convergence.standardErrorFunded,
  reserve: 500_000,
  weights: [0.6, 0.4],
  mu: [0.06, 0.02],
  sigma: [0.15, 0.04],
};
const outPath = resolve("/tmp/gao-parity-ts.json");
writeFileSync(outPath, JSON.stringify(payload));
console.log(
  `mc ts P(funded)=${payload.funded} p5=${payload.p5} p50=${payload.p50} se=${payload.se} trials=${payload.trials}`,
);

/** Annuity-due ladder at 1% using the same floor division as bend/fix.bend. */
function ladderAtOnePercent(): number {
  const unit = 1_000_000;
  const ppm = 10_000;
  const pay = 50_000;
  const discount = (future: number) => Math.floor((future * unit) / (unit + ppm));
  let needed = pay;
  for (let step = 0; step < 9; step++) needed = pay + discount(needed);
  return needed;
}
