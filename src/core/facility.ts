import { money, percentText, percentile } from "./math";
import type { CandidateRule, RangeCard, RangeMethod, RuleApplication, ScenarioName } from "./types";

/**
 * Facility dollars are taken only from wealth left after the operating reserve.
 * If wealth is below the reserve, the contribution is zero and the gap is reported.
 */
export function applyRule(wealth: number, reserveTarget: number, rule: CandidateRule): RuleApplication {
  const target = Number.isFinite(reserveTarget) ? Math.max(0, reserveTarget) : Number.POSITIVE_INFINITY;
  const safeWealth = Number.isFinite(wealth) ? wealth : 0;
  const reserveFunded = Math.max(0, Math.min(target, safeWealth));
  const reserveGap = Math.max(0, target - safeWealth);
  const residual = Math.max(0, safeWealth - target);
  let contribution = 0;
  if (Number.isFinite(target)) {
    if (rule.kind === "retain_fraction") {
      const retain = clamp01(rule.retainFraction);
      contribution = residual * (1 - retain);
    } else if (rule.kind === "keep_dollars") {
      contribution = Math.max(0, residual - Math.max(0, rule.keepDollars));
    } else {
      contribution = Math.min(residual, Math.max(0, rule.capDollars));
    }
  }
  const flexibility = residual - contribution;
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    kind: rule.kind,
    wealth: safeWealth,
    reserveTarget: target,
    reserveFunded,
    reserveGap,
    residual,
    contribution,
    flexibility,
    operatingFullyFunded: reserveGap <= 1e-4,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scenarioEnvelope(args: {
  contributions: { scenario: ScenarioName; contribution: number; funded: boolean }[];
  reserveTarget: number;
  ruleName: string;
}): RangeCard {
  const included = args.contributions;
  if (included.length === 0) {
    return {
      method: "scenario_envelope",
      title: "Scenario envelope",
      low: null,
      high: null,
      empiricalCoverage: null,
      operatingShortfallProbability: null,
      wording: "No scenarios are selected, so there is no envelope to show.",
      detail: "Choose at least one of bear, base, and bull.",
    };
  }
  const amounts = included.map((row) => row.contribution);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const funded = included.filter((row) => row.funded).length;
  const shortfall = (included.length - funded) / included.length;
  const names = included.map((row) => row.scenario).join(", ");
  return {
    method: "scenario_envelope",
    title: "Scenario envelope",
    low,
    high,
    empiricalCoverage: null,
    operatingShortfallProbability: shortfall,
    detail: `Lowest and highest contribution across: ${names}.`,
    wording: [
      "Exploratory communication range under the scenario-envelope method.",
      `After an operating reserve of ${money(args.reserveTarget)}, the rule "${args.ruleName}" produces a facility contribution between ${money(low)} and ${money(high)} across these scenarios: ${names}.`,
      "The span covers only the scenarios you included. It is not a probability, and it is not a promise to co-sponsors.",
      `Under these assumptions the operating reserve is fully funded in ${funded} of ${included.length} included scenarios.`,
      "Facility dollars are calculated only from wealth left after the reserve. A scenario that cannot fund the reserve shows a facility contribution of zero.",
    ].join(" "),
  };
}

export function percentileBand(args: {
  method: Extract<RangeMethod, "mc_percentile" | "conditional_mc">;
  contributions: number[];
  fundedFlags: boolean[];
  lowPercentile: number;
  highPercentile: number;
  reserveTarget: number;
  ruleName: string;
  context: string;
}): RangeCard {
  const title = args.method === "mc_percentile" ? "Full-horizon percentile band" : "Conditional two-year band";
  if (args.contributions.length === 0) {
    return {
      method: args.method,
      title,
      low: null,
      high: null,
      empiricalCoverage: null,
      operatingShortfallProbability: null,
      wording: "No simulated contributions are available for this band.",
      detail: args.context,
    };
  }
  const low = percentile(args.contributions, args.lowPercentile);
  const high = percentile(args.contributions, args.highPercentile);
  const coverLo = Math.min(low, high);
  const coverHi = Math.max(low, high);
  const inside = args.contributions.filter((value) => value >= coverLo - 1e-6 && value <= coverHi + 1e-6).length;
  const coverage = inside / args.contributions.length;
  const shortfall =
    args.fundedFlags.filter((funded) => !funded).length / Math.max(1, args.fundedFlags.length);
  return {
    method: args.method,
    title,
    low,
    high,
    empiricalCoverage: coverage,
    operatingShortfallProbability: shortfall,
    detail: args.context,
    wording: [
      `Exploratory communication range under the ${title.toLowerCase()}.`,
      args.context,
      `After an operating reserve of ${money(args.reserveTarget)}, the rule "${args.ruleName}" has a simulated contribution band from the ${percentText(args.lowPercentile, 1)} point (${money(low)}) to the ${percentText(args.highPercentile, 1)} point (${money(high)}).`,
      `In this seeded sample, ${percentText(coverage, 1)} of the contributions fell inside that band. That share is a count of these draws. It is not a forecast and it is not a promise that the 2033 gift will land there.`,
      `The share of draws in which beginning-of-2033 wealth does not cover the reserve is ${percentText(shortfall, 1)}.`,
      "Facility dollars are calculated only from wealth left after the reserve. Draws that miss the reserve contribute zero to the facility.",
    ].join(" "),
  };
}

export function contributionsOf(wealth: number[], reserve: number, rule: CandidateRule): {
  contributions: number[];
  fundedFlags: boolean[];
} {
  const contributions: number[] = [];
  const fundedFlags: boolean[] = [];
  for (const value of wealth) {
    const applied = applyRule(value, reserve, rule);
    contributions.push(applied.contribution);
    fundedFlags.push(applied.operatingFullyFunded);
  }
  return { contributions, fundedFlags };
}
