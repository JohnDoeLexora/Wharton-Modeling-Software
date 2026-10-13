import { useBook } from "../bookState";
import { annotatedHtml } from "../core/annotated";
import { buildBundle } from "../core/bundle";
import { facilityCsv, notesCsv, projectionsCsv, reserveCsv, trialsCsv, trialsParquetBytes, workspaceJson } from "../core/exportData";
import { assumptionsHash } from "../core/ledger";
import { methodologyFootnote } from "../core/package";
import { textPdf } from "../core/pdfText";
import { tearSheetHtml } from "../core/tearSheet";
import { workbookBytes } from "../core/xlsx";
import { useStore } from "../state";
import { DisclaimerLine, SourceTip } from "./bits";
import { download, downloadBlob } from "./format";

function parquetBlob(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function tearInput(
  audience: "INTERNAL" | "EXTERNAL",
  assumptions: ReturnType<typeof useStore>["assumptions"],
  output: ReturnType<typeof useStore>["output"],
  holdings: { ticker: string; weight: number; sleeve: string }[],
) {
  return {
    audience,
    title: "example book",
    asOf: output.provenance?.dataAsOf ?? "",
    holdings: holdings.map((row) => ({ name: row.ticker, weight: row.weight, kind: row.sleeve })),
    riskLines: [
      `Seed ${output.masterSeed}. Trials ${assumptions.trials}. Return model ${assumptions.returnModel}.`,
      output.correlation.repaired ? "Correlation was repaired." : "Correlation was used as typed.",
    ],
    citations: [],
    scenarios: [{ label: "Library", note: "Named scenarios live on the Stresses screen. They are not applied on this sheet." }],
    reservePv: output.reserve.active.reserve,
    giftP5: output.metrics?.facilityPercentiles["5"] ?? null,
    giftP50: output.metrics?.facilityPercentiles["50"] ?? null,
    giftP95: output.metrics?.facilityPercentiles["95"] ?? null,
    methodology: [methodologyFootnote(assumptions, output, assumptionsHash(assumptions))],
  };
}

function tearLines(
  audience: string,
  output: ReturnType<typeof useStore>["output"],
  holdings: { ticker: string; weight: number }[],
): string[] {
  return [
    `${audience} tear sheet. Exploratory output. Not an investment recommendation.`,
    `Seed ${output.masterSeed}. Data as of ${output.provenance?.dataAsOf ?? "unknown"}.`,
    ...holdings.map((row) => `${row.ticker} weight ${row.weight}`),
    `P(funded) ${output.metrics?.fullyFundedProbability ?? "n/a"}`,
    `p50 wealth ${output.metrics?.wealthPercentiles["50"] ?? "n/a"}`,
  ];
}

export function ExportPanel() {
  const { assumptions, output, notes } = useStore();
  const { holdings, stresses, audience, setAudience } = useBook();
  const stamp = new Date().toISOString().slice(0, 10);
  const hash = assumptionsHash(assumptions);
  const footnote = methodologyFootnote(assumptions, output, hash);

  return (
    <div className="stack" id="export-panel">
      <header className="panel-head">
        <h2>Export</h2>
        <p className="lede">
          Download the current assumptions and the numbers they produce. Use them as an appendix while the team writes.
          The files are not a finished Investment Policy Statement or Final Report. Every file name starts with{" "}
          <code>EXTERNAL - </code> or <code>INTERNAL - </code>.
        </p>
      </header>
      <section className="card">
        <h3>
          <SourceTip
            label="Who the file is for"
            source="EXTERNAL is a shareable sheet or annotated result. INTERNAL is the working notes and the full run package. The prefix is applied when the file downloads."
          />
        </h3>
        <div className="row-actions">
          <button type="button" className={audience === "EXTERNAL" ? "" : "ghost"} onClick={() => setAudience("EXTERNAL")} aria-pressed={audience === "EXTERNAL"}>
            EXTERNAL
          </button>
          <button type="button" className={audience === "INTERNAL" ? "" : "ghost"} onClick={() => setAudience("INTERNAL")} aria-pressed={audience === "INTERNAL"}>
            INTERNAL
          </button>
          <span className="muted">Current tag: {audience}.</span>
        </div>
        <div className="row-actions">
          <button type="button" onClick={() => download(`gao-projections-${stamp}.csv`, projectionsCsv(output), "text/csv")}>
            Projections CSV
          </button>
          <button type="button" onClick={() => download(`gao-trials-${stamp}.csv`, trialsCsv(output), "text/csv")}>
            Per-trial CSV
          </button>
          <button
            type="button"
            onClick={() =>
              downloadBlob(`gao-trials-${stamp}.parquet`, new Blob([parquetBlob(trialsParquetBytes(output))], { type: "application/vnd.apache.parquet" }))
            }
          >
            Per-trial Parquet
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
          <button
            type="button"
            onClick={() =>
              download(
                "annotated results.html",
                annotatedHtml({ assumptions, output, holdings, stresses }),
                "text/html",
              )
            }
          >
            Annotated results
          </button>
          <button type="button" onClick={() => download("tear-sheet.html", tearSheetHtml(tearInput(audience, assumptions, output, holdings)), "text/html")}>
            Tear sheet HTML
          </button>
          <button
            type="button"
            onClick={() => {
              const lines = tearLines(audience, output, holdings);
              downloadBlob("tear-sheet.pdf", new Blob([toBuffer(textPdf(`${audience} - tear sheet`, lines))], { type: "application/pdf" }));
            }}
          >
            Tear sheet PDF
          </button>
          <button
            type="button"
            onClick={() => download("run-bundle.json", JSON.stringify(buildBundle(assumptions, output)), "application/json")}
          >
            Reproduce bundle
          </button>
          <button
            type="button"
            onClick={() => {
              const bytes = workbookBytes([
                {
                  name: "Board",
                  rows: [
                    ["metric", "value"],
                    ["seed", output.masterSeed],
                    ["p50", output.metrics?.wealthPercentiles["50"] ?? ""],
                    ["P(funded)", output.metrics?.fullyFundedProbability ?? ""],
                  ],
                },
              ]);
              downloadBlob("board.xlsx", new Blob([toBuffer(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
            }}
          >
            Board workbook
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
