import { satelliteCatalog } from "./basket";
import { newSleeve, zeroAssumptions } from "./defaults";
import { assumptionsHash, type LedgerEntry } from "./ledger";
import { zeroEquityParams, zeroRateParams } from "./rates";
import { streamManifest } from "./rng";
import type {
  Assumptions,
  BasketName,
  EquityParams,
  MixSpec,
  RateParams,
  RateRegime,
  ResearchNote,
  ShockModel,
  Sleeve,
  SleeveKind,
} from "./types";

const KINDS: SleeveKind[] = ["parametric", "tbill", "intermediate", "long_treasury", "credit", "equity_index", "basket"];
const REGIMES: RateRegime[] = ["rising", "flat", "falling", "shock-up", "stagflation"];

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hydrateSleeve(raw: unknown, fallback: Sleeve): Sleeve {
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<Sleeve>;
  const kind = KINDS.includes(source.kind as SleeveKind) ? (source.kind as SleeveKind) : "parametric";
  const blank = newSleeve(
    typeof source.id === "string" && source.id ? source.id : fallback.id,
    typeof source.name === "string" ? source.name : fallback.name,
    finite(source.mu, fallback.mu),
    finite(source.sigma, fallback.sigma),
    finite(source.base, fallback.base),
    finite(source.bull, fallback.bull),
    finite(source.bear, fallback.bear),
  );
  return {
    ...blank,
    kind,
    duration: finite(source.duration, 0),
    convexity: finite(source.convexity, 0),
    expenseRatio: finite(source.expenseRatio, 0),
    spread: finite(source.spread, 0),
    defaultProb: finite(source.defaultProb, 0),
    recovery: finite(source.recovery, 0),
    spreadBeta: finite(source.spreadBeta, 0),
    tradable: typeof source.tradable === "boolean" ? source.tradable : true,
    winsEligible: typeof source.winsEligible === "boolean" ? source.winsEligible : true,
    studentDf: finite(source.studentDf, 5),
    issuer: typeof source.issuer === "string" ? source.issuer : "",
  };
}

function hydrateRates(raw: unknown, fallback: RateParams): RateParams {
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<RateParams>;
  return {
    ...fallback,
    regime: REGIMES.includes(source.regime as RateRegime) ? (source.regime as RateRegime) : fallback.regime,
    r0: finite(source.r0, fallback.r0),
    kappa: finite(source.kappa, fallback.kappa),
    theta: finite(source.theta, fallback.theta),
    sigma: finite(source.sigma, fallback.sigma),
    intermediatePremium: finite(source.intermediatePremium, fallback.intermediatePremium),
    longPremium: finite(source.longPremium, fallback.longPremium),
    slope: finite(source.slope, fallback.slope),
    equityRateCorr: finite(source.equityRateCorr, fallback.equityRateCorr),
    driftPerYear: finite(source.driftPerYear, fallback.driftPerYear),
    driftYears: finite(source.driftYears, fallback.driftYears),
    levelShock: finite(source.levelShock, fallback.levelShock),
  };
}

function hydrateEquity(raw: unknown, fallback: EquityParams): EquityParams {
  if (!raw || typeof raw !== "object") return fallback;
  const source = raw as Partial<EquityParams>;
  return {
    studentDf: finite(source.studentDf, fallback.studentDf),
    marketMu: finite(source.marketMu, fallback.marketMu),
    marketSigma: finite(source.marketSigma, fallback.marketSigma),
    regimeDrag: finite(source.regimeDrag, fallback.regimeDrag),
    sectorSigma: finite(source.sectorSigma, fallback.sectorSigma),
  };
}

function hydrateName(raw: unknown): BasketName | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<BasketName>;
  if (typeof source.ticker !== "string" || source.ticker.length === 0) return null;
  const blank = satelliteCatalog()[0];
  return {
    ...blank,
    id: typeof source.id === "string" && source.id ? source.id : source.ticker.toLowerCase(),
    ticker: source.ticker,
    name: typeof source.name === "string" ? source.name : source.ticker,
    sector: typeof source.sector === "string" ? source.sector : "broad",
    linkNote: typeof source.linkNote === "string" ? source.linkNote : "Team",
    taiwan: source.taiwan === true,
    alpha: finite(source.alpha, 0),
    beta: finite(source.beta, 1),
    idioSigma: finite(source.idioSigma, 0),
    studentDf: finite(source.studentDf, 5),
    jumpProb: finite(source.jumpProb, 0),
    jumpMean: finite(source.jumpMean, 0),
    fxSigma: finite(source.fxSigma, 0),
    geoJumpProb: finite(source.geoJumpProb, 0),
    geoJumpMean: finite(source.geoJumpMean, 0),
    sectorBeta: finite(source.sectorBeta, 0),
    weight: finite(source.weight, 0),
    expenseRatio: finite(source.expenseRatio, 0),
    assumptionNote: typeof source.assumptionNote === "string" ? source.assumptionNote : blank.assumptionNote,
  };
}

function hydrateMix(raw: unknown): MixSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<MixSpec>;
  if (!Array.isArray(source.weights2027) || !Array.isArray(source.weights2033)) return null;
  return {
    id: typeof source.id === "string" ? source.id : "mix",
    name: typeof source.name === "string" ? source.name : "Mix",
    weights2027: source.weights2027.map((value) => finite(value, 0)),
    weights2033: source.weights2033.map((value) => finite(value, 0)),
  };
}

/** Read a v1, v2, or v3 assumptions object and return a schemaVersion 3 snapshot. Missing fields get the zero-default value, not a market view. */
export function migrateAssumptions(raw: unknown): Assumptions {
  const base = zeroAssumptions();
  if (!raw || typeof raw !== "object") return base;
  const source = raw as Partial<Assumptions>;
  const sleeves =
    Array.isArray(source.sleeves) && source.sleeves.length > 0
      ? source.sleeves.map((sleeve, index) => hydrateSleeve(sleeve, base.sleeves[index] ?? base.sleeves[0]))
      : base.sleeves;
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
    rates: hydrateRates(source.rates, zeroRateParams()),
    equity: hydrateEquity(source.equity, zeroEquityParams()),
    basket: Array.isArray(source.basket)
      ? source.basket.map(hydrateName).filter((name): name is BasketName => name !== null)
      : satelliteCatalog(),
    costs: {
      transactionCostBps: finite(
        source.costs && typeof source.costs === "object" ? (source.costs as { transactionCostBps?: unknown }).transactionCostBps : undefined,
        0,
      ),
    },
    mixes: Array.isArray(source.mixes) ? source.mixes.map(hydrateMix).filter((mix): mix is MixSpec => mix !== null) : [],
    schemaVersion: 3,
    schema: 3,
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
    schemaVersion: 3,
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
