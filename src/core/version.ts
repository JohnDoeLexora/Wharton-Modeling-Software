export const APP_NAME = "gao-modeling-toolkit";
export const APP_VERSION = "3.0.0";

function readCommit(): string {
  try {
    return typeof __GIT_COMMIT__ === "string" && __GIT_COMMIT__.length > 0 ? __GIT_COMMIT__ : "unknown";
  } catch {
    return "unknown";
  }
}

/** Short git commit captured when Vite or Vitest bundled this module. Identifies formulas, not inputs. */
export const GIT_COMMIT = readCommit();
