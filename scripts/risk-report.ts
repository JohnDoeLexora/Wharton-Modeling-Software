/**
 * Risk report for a price file and a holdings book.
 * Defaults are the synthetic example under examples/. That book is not a portfolio.
 *
 *   npm run risk-report
 *   npm run risk-report -- examples/daily-prices-sample.csv examples/risk-book.csv 200
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { teachingAssumptions } from "../src/core/defaults.ts";
import { estimateFromCsv } from "../src/core/risk/assemble.ts";
import { compareMethods } from "../src/core/risk/compare.ts";
import { bookFromCsv } from "../src/core/risk/fixture.ts";
import { reportJson, reportMarkdown } from "../src/core/risk/report.ts";

const pricesPath = process.argv[2] ?? "examples/daily-prices-sample.csv";
const bookPath = process.argv[3] ?? "examples/risk-book.csv";
const trials = Number(process.argv[4] ?? 200);

const report = estimateFromCsv(readFileSync(pricesPath, "utf8"), bookFromCsv(readFileSync(bookPath, "utf8")));
const comparison = compareMethods(report, trials, 42, teachingAssumptions());
const markdown = reportMarkdown(report, comparison);
mkdirSync("out", { recursive: true });
writeFileSync(resolve("out/risk-report.md"), markdown);
writeFileSync(resolve("out/risk-report.json"), JSON.stringify(reportJson(report, comparison), null, 2));
process.stdout.write(markdown);
const gap = report.names.find((card) => card.ticker === "GAP");
if (gap?.vol.disagreement) {
  process.stdout.write(`\nGAP estimators disagree. Ratio ${gap.vol.ratio.toFixed(2)}.\n`);
}
process.stdout.write("\nWrote out/risk-report.md and out/risk-report.json.\n");
