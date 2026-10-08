import { useMemo, useState } from "react";
import bilExample from "../../examples/bil-buckets.csv?raw";
import govtExample from "../../examples/govt-buckets.csv?raw";
import targetExample from "../../examples/target-fund-buckets.csv?raw";
import { OPERATING_FIRST_YEAR, OPERATING_LAST_YEAR } from "../core/case";
import { assetKeyRates, immunizationGap, liabilityStats, surplusAtRisk } from "../core/immunize";
import {
  billEtfReturn,
  billEtfSimpleYield,
  billReinvestment,
  flatYield,
  fundSnapshot,
  fundYearReturn,
  htmBookValue,
  keyRateDurations,
  mtmValue,
  parseBucketCsv,
  priceTreasury,
  rollBuckets,
  targetMaturityValue,
  type FundBook,
} from "../core/instruments";
import { NumberField, PercentField } from "./fields";
import { num, pct, usd } from "./format";

function readFile(file: File, done: (text: string) => void) {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result ?? ""));
  reader.readAsText(file);
}

export function InstrumentPanel() {
  const [coupon, setCoupon] = useState(0.04);
  const [maturity, setMaturity] = useState(10);
  const [face, setFace] = useState(100);
  const [yieldLevel, setYieldLevel] = useState(0.04);
  const [purchaseYield, setPurchaseYield] = useState(0.04);
  const [held, setHeld] = useState(0);
  const [asOf, setAsOf] = useState(2033);
  const [short, setShort] = useState(0.04);
  const [expense, setExpense] = useState(0.001);
  const [bucketText, setBucketText] = useState("");
  const [book, setBook] = useState<FundBook | null>(null);

  const yieldAt = useMemo(() => flatYield(yieldLevel), [yieldLevel]);
  const quote = priceTreasury({ coupon, yearsToMaturity: maturity, face, yieldAt });
  const keys = keyRateDurations({
    price: (curve) => priceTreasury({ coupon, yearsToMaturity: maturity, face, yieldAt: curve }).dirty,
    yieldAt,
  });
  const htm = htmBookValue({ coupon, yearsToMaturity: maturity, yearsHeld: held, purchaseYield, face });
  const mtm = mtmValue({ coupon, yearsToMaturity: maturity, yearsHeld: held, yieldAt, face });
  const liability = liabilityStats(asOf, yieldAt);
  const assets = book ? assetKeyRates({ buckets: book.buckets, marketValue: liability.pv, yieldAt }) : [];
  const gap = immunizationGap(assets, liability);
  const snap = book ? fundSnapshot(book.buckets, yieldAt) : null;
  const shocked = flatYield(yieldLevel + 0.01);
  const yearReturn = book ? fundYearReturn(book, yieldAt, shocked) : null;
  const rolled = book ? rollBuckets(book.buckets, book.style) : [];
  const targetValue = targetMaturityValue(book?.style === "target_maturity" ? book.yearsToTarget : maturity, yieldAt, coupon, 1);
  const bill = billEtfReturn(short, expense);
  const billSimple = billEtfSimpleYield(short, expense);
  const reinvestment = billReinvestment([short, Math.max(0, short - 0.01), short + 0.01], expense);
  const surplus = surplusAtRisk({
    assetValue: liability.pv,
    assetDuration: snap?.duration ?? quote.modifiedDuration,
    assetConvexity: snap?.convexity ?? quote.convexity,
    liability,
    yieldAt,
    shocks: [
      { name: "+100 bp", dy: 0.01 },
      { name: "−100 bp", dy: -0.01 },
    ],
  });

  function loadBuckets(text: string) {
    setBucketText(text);
    setBook(parseBucketCsv(text));
  }

  return (
    <section className="stack" id="instrument-panel">
      <header className="panel-head">
        <h2>Instruments</h2>
        <p className="deck">
          Prices come from cash flows on the quoted curve. The numbers below are a calculator. They are not a holding and not a fund.
        </p>
      </header>

      <section className="card">
        <h3>Treasury</h3>
        <div className="choice-grid">
          <PercentField label="Coupon" value={coupon} onChange={setCoupon} />
          <NumberField label="Years to maturity" value={maturity} step="0.25" onChange={setMaturity} />
          <NumberField label="Face" value={face} step="1" onChange={setFace} />
          <PercentField label="Flat annual zero" value={yieldLevel} onChange={setYieldLevel} />
          <PercentField label="Purchase yield, for HTM" value={purchaseYield} onChange={setPurchaseYield} />
          <NumberField label="Years already held" value={held} step="0.25" onChange={setHeld} />
        </div>
        <p>
          Dirty {num(quote.dirty, 4)}. Clean {num(quote.clean, 4)}. Accrued {num(quote.accrued, 4)}.
          Duration {num(quote.modifiedDuration, 2)}y. Convexity {num(quote.convexity, 2)}.
          HTM book {num(htm, 4)}. Mark-to-market {num(mtm, 4)}.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Key-rate durations of this bond</caption>
            <thead><tr><th>Key</th><th>KRD</th></tr></thead>
            <tbody>
              {keys.map((row) => (
                <tr key={row.tenor}><td>{row.tenor}y</td><td>{num(row.krd, 3)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Bond ETF buckets</h3>
        <p className="muted">
          A constant-maturity book rolls down for the year’s return, then buys the original maturity back at the model price.
          A target-maturity book shortens. At the liquidation date its value is cash. Expense drag is multiplicative.
        </p>
        <div className="row-actions">
          <button type="button" id="load-example-buckets" onClick={() => loadBuckets(govtExample)}>Load example buckets</button>
          <button type="button" className="ghost" onClick={() => loadBuckets(bilExample)}>Load bill-fund shape</button>
          <button type="button" className="ghost" onClick={() => loadBuckets(targetExample)}>Load target-maturity shape</button>
          <label className="ghost file-button">
            Import buckets CSV
            <input className="sr-only" aria-label="Import buckets CSV" type="file" accept=".csv,text/csv" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file, loadBuckets);
            }} />
          </label>
        </div>
        <label className="field wide">
          <span>Buckets CSV</span>
          <textarea className="note" rows={5} value={bucketText} onChange={(event) => loadBuckets(event.target.value)} />
        </label>
        {snap && book ? (
          <>
            <p>
              Style {book.style}. Expense {pct(book.expenseRatio, 3)}. Dirty per face {num(snap.dirty, 4)}.
              Duration {num(snap.duration, 2)}y. Convexity {num(snap.convexity, 2)}.
              One-year return if the flat zero rises 100 bp, after the expense: {pct(yearReturn, 2)}.
              Target-style value with {num(book.yearsToTarget, 2)} years left, per 1 face: {num(targetValue, 4)}.
            </p>
            <div className="table-wrap">
              <table>
                <caption>Buckets after one roll</caption>
                <thead><tr><th>Maturity now</th><th>Weight</th><th>After one year</th></tr></thead>
                <tbody>
                  {book.buckets.map((row, index) => (
                    <tr key={`${row.maturityYears}-${index}`}>
                      <td>{num(row.maturityYears, 2)}</td>
                      <td>{pct(row.weight, 1)}</td>
                      <td>{num(rolled[index]?.maturityYears ?? 0, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <p>Import maturity buckets to price a fund. The editor starts empty.</p>}
        <div className="choice-grid">
          <PercentField label="Short quote for a bills ETF" value={short} onChange={setShort} />
          <PercentField label="Bills expense ratio" value={expense} onChange={setExpense} />
        </div>
        <p>
          Bills yield, short minus expense: {pct(billSimple, 3)}. Multiplicative net return: {pct(bill, 3)}.
          Reinvested wealth of 1 over a 1-point path: {num(reinvestment.reinvested.at(-1) ?? null, 4)}. Locked at the first yield: {num(reinvestment.locked.at(-1) ?? null, 4)}.
        </p>
      </section>

      <section className="card" id="immunization-report">
        <h3>Liability and immunization</h3>
        <p className="muted">
          The liability is the case schedule: $50,000 at the beginning of each year from {OPERATING_FIRST_YEAR} through {OPERATING_LAST_YEAR}.
          The gap is asset dollar key-rate duration minus liability dollar key-rate duration. Surplus-at-risk reprices the liability and shifts the assets with duration and convexity.
        </p>
        <NumberField label="Valuation year" value={asOf} step="1" onChange={(year) => setAsOf(Math.round(year))} />
        <p>
          Present value {usd(liability.pv)}. Duration {num(liability.modifiedDuration, 2)}y. Convexity {num(liability.convexity, 1)}.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Key-rate gap at this valuation year</caption>
            <thead>
              <tr><th>Key</th><th>Asset KRD</th><th>Liability KRD</th><th>Asset $</th><th>Liability $</th><th>Gap</th></tr>
            </thead>
            <tbody>
              {gap.map((row) => (
                <tr key={row.tenor}>
                  <td>{row.tenor}y</td>
                  <td>{num(row.assetKrd, 3)}</td>
                  <td>{num(row.liabilityKrd, 3)}</td>
                  <td>{usd(row.assetDollar)}</td>
                  <td>{usd(row.liabilityDollar)}</td>
                  <td>{usd(row.gap)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table>
            <caption>Surplus after a parallel quote shift</caption>
            <thead><tr><th>Shock</th><th>Assets</th><th>Liability PV</th><th>Surplus</th><th>Change</th></tr></thead>
            <tbody>
              {surplus.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{usd(row.assetValue)}</td>
                  <td>{usd(row.liabilityPv)}</td>
                  <td>{usd(row.surplus)}</td>
                  <td>{usd(row.surplusChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
