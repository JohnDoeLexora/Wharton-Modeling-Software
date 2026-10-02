import { facilityCsv, notesCsv, projectionsCsv, reserveCsv, workspaceJson } from "../core/exportData";
import { assumptionsHash } from "../core/ledger";
import { methodologyFootnote } from "../core/package";
import { useStore } from "../state";
import { DisclaimerLine } from "./bits";
import { download } from "./format";

export function ExportPanel() {
  const { assumptions, output, notes } = useStore();
  const stamp = new Date().toISOString().slice(0, 10);
  const hash = assumptionsHash(assumptions);
  const footnote = methodologyFootnote(assumptions, output, hash);

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>Export</h2>
        <p className="lede">
          Download the current assumptions and the numbers they produce. Use them as an appendix while the team writes.
          The files are not a finished Investment Policy Statement or Final Report.
        </p>
      </header>
      <section className="card">
        <div className="row-actions">
          <button type="button" onClick={() => download(`gao-projections-${stamp}.csv`, projectionsCsv(output), "text/csv")}>
            Projections CSV
          </button>
          <button type="button" onClick={() => download(`gao-reserve-${stamp}.csv`, reserveCsv(output), "text/csv")}>
            Reserve CSV
          </button>
          <button type="button" onClick={() => download(`gao-facility-${stamp}.csv`, facilityCsv(output), "text/csv")}>
            Facility and range CSV
          </button>
          <button type="button" onClick={() => download(`gao-research-notes-${stamp}.csv`, notesCsv(notes), "text/csv")}>
            Research notes CSV
          </button>
          <button
            type="button"
            onClick={() => download(`gao-run-package-${stamp}.json`, workspaceJson(assumptions, output, notes), "application/json")}
          >
            Run package JSON
          </button>
          <button type="button" className="ghost" onClick={() => download(`gao-methodology-${stamp}.txt`, footnote, "text/plain")}>
            Methodology footnote
          </button>
        </div>
        <p className="muted">
          The run package is one file: assumptions, results, the CSV tables, the liability schedule, tolerances, and the
          methodology footnote. Assumptions hash <span className="mono">{hash}</span>. The hash identifies inputs. The
          commit inside the file identifies the formulas.
        </p>
        <p className="muted">
          The reserve CSV rolls the full sized reserve, even if the on-screen schedule was capped at a scenario’s wealth.
        </p>
        <details>
          <summary>Methodology footnote for this run</summary>
          <pre className="method-note">{footnote}</pre>
        </details>
      </section>

      <section className="card">
        <h3>How the modules map onto the deliverables</h3>
        <p>This is a workflow. It does not fill in what the team should conclude.</p>
        <div className="table-wrap">
          <table>
            <caption>A way to use the toolkit while writing. The judgment stays with the team.</caption>
            <thead>
              <tr>
                <th>Deliverable</th>
                <th>What you might take from this toolkit</th>
                <th>What you still have to write</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Trading Notes</td>
                <td>Research-note tags, and which sleeve role a holding is meant to serve (growth or funding).</td>
                <td>Why a specific trade was made. Sentiment is not a signal to trade.</td>
              </tr>
              <tr>
                <td>Investment Policy Statement</td>
                <td>The assumption set, the glide path, the reserve method, and the team’s own certainty note.</td>
                <td>The policy itself: what the team will do, and why those assumptions are acceptable.</td>
              </tr>
              <tr>
                <td>Final Report</td>
                <td>Scenario wealth, the reserve schedule, gaps, candidate contributions, and the range wording as a draft.</td>
                <td>The evaluation of how the IPS was implemented, including favorable and unfavorable outcomes.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          WInS gains and losses stay out of the long-term projection. The competition guide says projections start from the case contributions plus the team’s return assumptions.
        </p>
      </section>
      <DisclaimerLine />
    </div>
  );
}
