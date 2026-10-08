import { assumptionsFromHoldings } from "../core/book";
import { holdingsFromCsv, holdingsToCsv, sleeveTotals, weightSum, type Holding, type InstrumentKind } from "../core/holdings";
import { nextHoldingId, useBook } from "../bookState";
import { useStore } from "../state";
import { onTableArrow, SourceTip } from "./bits";
import { download } from "./format";

const KINDS: InstrumentKind[] = ["stock", "etf", "bond"];

export function HoldingsPanel() {
  const { holdings, setHoldings, rules } = useBook();
  const { update } = useStore();
  const totals = sleeveTotals(holdings);
  const sum = weightSum(holdings);
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setHoldings(holdingsFromCsv(await file.text()));
  };
  return (
    <div className="stack" id="holdings-editor">
      <header className="panel-head">
        <h2>Holdings</h2>
        <p className="lede">
          One row per ticker or bond. Weights are shares of the {rules.startingCapital.toLocaleString("en-US")} dollar
          capital. The editor starts empty. An example file lives in <code>examples/</code> and is labeled as an example.
        </p>
      </header>
      <section className="card">
        <div className="section-row">
          <h3>
            <SourceTip label="Book" source="Team entries. Nothing on this page is a recommended holding." />
          </h3>
          <div className="row-actions">
            <button
              type="button"
              onClick={() => setHoldings([...holdings, { id: nextHoldingId(holdings), ticker: "", name: "", sleeve: "", weight: 0, kind: "stock", country: "", rationale: "" }])}
            >
              Add row
            </button>
            <button type="button" className="ghost" onClick={() => download("holdings.csv", holdingsToCsv(holdings), "text/csv")}>
              Export CSV
            </button>
            <label className="ghost file-button">
              Import CSV
              <input
                className="sr-only"
                type="file"
                accept=".csv,text/csv"
                aria-label="Import holdings CSV"
                onChange={(event) => {
                  void onFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => update((current) => assumptionsFromHoldings(current, holdings))}
              disabled={holdings.length === 0}
            >
              Use these weights in the model
            </button>
          </div>
        </div>
        <div className="table-wrap" onKeyDown={onTableArrow}>
          <table>
            <caption>Holdings. Arrow up and down move between cells in a column.</caption>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Sleeve</th>
                <th>Weight</th>
                <th>Kind</th>
                <th>Bond country</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={8}>No rows yet. Add one, or import a CSV. This is not a model portfolio.</td>
                </tr>
              ) : (
                holdings.map((row, index) => (
                  <tr key={row.id}>
                    <td>
                      <input aria-label={`Ticker ${index + 1}`} value={row.ticker} onChange={(event) => patch(setHoldings, holdings, index, { ticker: event.target.value })} />
                    </td>
                    <td>
                      <input aria-label={`Name ${index + 1}`} value={row.name} onChange={(event) => patch(setHoldings, holdings, index, { name: event.target.value })} />
                    </td>
                    <td>
                      <input aria-label={`Sleeve ${index + 1}`} value={row.sleeve} onChange={(event) => patch(setHoldings, holdings, index, { sleeve: event.target.value })} />
                    </td>
                    <td>
                      <input
                        aria-label={`Weight ${index + 1}`}
                        inputMode="decimal"
                        value={Number.isFinite(row.weight) ? String(Math.round(row.weight * 10000) / 100) : ""}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          patch(setHoldings, holdings, index, { weight: Number.isFinite(parsed) ? parsed / 100 : 0 });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Kind ${index + 1}`}
                        value={row.kind}
                        onChange={(event) => patch(setHoldings, holdings, index, { kind: event.target.value as InstrumentKind })}
                      >
                        {KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Country ${index + 1}`}
                        value={row.country}
                        placeholder="US"
                        onChange={(event) => patch(setHoldings, holdings, index, { country: event.target.value.toUpperCase() as Holding["country"] })}
                      />
                    </td>
                    <td>
                      <input aria-label={`Note ${index + 1}`} value={row.rationale} onChange={(event) => patch(setHoldings, holdings, index, { rationale: event.target.value })} />
                    </td>
                    <td>
                      <button type="button" className="text" onClick={() => setHoldings(holdings.filter((_, i) => i !== index))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className={Math.abs(sum - 1) < 1e-4 ? "status ok" : "status"}>
          Weight sum {(sum * 100).toFixed(2)}%. {Math.abs(sum - 1) < 1e-4 ? "Adds to 100%." : "Does not add to 100% yet."}
        </p>
        <div className="table-wrap">
          <table>
            <caption>Sleeve totals</caption>
            <thead>
              <tr>
                <th>Sleeve</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {totals.length === 0 ? (
                <tr>
                  <td colSpan={2}>No sleeves yet.</td>
                </tr>
              ) : (
                totals.map((row) => (
                  <tr key={row.sleeve}>
                    <td>{row.sleeve}</td>
                    <td className="num">{(row.weight * 100).toFixed(2)}%</td>
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

function patch(setHoldings: (rows: Holding[]) => void, holdings: Holding[], index: number, partial: Partial<Holding>) {
  setHoldings(holdings.map((row, i) => (i === index ? { ...row, ...partial } : row)));
}
