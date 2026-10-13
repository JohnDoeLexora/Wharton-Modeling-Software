/**
 * A JSON bundle that `npm run reproduce` can run again.
 * The wealth vector is part of the bundle so the check is bit-for-bit. MODEL_SPEC §13.
 */
import { sha256Hex } from "./hash";
import { runModel } from "./run";
import type { Assumptions, ModelOutput } from "./types";
import { APP_VERSION, GIT_COMMIT } from "./version";

export interface RunBundle {
  version: string;
  git: string;
  seed: number;
  assumptions: Assumptions;
  dataHashes: { file: string; sha256: string }[];
  wealth2033: number[];
}

export function buildBundle(assumptions: Assumptions, output: ModelOutput, files: { file: string; text: string }[] = []): RunBundle {
  return {
    version: APP_VERSION,
    git: GIT_COMMIT,
    seed: assumptions.seed,
    assumptions,
    dataHashes: files.map((file) => ({ file: file.file, sha256: sha256Hex(file.text) })),
    wealth2033: output.monteCarlo?.wealth2033.slice() ?? [],
  };
}

export interface ReproduceResult {
  ok: boolean;
  compared: number;
  maxAbs: number;
  message: string;
}

/** Re-run the bundle and compare beginning-of-2033 wealth trial by trial. */
export function reproduceBundle(bundle: RunBundle): ReproduceResult {
  const output = runModel(bundle.assumptions);
  const got = output.monteCarlo?.wealth2033 ?? [];
  const n = Math.min(got.length, bundle.wealth2033.length);
  let maxAbs = 0;
  for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(got[i] - bundle.wealth2033[i]));
  const ok = n > 0 && n === bundle.wealth2033.length && n === got.length && maxAbs <= 1e-6 && output.masterSeed === bundle.seed;
  return {
    ok,
    compared: n,
    maxAbs,
    message: ok
      ? `Reproduced ${n} trial wealth values. Largest absolute gap ${maxAbs}.`
      : `Reproduction failed. Compared ${n} of ${bundle.wealth2033.length} stored and ${got.length} fresh values. Largest gap ${maxAbs}.`,
  };
}
