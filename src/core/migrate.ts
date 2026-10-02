import { zeroAssumptions } from "./defaults";
import { assumptionsHash, type LedgerEntry } from "./ledger";
import { streamManifest } from "./rng";
import type { Assumptions, ResearchNote, ShockModel } from "./types";

/** Read a v1 or v2 assumptions object and return a schemaVersion 2 snapshot. Missing fields get the zero-default value, not a market view. */
export function migrateAssumptions(raw: unknown): Assumptions {
  const base = zeroAssumptions();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<Assumptions>;
  const sleeves = Array.isArray(source.sleeves) && source.sleeves.length > 0 ? source.sleeves : base.sleeves;
  const glide = Array.isArray(source.glide) && source.glide.length > 0 ? source.glide : base.glide;
  const shockModel: ShockModel = source.shockModel === "block_bootstrap" ? "block_bootstrap" : "parametric";
  const history = Array.isArray(source.bootstrapHistory)
    ? source.bootstrapHistory.filter((row): row is number[] => Array.isArray(row)).map((row) => row.map((value) => Number(value)))
    : [];
  const blockLength =
    typeof source.blockLength === "number" && Number.isInteger(source.blockLength) && source.blockLength >= 1
      ? source.blockLength
      : 1;
  return {
    ...base,
    tag: source.tag === "teaching-example" || source.tag === "edited" || source.tag === "zero-default" ? source.tag : base.tag,
    certaintyNote: typeof source.certaintyNote === "string" ? source.certaintyNote : "",
    sleeves,
    glide,
    correlation: Array.isArray(source.correlation) && source.correlation.length > 0 ? source.correlation : base.correlation,
    correlationStress: typeof source.correlationStress === "number" && Number.isFinite(source.correlationStress) ? source.correlationStress : 0,
    rebalance: source.rebalance === "drift" ? "drift" : "annual",
    returnModel: source.returnModel === "normal" ? "normal" : "lognormal",
    shockModel,
    bootstrapHistory: history,
    blockLength,
    normalFloor: typeof source.normalFloor === "number" && Number.isFinite(source.normalFloor) ? source.normalFloor : base.normalFloor,
    inflation: typeof source.inflation === "number" && Number.isFinite(source.inflation) ? source.inflation : 0,
    trials: typeof source.trials === "number" && Number.isFinite(source.trials) ? Math.round(source.trials) : base.trials,
    seed: typeof source.seed === "number" && Number.isFinite(source.seed) ? source.seed : base.seed,
    percentiles: Array.isArray(source.percentiles) && source.percentiles.length > 0 ? source.percentiles : base.percentiles,
    reserve: { ...base.reserve, ...(source.reserve ?? {}) },
    facility: {
      ...base.facility,
      ...(source.facility ?? {}),
      rules:
        Array.isArray(source.facility?.rules) && source.facility.rules.length > 0
          ? source.facility.rules
          : base.facility.rules,
    },
    schemaVersion: 2,
    schema: 2,
  };
}

function isNote(raw: unknown): raw is ResearchNote {
  if (!raw || typeof raw !== "object") return false;
  const note = raw as Partial<ResearchNote>;
  return typeof note.id === "string" && typeof note.text === "string" && typeof note.label === "string" && !!note.scores;
}

function migrateEntry(raw: unknown): LedgerEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<LedgerEntry>;
  if (typeof entry.name !== "string" || !entry.assumptions || !entry.summary) return null;
  const assumptions = migrateAssumptions(entry.assumptions);
  const hash = typeof entry.assumptionsHash === "string" && entry.assumptionsHash.length > 0
    ? entry.assumptionsHash
    : assumptionsHash(assumptions);
  return {
    id: typeof entry.id === "string" ? entry.id : `run-${hash.slice(0, 12)}`,
    name: entry.name,
    savedAt: typeof entry.savedAt === "string" ? entry.savedAt : "",
    assumptionsHash: hash,
    schemaVersion: 2,
    seed: typeof entry.seed === "number" ? entry.seed : assumptions.seed,
    trials: typeof entry.trials === "number" ? entry.trials : assumptions.trials,
    shockModel: assumptions.shockModel,
    streams: entry.streams ?? streamManifest(assumptions.seed),
    summary: entry.summary,
    assumptions,
  };
}

/** Browser storage. Accepts the v1 blob (`v: 1`) and the v2 blob (`v: 2`, with a ledger). */
export function migrateStoredWorkspace(raw: unknown): {
  assumptions: Assumptions;
  notes: ResearchNote[];
  ledger: LedgerEntry[];
} {
  if (!raw || typeof raw !== "object") {
    return { assumptions: zeroAssumptions(), notes: [], ledger: [] };
  }
  const saved = raw as { assumptions?: unknown; notes?: unknown; ledger?: unknown; sleeves?: unknown };
  const assumptions = migrateAssumptions(saved.assumptions ?? (saved.sleeves ? saved : undefined));
  const notes = Array.isArray(saved.notes) ? saved.notes.filter(isNote) : [];
  const ledger = Array.isArray(saved.ledger) ? saved.ledger.map(migrateEntry).filter((entry): entry is LedgerEntry => entry !== null) : [];
  return { assumptions, notes, ledger };
}
