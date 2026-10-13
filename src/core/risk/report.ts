/** Text and JSON risk report. The example book is an illustration, not a recommendation. */

import type { PairedComparison } from "./compare";
import type { RiskReport } from "./assemble";

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function reportMarkdown(report: RiskReport, comparison: PairedComparison | null): string {
  const lines: string[] = [];
  lines.push("# Risk report");
  lines.push("");
  lines.push(report.note);
  lines.push("");
  lines.push(`As of ${report.asOf || "—"}. Market column: ${report.market || "none"}.`);
  lines.push("");
  lines.push("## Names");
  lines.push("");
  lines.push("| Ticker | 1y daily vol | Monthly vol | EWMA | Horizon | Measured beta (1-yr daily) | SE | Vasicek (not measured) | Jumps | df | Flags |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const card of report.names) {
    const measured = card.beta?.oneYear;
    lines.push(
      `| ${card.ticker} | ${pct(card.vol.realized1y)} | ${pct(card.vol.realizedMonthly)} | ${pct(card.vol.ewma)} | ${pct(card.vol.horizon)} | ${num(measured?.beta)} (${measured?.window ?? "1-yr daily"}) | ${num(measured?.se)} | ${num(card.beta?.vasicek.beta)} | ${card.jumps.source}${card.jumps.fallbackClass ? ` (${card.jumps.fallbackClass})` : ""} | ${card.tails.df} | ${card.flags.join(", ") || "—"} |`,
    );
  }
  lines.push("");
  lines.push("A Vasicek number and a Blume number are not measured betas. The measured column is the OLS or Dimson slope.");
  lines.push("");
  if (report.book) {
    lines.push("## Book");
    lines.push("");
    lines.push(
      `Ex-ante vol ${pct(report.book.vol)}. Measured beta ${num(report.book.betaRaw)}${report.book.betaWindow ? ` (${report.book.betaWindow})` : ""}. Shrunk beta ${num(report.book.betaShrunk)} (not measured).`,
    );
    lines.push(`Factor share ${pct(report.book.factorShare)}, idiosyncratic share ${pct(report.book.idioShare)}, jump share ${pct(report.book.jumpShare)}.`);
    lines.push(`Worst historical gap stress: ${report.book.worstTicker || "—"} ${pct(report.book.worstStress)}.`);
    lines.push("");
    lines.push("| Ticker | Weight | Component | Share | Stress |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of report.book.components) {
      lines.push(`| ${row.ticker} | ${pct(row.weight)} | ${pct(row.component)} | ${pct(row.percent)} | ${pct(row.stress)} |`);
    }
    lines.push("");
    lines.push(report.book.note);
    lines.push("");
  }
  lines.push("## Coverage");
  lines.push("");
  for (const row of report.coverage) {
    if (!row.next || !row.old) {
      lines.push(`- ${row.ticker}: ${row.note}`);
      continue;
    }
    lines.push(
      `- ${row.ticker}: winner ${row.winner}. New 95% hit rate ${pct(row.next.var95.hitRate)} (Kupiec p ${num(row.next.var95.pValue)}). Old 95% hit rate ${pct(row.old.var95.hitRate)} (Kupiec p ${num(row.old.var95.pValue)}).`,
    );
  }
  lines.push("");
  if (comparison) {
    lines.push("## Old versus new on the case model");
    lines.push("");
    lines.push(comparison.note);
    lines.push("");
    lines.push(`Locked cash flows: ${comparison.cash2027} in 2027, ${comparison.cash2028} in 2028, payment ${comparison.payment}.`);
    lines.push("");
    lines.push("| Method | P(funded) | p5 wealth | p50 wealth | gift p5 | gift p50 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const side of [comparison.old, comparison.next]) {
      lines.push(`| ${side.label} | ${num(side.funded, 3)} | ${num(side.p5, 0)} | ${num(side.p50, 0)} | ${num(side.giftP5, 0)} | ${num(side.giftP50, 0)} |`);
    }
    lines.push("");
    lines.push(
      `Paired difference (new − old): P(funded) ${num(comparison.paired.fundedDiff, 3)} (SE ${num(comparison.paired.fundedSe, 3)}), mean 2033 wealth ${num(comparison.paired.wealthDiff, 0)} (SE ${num(comparison.paired.wealthSe, 0)}). The table above is the two sample levels. The paired difference is the comparison.`,
    );
    lines.push("");
  }
  lines.push("Covariance shrinkage " + num(report.factors.shrinkage, 3) + ". PSD " + (report.factors.psd ? "yes" : "no") + ".");
  lines.push("");
  return lines.join("\n");
}

export function reportJson(report: RiskReport, comparison: PairedComparison | null): unknown {
  return {
    asOf: report.asOf,
    note: report.note,
    market: report.market,
    flags: report.flags,
    names: report.names.map((card) => ({
      ticker: card.ticker,
      quality: card.quality,
      vol: card.vol,
      citation: card.beta?.citation ?? "",
      measuredBeta: card.beta?.oneYear ?? null,
      vasicek: card.beta?.vasicek ?? null,
      blume: card.beta?.blume ?? null,
      jumps: card.jumps,
      tails: card.tails,
      fund: card.fund,
      modelVol: card.modelVol,
      recentVol: card.recentVol,
      flags: card.flags,
    })),
    book: report.book,
    coverage: report.coverage,
    factors: {
      names: report.factors.names,
      factors: report.factors.factors,
      shrinkage: report.factors.shrinkage,
      psd: report.factors.psd,
      repaired: report.factors.repaired,
      correlation: report.factors.correlation,
    },
    comparison,
  };
}
