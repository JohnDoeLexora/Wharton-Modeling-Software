/**
 * One HTML tear sheet for a book or a holding. The title prefix is chosen at export.
 * MODEL_SPEC §13. The sheet describes a run. It does not recommend a portfolio.
 */
import type { Citation } from "./verifyStats";
import { citationTable } from "./verifyStats";

export type Audience = "INTERNAL" | "EXTERNAL";

export interface TearHolding {
  name: string;
  weight: number;
  kind: string;
}

export interface TearSheetInput {
  audience: Audience;
  title: string;
  asOf: string;
  holdings: TearHolding[];
  riskLines: string[];
  citations: Citation[];
  scenarios: { label: string; note: string }[];
  reservePv: number | null;
  giftP5: number | null;
  giftP50: number | null;
  giftP95: number | null;
  methodology: string[];
}

export function tearSheetHtml(input: TearSheetInput): string {
  const prefix = input.audience === "INTERNAL" ? "INTERNAL - " : "EXTERNAL - ";
  const title = `${prefix}${input.title}`;
  const holdings = input.holdings
    .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.kind)}</td><td>${(row.weight * 100).toFixed(1)}%</td></tr>`)
    .join("");
  const risks = input.riskLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const scenarios = input.scenarios.map((row) => `<li><strong>${escapeHtml(row.label)}.</strong> ${escapeHtml(row.note)}</li>`).join("");
  const notes = input.methodology.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const citations = input.citations.length > 0 ? markdownTable(citationTable(input.citations)) : "<p>No cited statistics on this sheet.</p>";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Georgia, serif; color: #1c1915; margin: 2rem; }
  h1 { font-size: 1.6rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border-bottom: 1px solid #ddd4c3; text-align: left; padding: 0.3rem; }
  .banner { background: #f8efd8; padding: 0.6rem 0.8rem; }
  @media print { body { margin: 0.6in; } }
</style>
</head>
<body>
<p class="banner">Exploratory output under the assumptions in this run. Not an investment recommendation.</p>
<h1>${escapeHtml(title)}</h1>
<p>As of ${escapeHtml(input.asOf)}. Audience ${input.audience}.</p>
<h2>Holdings</h2>
<table><thead><tr><th>Name</th><th>Kind</th><th>Weight</th></tr></thead><tbody>${holdings}</tbody></table>
<h2>Risk decomposition</h2>
<ul>${risks}</ul>
<h2>Statistic verification</h2>
${citations}
<h2>Scenarios</h2>
<ul>${scenarios}</ul>
<h2>Reserve and gift</h2>
<p>Liability present value ${money(input.reservePv)}. Gift fan p5 ${money(input.giftP5)}, p50 ${money(input.giftP50)}, p95 ${money(input.giftP95)}.</p>
<h2>Methodology</h2>
<ul>${notes}</ul>
</body>
</html>`;
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markdownTable(markdown: string): string {
  const lines = markdown.split("\n").filter((line) => line.startsWith("|"));
  const rows = lines.filter((line) => !line.includes("---"));
  const body = rows
    .map((line, index) => {
      const cells = line.split("|").slice(1, -1).map((cell) => `<${index === 0 ? "th" : "td"}>${escapeHtml(cell.trim())}</${index === 0 ? "th" : "td"}>`);
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return `<table>${body}</table>`;
}
