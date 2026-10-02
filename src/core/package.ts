import { CASE_TIMELINE, DISCLAIMER } from "./case";
import { assumptionsHash } from "./ledger";
import { caseLiabilitySchedule } from "./liability";
import { TOLERANCE } from "./tolerance";
import type { Assumptions, ModelOutput, ResearchNote } from "./types";
import { APP_NAME, APP_VERSION, GIT_COMMIT } from "./version";
import { facilityCsv, notesCsv, projectionsCsv, reserveCsv } from "./exportData";

export interface RunPackage {
  packageVersion: 1;
  disclaimer: string;
  software: { name: string; version: string; commit: string };
  exportedAt: string;
  schemaVersion: 2;
  assumptionsHash: string;
  hashNote: string;
  winsTradingPnlIncluded: false;
  finbertInProjection: false;
  taxesIncluded: false;
  methodology: string;
  caseTimeline: typeof CASE_TIMELINE;
  liability: ReturnType<typeof caseLiabilitySchedule>;
  tolerances: typeof TOLERANCE;
  assumptions: Assumptions;
  results: {
    errors: string[];
    masterSeed: number;
    streams: ModelOutput["streams"];
    shockModel: ModelOutput["shockModel"];
    correlation: {
      stress: number;
      repaired: boolean;
      ridged: boolean;
      warning: string | null;
      rawMinEigenvalue: number | null;
      used: number[][];
    };
    scenarios: ModelOutput["scenarios"];
    monteCarlo: ModelOutput["monteCarlo"];
    reserve: ModelOutput["reserve"];
    facility: Omit<NonNullable<ModelOutput["facility"]>, "contributionSamples"> & {
      contributionSampleCount: number;
    } | null;
  };
  csv: { projections: string; reserve: string; facility: string; notes: string };
  researchNotes: ResearchNote[];
}

export function methodologyFootnote(assumptions: Assumptions, output: ModelOutput, hash = assumptionsHash(assumptions)): string {
  const lines = [
    DISCLAIMER,
    "",
    `Software: ${APP_NAME} ${APP_VERSION}, commit ${GIT_COMMIT}.`,
    "The assumptions hash identifies the inputs. The commit identifies the formulas. A matching hash under a different commit is not the same experiment.",
    `Schema version: ${assumptions.schemaVersion}.`,
    `Assumptions hash (SHA-256 of canonical JSON): ${hash}.`,
    `Master seed: ${output.masterSeed}. Trials: ${assumptions.trials}.`,
    `Shock model: ${assumptions.shockModel}. Return model: ${assumptions.returnModel}. Rebalance: ${assumptions.rebalance}.`,
    `Stream design: ${output.streams.design}`,
    `Stream ${output.streams.portfolio.id} portfolio. Step: ${output.streams.portfolio.step}. Dimension: ${output.streams.portfolio.dimension}.`,
    `Stream ${output.streams.reserve.id} reserve shortfall. Step: ${output.streams.reserve.step}. Dimension: ${output.streams.reserve.dimension}.`,
    `Stream ${output.streams.bootstrap.id} block bootstrap. Step: ${output.streams.bootstrap.step}. Dimension: ${output.streams.bootstrap.dimension}.`,
    `Conditional 2031 to 2033: ${output.streams.conditional}`,
    output.monteCarlo ? `Monte Carlo formula: ${output.monteCarlo.formula}` : "Monte Carlo did not run.",
    `Correlation stress (added to off-diagonals): ${assumptions.correlationStress}. Repaired: ${output.correlation.repaired ? "yes" : "no"}. Ridged: ${output.correlation.ridged ? "yes" : "no"}.`,
    output.correlation.warning ? `Correlation warning: ${output.correlation.warning}` : "Correlation warning: none.",
    `Reserve method on the schedule: ${output.reserve.active.method}. ${output.reserve.active.message}`,
    output.facility?.primary
      ? `Primary range method: ${output.facility.primary.method}. Low ${output.facility.primary.low}. High ${output.facility.primary.high}.`
      : "Primary range: unavailable.",
    `Percentiles: ${TOLERANCE.percentile}.`,
    `Dollar identities use absolute tolerance ${TOLERANCE.moneyAbsolute}. A matched ladder funded ratio uses ${TOLERANCE.fundedRatioAbsolute}.`,
    `Displayed money: ${TOLERANCE.displayMoney}.`,
    "WInS trading profit and loss is not an input.",
    "FinBERT scores are not an input to this projection.",
    "The ten operating payments are the case liability: $50,000 nominal, beginning of each year 2033 through 2042, not inflation-linked.",
    "This package is a record of a calculation. It is not an investment recommendation.",
  ];
  return lines.join("\n");
}

export function buildRunPackage(
  assumptions: Assumptions,
  output: ModelOutput,
  notes: ResearchNote[],
  exportedAt = new Date().toISOString(),
): RunPackage {
  const hash = assumptionsHash(assumptions);
  const facility = output.facility
    ? {
        reserveTarget: output.facility.reserveTarget,
        reserveSource: output.facility.reserveSource,
        scenarioRows: output.facility.scenarioRows,
        ranges: output.facility.ranges,
        primary: output.facility.primary,
        conditionalAnchor: output.facility.conditionalAnchor,
        conditionalAnchorLabel: output.facility.conditionalAnchorLabel,
        portfolioFundedRatio: output.facility.portfolioFundedRatio,
        contributionSampleCount: output.facility.contributionSamples.length,
      }
    : null;
  return {
    packageVersion: 1,
    disclaimer: DISCLAIMER,
    software: { name: APP_NAME, version: APP_VERSION, commit: GIT_COMMIT },
    exportedAt,
    schemaVersion: 2,
    assumptionsHash: hash,
    hashNote: "SHA-256 of the canonical JSON of assumptions. Key order is sorted. The hash does not cover results or the software commit.",
    winsTradingPnlIncluded: false,
    finbertInProjection: false,
    taxesIncluded: false,
    methodology: methodologyFootnote(assumptions, output, hash),
    caseTimeline: CASE_TIMELINE,
    liability: caseLiabilitySchedule(),
    tolerances: TOLERANCE,
    assumptions,
    results: {
      errors: output.errors,
      masterSeed: output.masterSeed,
      streams: output.streams,
      shockModel: output.shockModel,
      correlation: {
        stress: output.correlation.stress,
        repaired: output.correlation.repaired,
        ridged: output.correlation.ridged,
        warning: output.correlation.warning,
        rawMinEigenvalue: output.correlation.rawMinEigenvalue,
        used: output.correlation.used,
      },
      scenarios: output.scenarios,
      monteCarlo: output.monteCarlo,
      reserve: output.reserve,
      facility,
    },
    csv: {
      projections: projectionsCsv(output),
      reserve: reserveCsv(output),
      facility: facilityCsv(output),
      notes: notesCsv(notes),
    },
    researchNotes: notes,
  };
}
