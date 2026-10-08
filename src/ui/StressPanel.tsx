import { useState } from "react";
import { useBook } from "../bookState";
import { runCached } from "../core/runCache";
import { STRESS_PRESETS, applyStress, type StressSpec } from "../core/stress";
import { useStore } from "../state";
import { SourceTip } from "./bits";
import { compactUsd, pct } from "./format";

export function StressPanel() {
  const { assumptions } = useStore();
  const { setStresses, stresses } = useBook();
  const [pending, setPending] = useState(false);
  const [crashYear, setCrashYear] = useState(2028);
  const [crashShock, setCrashShock] = useState(-0.35);
  return (
    <div className="stack" id="stress-panel">
      <header className="panel-head">
        <h2>Stresses</h2>
        <p className="lede">
          Each button runs the current assumptions with one overlay. Apply a holdings book first if that book is what
          you want to stress. The overlays are team inputs, not forecasts.
        </p>
      </header>
      <section className="card">
        <div className="choice-grid">
          <label className="field">
            <span>
              <SourceTip label="Crash year" source={STRESS_PRESETS[0].source} />
            </span>
            <input
              aria-label="Crash year"
              inputMode="numeric"
              value={crashYear}
              onChange={(event) => setCrashYear(Number(event.target.value) || crashYear)}
            />
          </label>
          <label className="field">
            <span>Crash shock (decimal)</span>
            <input
              aria-label="Crash shock"
              inputMode="decimal"
              value={crashShock}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed)) setCrashShock(parsed);
              }}
            />
          </label>
        </div>
        <div className="row-actions">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              window.setTimeout(() => {
                const trials = Math.min(assumptions.trials, 400);
                const base = { ...assumptions, trials, mixes: [] };
                const rows = STRESS_PRESETS.map((preset) => {
                  const spec: StressSpec = preset.id === "crash" ? { ...preset, crashYear, crashShock } : preset;
                  const output = runCached(applyStress(base, spec));
                  return {
                    id: spec.id,
                    label: spec.label,
                    funded: output.metrics?.fullyFundedProbability ?? null,
                    p5: output.metrics?.wealthPercentiles["5"] ?? null,
                    gift: output.metrics?.facilityPercentiles["50"] ?? null,
                  };
                });
                setStresses(rows);
                setPending(false);
              }, 0);
            }}
          >
            {pending ? "Running stresses…" : "Run all five stresses"}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <caption>Stress results on the current book. P(funded) and p5 use the same seed as the workspace.</caption>
            <thead>
              <tr>
                <th>Stress</th>
                <th>P(funded)</th>
                <th>p5</th>
                <th>Median gift</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {stresses.length === 0 ? (
                <tr>
                  <td colSpan={5}>Not run yet.</td>
                </tr>
              ) : (
                stresses.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td className="num">{row.funded === null ? "—" : pct(row.funded, 1)}</td>
                    <td className="num">{row.p5 === null ? "—" : compactUsd(row.p5)}</td>
                    <td className="num">{row.gift === null ? "—" : compactUsd(row.gift)}</td>
                    <td>{STRESS_PRESETS.find((preset) => preset.id === row.id)?.source}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
