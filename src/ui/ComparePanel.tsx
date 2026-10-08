import { useState } from "react";
import { useBook } from "../bookState";
import { assumptionsFromHoldings } from "../core/book";
import { diffHoldings, standardErrorProbability } from "../core/holdings";
import { runCached } from "../core/runCache";
import { useStore } from "../state";
import { compactUsd, pct } from "./format";

export function ComparePanel() {
  const { holdings, baseline, setBaseline } = useBook();
  const { assumptions } = useStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<null | {
    leftFunded: number | null;
    rightFunded: number | null;
    leftP5: number | null;
    rightP5: number | null;
    leftP50: number | null;
    rightP50: number | null;
    se: number | null;
    trials: number;
  }>(null);
  const diff = diffHoldings(baseline, holdings);
  const changed = diff.filter((row) => row.kind !== "same");
  return (
    <div className="stack" id="compare-panel">
      <header className="panel-head">
        <h2>Compare</h2>
        <p className="lede">
          Pin the current holdings as the baseline, edit, then score both with the same seed. That is common random
          numbers. The standard error is the sampling error of P(funded), sqrt(p(1−p)/n).
        </p>
      </header>
      <section className="card">
        <div className="row-actions">
          <button type="button" onClick={() => setBaseline(holdings.map((row) => ({ ...row })))}>
            Pin current holdings as baseline
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError("");
              window.setTimeout(() => {
                try {
                  const trials = Math.min(assumptions.trials, 400);
                  const left = runCached(assumptionsFromHoldings({ ...assumptions, trials, mixes: [] }, baseline));
                  const right = runCached(assumptionsFromHoldings({ ...assumptions, trials, mixes: [] }, holdings));
                  const p = right.metrics?.fullyFundedProbability ?? 0;
                  setResult({
                    leftFunded: left.metrics?.fullyFundedProbability ?? null,
                    rightFunded: right.metrics?.fullyFundedProbability ?? null,
                    leftP5: left.metrics?.wealthPercentiles["5"] ?? null,
                    rightP5: right.metrics?.wealthPercentiles["5"] ?? null,
                    leftP50: left.metrics?.wealthPercentiles["50"] ?? null,
                    rightP50: right.metrics?.wealthPercentiles["50"] ?? null,
                    se: standardErrorProbability(p, trials),
                    trials,
                  });
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "The comparison failed.");
                } finally {
                  setPending(false);
                }
              }, 0);
            }}
          >
            {pending ? "Scoring both books…" : "Score baseline vs current"}
          </button>
        </div>
        {error ? <p className="issues">{error}</p> : null}
        <p className="muted">
          {baseline.length === 0 ? "No baseline pinned." : `${baseline.length} baseline row${baseline.length === 1 ? "" : "s"}.`}{" "}
          {changed.length} difference{changed.length === 1 ? "" : "s"} against the current book.
        </p>
        <div className="table-wrap">
          <table>
            <caption>What changed between the baseline and the current holdings.</caption>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Sleeve</th>
                <th>Change</th>
                <th>Before</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {diff.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nothing to diff yet.</td>
                </tr>
              ) : (
                diff.map((row) => (
                  <tr key={`${row.kind}-${row.ticker}`}>
                    <td>{row.ticker}</td>
                    <td>{row.sleeve}</td>
                    <td>{row.kind}</td>
                    <td className="num">{row.before === null ? "—" : pct(row.before, 2)}</td>
                    <td className="num">{row.after === null ? "—" : pct(row.after, 2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {result ? (
          <div className="table-wrap">
            <table>
              <caption>
                Paired sample, {result.trials} trials, same seed. SE of the current P(funded) is{" "}
                {result.se === null ? "—" : pct(result.se, 2)}.
              </caption>
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Baseline</th>
                  <th>Current</th>
                  <th>Delta</th>
                </tr>
              </thead>
              <tbody>
                <Metric label="P(funded)" left={result.leftFunded} right={result.rightFunded} format={(value) => pct(value, 1)} />
                <Metric label="p5 wealth" left={result.leftP5} right={result.rightP5} format={compactUsd} />
                <Metric label="p50 wealth" left={result.leftP50} right={result.rightP50} format={compactUsd} />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Score the two books to see P(funded), p5, and p50 with a standard error.</p>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  left,
  right,
  format,
}: {
  label: string;
  left: number | null;
  right: number | null;
  format: (value: number) => string;
}) {
  const delta = left !== null && right !== null ? right - left : null;
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{left === null ? "—" : format(left)}</td>
      <td className="num">{right === null ? "—" : format(right)}</td>
      <td className="num">{delta === null ? "—" : format(delta)}</td>
    </tr>
  );
}
