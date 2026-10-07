import { DECISION_YEAR } from "./case";
import { newSleeve, zeroAssumptions } from "./defaults";
import { wealthInYear } from "./project";
import { applyRegimeTemplate, RATE_REGIMES } from "./rates";
import { runModel } from "./run";
import { toCsv } from "./exportData";
import type { Assumptions, RateRegime, SleeveKind } from "./types";

/**
 * Stress assumptions carried forward from the composition sweep.
 * They are not forecasts and not a portfolio for the case.
 */
export const SWEEP_STRESS = {
  equityMu: 0.08,
  equitySigma: 0.16,
  equityBear: -0.1,
  equityBase: 0.08,
  equityBull: 0.15,
  riskyMu: 0.18,
  riskySigma: 0.45,
  riskyBear: -0.4,
  riskyBase: 0.12,
  riskyBull: 0.4,
  r0: 0.04,
  note: "Stress assumptions for a mix × regime grid. Not forecasts. Not a holding list.",
};

export interface SweepSpec {
  id: string;
  family: string;
  note: string;
  regime: RateRegime;
  weights2027: number[];
  weights2033: number[];
  /** Sleeve roles aligned with the weights. `risky` stays parametric. `credit` is a priced credit sleeve. */
  roles: ("equity" | "funding" | "risky" | "basket" | "credit")[];
  fundingKind: Extract<SleeveKind, "tbill" | "intermediate" | "long_treasury" | "credit">;
  correlationStress: number;
  equitySigma: number;
  riskySigma: number;
}

export interface SweepRow {
  id: string;
  family: string;
  note: string;
  regime: string;
  fundingKind: string;
  weights2027: string;
  weights2033: string;
  p1: number | null;
  p5: number | null;
  p50: number | null;
  p95: number | null;
  fullyFunded: number | null;
  cvar5: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownP50: number | null;
  standardErrorMean: number | null;
  wealth2033Base: number | null;
  wealth2033Htm: number | null;
  errors: string;
}

function weights(parts: number[]): number[] {
  const total = parts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return parts.map((_, index) => (index === 0 ? 1 : 0));
  return parts.map((value) => value / total);
}

export function buildSweepSpecs(): SweepSpec[] {
  const specs: SweepSpec[] = [];
  let n = 0;
  const id = (family: string) => {
    n += 1;
    return `${family}_${String(n).padStart(3, "0")}`;
  };
  const push = (spec: Omit<SweepSpec, "id" | "correlationStress" | "equitySigma" | "riskySigma"> & Partial<SweepSpec>) => {
    specs.push({
      id: spec.id ?? id(spec.family),
      correlationStress: spec.correlationStress ?? 0,
      equitySigma: spec.equitySigma ?? SWEEP_STRESS.equitySigma,
      riskySigma: spec.riskySigma ?? SWEEP_STRESS.riskySigma,
      family: spec.family,
      note: spec.note,
      regime: spec.regime,
      weights2027: spec.weights2027,
      weights2033: spec.weights2033,
      roles: spec.roles,
      fundingKind: spec.fundingKind,
    });
  };

  for (const regime of RATE_REGIMES) {
    for (const funding of [0, 0.2, 0.4, 0.6, 1]) {
      const pair = weights([1 - funding, funding]);
      push({
        family: "tbill_vs_equity",
        note: `Flat glide. Equity ${(100 * pair[0]).toFixed(0)}%, T-bills ${(100 * pair[1]).toFixed(0)}%. Regime ${regime}. ${SWEEP_STRESS.note}`,
        regime,
        weights2027: pair,
        weights2033: pair,
        roles: ["equity", "funding"],
        fundingKind: "tbill",
      });
    }
  }

  for (const regime of RATE_REGIMES) {
    for (const startFunding of [0, 0.2, 0.4]) {
      const endFunding = Math.min(0.7, startFunding + 0.4);
      push({
        family: "derisk_2033",
        note: `Glide toward more T-bills by 2033. Start funding ${(100 * startFunding).toFixed(0)}%, end ${(100 * endFunding).toFixed(0)}%. Regime ${regime}. ${SWEEP_STRESS.note}`,
        regime,
        weights2027: weights([1 - startFunding, startFunding]),
        weights2033: weights([1 - endFunding, endFunding]),
        roles: ["equity", "funding"],
        fundingKind: "tbill",
      });
    }
  }

  for (const regime of RATE_REGIMES) {
    for (const kind of ["intermediate", "long_treasury"] as const) {
      const pair = weights([0.6, 0.4]);
      push({
        family: "duration_sleeve",
        note: `Equity 60% and ${kind.replace("_", " ")} 40%, flat glide. Regime ${regime}. ${SWEEP_STRESS.note}`,
        regime,
        weights2027: pair,
        weights2033: pair,
        roles: ["equity", "funding"],
        fundingKind: kind,
      });
    }
  }

  for (const regime of RATE_REGIMES) {
    const triple = weights([0.5, 0.3, 0.2]);
    push({
      family: "credit_sleeve",
      note: `Equity 50%, intermediate Treasuries 30%, credit 20%. Credit is not a T-bill. Regime ${regime}. ${SWEEP_STRESS.note}`,
      regime,
      weights2027: triple,
      weights2033: triple,
      roles: ["equity", "funding", "credit"],
      fundingKind: "intermediate",
    });
  }

  for (const regime of ["flat", "rising"] as RateRegime[]) {
    for (const risky of [0, 0.05, 0.1, 0.15, 0.2, 0.25]) {
      const rest = 1 - risky;
      push({
        family: "risky_sleeve",
        note: `Parametric high-vol sleeve ${(100 * risky).toFixed(0)}%. Remainder 70/30 equity and T-bills. Regime ${regime}. ${SWEEP_STRESS.note}`,
        regime,
        weights2027: weights([rest * 0.7, rest * 0.3, risky]),
        weights2033: weights([rest * 0.7, rest * 0.3, risky]),
        roles: ["equity", "funding", "risky"],
        fundingKind: "tbill",
      });
    }
  }

  for (const risky of [0.1, 0.15]) {
    for (const stress of [0, 0.15, 0.3]) {
      const rest = 1 - risky;
      push({
        family: "risky_corr_stress",
        note: `High-vol sleeve ${(100 * risky).toFixed(0)}% with correlation stress ${stress}. Flat regime. ${SWEEP_STRESS.note}`,
        regime: "flat",
        weights2027: weights([rest * 0.7, rest * 0.3, risky]),
        weights2033: weights([rest * 0.7, rest * 0.3, risky]),
        roles: ["equity", "funding", "risky"],
        fundingKind: "tbill",
        correlationStress: stress,
      });
    }
  }

  for (const regime of RATE_REGIMES) {
    const triple = weights([0.7, 0.2, 0.1]);
    push({
      family: "satellite_basket",
      note: `Equity 70%, T-bills 20%, satellite basket 10%. Basket parameters are placeholders. Regime ${regime}. ${SWEEP_STRESS.note}`,
      regime,
      weights2027: triple,
      weights2033: triple,
      roles: ["equity", "funding", "basket"],
      fundingKind: "tbill",
    });
  }

  return specs;
}

function correlationFor(count: number, stress: number): number[][] {
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => {
      if (row === col) return 1;
      const base = row < 2 && col < 2 ? 0.1 : 0.2;
      return Math.max(-0.999, Math.min(0.999, base + stress));
    }),
  );
}

export function assumptionsForSweep(spec: SweepSpec, trials: number, seed: number): Assumptions {
  const assumptions = zeroAssumptions();
  const templated = applyRegimeTemplate(assumptions.rates, assumptions.equity, spec.regime);
  assumptions.tag = "edited";
  assumptions.certaintyNote = SWEEP_STRESS.note;
  assumptions.trials = trials;
  assumptions.seed = seed;
  assumptions.rates = {
    ...templated.rates,
    r0: SWEEP_STRESS.r0,
    kappa: 0.2,
    theta: 0.035,
    sigma: 0.007,
    intermediatePremium: 0.007,
    longPremium: 0.014,
    slope: 0,
  };
  assumptions.equity = {
    ...templated.equity,
    studentDf: 5,
    marketMu: SWEEP_STRESS.equityMu,
    marketSigma: spec.equitySigma,
    sectorSigma: 0.05,
  };
  assumptions.correlationStress = spec.correlationStress;
  assumptions.reserve.method = "ladder";
  assumptions.reserve.discountYield = SWEEP_STRESS.r0;
  assumptions.facility.rangeMethod = "mc_percentile";
  assumptions.facility.rangeLowPercentile = 0.1;
  assumptions.facility.rangeHighPercentile = 0.9;

  const sleeves = spec.roles.map((role, index) => {
    if (role === "equity") {
      return {
        ...newSleeve("equity", "Broad equity (stress assumption)", SWEEP_STRESS.equityMu, spec.equitySigma, SWEEP_STRESS.equityBase, SWEEP_STRESS.equityBull, SWEEP_STRESS.equityBear),
        kind: "equity_index" as const,
        studentDf: 5,
      };
    }
    if (role === "funding") {
      const named =
        spec.fundingKind === "tbill"
          ? "T-bills (priced)"
          : spec.fundingKind === "intermediate"
            ? "Intermediate Treasuries (priced)"
            : spec.fundingKind === "long_treasury"
              ? "Long Treasuries (priced)"
              : "Credit (priced, not a T-bill)";
      const duration = spec.fundingKind === "tbill" ? 0.4 : spec.fundingKind === "intermediate" ? 5 : spec.fundingKind === "long_treasury" ? 16 : 6;
      const convexity = spec.fundingKind === "tbill" ? 0.15 : spec.fundingKind === "intermediate" ? 30 : spec.fundingKind === "long_treasury" ? 280 : 40;
      return {
        ...newSleeve(`funding-${index}`, named),
        kind: spec.fundingKind,
        duration,
        convexity,
        spread: spec.fundingKind === "credit" ? 0.012 : 0,
        defaultProb: spec.fundingKind === "credit" ? 0.004 : 0,
        recovery: spec.fundingKind === "credit" ? 0.4 : 1,
        spreadBeta: spec.fundingKind === "credit" ? 0.8 : 0,
      };
    }
    if (role === "basket") {
      return { ...newSleeve("basket", "Satellite basket (placeholder parameters)"), kind: "basket" as const };
    }
    if (role === "credit") {
      return {
        ...newSleeve(`credit-${index}`, "Credit (priced, not a T-bill)"),
        kind: "credit" as const,
        duration: 6,
        convexity: 40,
        spread: 0.012,
        defaultProb: 0.004,
        recovery: 0.4,
        spreadBeta: 0.8,
        issuer: "Placeholder issuer",
      };
    }
    return {
      ...newSleeve("risky", "High-vol sleeve (stress assumption)", SWEEP_STRESS.riskyMu, spec.riskySigma, SWEEP_STRESS.riskyBase, SWEEP_STRESS.riskyBull, SWEEP_STRESS.riskyBear),
      kind: "parametric" as const,
    };
  });

  assumptions.sleeves = sleeves;
  assumptions.glide = [
    { year: 2027, weights: spec.weights2027 },
    { year: 2033, weights: spec.weights2033 },
  ];
  assumptions.correlation = correlationFor(sleeves.length, 0);
  if (spec.roles.includes("basket")) {
    const tickers = new Set(["TSM", "EWT", "AAPL", "XLU"]);
    assumptions.basket = assumptions.basket.map((name) =>
      tickers.has(name.ticker) ? { ...name, weight: 1 } : { ...name, weight: 0 },
    );
  }
  return assumptions;
}

export function runSweepSpec(spec: SweepSpec, trials: number, seed: number): SweepRow {
  const assumptions = assumptionsForSweep(spec, trials, seed);
  const output = runModel(assumptions);
  const base = output.scenarios.base;
  const wealth = output.metrics?.wealthPercentiles ?? {};
  const drawdown = output.metrics?.maxDrawdownPercentiles ?? {};
  const htm = base?.find((point) => point.calendarYear === DECISION_YEAR)?.wealthStartHtm ?? null;
  return {
    id: spec.id,
    family: spec.family,
    note: spec.note,
    regime: spec.regime,
    fundingKind: spec.fundingKind,
    weights2027: spec.weights2027.map((value) => value.toFixed(4)).join("|"),
    weights2033: spec.weights2033.map((value) => value.toFixed(4)).join("|"),
    p1: wealth["1"] ?? null,
    p5: wealth["5"] ?? null,
    p50: wealth["50"] ?? null,
    p95: wealth["95"] ?? null,
    fullyFunded: output.metrics?.fullyFundedProbability ?? null,
    cvar5: output.metrics?.cvar5 ?? null,
    sharpe: output.metrics?.sharpe ?? null,
    sortino: output.metrics?.sortino ?? null,
    maxDrawdownP50: drawdown["50"] ?? null,
    standardErrorMean: output.metrics?.convergence.standardErrorMean ?? null,
    wealth2033Base: base ? wealthInYear(base, DECISION_YEAR) : null,
    wealth2033Htm: htm,
    errors: output.errors.join("; "),
  };
}

export function runSweep(specs: SweepSpec[], trials: number, seed: number): SweepRow[] {
  return specs.map((spec) => runSweepSpec(spec, trials, seed));
}

export function sweepCsv(rows: SweepRow[]): string {
  const header = [
    "id",
    "family",
    "note",
    "regime",
    "funding_kind",
    "weights_2027",
    "weights_2033",
    "p1",
    "p5",
    "p50",
    "p95",
    "fully_funded",
    "cvar5",
    "sharpe",
    "sortino",
    "max_drawdown_p50",
    "standard_error_mean",
    "wealth_2033_base_mtm",
    "wealth_2033_base_htm",
    "errors",
  ];
  const body = rows.map((row) => [
    row.id,
    row.family,
    row.note,
    row.regime,
    row.fundingKind,
    row.weights2027,
    row.weights2033,
    row.p1,
    row.p5,
    row.p50,
    row.p95,
    row.fullyFunded,
    row.cvar5,
    row.sharpe,
    row.sortino,
    row.maxDrawdownP50,
    row.standardErrorMean,
    row.wealth2033Base,
    row.wealth2033Htm,
    row.errors,
  ]);
  return toCsv([header, ...body]);
}

export function sweepDocument(rows: SweepRow[], trials: number, seed: number) {
  return {
    disclaimer:
      "Exploratory mix × rate-regime grid for the Laura Gao case. Stress assumptions, not forecasts. Not an investment recommendation, not a reserve, and not a facility contribution.",
    commonRandomNumbers: true,
    seed,
    trials,
    regimes: RATE_REGIMES,
    note: SWEEP_STRESS.note,
    rows,
  };
}
