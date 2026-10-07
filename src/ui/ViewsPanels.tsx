import { useStore } from "../state";
import { LineChart } from "./Chart";
import { pct, usd } from "./format";

export function MetricsStrip() {
  const { output } = useStore();
  const metrics = output.metrics;
  if (!metrics) {
    return (
      <section className="card">
        <h3>Sample metrics</h3>
        <p className="muted">The sample did not run, so percentiles, funded probability, and ratios are blank.</p>
      </section>
    );
  }
  const p1 = metrics.wealthPercentiles["1"];
  const cards: { label: string; value: string; hint: string }[] = [
    { label: "p1 wealth, 2033", value: usd(p1), hint: "First percentile of beginning-of-2033 wealth in this sample." },
    {
      label: "P(fully funded)",
      value: pct(metrics.fullyFundedProbability, 1),
      hint: "Share of trials with 2033 wealth at least the reserve target.",
    },
    { label: "CVaR 5%", value: usd(metrics.cvar5), hint: "Mean of the worst 5% of 2033 wealth figures." },
    { label: "Mean max drawdown", value: pct(metrics.meanMaxDrawdown, 1), hint: "Average peak-to-trough drop of beginning-of-year wealth." },
    { label: "Sharpe", value: metrics.sharpe === null ? "—" : metrics.sharpe.toFixed(2), hint: "Mean excess over the cash yield, divided by the sample standard deviation." },
    { label: "Sortino", value: metrics.sortino === null ? "—" : metrics.sortino.toFixed(2), hint: "Mean excess divided by downside deviation." },
    {
      label: "SE of the mean",
      value: usd(metrics.convergence.standardErrorMean),
      hint: `${metrics.convergence.trials.toLocaleString("en-US")} trials. ${metrics.convergence.note}`,
    },
    {
      label: "2031 conditional band",
      value:
        metrics.conditionalLow === null || metrics.conditionalHigh === null
          ? "—"
          : `${usd(metrics.conditionalLow)} – ${usd(metrics.conditionalHigh)}`,
      hint: `Coverage in this sample: ${pct(metrics.conditionalCoverage, 1)}.`,
    },
  ];
  return (
    <section className="card" id="sample-metrics">
      <h3>Sample metrics</h3>
      <p className="muted">
        Counts inside this seeded sample. A percentile is a rank, not a market probability. Standard error of P(funded):{" "}
        {metrics.convergence.standardErrorFunded === null ? "—" : metrics.convergence.standardErrorFunded.toFixed(4)}.
      </p>
      <div className="metric-strip">
        {cards.map((card) => (
          <article key={card.label}>
            <h4>{card.label}</h4>
            <p className="metric-value">{card.value}</p>
            <p className="muted">{card.hint}</p>
          </article>
        ))}
      </div>
      {metrics.sleeveMtm.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption>Average price term by sleeve. Near zero when duration is near zero and yields do not move.</caption>
            <thead>
              <tr>
                <th>Sleeve</th>
                <th>Kind</th>
                <th>Mean price term</th>
              </tr>
            </thead>
            <tbody>
              {metrics.sleeveMtm.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.kind}</td>
                  <td className="num">{pct(row.meanPrice, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function MtmHtmPanel() {
  const { output } = useStore();
  const base = output.scenarios.base;
  if (!base) return null;
  const years = base.map((point) => point.calendarYear);
  return (
    <section className="card" id="mtm-htm">
      <h3>Mark to market and hold to maturity</h3>
      <p className="muted">
        Mark-to-market is carry minus duration times the yield change, plus convexity, minus default loss.
        Hold-to-maturity keeps the carry and the default loss and drops the price term. A bill with a short duration
        loses little when yields rise. A long bond loses about duration times the yield change. If every sleeve is
        parametric, the two wealth paths match, because that sleeve ignores the rate path.
      </p>
      <p className="formula">{output.views.formula}</p>
      <LineChart
        years={years}
        series={[
          { name: "Base, mark to market", color: "#0e5f5a", values: base.map((point) => point.wealthStart) },
          {
            name: "Base, hold to maturity",
            color: "#8a4b08",
            values: base.map((point) => point.wealthStartHtm),
            dash: "5 4",
          },
        ]}
        markers={[2031, 2033]}
        ariaLabel="Base-path wealth, mark to market and hold to maturity"
        downloadName="gao-mtm-htm"
      />
      <div className="table-wrap">
        <table>
          <caption>2027 sleeve return on the base path. Price is the duration and convexity term.</caption>
          <thead>
            <tr>
              <th>Sleeve</th>
              <th>Kind</th>
              <th>Carry</th>
              <th>Price</th>
              <th>Mark to market</th>
              <th>Hold to maturity</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {output.views.sleeves.map((sleeve) => (
              <tr key={sleeve.id}>
                <td>{sleeve.name}</td>
                <td>{sleeve.kind}</td>
                <td className="num">{pct(sleeve.carry2027, 2)}</td>
                <td className="num">{pct(sleeve.price2027, 2)}</td>
                <td className="num">{pct(sleeve.mtm2027, 2)}</td>
                <td className="num">{pct(sleeve.htm2027, 2)}</td>
                <td>{sleeve.flagReason ?? (sleeve.flagged ? "Flagged" : "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MixResultsTable() {
  const { output, assumptions } = useStore();
  return (
    <section className="card" id="mix-results">
      <h3>Compared mixes</h3>
      <p className="muted">
        Same seed, same streams, different glide. {assumptions.mixes.length === 0 ? "Add a mix on the Assumptions tab." : "Common random numbers are on."}
      </p>
      {output.mixes.length === 0 ? null : (
        <div className="table-wrap">
          <table>
            <caption>2033 wealth percentiles and funded share for each comparison mix.</caption>
            <thead>
              <tr>
                <th>Mix</th>
                <th>p1</th>
                <th>p5</th>
                <th>p50</th>
                <th>p95</th>
                <th>P(funded)</th>
                <th>CVaR 5%</th>
                <th>Mean max drawdown</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {output.mixes.map((mix) => (
                <tr key={mix.id}>
                  <td>{mix.name}</td>
                  <td className="num">{usd(mix.p1)}</td>
                  <td className="num">{usd(mix.p5)}</td>
                  <td className="num">{usd(mix.p50)}</td>
                  <td className="num">{usd(mix.p95)}</td>
                  <td className="num">{pct(mix.fullyFundedProbability, 1)}</td>
                  <td className="num">{usd(mix.cvar5)}</td>
                  <td className="num">{pct(mix.meanMaxDrawdown, 1)}</td>
                  <td>{mix.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
