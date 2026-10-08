import { useState } from "react";
import historyExample from "../../examples/curve-history.csv?raw";
import equityExample from "../../examples/equity-annual-sample.csv?raw";
import snapshotExample from "../../examples/curve-snapshot.csv?raw";
import { backtestWindows, historyFromSnapshots, parseFrenchAnnual, type BacktestReport } from "../core/backtest";
import { calibrateSnapshot, estimateDynamics, parseYieldCsv, type Calibration, type DynamicsEstimate } from "../core/calibrate";
import { convergenceCurve, metricSpread, modelRisk, seedStability, type ConvergencePoint, type ModelRiskRow, type SeedRow } from "../core/diagnostics";
import { FLOOR_POLICY, QUOTE_FLOOR } from "../core/nelson";
import { useStore } from "../state";
import { LineChart } from "./Chart";
import { num, pct, usd } from "./format";

function readFile(file: File, done: (text: string) => void) {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result ?? ""));
  reader.readAsText(file);
}

export function CurvePanel() {
  const { assumptions, output } = useStore();
  const [snapshotText, setSnapshotText] = useState("");
  const [historyText, setHistoryText] = useState("");
  const [equityText, setEquityText] = useState("");
  const [fit, setFit] = useState<Calibration | null>(null);
  const [dynamics, setDynamics] = useState<DynamicsEstimate | null>(null);
  const [backtest, setBacktest] = useState<BacktestReport | null>(null);
  const [fitError, setFitError] = useState("");
  const [seeds, setSeeds] = useState<SeedRow[] | null>(null);
  const [risk, setRisk] = useState<ModelRiskRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  function fitText(text: string) {
    setSnapshotText(text);
    const snapshots = parseYieldCsv(text);
    if (snapshots.length === 0) {
      setFit(null);
      setDynamics(null);
      setFitError("No curve rows. Use a Treasury wide file or as_of, tenor_years, par_yield.");
      return;
    }
    setFitError("");
    const last = snapshots[snapshots.length - 1];
    setFit(calibrateSnapshot(last));
    setDynamics(snapshots.length > 1 ? estimateDynamics(snapshots) : null);
  }

  function runBacktest(curves: string, equity: string) {
    setHistoryText(curves);
    setEquityText(equity);
    const snapshots = parseYieldCsv(curves);
    const report = backtestWindows(historyFromSnapshots(snapshots, parseFrenchAnnual(equity)), 7);
    setBacktest(report);
  }

  const wealth = output.monteCarlo?.wealth2033 ?? [];
  const convergence: ConvergencePoint[] = wealth.length > 1 ? convergenceCurve(wealth, output.reserve.active.reserve) : [];
  const spread = risk ? metricSpread(risk, (row) => row.p50) : null;

  return (
    <section className="stack" id="curve-panel">
      <header className="panel-head">
        <h2>Curve</h2>
        <p className="deck">
          Nelson-Siegel fit to a curve you import. Floor policy <span className="formula">{FLOOR_POLICY}</span>: a quoted
          annual zero is max({QUOTE_FLOOR}, the model yield). Factor states are not floored. This fit describes the file.
          It is not a forecast.
        </p>
      </header>

      <section className="card">
        <h3>Snapshot</h3>
        <p className="muted">
          Wide Treasury files are percent, including a bill printed as 0.50. A long file is decimal unless a cell is above 1.
          The official history is downloaded by <span className="formula">scripts/fetch_treasury.py</span> into <span className="formula">data/</span>.
        </p>
        <div className="row-actions">
          <button type="button" id="load-example-curve" onClick={() => fitText(snapshotExample)}>
            Load example snapshot
          </button>
          <label className="ghost file-button">
            Import curve CSV
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              aria-label="Import curve CSV"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file, fitText);
              }}
            />
          </label>
        </div>
        <label className="field wide">
          <span>Curve CSV</span>
          <textarea className="note" rows={6} value={snapshotText} onChange={(event) => setSnapshotText(event.target.value)} />
        </label>
        <button type="button" onClick={() => fitText(snapshotText)}>Fit curve</button>
        {fitError ? <p>{fitError}</p> : null}
        {fit?.nelson ? (
          <>
            <p>
              As of {fit.asOf}. Level {pct(fit.nelson.beta0, 2)}, slope {pct(fit.nelson.beta1, 2)}, curvature {pct(fit.nelson.beta2, 2)}.
              RMSE {pct(fit.nelson.rmse, 3)}. Svensson fourth factor {fit.svensson ? pct(fit.svensson.beta3, 2) : "—"}.
            </p>
            <div className="table-wrap">
              <table id="curve-residuals">
                <caption>Fitted annual zero minus the bootstrapped zero</caption>
                <thead>
                  <tr><th>Tenor</th><th>Par</th><th>Observed zero</th><th>Fitted</th><th>Residual</th></tr>
                </thead>
                <tbody>
                  {fit.nelson.rows.map((row) => {
                    const spot = fit.spots.find((item) => Math.abs(item.tenor - row.tenor) < 1e-6);
                    return (
                      <tr key={row.tenor}>
                        <td>{num(row.tenor, 2)}</td>
                        <td>{spot ? pct(spot.parYield, 2) : "—"}</td>
                        <td>{pct(row.observed, 2)}</td>
                        <td>{pct(row.fitted, 2)}</td>
                        <td>{pct(row.residual, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {dynamics ? (
          <p>
            {dynamics.note} Level κ {dynamics.level ? num(dynamics.level.kappa, 3) : "—"}, σ {dynamics.level ? pct(dynamics.level.sigma, 2) : "—"}.
            Slope κ {dynamics.slope ? num(dynamics.slope.kappa, 3) : "—"}, σ {dynamics.slope ? pct(dynamics.slope.sigma, 2) : "—"}.
            Curvature κ {dynamics.curvature ? num(dynamics.curvature.kappa, 3) : "—"}, σ {dynamics.curvature ? pct(dynamics.curvature.sigma, 2) : "—"}.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h3>Historical windows</h3>
        <p className="muted">
          Each window is seven beginning-of-year curves. A bill book and a duration-style book are sized on the first curve
          and withdraw the case $50,000 schedule. Equity, when the second file has it, is context. It is not a portfolio weight
          and it is not fed into the case projection.
        </p>
        <div className="row-actions">
          <button type="button" id="load-example-history" onClick={() => { fitText(historyExample); runBacktest(historyExample, equityExample); }}>
            Load example history
          </button>
          <label className="ghost file-button">
            Import history CSV
            <input className="sr-only" aria-label="Import history CSV" type="file" accept=".csv,text/csv" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file, (text) => runBacktest(text, equityText));
            }} />
          </label>
        </div>
        <button type="button" onClick={() => runBacktest(historyText || snapshotText, equityText)}>Roll windows</button>
        {backtest ? (
          <>
            <p>{backtest.note}</p>
            <p>Bill funded-ratio p5 {num(backtest.billFundedP5, 3)}. Duration-style funded-ratio p5 {num(backtest.matchedFundedP5, 3)}. Windows {backtest.windows.length}.</p>
            <div className="table-wrap">
              <table>
                <caption>Minimum funded ratio inside each window</caption>
                <thead>
                  <tr><th>Start</th><th>End</th><th>Bills</th><th>Duration-style</th><th>Equity growth</th></tr>
                </thead>
                <tbody>
                  {backtest.windows.map((row) => (
                    <tr key={row.startYear}>
                      <td>{row.startYear}</td>
                      <td>{row.endYear}</td>
                      <td>{num(row.billMinFunded, 3)}</td>
                      <td>{num(row.matchedMinFunded, 3)}</td>
                      <td>{row.equityGrowth == null ? "—" : num(row.equityGrowth, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="card" id="model-risk">
        <h3>Convergence, seeds, and model risk</h3>
        <p className="muted">
          The standard-error chart uses the sample already on the Decision tab. Seed stability and the model-risk panel rerun
          that book with a short trial cap. The spread is the disagreement across the Nelson-Siegel curve, the three-point curve,
          and a 1.5× level volatility. It is not a confidence interval.
        </p>
        {convergence.length > 0 ? (
          <LineChart
            years={convergence.map((point) => point.trials)}
            series={[{ name: "SE of mean 2033 wealth", color: "#0e5f5a", values: convergence.map((point) => point.standardErrorMean) }]}
            formatTick={(value) => num(value, 0)}
            ariaLabel="Standard error of mean 2033 wealth versus number of trials"
            downloadName="convergence-se"
          />
        ) : <p>Run a sample on Decision to plot the standard error against the trial count.</p>}
        <button
          type="button"
          id="run-diagnostics"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            window.setTimeout(() => {
              setSeeds(seedStability(assumptions, [assumptions.seed, assumptions.seed + 1, assumptions.seed + 2], 50));
              setRisk(modelRisk(assumptions, 50));
              setBusy(false);
            }, 0);
          }}
        >
          {busy ? "Running" : "Run seed and model-risk check"}
        </button>
        {seeds ? (
          <div className="table-wrap">
            <table>
              <caption>Same book, three seeds, 50 trials</caption>
              <thead><tr><th>Seed</th><th>p50</th><th>p5</th><th>P(funded)</th></tr></thead>
              <tbody>
                {seeds.map((row) => (
                  <tr key={row.seed}>
                    <td>{row.seed}</td>
                    <td>{usd(row.p50)}</td>
                    <td>{usd(row.p5)}</td>
                    <td>{pct(row.funded, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {risk ? (
          <>
            <p>Spread of median 2033 wealth across the three settings: {usd(spread)}.</p>
            <div className="table-wrap">
              <table>
                <caption>Headline metrics under alternate rate models</caption>
                <thead><tr><th>Setting</th><th>Curve</th><th>Level σ</th><th>p50</th><th>p5</th><th>P(funded)</th></tr></thead>
                <tbody>
                  {risk.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.curveModel}</td>
                      <td>{pct(row.sigma, 2)}</td>
                      <td>{usd(row.p50)}</td>
                      <td>{usd(row.p5)}</td>
                      <td>{pct(row.funded, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}
