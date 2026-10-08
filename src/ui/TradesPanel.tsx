import { useMemo, useState } from "react";
import { useBook } from "../bookState";
import {
  BOND_COUNTRIES,
  buildTradeSheet,
  marketFromCsv,
  tradeSheetToCsv,
  type BondCountry,
  type RulesConfig,
} from "../core/holdings";
import { onTableArrow, SourceTip } from "./bits";
import { compactUsd, download } from "./format";

export function TradesPanel() {
  const { holdings, market, setMarket, rules, setRules } = useBook();
  const [text, setText] = useState("");
  const sheet = useMemo(() => buildTradeSheet(holdings, market, rules), [holdings, market, rules]);
  const failing = sheet.checks.filter((check) => !check.ok).length;
  return (
    <div className="stack" id="trades-panel">
      <header className="panel-head">
        <h2>Trades</h2>
        <p className="lede">
          Rules start from the 2026 WInS Trading Details email. Edit them if the note you have says something else.
          The sheet buys whole shares, or bond face in the increment below, and leaves the rest as cash so the total
          equals the capital.
        </p>
      </header>
      <section className="card" id="rules-config">
        <h3>
          <SourceTip label="Competition rules" source={rules.source} />
        </h3>
        <div className="choice-grid">
          <NumberRule label="Starting capital ($)" value={rules.startingCapital} onChange={(startingCapital) => setRules({ ...rules, startingCapital })} />
          <NumberRule label="Minimum stock price ($)" value={rules.minStockPrice} onChange={(minStockPrice) => setRules({ ...rules, minStockPrice })} />
          <NumberRule label="Max trades" value={rules.maxTrades} onChange={(maxTrades) => setRules({ ...rules, maxTrades })} />
          <NumberRule label="Volume multiple" value={rules.volumeMultiple} onChange={(volumeMultiple) => setRules({ ...rules, volumeMultiple })} />
          <NumberRule label="Bond face increment ($)" value={rules.faceIncrement} onChange={(faceIncrement) => setRules({ ...rules, faceIncrement })} />
        </div>
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={rules.allowShort} onChange={(event) => setRules({ ...rules, allowShort: event.target.checked })} />
            Allow shorting
          </label>
          <label className="check">
            <input type="checkbox" checked={rules.allowMargin} onChange={(event) => setRules({ ...rules, allowMargin: event.target.checked })} />
            Allow margin
          </label>
          <label className="check">
            <input type="checkbox" checked={rules.etfsAllowed} onChange={(event) => setRules({ ...rules, etfsAllowed: event.target.checked })} />
            WInS ETFs allowed
          </label>
          <label className="check">
            <input type="checkbox" checked={rules.bondsAllowed} onChange={(event) => setRules({ ...rules, bondsAllowed: event.target.checked })} />
            WInS treasuries allowed
          </label>
        </div>
        <p className="muted">Treasury countries: {rules.bondCountries.join(", ")}. Toggle a country to drop it from the allowed list.</p>
        <div className="row-actions">
          {BOND_COUNTRIES.map((country) => (
            <button
              key={country}
              type="button"
              className={rules.bondCountries.includes(country) ? "" : "ghost"}
              onClick={() => setRules({ ...rules, bondCountries: toggleCountry(rules, country) })}
            >
              {country}
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h3>
          <SourceTip
            label="Market snapshot"
            source="CSV columns: ticker, price, avg_daily_volume, as_of, kind, clean_price, accrued, coupon, maturity, name. You type or import this. The app does not fetch prices."
          />
        </h3>
        <textarea
          className="note"
          rows={5}
          aria-label="Market snapshot CSV"
          placeholder={"ticker,price,avg_daily_volume,as_of,kind,clean_price,accrued,coupon,maturity,name"}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="row-actions">
          <button
            type="button"
            onClick={() => {
              const parsed = marketFromCsv(text);
              if (parsed.length > 0) setMarket(parsed);
            }}
          >
            Import snapshot
          </button>
          <span className="muted">{market.length} snapshot row{market.length === 1 ? "" : "s"}.</span>
        </div>
      </section>
      <section className="card" id="trade-sheet">
        <div className="section-row">
          <h3>Trade sheet</h3>
          <div className="row-actions">
            <button type="button" onClick={() => download("trade sheet.csv", tradeSheetToCsv(sheet), "text/csv")}>
              Export CSV
            </button>
            <button type="button" className="ghost" onClick={() => download("trade sheet.html", sheetHtml(sheet), "text/html")}>
              One-page sheet
            </button>
          </div>
        </div>
        {sheet.bookErrors.length > 0 ? (
          <div className="issues" role="alert">
            <ul>
              {sheet.bookErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className={failing === 0 && sheet.balanced ? "status ok" : "status"}>
          {sheet.orders.length} orders. {failing === 0 ? "Every order passes." : `${failing} order${failing === 1 ? "" : "s"} fail.`} Total{" "}
          {compactUsd(sheet.total)}. Cash {compactUsd(sheet.cash)}. {sheet.balanced ? "Total equals capital." : "Total does not equal capital."}
        </p>
        <div className="table-wrap" onKeyDown={onTableArrow}>
          <table>
            <caption>Generated orders. The check column is pass or fail with a reason.</caption>
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Sleeve</th>
                <th>Qty or face</th>
                <th>Amount</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {sheet.orders.length === 0 ? (
                <tr>
                  <td colSpan={6}>Add holdings with a positive weight. Then import a snapshot so prices and volume exist.</td>
                </tr>
              ) : (
                sheet.orders.map((order) => (
                  <tr key={order.order} className={order.check.ok ? undefined : "bad-row"}>
                    <td>{order.order}</td>
                    <td>
                      {order.ticker}
                      <small className="sub">{order.name}</small>
                    </td>
                    <td>{order.sleeve}</td>
                    <td className="num">{order.qtyOrFace}</td>
                    <td className="num">{compactUsd(order.amount)}</td>
                    <td>{order.check.ok ? order.check.reason : `FAIL: ${order.check.reason}`}</td>
                  </tr>
                ))
              )}
              <tr>
                <td></td>
                <td>CASH</td>
                <td>Cash</td>
                <td></td>
                <td className="num">{compactUsd(sheet.cash)}</td>
                <td>{sheet.cash >= -0.001 ? "PASS: leftover cash" : "FAIL: negative cash"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function NumberRule({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        aria-label={label}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}

function toggleCountry(rules: RulesConfig, country: BondCountry): BondCountry[] {
  return rules.bondCountries.includes(country) ? rules.bondCountries.filter((item) => item !== country) : [...rules.bondCountries, country];
}

function sheetHtml(sheet: ReturnType<typeof buildTradeSheet>): string {
  const rows = sheet.orders
    .map(
      (order) =>
        `<tr><td>${order.order}</td><td>${escapeHtml(order.ticker)}</td><td>${escapeHtml(order.sleeve)}</td><td>${escapeHtml(order.qtyOrFace)}</td><td>${order.amount.toFixed(2)}</td><td>${escapeHtml(order.check.ok ? order.check.reason : "FAIL: " + order.check.reason)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Trade sheet</title>
<style>body{font:14px "Segoe UI",sans-serif;margin:24px;color:#1c1915}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #ddd4c3;padding:6px;text-align:left}h1{font-family:Georgia,serif}</style></head>
<body><h1>Trade sheet</h1><p>Total $${sheet.total.toFixed(2)}. Cash $${sheet.cash.toFixed(2)}. ${sheet.balanced ? "The total equals the capital." : "The total does not equal the capital."} Not an investment recommendation.</p>
<table><thead><tr><th>#</th><th>Ticker</th><th>Sleeve</th><th>Qty</th><th>Amount</th><th>Check</th></tr></thead><tbody>${rows}
<tr><td></td><td>CASH</td><td>Cash</td><td></td><td>${sheet.cash.toFixed(2)}</td><td>Leftover</td></tr></tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char] ?? char);
}
