/**
 * Mix × rate-regime sweep. Supersedes scripts/composition-sweep.ts.
 * Stress assumptions are labeled in the output. They are not forecasts.
 *
 *   npm run sweep
 *   npm run sweep -- --trials 200 --seed 42 --out out/sweep
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSweepSpecs, runSweep, sweepCsv, sweepDocument } from "../src/core/sweep.ts";

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return fallback;
  return process.argv[index + 1];
}

const trials = Math.max(50, Math.round(Number(flag("--trials", "200"))));
const seed = Math.round(Number(flag("--seed", "42")));
const outDir = resolve(flag("--out", "out/sweep"));
const family = flag("--family", "");

const specs = buildSweepSpecs().filter((spec) => (family ? spec.family === family : true));
if (specs.length === 0) {
  console.error(`No sweep rows for family "${family}".`);
  process.exit(1);
}

const started = Date.now();
const rows = runSweep(specs, trials, seed);
mkdirSync(outDir, { recursive: true });
const csvPath = resolve(outDir, "sweep.csv");
const jsonPath = resolve(outDir, "sweep.json");
writeFileSync(csvPath, sweepCsv(rows));
writeFileSync(jsonPath, JSON.stringify(sweepDocument(rows, trials, seed), null, 2));
const failed = rows.filter((row) => row.errors).length;
console.log(`Wrote ${rows.length} rows (${failed} with errors) in ${Date.now() - started} ms`);
console.log(csvPath);
console.log(jsonPath);
