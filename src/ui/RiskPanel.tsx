import { useEffect, useState } from "react";
import pricesExample from "../../examples/daily-prices-sample.csv?raw";
import bookExample from "../../examples/risk-book.csv?raw";
import type { PairedComparison } from "../core/risk/compare";
import { compareMethods, copyProposals } from "../core/risk/compare";
import type { RiskReport } from "../core/risk/assemble";
import { estimateFromCsv } from "../core/risk/assemble";
import { bookFromCsv } from "../core/risk/fixture";
import { buildTradeNote, noteCount } from "../core/tradeNote";
import { useStore } from "../state";
import { num, pct, usd } from "./format";

export interface RiskViewProps {
  report: RiskReport | null;
  comparison: PairedComparison | null;
  selected: string;
  busy: string;
  note: string;
  copyNote: string;
  onSelect: (ticker: string) => void;
  onLoadExample: () => void;
  onImportPrices: (text: string) => void;
  onImportBook: (text: string) => void;
  onCompare: () => void;
  onCopy: () => void;
  onNote: (text: string) => void;
}

function Spark({ values, label }: { values: number[]; label: string }) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return <p className="fine">{label}: not enough history.</p>;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const width = 280;
  const height = 48;
  const step = width / (values.length - 1);
  const points = values
    .map((value, index) => {
      const y = Number.isFinite(value) ? height - ((value - min) / span) * (height - 4) - 2 : height / 2;
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <figure className="spark">
      <figcaption>
        {label} · {num(min, 2)} to {num(max, 2)}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        <polyline fill="none" stroke="currentColor" strokeWidth="1.6" points={points} />
      </svg>
    </figure>
  );
}

function heat(value: number): string {
  if (!Number.isFinite(value)) return "transparent";
  const t = Math.max(-1, Math.min(1, value));
  const alpha = 0.12 + 0.7 * Math.abs(t);
  return t >= 0 ? `rgba(14, 95, 90, ${alpha})` : `rgba(196, 73, 44, ${alpha})`;
}

function betaLine(label: string, beta: number, se: number, measured: boolean, window: string) {
  return (
    <tr key={label}>
      <td>{label}</td>
      <td>{window}</td>
      <td>{num(beta)}</td>
      <td>{num(se)}</td>
      <td>{measured ? "measured" : "not measured"}</td>
    </tr>
  );
}

export function RiskView({
  report,
  comparison,
  selected,
  busy,
  note,
  copyNote,
  onSelect,
  onLoadExample,
  onImportPrices,
  onImportBook,
  onCompare,
  onCopy,
  onNote,
}: RiskViewProps) {
  const card = report?.names.find((row) => row.ticker === selected) ?? report?.names[0] ?? null;
  const count = noteCount(note);
  const diverging =
    report?.book == null
      ? []
      : report.names.filter(
          (row) => row.diverge && report.book!.components.some((component) => component.ticker === row.ticker && component.weight > 0),
        );
  return (
    <section className="stack" id="risk-panel">
      <header className="panel-head">
        <h2>Risk</h2>
        <p className="deck">
          Daily estimators for a history you import. A Vasicek number and a Blume number are labeled not measured. The example file is synthetic.
        </p>
      </header>
      <div className="row-actions">
        <button type="button" id="load-risk-example" onClick={onLoadExample} disabled={busy !== ""}>
          Load example history
        </button>
        <button type="button" id="compare-old-new" onClick={onCompare} disabled={busy !== "" || report == null}>
          Compare old and new
        </button>
        <button type="button" className="ghost" id="copy-risk-basket" onClick={onCopy} disabled={busy !== "" || report == null}>
          Copy into basket
        </button>
        <label className="ghost file-button">
          Import prices CSV
          <input
            className="sr-only"
            aria-label="Import prices CSV"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(onImportPrices);
            }}
          />
        </label>
        <label className="ghost file-button">
          Import book CSV
          <input
            className="sr-only"
            aria-label="Import book CSV"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then(onImportBook);
            }}
          />
        </label>
      </div>
      {busy ? (
        <p role="status" id="risk-busy">
          {busy}
        </p>
      ) : null}
      {copyNote ? (
        <p role="status" id="risk-copy-status">
          {copyNote}
        </p>
      ) : null}
      {diverging.length > 0 ? (
        <div id="vol-divergence-banner" className="alert" role="alert">
          {diverging.map((row) => row.ticker).join(", ")}: model vol and recent realized vol differ by more than 1.5×. Both numbers are on the card. The horizon figure is the term-structure forecast. The recent figure is the last window of the file.
        </div>
      ) : null}

      <section className="card" id="risk-card">
        <h3>Name card</h3>
        {card == null || report == null ? (
          <p>Load a daily adjusted-close file to see every estimator, the data-quality line, and the rolling vol and beta.</p>
        ) : (
          <>
            <div className="row-actions" role="listbox" aria-label="Names">
              {report.names.map((row) => (
                <button
                  key={row.ticker}
                  type="button"
                  aria-pressed={row.ticker === card.ticker}
                  onClick={() => onSelect(row.ticker)}
                >
                  {row.ticker}
                </button>
              ))}
            </div>
            <p>
              <strong>{card.ticker}</strong> · {card.sector || "no sector"} · {card.role}
              {card.nonsync ? " · Dimson lead/lag" : ""}
            </p>
            <p className="fine">
              Observations {card.quality.observations}. Returns {card.quality.returnCount}. Missing business days {card.quality.missingBusinessDays}. Stale prints {card.quality.stalePrints}. Split adjustments {card.quality.splitAdjustments}.
              {card.quality.ipoShort ? " IPO-short history." : ""}
            </p>
            {card.flags.length > 0 ? <p className="fine">Flags: {card.flags.join("; ")}.</p> : <p className="fine">No estimator flag on this name.</p>}
            <div className="metric-strip">
              <article>
                <h4>1-year daily vol</h4>
                <p className="metric-value">{pct(card.vol.realized1y)}</p>
              </article>
              <article>
                <h4>Monthly vol</h4>
                <p className="metric-value">{pct(card.vol.realizedMonthly)}</p>
              </article>
              <article>
                <h4>EWMA λ {num(card.vol.ewmaLambda, 2)}</h4>
                <p className="metric-value">{pct(card.vol.ewma)}</p>
              </article>
              <article>
                <h4>Horizon {card.vol.horizonDays}d</h4>
                <p className="metric-value">{pct(card.vol.horizon)}</p>
              </article>
              <article>
                <h4>Model vol</h4>
                <p className="metric-value">{pct(card.modelVol)}</p>
              </article>
            </div>
            <div className="table-wrap">
              <table>
                <caption>Volatility estimators, annualized</caption>
                <thead>
                  <tr>
                    <th>Estimator</th>
                    <th>Vol</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Realized daily</td>
                    <td>{pct(card.vol.realizedDaily)}</td>
                  </tr>
                  <tr>
                    <td>Realized weekly</td>
                    <td>{pct(card.vol.realizedWeekly)}</td>
                  </tr>
                  <tr>
                    <td>Realized monthly</td>
                    <td>{pct(card.vol.realizedMonthly)}</td>
                  </tr>
                  <tr>
                    <td>Realized 1-year daily</td>
                    <td>{pct(card.vol.realized1y)}</td>
                  </tr>
                  <tr>
                    <td>EWMA</td>
                    <td>{pct(card.vol.ewma)}</td>
                  </tr>
                  <tr>
                    <td>GARCH current{card.vol.garchOk ? "" : " (not fit)"}</td>
                    <td>{pct(card.vol.garchCurrent)}</td>
                  </tr>
                  <tr>
                    <td>GARCH long-run</td>
                    <td>{pct(card.vol.garchLongRun)}</td>
                  </tr>
                  <tr>
                    <td>Blended</td>
                    <td>{pct(card.vol.blended)}</td>
                  </tr>
                  <tr>
                    <td>Horizon forecast</td>
                    <td>{pct(card.vol.horizon)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="fine">
              Estimator ratio {num(card.vol.ratio)}. {card.vol.disagreement ? "The estimators disagree by more than 1.5×." : "The estimators are inside 1.5×."} {card.vol.note}
            </p>
            <div className="table-wrap">
              <table>
                <caption>Betas. Shrunk rows are not measured.</caption>
                <thead>
                  <tr>
                    <th>Estimator</th>
                    <th>Window</th>
                    <th>Beta</th>
                    <th>SE</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {card.beta ? (
                    <>
                      {betaLine("Daily", card.beta.daily.beta, card.beta.daily.se, true, card.beta.daily.window)}
                      {betaLine("One year", card.beta.oneYear.beta, card.beta.oneYear.se, true, card.beta.oneYear.window)}
                      {betaLine("Weekly", card.beta.weekly.beta, card.beta.weekly.se, true, card.beta.weekly.window)}
                      {betaLine("Monthly", card.beta.monthly.beta, card.beta.monthly.se, true, card.beta.monthly.window)}
                      {card.beta.dimson
                        ? betaLine("Dimson", card.beta.dimson.beta, card.beta.dimson.se, true, card.beta.dimson.window)
                        : null}
                      <tr>
                        <td>Vasicek</td>
                        <td>prior {num(card.beta.vasicek.prior)}</td>
                        <td>{num(card.beta.vasicek.beta)}</td>
                        <td>—</td>
                        <td>{card.beta.vasicek.label}</td>
                      </tr>
                      <tr>
                        <td>Blume</td>
                        <td>monthly legacy</td>
                        <td>{num(card.beta.blume.beta)}</td>
                        <td>—</td>
                        <td>{card.beta.blume.label}</td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td colSpan={5}>No market column, so there is no measured beta.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {card.beta ? <p className="fine">{card.beta.vasicek.priorNote}</p> : null}
            <p>
              Jumps: source {card.jumps.source}
              {card.jumps.fallbackClass ? ` (${card.jumps.fallbackClass})` : ""}. Intensity {num(card.jumps.lambdaAnnual)} per year. Gaps {card.jumps.gaps}. Mean jump size {num(card.jumps.size)}. Diffusion vol {pct(Math.sqrt(Math.max(0, card.jumps.diffusionVariance)))}. {card.jumps.volFlag ? `${card.jumps.volFlag} ` : ""}
              Double-exponential up rate {num(card.jumps.upRate)}, down rate {num(card.jumps.downRate)}.
            </p>
            <p className="fine">
              Student-t df {card.tails.df} ({card.tails.source}). {card.tails.note}
            </p>
            {card.fund ? (
              <p className="fine">
                Versus {card.fund.benchmark}: tracking difference {pct(card.fund.trackingDifference)}, tracking error {pct(card.fund.trackingError)}, fee drag {pct(card.fund.feeDrag)}. {card.fund.note}
              </p>
            ) : null}
            <Spark values={card.sparkVol} label="63-session rolling vol" />
            <Spark values={card.sparkBeta} label="63-session rolling beta" />
            <label htmlFor="risk-trade-note">
              Trading note draft
              <textarea id="risk-trade-note" className="note" rows={4} value={note} onChange={(event) => onNote(event.target.value)} />
            </label>
            <p className={count.over ? "note-count over" : "note-count"}>
              {count.length} / {count.limit}
            </p>
          </>
        )}
      </section>

      <section className="card" id="risk-screen">
        <h3>Portfolio risk</h3>
        {report?.book == null ? (
          <p>Import a book beside the price file. Weights are holdings you supply. The screen does not invent a book.</p>
        ) : (
          <>
            <div className="metric-strip">
              <article>
                <h4>Ex-ante vol</h4>
                <p className="metric-value">{pct(report.book.vol)}</p>
              </article>
              <article>
                <h4>Measured beta{report.book.betaWindow ? ` (${report.book.betaWindow})` : ""}</h4>
                <p className="metric-value">{num(report.book.betaRaw)}</p>
              </article>
              <article>
                <h4>Vasicek beta (not measured)</h4>
                <p className="metric-value">{num(report.book.betaShrunk)}</p>
              </article>
              <article>
                <h4>Idiosyncratic share</h4>
                <p className="metric-value">{pct(report.book.idioShare)}</p>
              </article>
              <article>
                <h4>Jump share</h4>
                <p className="metric-value">{pct(report.book.jumpShare)}</p>
              </article>
            </div>
            <p className="fine">
              Factor share {pct(report.book.factorShare)}. Worst historical gap stress: {report.book.worstTicker || "—"} {pct(report.book.worstStress)}. Covariance PSD {report.factors.psd ? "yes" : "no"}. Shrinkage {num(report.factors.shrinkage, 3)}.
              {report.factors.repaired ? " Negative eigenvalues were clipped." : ""}
            </p>
            <div className="table-wrap">
              <table>
                <caption>Component risk. Marginal contribution times weight sums to ex-ante vol.</caption>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Weight</th>
                    <th>Marginal</th>
                    <th>Component</th>
                    <th>Share</th>
                    <th>Measured beta{report.book.betaWindow ? ` (${report.book.betaWindow})` : ""}</th>
                    <th>Vasicek (not measured)</th>
                    <th>Gap stress</th>
                  </tr>
                </thead>
                <tbody>
                  {report.book.components.map((row) => (
                    <tr key={row.ticker}>
                      <td>{row.ticker}</td>
                      <td>{pct(row.weight)}</td>
                      <td>{pct(row.marginal)}</td>
                      <td>{pct(row.component)}</td>
                      <td>{pct(row.percent)}</td>
                      <td>
                        {num(row.betaRaw)}
                        {row.betaWindow ? <span className="fine"> {row.betaWindow}</span> : null}
                      </td>
                      <td>{num(row.betaShrunk)}</td>
                      <td>{pct(row.stress)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">{report.book.note}</p>
            {report.factors.correlation.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <caption>Correlation of the shrunk covariance. Factors: {report.factors.factors.join(", ") || "—"}.</caption>
                  <thead>
                    <tr>
                      <th>Name</th>
                      {report.factors.names.map((ticker) => (
                        <th key={ticker}>{ticker}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.factors.names.map((ticker, row) => (
                      <tr key={ticker}>
                        <th>{ticker}</th>
                        {report.factors.correlation[row].map((value, column) => (
                          <td key={report.factors.names[column]} className="heat" style={{ background: heat(value) }}>
                            {num(value, 2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="card" id="risk-backtest">
        <h3>Coverage backtest</h3>
        <p className="fine">
          Rolling one-step VaR. The old column is expanding monthly vol and a Student-t with 5 degrees of freedom. The new column is EWMA variance known before the session and a Student-t refit on the trailing year. Kupiec tests the hit rate. Christoffersen tests whether hits cluster. The score adds the 95% and 99% hit-rate gaps to a penalty when either test rejects at 5%. A lower score is the closer calibration on this file.
        </p>
        {report == null || report.coverage.length === 0 ? (
          <p>Coverage runs when a history is loaded.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>Which method wins on this history</caption>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Winner</th>
                  <th>New 95% hits</th>
                  <th>Kupiec p</th>
                  <th>Christoffersen p</th>
                  <th>New 99% hits</th>
                  <th>ES ratio 95%</th>
                  <th>PIT KS</th>
                  <th>Old 95% hits</th>
                </tr>
              </thead>
              <tbody>
                {report.coverage.map((row) => (
                  <tr key={row.ticker}>
                    <td>{row.ticker}</td>
                    <td>{row.winner}</td>
                    <td>{row.next ? pct(row.next.var95.hitRate) : "—"}</td>
                    <td>{row.next ? num(row.next.var95.pValue) : "—"}</td>
                    <td>{row.next ? num(row.next.conditional95.pValue) : "—"}</td>
                    <td>{row.next ? pct(row.next.var99.hitRate) : "—"}</td>
                    <td>{row.next ? num(row.next.esRatio95) : "—"}</td>
                    <td>
                      {row.next ? num(row.next.pitKs, 3) : "—"}
                      {row.next ? (row.next.pitPass ? " pass" : " fail") : ""}
                    </td>
                    <td>{row.old ? pct(row.old.var95.hitRate) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {comparison ? (
          <>
            <h4>Old versus new on the case model</h4>
            <p className="fine">{comparison.note}</p>
            <p>
              Paired difference (new − old): P(funded) {num(comparison.paired.fundedDiff, 3)} (SE {num(comparison.paired.fundedSe, 3)}). Wealth {usd(comparison.paired.wealthDiff)} (SE {usd(comparison.paired.wealthSe)}).
            </p>
            <p className="fine">
              Locked cash flows: {usd(comparison.cash2027)} in 2027, {usd(comparison.cash2028)} in 2028, payment {usd(comparison.payment)}. Seed {comparison.seed}. Trials {comparison.trials}.
            </p>
            <div className="table-wrap">
              <table>
                <caption>Sample levels. The paired difference above is the comparison, not these levels.</caption>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>P(funded)</th>
                    <th>p5 wealth</th>
                    <th>p50 wealth</th>
                    <th>Gift p5</th>
                    <th>Gift p50</th>
                  </tr>
                </thead>
                <tbody>
                  {[comparison.old, comparison.next].map((side) => (
                    <tr key={side.label}>
                      <td>{side.label}</td>
                      <td>{num(side.funded, 3)}</td>
                      <td>{usd(side.p5)}</td>
                      <td>{usd(side.p50)}</td>
                      <td>{usd(side.giftP5)}</td>
                      <td>{usd(side.giftP50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">
              {comparison.next.betas.map((row) => `${row.ticker} beta ${num(row.beta)} (${row.label})`).join(". ")}.
            </p>
          </>
        ) : (
          <p className="fine">Compare old and new runs the locked case cash flows twice, once with monthly Blume inputs and once with the horizon Vasicek inputs.</p>
        )}
      </section>
    </section>
  );
}

function draftNote(report: RiskReport | null, ticker: string): string {
  const card = report?.names.find((row) => row.ticker === ticker) ?? report?.names[0] ?? null;
  if (!card || report == null) return "";
  const weight = report.book?.components.find((row) => row.ticker === card.ticker)?.weight ?? 0;
  return buildTradeNote({
    ticker: card.ticker,
    sleeve: "imported",
    weight,
    kind: card.role === "index" ? "etf" : "stock",
    role: card.flags[0] ?? "Imported history",
    duration: null,
    modeledYield: null,
    expense: card.fund?.feeDrag ?? null,
    riskCitation: card.beta?.citation,
  });
}

export function RiskPanel() {
  const { update, assumptions } = useStore();
  const [report, setReport] = useState<RiskReport | null>(null);
  const [comparison, setComparison] = useState<PairedComparison | null>(null);
  const [prices, setPrices] = useState("");
  const [book, setBook] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [copyNote, setCopyNote] = useState("");

  const activeTicker = report?.names.some((row) => row.ticker === selected) ? selected : report?.names[0]?.ticker ?? "";
  useEffect(() => {
    setNote(draftNote(report, activeTicker));
  }, [report, activeTicker]);

  function estimate(nextPrices: string, nextBook: string) {
    setBusy("Estimating the imported history…");
    setComparison(null);
    setCopyNote("");
    window.setTimeout(() => {
      const next = estimateFromCsv(nextPrices, bookFromCsv(nextBook));
      setReport(next);
      setPrices(nextPrices);
      setBook(nextBook);
      setSelected((current) => (next.names.some((row) => row.ticker === current) ? current : next.names[0]?.ticker ?? ""));
      setBusy("");
    }, 30);
  }

  return (
    <RiskView
      report={report}
      comparison={comparison}
      selected={selected}
      busy={busy}
      note={note}
      copyNote={copyNote}
      onSelect={setSelected}
      onNote={setNote}
      onLoadExample={() => estimate(pricesExample, bookExample)}
      onImportPrices={(text) => estimate(text, book)}
      onImportBook={(text) => estimate(prices, text)}
      onCompare={() => {
        if (!report) return;
        setBusy("Running the paired sample on the locked cash flows…");
        window.setTimeout(() => {
          setComparison(compareMethods(report, 200, assumptions.seed, assumptions));
          setBusy("");
        }, 30);
      }}
      onCopy={() => {
        if (!report) return;
        update((current) => copyProposals(current, report));
        setCopyNote(
          "Copied Vasicek betas, horizon idiosyncratic vol, fitted jumps, and fitted degrees of freedom onto the basket. A Vasicek beta is not measured. The projection uses those rows when a sleeve’s pricing is Satellite basket.",
        );
      }}
    />
  );
}
