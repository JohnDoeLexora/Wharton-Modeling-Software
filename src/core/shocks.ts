import { FIRST_PROJECTION_YEAR } from "./case";
import { STREAM, standardNormal } from "./rng";
import { sobolSleeveShock } from "./sobol";
import type { SamplingMethod } from "./types";

/**
 * Standard normal portfolio shocks for one trial and one calendar year.
 * Pseudo-random draws are stream 1. Antithetic pairs negate the even trial.
 * Sobol draws are a Brownian bridge, one 15-year path per sleeve.
 */
export function portfolioNormals(args: {
  seed: number;
  sampling: SamplingMethod | undefined;
  trial: number;
  year: number;
  sleeveCount: number;
}): number[] {
  const sampling = args.sampling ?? "pseudo";
  const count = args.sleeveCount;
  if (sampling === "sobol") {
    const yearIndex = args.year - FIRST_PROJECTION_YEAR;
    return Array.from({ length: count }, (_, index) => sobolSleeveShock(args.seed, args.trial, yearIndex, index, count));
  }
  if (sampling === "antithetic") {
    const sign = args.trial % 2 === 0 ? 1 : -1;
    const base = Math.floor(args.trial / 2);
    return Array.from(
      { length: count },
      (_, index) => sign * standardNormal(args.seed, STREAM.portfolio, base, args.year, index),
    );
  }
  return Array.from({ length: count }, (_, index) => standardNormal(args.seed, STREAM.portfolio, args.trial, args.year, index));
}
