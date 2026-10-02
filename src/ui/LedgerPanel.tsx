import { useState } from "react";
import { diffAssumptions, type LedgerEntry } from "../core/ledger";
import { useStore } from "../state";
import { DisclaimerLine } from "./bits";
import { usd } from "./format";

export function LedgerPanel() {
  const { assumptions, output, ledger, saveRun, removeRun, replace, savePending, pending } = useStore();
  const [name, setName] = useState("");
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const left = ledger.find((entry) => entry.id === leftId) ?? null;
  const right = ledger.find((entry) => entry.id === rightId) ?? null;
  const diff = left && right ? diffAssumptions(left.assumptions, right.assumptions) : null;

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>Run ledger</h2>
        <p className="lede">
          Save the current inputs and a short output summary. A saved row does not change when you edit the workspace
          afterward. The hash covers the assumptions only. The software commit, stored in the run package, covers the formulas.
        </p>
      </header>

      <section className="card">
        <h3>Save the current run</h3>
        <form
          className="choice-grid"
          onSubmit={(event) => {
            event.preventDefault();
            saveRun(name);
            setName("");
          }}
        >
          <label className="field wide">
            <span>Name</span>
            <input
              value={name}
              aria-label="Run name"
              placeholder="For example: ladder at 3%, flat glide"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="row-actions">
            <button type="submit" disabled={savePending}>
              {savePending ? "Saving…" : "Save run"}
            </button>
          </div>
        </form>
        <p className="muted">
          Current master seed {output.masterSeed}, {assumptions.trials.toLocaleString("en-US")} trials, shock model {assumptions.shockModel}.
          Base 2033 wealth {usd(output.scenarios.base?.find((point) => point.calendarYear === 2033)?.wealthStart)}. Active reserve{" "}
          {usd(output.reserve.active.reserve)}.
          {pending ? " The on-screen sample is still updating. A save uses the inputs as they are now and computes its own sample." : ""}
        </p>
      </section>

      <section className="card">
        <h3>Saved runs</h3>
        {ledger.length === 0 ? (
          <p className="muted">No runs saved in this browser yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>Newest first. Removing a row deletes it from this browser only.</caption>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Saved</th>
                  <th>Hash</th>
                  <th>Seed</th>
                  <th>Base 2033</th>
                  <th>MC p50</th>
                  <th>Reserve</th>
                  <th>Range</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.name}</td>
                    <td>{entry.savedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="mono">{entry.assumptionsHash.slice(0, 12)}</td>
                    <td className="num">{entry.seed}</td>
                    <td className="num">{usd(entry.summary.wealth2033.base)}</td>
                    <td className="num">{usd(entry.summary.mcP50Wealth2033)}</td>
                    <td className="num">
                      {usd(entry.summary.reserve)}
                      <small className="sub">{entry.summary.reserveMethod}</small>
                    </td>
                    <td className="num">
                      {usd(entry.summary.rangeLow)} – {usd(entry.summary.rangeHigh)}
                    </td>
                    <td>
                      <button type="button" className="ghost" onClick={() => loadEntry(entry, replace)}>
                        Load
                      </button>
                      <button type="button" className="text" onClick={() => removeRun(entry.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h3>Compare two runs</h3>
        <div className="choice-grid">
          <label className="field">
            <span>Left</span>
            <select value={leftId} aria-label="Left run" onChange={(event) => setLeftId(event.target.value)}>
              <option value="">Choose a run</option>
              {ledger.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Right</span>
            <select value={rightId} aria-label="Right run" onChange={(event) => setRightId(event.target.value)}>
              <option value="">Choose a run</option>
              {ledger.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {left && right ? (
          <>
            <div className="table-wrap">
              <table>
                <caption>Output summaries stored at save time. They are not recomputed.</caption>
                <thead>
                  <tr>
                    <th></th>
                    <th>{left.name}</th>
                    <th>{right.name}</th>
                  </tr>
                </thead>
                <tbody>
                  <SummaryRow label="Assumptions hash" left={left.assumptionsHash.slice(0, 12)} right={right.assumptionsHash.slice(0, 12)} />
                  <SummaryRow label="Seed" left={String(left.seed)} right={String(right.seed)} />
                  <SummaryRow label="Trials" left={String(left.trials)} right={String(right.trials)} />
                  <SummaryRow label="Bear 2033" left={usd(left.summary.wealth2033.bear)} right={usd(right.summary.wealth2033.bear)} />
                  <SummaryRow label="Base 2033" left={usd(left.summary.wealth2033.base)} right={usd(right.summary.wealth2033.base)} />
                  <SummaryRow label="Bull 2033" left={usd(left.summary.wealth2033.bull)} right={usd(right.summary.wealth2033.bull)} />
                  <SummaryRow label="MC p50 2033" left={usd(left.summary.mcP50Wealth2033)} right={usd(right.summary.mcP50Wealth2033)} />
                  <SummaryRow label="Reserve" left={`${usd(left.summary.reserve)} (${left.summary.reserveMethod})`} right={`${usd(right.summary.reserve)} (${right.summary.reserveMethod})`} />
                  <SummaryRow
                    label="Range"
                    left={`${usd(left.summary.rangeLow)} – ${usd(left.summary.rangeHigh)}`}
                    right={`${usd(right.summary.rangeLow)} – ${usd(right.summary.rangeHigh)}`}
                  />
                </tbody>
              </table>
            </div>
            <h4>Assumption differences</h4>
            {diff && diff.rows.length === 0 ? <p className="muted">The two snapshots are the same inputs.</p> : null}
            {diff && diff.rows.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <caption>
                    Field-by-field difference. {diff.truncated ? "The list is truncated." : "Every changed field is listed."}
                  </caption>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>{left.name}</th>
                      <th>{right.name}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.rows.map((row) => (
                      <tr key={row.path}>
                        <td className="mono">{row.path}</td>
                        <td>{row.left}</td>
                        <td>{row.right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">Choose two saved runs.</p>
        )}
      </section>
      <DisclaimerLine />
    </div>
  );
}

function SummaryRow({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <tr className={left !== right ? "mark" : ""}>
      <th>{label}</th>
      <td>{left}</td>
      <td>{right}</td>
    </tr>
  );
}

function loadEntry(entry: LedgerEntry, replace: (assumptions: LedgerEntry["assumptions"]) => void) {
  if (window.confirm(`Replace the workspace inputs with “${entry.name}”? Research notes stay.`)) {
    replace(entry.assumptions);
  }
}
