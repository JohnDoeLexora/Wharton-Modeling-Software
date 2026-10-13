/**
 * Deterministic parity: Bend stdout versus the TypeScript golden lines.
 * Monte Carlo parity: one fixed parametric book, written for the Python
 * cross-check in reference/python/parity_check.py.
 *
 * Bend also runs the 16-trial fixed-point fan in bend/fan.bend.
 * Those dollars are in the golden lines (fan_trial0, fan_mean, fan_min, fan_max).
 * The 200-trial statistical comparison is TypeScript versus the independent
 * Python copy of the same contract.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { zeroAssumptions } from "../src/core/defaults.ts";
import { goldenLines, parseGolden } from "../src/core/golden.ts";
import { runModel } from "../src/core/run.ts";
import {
  ewmaVariance,
  fitGarch,
  goldenEwma,
  goldenJumpVar,
  goldenShrunkCov,
  goldenVasicek,
  kupiec,
  ledoitWolf,
  ols,
  parityHits,
  paritySeries,
  vasicekBeta,
} from "../src/core/risk/index.ts";

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

const series = paritySeries();
const ewma = ewmaVariance(series.asset);
const fit = ols(series.asset, [series.asset.map(() => 1), series.market]);
const slopeSe = fit.cov ? Math.sqrt(Math.max(0, fit.cov[1][1])) : Number.NaN;
const shrunkBeta = vasicekBeta(fit.coef[1], slopeSe, 1, 0.25);
const garch = fitGarch(series.asset);
const hits = parityHits();
const kupiecTest = kupiec(hits.filter(Boolean).length, hits.length, 0.05);
const shrink = ledoitWolf(series.asset.map((value, index) => [value, series.market[index]]));
const cov = goldenShrunkCov();
const riskPath = resolve("/tmp/gao-risk-golden.json");
writeFileSync(
  riskPath,
  JSON.stringify({
    ewma: goldenEwma(),
    vasicek: goldenVasicek(),
    jump: goldenJumpVar(),
    covDet: cov.det,
    series,
    ewmaNext: ewma.next,
    ols: { intercept: fit.coef[0], slope: fit.coef[1], se: slopeSe },
    vasicekBeta: shrunkBeta.beta,
    garch: { ok: garch.ok, alpha: garch.alpha, beta: garch.beta, omega: garch.omega, longRun: garch.longRun },
    kupiec: { lr: kupiecTest.lr, pValue: kupiecTest.pValue, hits: kupiecTest.hits, n: kupiecTest.n },
    shrinkage: shrink.shrinkage,
    shrunk00: shrink.cov[0][0],
  }),
);
console.log(`risk golden ewma=${goldenEwma()} vasicek=${goldenVasicek()} jump=${goldenJumpVar()} det=${cov.det}`);

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
