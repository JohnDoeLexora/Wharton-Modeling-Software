/**
 * Named stresses. Each one is an assumption overlay, not a forecast.
 * A crash is an additive simple return on non-bond sleeves in one year.
 * The sizes below are the form defaults. The panel lets the team edit them.
 */

import { isBondKind } from "./bonds";
import type { Assumptions, Sleeve } from "./types";

export interface StressSpec {
  id: string;
  label: string;
  /** Where the default comes from. Shown as a tooltip. */
  source: string;
  crashYear: number | null;
  crashShock: number;
  taiwanJump: number;
  studentDf: number | null;
  equityDrag: number;
  volMultiple: number;
}

export const STRESS_PRESETS: StressSpec[] = [
  {
    id: "crash",
    label: "Crash in a chosen year",
    source: "Team input. The default −35% is an illustration of a single bad year, not a historical estimate.",
    crashYear: 2028,
    crashShock: -0.35,
    taiwanJump: 0,
    studentDf: null,
    equityDrag: 0,
    volMultiple: 1,
  },
  {
    id: "taiwan",
    label: "Taiwan shock",
    source: "Team input. Applied to basket rows flagged taiwan. −25% is an illustration, not a scenario from the case.",
    crashYear: null,
    crashShock: 0,
    taiwanJump: -0.25,
    studentDf: null,
    equityDrag: 0,
    volMultiple: 1,
  },
  {
    id: "tails",
    label: "Fatter tails",
    source: "Student-t degrees of freedom. 3 is fatter than the workspace default of about 5. It is a dial, not a fitted value.",
    crashYear: null,
    crashShock: 0,
    taiwanJump: 0,
    studentDf: 3,
    equityDrag: 0,
    volMultiple: 1,
  },
  {
    id: "erp",
    label: "Lower equity premium",
    source: "Subtracts 3 percentage points from equity μ and from the basket market μ. The 3 points are a team stress, not a forecast.",
    crashYear: null,
    crashShock: 0,
    taiwanJump: 0,
    studentDf: null,
    equityDrag: -0.03,
    volMultiple: 1,
  },
  {
    id: "vol",
    label: "Volatility up",
    source: "Multiplies sleeve σ, market σ, and idiosyncratic σ by 1.5. The multiple is a team stress.",
    crashYear: null,
    crashShock: 0,
    taiwanJump: 0,
    studentDf: null,
    equityDrag: 0,
    volMultiple: 1.5,
  },
];

function scaleSleeve(sleeve: Sleeve, spec: StressSpec): Sleeve {
  const next = { ...sleeve };
  if (spec.volMultiple !== 1) next.sigma = sleeve.sigma * spec.volMultiple;
  if (spec.equityDrag !== 0 && !isBondKind(sleeve.kind) && sleeve.kind !== "tbill") {
    next.mu = sleeve.mu + spec.equityDrag;
    next.base = sleeve.base + spec.equityDrag;
    next.bull = sleeve.bull + spec.equityDrag;
    next.bear = sleeve.bear + spec.equityDrag;
  }
  if (spec.studentDf !== null && sleeve.kind === "equity_index") next.studentDf = spec.studentDf;
  return next;
}

export function applyStress(assumptions: Assumptions, spec: StressSpec): Assumptions {
  return {
    ...assumptions,
    mixes: [],
    crashYear: spec.crashYear,
    crashShock: spec.crashShock,
    sleeves: assumptions.sleeves.map((sleeve) => scaleSleeve(sleeve, spec)),
    equity: {
      ...assumptions.equity,
      marketMu: assumptions.equity.marketMu + spec.equityDrag,
      marketSigma: assumptions.equity.marketSigma * spec.volMultiple,
      studentDf: spec.studentDf ?? assumptions.equity.studentDf,
    },
    basket: assumptions.basket.map((name) => ({
      ...name,
      idioSigma: name.idioSigma * spec.volMultiple,
      studentDf: spec.studentDf ?? name.studentDf,
      geoJumpProb: spec.taiwanJump !== 0 && name.taiwan ? 1 : name.geoJumpProb,
      geoJumpMean: spec.taiwanJump !== 0 && name.taiwan ? spec.taiwanJump : name.geoJumpMean,
    })),
  };
}
