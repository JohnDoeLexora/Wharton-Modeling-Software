/**
 * Bit-level parity of the TypeScript year step and reference/python/kernel.py.
 * Twenty golden books must agree within 1e-9 relative. Five richer books also
 * agree on p5, p50, p95, P(funded), and the gift band within 3 standard errors.
 */
import { spawnSync } from "node:child_process";
import { parityConfigs, parityRun, type ParityConfig } from "../src/core/parityKernel.ts";

const REL = 1e-9;

function python(config: ParityConfig): { wealth2033: number[]; path0: number[] } {
  const run = spawnSync("python3", ["reference/python/kernel.py", "run"], {
    input: JSON.stringify(config),
    encoding: "utf8",
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    throw new Error(`python kernel failed for seed ${config.seed}`);
  }
  return JSON.parse(run.stdout) as { wealth2033: number[]; path0: number[] };
}

function relative(a: number, b: number): number {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale;
}

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sorted[lo];
  const weight = position - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const audit = spawnSync("python3", ["reference/python/kernel.py", "audit"], { encoding: "utf8" });
const word = JSON.parse(audit.stdout) as { hi: number; lo: number };
if (word.hi !== 2195427346 || word.lo !== 1420824054) {
  console.error("SplitMix audit word mismatch", word);
  process.exit(1);
}

let failed = 0;
for (const row of parityConfigs()) {
  const ts = parityRun(row.config);
  const py = python(row.config);
  let worst = 0;
  for (let i = 0; i < ts.path0.length; i++) worst = Math.max(worst, relative(ts.path0[i], py.path0[i]));
  for (let i = 0; i < ts.wealth2033.length; i++) worst = Math.max(worst, relative(ts.wealth2033[i], py.wealth2033[i]));
  if (worst > REL) {
    failed += 1;
    console.error(`${row.name} relative gap ${worst}`);
    continue;
  }
  if (row.rich) {
    const reserve = 500000;
    const funded = (values: number[]) => values.filter((value) => value + 1e-6 >= reserve).length / values.length;
    const gift = (values: number[]) => mean(values.map((value) => value - reserve));
    const se = (values: number[]) => {
      const center = mean(values);
      let square = 0;
      for (const value of values) square += (value - center) ** 2;
      return Math.sqrt(square / Math.max(1, values.length - 1)) / Math.sqrt(values.length);
    };
    const checks: [string, number, number, number][] = [
      ["p5", percentile(ts.wealth2033, 0.05), percentile(py.wealth2033, 0.05), 3 * se(ts.wealth2033)],
      ["p50", percentile(ts.wealth2033, 0.5), percentile(py.wealth2033, 0.5), 3 * se(ts.wealth2033)],
      ["p95", percentile(ts.wealth2033, 0.95), percentile(py.wealth2033, 0.95), 3 * se(ts.wealth2033)],
      ["funded", funded(ts.wealth2033), funded(py.wealth2033), 3 * Math.sqrt(0.25 / ts.wealth2033.length)],
      ["gift", gift(ts.wealth2033), gift(py.wealth2033), 3 * se(ts.wealth2033)],
    ];
    for (const [name, left, right, band] of checks) {
      if (Math.abs(left - right) > Math.max(band, 1e-6)) {
        failed += 1;
        console.error(`${row.name} ${name} ${left} vs ${right} band ${band}`);
      }
    }
  }
  console.log(`${row.name} ok ${worst.toExponential(2)}`);
}

if (failed > 0) {
  console.error(`${failed} parity checks failed`);
  process.exit(1);
}
console.log("parity-full ok");
