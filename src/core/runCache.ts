import { assumptionsHash } from "./ledger";
import { runModel, type RunHooks } from "./run";
import type { Assumptions, ModelOutput } from "./types";

const cache = new Map<string, ModelOutput>();

export function rememberRun(hash: string, output: ModelOutput) {
  cache.set(hash, output);
  if (cache.size > 12) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function cachedOutput(assumptions: Assumptions): ModelOutput | null {
  return cache.get(assumptionsHash(assumptions)) ?? null;
}

/** Run the model, or return the sample already computed for this assumption hash. */
export function runCached(assumptions: Assumptions, hooks?: RunHooks): ModelOutput {
  const hash = assumptionsHash(assumptions);
  const hit = cache.get(hash);
  if (hit) {
    hooks?.onProgress?.(hit.monteCarlo?.trials ?? assumptions.trials, hit.monteCarlo?.trials ?? assumptions.trials);
    return hit;
  }
  const output = runModel(assumptions, hooks);
  rememberRun(hash, output);
  return output;
}
