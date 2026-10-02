import { percentileKey } from "../core/math";
import type { ScenarioName } from "../core/types";
import { useStore } from "../state";
import { DisclaimerLine, Issues, TagPill } from "./bits";
import { LineChart } from "./Chart";
import { pct, usd } from "./format";
import { SensitivityCard } from "./SensitivityCard";

const SCENARIO_COLOR: Record<ScenarioName, string> = {
  bear: "#8d2b2b",
  base: "#0e5f5a",
  bull: "#1f6b3a",
};

export function ProjectionsPanel() {
  const { assumptions, output } = useStore();
  const base = output.scenarios.base;
  const years = base?.map((point) => point.calendarYear) ?? [];

  const bands = output.monteCarlo && years.length ? fanBands(output.monteCarlo.byYear, assumptions.percentiles) : [];

  const series = (["bear", "base", "bull"] as ScenarioName[])
    .filter((name) => output.scenarios[name])
    .map((name) => ({
      name: `${name} path`,
      color: SCENARIO_COLOR[name],
      values: output.scenarios[name]!.map((point) => point.wealthStart),
      dash: name === "base" ? undefined : "5 4",
    }));

  if (output.monteCarlo) {
    const mid = midpointKey(assumptions.percentiles);
    series.push({
      name: `Sample p${mid}`,
      color: "#1e3348",
      values: output.monteCarlo.byYear.map((row) => row.values[mid] ?? Number.NaN),
      dash: undefined,
    });
  }

  return (
    <div className="stack">
      <header className="panel-head">
        <div>
          <h2>Projections</h2>
          <TagPill />
        </div>
        <p className="lede">
          Beginning-of-year wealth for the undivided portfolio. The 2033 reserve and the facility contribution are
          not taken out of these lines. Those choices are illustrated on their own tabs. WInS trading results are not included.
        </p>
      </header>
      <Issues />
      {assumptions.tag === "zero-default" && base ? (
        <p className="callout">
          At a 0% return, beginning-of-2033 wealth is {usd(base.find((point) => point.calendarYear === 2033)?.wealthStart)}.
          That is the $300,000 contribution plus the $150,000 contribution. The ten operating payments sum to $500,000
          before any discounting, so this starting point has no residual for a facility gift.
        </p>
      ) : null}
      {assumptions.tag === "teaching-example" ? (
        <p className="callout warn">
          Teaching numbers are loaded. They are round arithmetic so the charts move. Do not paste them into a Trading Note, the IPS, or the Final Report.
        </p>
      ) : null}
      {base ? (
        <>
          <LineChart
            years={years}
            series={series}
            bands={bands}
            markers={[2031, 2033]}
            ariaLabel="Projected beginning-of-year portfolio wealth from 2027 to 2042"
            downloadName="gao-wealth-fan"
          />
          <p className="formula">
            {output.monteCarlo?.formula ?? "Monte Carlo did not run."} Percentiles are {assumptions.percentiles.map((p) => `p${percentileKey(p)}`).join(", ")}, Hyndman–Fan type 7.
          </p>
          <p className="muted">
            Vertical lines mark 2031, when a range would be communicated, and 2033, when the reserve is set aside.
            Each shaded fan pairs a low percentile with the matching high percentile. A percentile is a rank inside this seeded sample, not a forecast.
          </p>
          <div className="table-wrap">
            <table>
              <caption>Beginning-of-year wealth. Returns in the last column are earned during the base year, after that row’s wealth is observed.</caption>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Y</th>
                  <th>Contribution</th>
                  <th>Bear</th>
                  <th>Base</th>
                  <th>Bull</th>
                  {assumptions.percentiles.map((p) => (
                    <th key={p}>p{percentileKey(p)}</th>
                  ))}
                  <th>Base, real</th>
                  <th>Base return during year</th>
                </tr>
              </thead>
              <tbody>
                {base.map((point) => (
                  <tr key={point.calendarYear} className={point.calendarYear === 2031 || point.calendarYear === 2033 ? "mark" : ""}>
                    <td>{point.calendarYear}</td>
                    <td className="num">{point.yearIndex}</td>
                    <td className="num">{point.contribution ? usd(point.contribution) : "—"}</td>
                    <td className="num">{usd(output.scenarios.bear?.find((row) => row.calendarYear === point.calendarYear)?.wealthStart)}</td>
                    <td className="num">{usd(point.wealthStart)}</td>
                    <td className="num">{usd(output.scenarios.bull?.find((row) => row.calendarYear === point.calendarYear)?.wealthStart)}</td>
                    {assumptions.percentiles.map((p) => (
                      <td key={p} className="num">
                        {usd(output.monteCarlo?.byYear.find((row) => row.calendarYear === point.calendarYear)?.values[percentileKey(p)])}
                      </td>
                    ))}
                    <td className="num">{usd(point.realWealthStart)}</td>
                    <td className="num">{point.yearReturn === null ? "—" : pct(point.yearReturn, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Real wealth is in beginning-of-2026 dollars: nominal / (1+inflation)^(year−2026).
            Return model: {assumptions.returnModel}. Shock model: {assumptions.shockModel}. Rebalance: {assumptions.rebalance === "annual" ? "annual to the glide path" : "drift"}.
            Master seed {output.masterSeed}, stream 1, {output.monteCarlo?.trials.toLocaleString("en-US")} draws.
          </p>
        </>
      ) : null}
      <SensitivityCard />
      <DisclaimerLine />
    </div>
  );
}

function fanBands(
  byYear: { values: Record<string, number> }[],
  requested: number[],
): { low: number[]; high: number[]; color: string; name: string }[] {
  const sorted = [...requested].sort((a, b) => a - b);
  const colors = ["rgba(30, 51, 72, 0.10)", "rgba(30, 51, 72, 0.18)", "rgba(30, 51, 72, 0.28)"];
  const bands = [];
  for (let index = 0; index < Math.floor(sorted.length / 2); index++) {
    const low = sorted[index];
    const high = sorted[sorted.length - 1 - index];
    bands.push({
      low: byYear.map((row) => row.values[percentileKey(low)] ?? Number.NaN),
      high: byYear.map((row) => row.values[percentileKey(high)] ?? Number.NaN),
      color: colors[Math.min(index, colors.length - 1)],
      name: `p${percentileKey(low)}–p${percentileKey(high)}`,
    });
  }
  return bands;
}

function midpointKey(percentiles: number[]): string {
  const keys = percentiles.map(percentileKey);
  return keys.reduce((best, key) => (Math.abs(Number(key) - 50) < Math.abs(Number(best) - 50) ? key : best));
}
