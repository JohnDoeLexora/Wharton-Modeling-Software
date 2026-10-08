import { useMemo, useState } from "react";
import fillsExample from "../../examples/fills.csv?raw";
import holdingsExample from "../../examples/example-holdings.csv?raw";
import { holdingsFromCsv, type Holding } from "../core/holdings";
import { fundSnapshot, flatYield } from "../core/instruments";
import { parseBucketCsv } from "../core/instruments";
import govtExample from "../../examples/govt-buckets.csv?raw";
import { parseFills, trackingReport, WINS_PNL_LABEL } from "../core/tracking";
import { buildTradeNote, noteCount, TRADE_NOTE_LIMIT } from "../core/tradeNote";
import { useBook } from "../bookState";
import { num, pct, usd } from "./format";

const govt = parseBucketCsv(govtExample);
const govtSnap = fundSnapshot(govt.buckets, flatYield(0.04));

function statsFor(holding: Holding) {
  const bondish = holding.kind === "bond" || holding.kind === "etf";
  return {
    ticker: holding.ticker,
    sleeve: holding.sleeve,
    weight: holding.weight,
    kind: holding.kind,
    role: holding.rationale,
    duration: bondish ? govtSnap.duration : null,
    modeledYield: bondish ? govtSnap.yieldToMaturity : null,
    expense: holding.kind === "etf" ? govt.expenseRatio : null,
  };
}

export function TrackingPanel() {
  const { holdings, setHoldings, market, rules, fillsText, setFillsText } = useBook();
  const [draft, setDraft] = useState(() => buildTradeNote({
    ticker: "EXA",
    sleeve: "Growth",
    weight: 0.25,
    kind: "stock",
    role: "Example draft. Not a holding.",
    duration: null,
    modeledYield: null,
    expense: null,
  }));

  const report = useMemo(() => {
    const fills = parseFills(fillsText);
    if (fills.length === 0) return null;
    return trackingReport({ fills, holdings, market, rules });
  }, [fillsText, holdings, market, rules]);

  function updateNote(id: string, tradeNote: string) {
    setHoldings(holdings.map((row) => (row.id === id ? { ...row, tradeNote } : row)));
  }

  return (
    <section className="stack" id="tracking-panel">
      <header className="panel-head">
        <h2>Tracking</h2>
        <p className="deck">
          Fills you import are labeled {WINS_PNL_LABEL}. That profit and loss is not an input to the case projection.
        </p>
      </header>

      <section className="card">
        <h3>{WINS_PNL_LABEL}</h3>
        <div className="row-actions">
          <button type="button" id="load-example-fills" onClick={() => setFillsText(fillsExample)}>Load example fills</button>
          <button
            type="button"
            className="ghost"
            id="load-example-holdings"
            onClick={() => setHoldings(holdingsFromCsv(holdingsExample))}
          >
            Load example holdings shape
          </button>
          <label className="ghost file-button">
            Import fills CSV
            <input
              className="sr-only"
              aria-label="Import fills CSV"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setFillsText(String(reader.result ?? ""));
                reader.readAsText(file);
              }}
            />
          </label>
        </div>
        <label className="field wide">
          <span>Fills CSV</span>
          <textarea className="note" rows={5} value={fillsText} onChange={(event) => setFillsText(event.target.value)} />
        </label>
        {report ? (
          <>
            <p>
              <strong>{report.label}</strong> since the fills: {usd(report.pnl)}. Market value {usd(report.marketValue)}.
              Trades used {report.tradesUsed} of {rules.maxTrades}. Left {report.tradesLeft}. This column does not enter the projection.
            </p>
            <div className="table-wrap">
              <table>
                <caption>Realized weight versus the holdings target</caption>
                <thead><tr><th>Ticker</th><th>Target</th><th>Realized</th><th>Drift</th><th>Market value</th></tr></thead>
                <tbody>
                  {report.weights.map((row) => (
                    <tr key={row.ticker}>
                      <td>{row.ticker}</td>
                      <td>{pct(row.targetWeight, 1)}</td>
                      <td>{pct(row.realizedWeight, 1)}</td>
                      <td>{pct(row.drift, 1)}</td>
                      <td>{usd(row.marketValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <caption>Rebalance ideas inside the trade budget and the volume multiple</caption>
                <thead><tr><th>Ticker</th><th>Side</th><th>Qty</th><th>Notional</th><th>Check</th></tr></thead>
                <tbody>
                  {report.ideas.map((idea) => (
                    <tr key={idea.ticker}>
                      <td>{idea.ticker}</td>
                      <td>{idea.side}</td>
                      <td>{idea.qty}</td>
                      <td>{usd(idea.notional)}</td>
                      <td>{idea.ok ? idea.reason : `No: ${idea.reason}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p>Import fills to see weights, drift, and {WINS_PNL_LABEL}. The page starts empty.</p>}
      </section>

      <section className="card" id="trade-notes">
        <h3>Trading notes</h3>
        <p className="muted">
          Each draft is built from the holding’s role, sleeve, weight, and modeled stats, then cut at {TRADE_NOTE_LIMIT} characters.
          Edit it. The app does not submit it.
        </p>
        {holdings.length === 0 ? <p>The holdings book is empty. Load the example shape, or edit the draft below. It is not added to the book.</p> : null}
        {holdings.map((holding) => {
          const generated = buildTradeNote(statsFor(holding));
          const text = holding.tradeNote && holding.tradeNote.length > 0 ? holding.tradeNote : generated;
          const count = noteCount(text);
          return (
            <label className="field wide" key={holding.id}>
              <span>{holding.ticker || "Holding"} · {holding.sleeve || "no sleeve"}</span>
              <textarea
                className="note"
                rows={4}
                value={text}
                onChange={(event) => updateNote(holding.id, event.target.value)}
              />
              <small className={count.over ? "note-count over" : "note-count"}>{count.length} / {count.limit}</small>
            </label>
          );
        })}
        <label className="field wide">
          <span>Scratch draft</span>
          <textarea id="scratch-note" className="note" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <small className={noteCount(draft).over ? "note-count over" : "note-count"}>
            {noteCount(draft).length} / {TRADE_NOTE_LIMIT}
          </small>
        </label>
        <p className="muted">Modeled duration on the ETF example shape, at a flat 4% zero, is {num(govtSnap.duration, 2)} years. That figure is a calculator input for the note, not a position.</p>
      </section>
    </section>
  );
}
