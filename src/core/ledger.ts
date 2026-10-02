import { DECISION_YEAR } from "./case";
import { canonicalJson, sha256Hex } from "./hash";
import { percentile } from "./math";
import { streamManifest } from "./rng";
import type { Assumptions, ModelOutput, ScenarioName } from "./types";
import type { StreamManifest } from "./rng";

export interface RunSummary {
  tag: Assumptions["tag"];
  wealth2033: Record<ScenarioName, number | null>;
  mcP50Wealth2033: number | null;
  reserveMethod: Assumptions["reserve"]["method"];
  reserve: number | null;
  rangeMethod: string | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  errors: string[];
}

/** Immutable snapshot. `assumptions` is a deep copy taken at save time. */
export interface LedgerEntry {
  id: string;
  name: string;
  savedAt: string;
  /** SHA-256 of the canonical JSON of `assumptions`. Identifies inputs, not the code version. */
  assumptionsHash: string;
  schemaVersion: 2;
  seed: number;
  trials: number;
  shockModel: Assumptions["shockModel"];
  streams: StreamManifest;
  summary: RunSummary;
  assumptions: Assumptions;
}

export function assumptionsHash(assumptions: Assumptions): string {
  return sha256Hex(canonicalJson(assumptions));
}

export function summarizeRun(assumptions: Assumptions, output: ModelOutput): RunSummary {
  const wealth = (name: "bear" | "base" | "bull") => {
    const value = output.scenarios[name]?.find((point) => point.calendarYear === DECISION_YEAR)?.wealthStart;
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
  const primary = output.facility?.primary ?? null;
  return {
    tag: assumptions.tag,
    wealth2033: { bear: wealth("bear"), base: wealth("base"), bull: wealth("bull") },
    mcP50Wealth2033: output.monteCarlo ? percentile(output.monteCarlo.wealth2033, 0.5) : null,
    reserveMethod: assumptions.reserve.method,
    reserve: output.reserve.active.reserve,
    rangeMethod: primary?.method ?? assumptions.facility.rangeMethod,
    rangeLow: primary?.low ?? null,
    rangeHigh: primary?.high ?? null,
    errors: output.errors.slice(),
  };
}

/** A saved run. The assumptions object is a deep copy. Later edits to the workspace do not change the row. */
export function createLedgerEntry(
  name: string,
  assumptions: Assumptions,
  output: ModelOutput,
  savedAt = new Date().toISOString(),
): LedgerEntry {
  const snapshot = structuredClone(assumptions);
  const assumptionsHashValue = assumptionsHash(snapshot);
  const stamp = savedAt.replace(/[^0-9]/g, "").slice(0, 17);
  return {
    id: `run-${assumptionsHashValue.slice(0, 12)}-${stamp}`,
    name: name.trim() || "Untitled run",
    savedAt,
    assumptionsHash: assumptionsHashValue,
    schemaVersion: 2,
    seed: output.masterSeed,
    trials: assumptions.trials,
    shockModel: assumptions.shockModel,
    streams: output.streams ?? streamManifest(assumptions.seed),
    summary: summarizeRun(snapshot, output),
    assumptions: snapshot,
  };
}

export interface AssumptionDiff {
  path: string;
  left: string;
  right: string;
}

export function diffAssumptions(
  left: Assumptions,
  right: Assumptions,
  limit = 80,
): { rows: AssumptionDiff[]; truncated: boolean } {
  const rows: AssumptionDiff[] = [];
  const truncated = walk(left, right, "", rows, limit);
  return { rows, truncated: truncated || rows.length >= limit };
}

function walk(left: unknown, right: unknown, path: string, rows: AssumptionDiff[], limit: number): boolean {
  if (rows.length >= limit) return true;
  if (same(left, right)) return false;
  const leftObject = isPlain(left);
  const rightObject = isPlain(right);
  if (!leftObject || !rightObject) {
    rows.push({ path: path || "(root)", left: formatDiff(left), right: formatDiff(right) });
    return rows.length >= limit;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    const count = Math.max(a.length, b.length);
    for (let index = 0; index < count; index++) {
      if (walk(a[index], b[index], `${path}[${index}]`, rows, limit)) return true;
    }
    return false;
  }
  const keys = new Set([...Object.keys(left as object), ...Object.keys(right as object)]);
  for (const key of [...keys].sort()) {
    const next = path ? `${path}.${key}` : key;
    if (walk((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], next, rows, limit)) {
      return true;
    }
  }
  return false;
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left === "number" && typeof right === "number" && Number.isNaN(left) && Number.isNaN(right)) return true;
  return false;
}

function isPlain(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function formatDiff(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : String(value);
  if (value === undefined) return "missing";
  return JSON.stringify(value) ?? "missing";
}
