/**
 * One HTML file a person can open and print. Charts are inline SVG with a
 * sentence under each one. The file describes the sample on screen. It does
 * not recommend a portfolio.
 */

import type { Holding } from "./holdings";
import type { Assumptions, ModelOutput } from "./types";
import type { StressRow } from "../bookState";

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1000) return sign + "$" + Math.round(abs / 1000) + "k";
  return sign + "$" + Math.round(abs);
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (value * 100).toFixed(1) + "%";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}

function lineChart(values: number[], label: string): string {
  if (values.length === 0) return "<p>No path.</p>";
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const w = 640;
  const h = 180;
  const coords = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * (w - 20) + 10;
      const y = 10 + ((max - value) / (max - min)) * (h - 20);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(label)}"><polyline fill="none" stroke="#0e5f5a" stroke-width="2" points="${coords}"/></svg>`;
}

export function annotatedHtml(args: {
  assumptions: Assumptions;
  output: ModelOutput;
  holdings: Holding[];
  stresses: StressRow[];
}): string {
  const { assumptions, output, holdings, stresses } = args;
  const metrics = output.metrics;
  const base = output.scenarios.base ?? [];
  const wealth = base.map((point) => point.wealthStart);
  const htm = base.map((point) => point.wealthStartHtm);
  const holdingRows = holdings
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.ticker)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.sleeve)}</td><td>${pct(row.weight)}</td></tr>`,
    )
    .join("");
  const regimeRows = output.reserve.regimeFunding
    .map((row) => {
      const method = row.methods.find((item) => item.method === "pv_curve");
      return `<tr><td>${escapeHtml(row.regime)}</td><td>${(row.short2033 * 100).toFixed(2)}%</td><td>${money(method?.reserve)}</td><td>${method?.minFundedRatio === null || method?.minFundedRatio === undefined ? "—" : method.minFundedRatio.toFixed(2)}</td></tr>`;
    })
    .join("");
  const stressRows = stresses
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td>${pct(row.funded)}</td><td>${money(row.p5)}</td><td>${money(row.gift)}</td></tr>`,
    )
    .join("");
  const assumptionRows = [
    ["Seed", String(assumptions.seed)],
    ["Trials", String(assumptions.trials)],
    ["Rebalance", assumptions.rebalance],
    ["Return model", assumptions.returnModel],
    ["Reserve method", assumptions.reserve.method],
    ["Discount yield", pct(assumptions.reserve.discountYield)],
    ["Rate regime", assumptions.rates.regime],
  ]
    .map((row) => `<tr><td>${row[0]}</td><td>${escapeHtml(row[1])}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Annotated results</title>
<style>
body{font:15px "Segoe UI",sans-serif;margin:28px;color:#1c1915;max-width:880px}
h1,h2{font-family:Georgia,serif}
section{break-inside:avoid;margin:1.2rem 0}
.callout{background:#e5f2f0;border-left:3px solid #0e5f5a;padding:8px 12px}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd4c3;padding:4px 6px;text-align:left}
svg{width:100%;height:auto;background:#fff;border:1px solid #ddd4c3}
</style></head><body>
<h1>Annotated results</h1>
<p class="callout">These figures are the sample under the assumptions in the file. They are not an investment recommendation, and they do not choose a reserve or a facility gift.</p>
<section><h2>Holdings</h2>
<p class="callout">${holdings.length === 0 ? "No holdings were in the editor when this file was written. The charts use the sleeve assumptions." : "Each row is a weight the team typed. Sleeve totals are what the model used if those weights were applied."}</p>
<table><thead><tr><th>Ticker</th><th>Name</th><th>Sleeve</th><th>Weight</th></tr></thead><tbody>${holdingRows || "<tr><td colspan='4'>None</td></tr>"}</tbody></table></section>
<section><h2>Wealth fan</h2>
${lineChart(wealth, "Base wealth path")}
<p class="callout">Base-path beginning-of-year wealth. p5 of the sample at the start of 2033 is ${money(metrics?.wealthPercentiles["5"])}. The median is ${money(metrics?.wealthPercentiles["50"])}. P(funded) is ${pct(metrics?.fullyFundedProbability)}.</p></section>
<section><h2>Funding versus the mix</h2>
<p class="callout">P(fully funded) is the share of trials whose 2033 wealth covers the active reserve. It moves when the mix, the reserve method, or the return assumptions move. It is not a probability from outside this model.</p></section>
<section><h2>Rate-regime matrix</h2>
<table><thead><tr><th>Regime</th><th>Short rate, 2033</th><th>PV reserve</th><th>Min funded ratio</th></tr></thead><tbody>${regimeRows}</tbody></table>
<p class="callout">Each column uses that regime's drift template and sets short-rate volatility to zero. The templates are illustrations.</p></section>
<section><h2>Mark-to-market versus hold-to-maturity</h2>
${lineChart(wealth.map((value, index) => value - (htm[index] ?? value)), "MTM minus HTM")}
<p class="callout">The line is mark-to-market wealth minus hold-to-maturity wealth on the base path. A gap is the price term on bonds. At a zero yield change the gap is the carry difference, which is zero when nothing is priced as a bond. The reserve is a separate stack of dollars and is not subtracted here.</p></section>
<section><h2>Stresses</h2>
<table><thead><tr><th>Stress</th><th>P(funded)</th><th>p5</th><th>Median gift</th></tr></thead><tbody>${stressRows || "<tr><td colspan='4'>Not run</td></tr>"}</tbody></table>
<p class="callout">A stress is an overlay the team chose: a crash in one year, a Taiwan jump, fatter tails, a lower equity premium, or higher volatility.</p></section>
<section><h2>Facility gift and the 2031 range</h2>
<p class="callout">Median gift ${money(metrics?.facilityPercentiles["50"])}. The 2031 conditional range is ${money(metrics?.conditionalLow)} to ${money(metrics?.conditionalHigh)}. A gift is never taken from the reserve. If wealth is below the reserve, the gift is zero.</p></section>
<section><h2>Assumptions</h2>
<table><tbody>${assumptionRows}</tbody></table>
<p class="callout">Case cash flows stay locked: $300,000 at the start of 2027, $150,000 at the start of 2028, and ten $50,000 payments from 2033 through 2042. WInS trading profit is not in this projection.</p></section>
</body></html>`;
}
