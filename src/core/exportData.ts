import { CASE_TIMELINE, DISCLAIMER } from "./case";
import type { Assumptions, ModelOutput, ResearchNote } from "./types";

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value);
  const escaped = /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  if (/^[=+@]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return escaped;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\n") + "\n";
}

export function projectionsCsv(output: ModelOutput): string {
  const header = [
    "scenario",
    "calendar_year",
    "year_index",
    "contribution",
    "wealth_start",
    "real_wealth_start",
    "year_return",
    "policy_weights",
    "actual_weights",
  ];
  const rows: (string | number | null)[][] = [header];
  for (const [name, path] of Object.entries(output.scenarios)) {
    if (!path) continue;
    for (const point of path) {
      rows.push([
        name,
        point.calendarYear,
        point.yearIndex,
        point.contribution,
        point.wealthStart,
        point.realWealthStart,
        point.yearReturn,
        point.policyWeights.map((weight) => weight.toFixed(6)).join("|"),
        point.actualWeights.map((weight) => weight.toFixed(6)).join("|"),
      ]);
    }
  }
  if (output.monteCarlo) {
    for (const year of output.monteCarlo.byYear) {
      for (const [key, value] of Object.entries(year.values)) {
        rows.push([`mc_p${key}`, year.calendarYear, year.calendarYear - 2026, "", value, "", "", "", ""]);
      }
    }
  }
  return toCsv(rows);
}

export function reserveCsv(output: ModelOutput): string {
  const rows: (string | number | null)[][] = [
    ["method", "reserve", "achieved_probability", "macaulay_duration", "modified_duration", "message"],
  ];
  for (const sizing of Object.values(output.reserve.sizings)) {
    rows.push([
      sizing.method,
      sizing.reserve,
      sizing.achievedProbability,
      sizing.macaulayDuration,
      sizing.modifiedDuration,
      sizing.message,
    ]);
  }
  rows.push([]);
  rows.push([
    "calendar_year",
    "boy_assets",
    "payment_due",
    "payment_funded",
    "shortfall",
    "after_payment",
    "reinvestment_return",
    "eoy_assets",
    "undiscounted_liability",
    "pv_liability",
    "funded_ratio",
  ]);
  for (const row of output.reserve.schedule ?? []) {
    rows.push([
      row.calendarYear,
      row.boyAssets,
      row.paymentDue,
      row.paymentFunded,
      row.shortfall,
      row.afterPayment,
      row.reinvestmentReturn,
      row.eoyAssets,
      row.undiscountedLiability,
      row.pvLiability,
      row.fundedRatio,
    ]);
  }
  return toCsv(rows);
}

export function facilityCsv(output: ModelOutput): string {
  const facility = output.facility;
  const rows: (string | number | null)[][] = [
    ["reserve_target", facility?.reserveTarget ?? null],
    ["reserve_source", facility?.reserveSource ?? ""],
  ];
  rows.push([]);
  rows.push(["scenario", "wealth_2031", "wealth_2033", "rule", "contribution", "flexibility", "reserve_gap", "funded"]);
  for (const row of facility?.scenarioRows ?? []) {
    for (const rule of row.byRule) {
      rows.push([
        row.scenario,
        row.wealth2031,
        row.wealth2033,
        rule.ruleName,
        rule.contribution,
        rule.flexibility,
        rule.reserveGap,
        rule.operatingFullyFunded ? "yes" : "no",
      ]);
    }
  }
  rows.push([]);
  rows.push(["range_method", "low", "high", "empirical_coverage", "operating_shortfall_probability", "wording"]);
  for (const range of facility?.ranges ?? []) {
    rows.push([
      range.method,
      range.low,
      range.high,
      range.empiricalCoverage,
      range.operatingShortfallProbability,
      range.wording,
    ]);
  }
  return toCsv(rows);
}

export function notesCsv(notes: ResearchNote[]): string {
  const rows: (string | number | null)[][] = [
    ["created_at", "ticker_or_theme", "source", "model", "label", "positive", "negative", "neutral", "text"],
  ];
  for (const note of notes) {
    rows.push([
      note.createdAt,
      note.tickerOrTheme,
      note.source,
      note.modelName,
      note.label,
      note.scores.positive,
      note.scores.negative,
      note.scores.neutral,
      note.text,
    ]);
  }
  return toCsv(rows);
}

export function workspaceJson(assumptions: Assumptions, output: ModelOutput, notes: ResearchNote[]): string {
  return JSON.stringify(
    {
      disclaimer: DISCLAIMER,
      exportedAt: new Date().toISOString(),
      caseTimeline: CASE_TIMELINE,
      winsTradingPnlIncluded: false,
      taxesIncluded: false,
      assumptions,
      results: {
        errors: output.errors,
        scenarios: output.scenarios,
        monteCarlo: output.monteCarlo
          ? {
              trials: output.monteCarlo.trials,
              seed: output.monteCarlo.seed,
              byYear: output.monteCarlo.byYear,
              wealth2031: output.monteCarlo.wealth2031,
              wealth2033: output.monteCarlo.wealth2033,
            }
          : null,
        reserve: output.reserve,
        facility: output.facility
          ? {
              ...output.facility,
              contributionSamples: undefined,
              contributionSampleCount: output.facility.contributionSamples.length,
            }
          : null,
      },
      researchNotes: notes,
    },
    null,
    2,
  );
}
