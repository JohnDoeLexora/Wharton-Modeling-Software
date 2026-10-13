import { assumptionsHash } from "./ledger";
import type { Assumptions, ProvenanceStamp } from "./types";
import { APP_VERSION, GIT_COMMIT } from "./version";

/** Fetch date recorded in data/PROVENANCE.md. */
export const DATA_AS_OF = "2026-10-08";

/** SHA-256 of data/treasury_par_yields.csv on that date. */
export const TREASURY_SHA256 = "670bc2149026bab46e86315a6781f2153fab33c8fe377caaa790930ccfffaf22";

/** SHA-256 of data/french_ff_annual.csv on that date. */
export const FRENCH_SHA256 = "d7d7fe37b150b5b15c9c069b3ba101dfe1af568c6d7b5db6e73cd0a6c0c9e5e5";

export function provenanceStamp(assumptions: Assumptions, seed: number): ProvenanceStamp {
  return {
    dataAsOf: DATA_AS_OF,
    treasurySha256: TREASURY_SHA256,
    frenchSha256: FRENCH_SHA256,
    frenchNote:
      "Ken French's files are revised retroactively. This hash is the copy fetched on the as-of date.",
    curveNote:
      "Treasury par yields are fit to a Nelson–Siegel zero curve. A reserve present value uses those discount factors, not the par yield itself.",
    teachingNote:
      "The example book's 7% and 16%, and 3% and 4%, are teaching numbers. They are not a capital-market assumption and not a recommended portfolio.",
    seed,
    version: APP_VERSION,
    gitCommit: GIT_COMMIT,
    assumptionsHash: assumptionsHash(assumptions),
  };
}
