/**
 * Re-run a JSON bundle and compare beginning-of-2033 wealth. MODEL_SPEC §13.
 * Usage: npm run reproduce -- bundle.json
 */
import { readFileSync } from "node:fs";
import { reproduceBundle, type RunBundle } from "../src/core/bundle.ts";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run reproduce -- bundle.json");
  process.exit(1);
}
const bundle = JSON.parse(readFileSync(path, "utf8")) as RunBundle;
const result = reproduceBundle(bundle);
console.log(result.message);
process.exit(result.ok ? 0 : 1);
