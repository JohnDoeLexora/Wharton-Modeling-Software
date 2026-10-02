import { useState } from "react";
import { DECISION_YEAR } from "../core/case";
import { caseLiabilityPv, caseLiabilitySchedule, discountFactor } from "../core/liability";
import { rollReserve } from "../core/reserve";
import type { ReserveMethod, ScenarioName } from "../core/types";
import { useStore } from "../state";
import { DisclaimerLine, Issues } from "./bits";
import { LineChart } from "./Chart";
import { PercentField } from "./fields";
import { num, pct, usd } from "./format";

const METHODS: { id: ReserveMethod; title: string; formula: string }[] = [
  {
    id: "ladder",
    title: "Flat-yield ladder",
    formula: "Reserve = Σ 50,000 / (1+y)^k for k = 0…9. The k = 0 payment is due the day the reserve is set aside.",
  },
  {
    id: "duration",
    title: "Present value plus a surplus margin",
    formula: "Reserve = present value at y × (1 + margin). Macaulay duration = Σ k·PV_k / PV. Modified = Macaulay / (1+y).",
  },
  {
    id: "stress",
    title: "Stress path",
    formula: "Same backward induction as the ladder, using one stress return every year. One path, not a probability.",
  },
  {
    id: "shortfall",
    title: "In-sample shortfall target",
    formula:
      "Stream 2 draws one reserve return per interval. For each trial, immunize that path. The reserve is the order statistic that covers the target share. Trial t lines up with portfolio trial t. The shocks are not the portfolio's shocks.",
  },
];

export function ReservePanel() {
  const { assumptions, output, update } = useStore();
  const reserve = assumptions.reserve;
  const [startMode, setStartMode] = useState<"sized" | ScenarioName>("sized");
  const active = output.reserve.active;
  const sized = active.reserve;
  const scenarioWealth = (name: ScenarioName) =>
    output.scenarios[name]?.find((point) => point.calendarYear === DECISION_YEAR)?.wealthStart ?? null;

  let initial = sized;
  if (startMode !== "sized" && sized !== null) {
    const wealth = scenarioWealth(startMode);
    if (wealth !== null) initial = Math.min(sized, Math.max(0, wealth));
  }
  const rows =
    initial === null || output.reserve.scheduleReturns.length === 0
      ? output.reserve.schedule
      : rollReserve({
          initial,
          returnsBetween: output.reserve.scheduleReturns,
          discountYield: reserve.discountYield,
        });

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>Operating reserve</h2>
        <p className="lede">
          Four ways to turn the ten $50,000 payments into a dollar amount. Pick one to inspect its schedule.
          The comparison is arithmetic under your inputs. It is not a ranking and it does not define “high certainty” for you.
        </p>
      </header>
      <Issues />

      <section className="card">
        <h3>Your definition of high funding certainty</h3>
        <p className="muted">The case asks the team to define this. The box starts empty. The software will not fill it in.</p>
        <textarea
          className="note"
          rows={4}
          value={assumptions.certaintyNote}
          placeholder="Example of the kind of sentence the team might write later: “We will call the reserve highly certain when …”"
          onChange={(event) => update((a) => ({ ...a, certaintyNote: event.target.value }))}
        />
      </section>

      <section className="card">
        <h3>Inputs shared by the methods</h3>
        <div className="choice-grid">
          <PercentField
            label="Discount yield y"
            value={reserve.discountYield}
            hint="Ladder size, duration, and the present value used in the funded ratio."
            onChange={(discountYield) => update((a) => ({ ...a, reserve: { ...a.reserve, discountYield } }))}
          />
          <PercentField
            label="Surplus margin"
            value={reserve.surplusMargin}
            hint="Duration method only. 0 means set aside the present value and nothing more."
            onChange={(surplusMargin) => update((a) => ({ ...a, reserve: { ...a.reserve, surplusMargin } }))}
          />
          <PercentField
            label="Stress return"
            value={reserve.stressReturn}
            hint="Flat return on the stress path."
            onChange={(stressReturn) => update((a) => ({ ...a, reserve: { ...a.reserve, stressReturn } }))}
          />
          <PercentField
            label="Shortfall mean μ"
            value={reserve.shortfallMu}
            hint="Expected simple return of the reserve assets in the sample."
            onChange={(shortfallMu) => update((a) => ({ ...a, reserve: { ...a.reserve, shortfallMu } }))}
          />
          <PercentField
            label="Shortfall volatility σ"
            value={reserve.shortfallSigma}
            onChange={(shortfallSigma) => update((a) => ({ ...a, reserve: { ...a.reserve, shortfallSigma } }))}
          />
          <PercentField
            label="Shortfall target"
            value={reserve.shortfallTarget}
            hint="Share of this seeded sample to cover. Not a market probability."
            onChange={(shortfallTarget) => update((a) => ({ ...a, reserve: { ...a.reserve, shortfallTarget } }))}
          />
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            update((a) => {
              const funding = a.sleeves.find((sleeve) => sleeve.id === "funding") ?? a.sleeves[a.sleeves.length - 1];
              if (!funding) return a;
              return { ...a, reserve: { ...a.reserve, shortfallMu: funding.mu, shortfallSigma: funding.sigma } };
            })
          }
        >
          Copy μ and σ from the funding sleeve into the shortfall fields
        </button>
      </section>

      <LiabilityCard yieldPerYear={reserve.discountYield} />

      <section className="card">
        <h3>Method to show on the schedule</h3>
        <div className="method-grid">
          {METHODS.map((method) => (
            <label key={method.id} className={reserve.method === method.id ? "method on" : "method"}>
              <input
                type="radio"
                name="reserve-method"
                checked={reserve.method === method.id}
                onChange={() => update((a) => ({ ...a, reserve: { ...a.reserve, method: method.id } }))}
              />
              <span>
                <strong>{method.title}</strong>
                <span className="formula">{method.formula}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Side-by-side sizes</h3>
        <p className="muted">
          Gap = reserve − beginning-of-2033 wealth on that scenario. A positive gap means that scenario cannot fund the reserve in full.
          Wealth is missing when the portfolio inputs are invalid.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Reserve sizes under the current inputs. Order is not a ranking.</caption>
            <thead>
              <tr>
                <th>Method</th>
                <th>Reserve</th>
                <th>Gap vs bear</th>
                <th>Gap vs base</th>
                <th>Gap vs bull</th>
                <th>Macaulay</th>
                <th>Modified</th>
                <th>In-sample share</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((method) => {
                const sizing = output.reserve.sizings[method.id];
                const gap = (name: ScenarioName) => {
                  const wealth = scenarioWealth(name);
                  if (sizing.reserve === null || wealth === null) return null;
                  return sizing.reserve - wealth;
                };
                return (
                  <tr key={method.id} className={method.id === reserve.method ? "mark" : ""}>
                    <td>{method.title}</td>
                    <td className="num">{usd(sizing.reserve)}</td>
                    <td className="num">{usd(gap("bear"))}</td>
                    <td className="num">{usd(gap("base"))}</td>
                    <td className="num">{usd(gap("bull"))}</td>
                    <td className="num">{num(sizing.macaulayDuration, 2)}</td>
                    <td className="num">{num(sizing.modifiedDuration, 2)}</td>
                    <td className="num">{sizing.achievedProbability === null ? "—" : pct(sizing.achievedProbability, 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="formula">{active.message}</p>
        {output.facility?.portfolioFundedRatio ? (
          <p className="muted">
            {output.facility.portfolioFundedRatio.formula} In this sample, {pct(output.facility.portfolioFundedRatio.shareCovered, 1)} of
            trials can fund the selected reserve. Median funded ratio{" "}
            {num(output.facility.portfolioFundedRatio.percentiles["50"], 2)}.
          </p>
        ) : null}
        {active.pathwiseFundedRatio ? (
          <div className="table-wrap">
            <table>
              <caption>Pathwise funded ratio on stream 2. Sized reserve divided by that path’s immunizing reserve.</caption>
              <thead>
                <tr>
                  <th>Trial</th>
                  <th>Immunizing reserve</th>
                  <th>Funded ratio</th>
                </tr>
              </thead>
              <tbody>
                {active.pathwiseFundedRatio.examples.map((example) => (
                  <tr key={example.trial}>
                    <td className="num">{example.trial}</td>
                    <td className="num">{usd(example.requirement, 0)}</td>
                    <td className="num">{example.fundedRatio === null ? "—" : num(example.fundedRatio, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-row">
          <h3>Schedule, 2033–2042</h3>
          <label className="field">
            <span>Starting assets in this view</span>
            <select value={startMode} onChange={(event) => setStartMode(event.target.value as "sized" | ScenarioName)}>
              <option value="sized">Full sized reserve</option>
              <option value="bear">Bear 2033 wealth, capped at the reserve</option>
              <option value="base">Base 2033 wealth, capped at the reserve</option>
              <option value="bull">Bull 2033 wealth, capped at the reserve</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={reserve.useCustomSchedule}
            onChange={(event) => update((a) => ({ ...a, reserve: { ...a.reserve, useCustomSchedule: event.target.checked } }))}
          />
          Roll the schedule on a year-by-year reinvestment path I type. Sizing still uses the method rate above.
        </label>
        {reserve.useCustomSchedule ? (
          <div className="year-rates">
            {reserve.customReturns.map((rate, index) => (
              <PercentField
                key={2033 + index}
                label={`During ${2033 + index}`}
                value={rate}
                onChange={(next) =>
                  update((a) => {
                    const customReturns = a.reserve.customReturns.slice();
                    customReturns[index] = next;
                    return { ...a, reserve: { ...a.reserve, customReturns } };
                  })
                }
              />
            ))}
          </div>
        ) : null}
        <p className="muted">{output.reserve.scheduleNote} The CSV export always uses the full sized reserve.</p>
        {rows ? (
          <>
            <LineChart
              years={rows.map((row) => row.calendarYear)}
              series={[
                { name: "Reserve assets at start of year", color: "#0e5f5a", values: rows.map((row) => row.boyAssets) },
                { name: "PV of remaining payments", color: "#8a4b08", values: rows.map((row) => row.pvLiability), dash: "5 4" },
                { name: "Undiscounted payments left", color: "#1e3348", values: rows.map((row) => row.undiscountedLiability), dash: "2 3" },
              ]}
              ariaLabel="Reserve assets against remaining operating liability, 2033 to 2042"
              downloadName="gao-reserve-waterline"
            />
            <p className="formula">
              Funded ratio = beginning-of-year assets / present value of payments still due, including today’s, at the discount yield.
              A matched ladder with no surplus sits near 1. That is an identity at the yield you typed, not a probability.
            </p>
            <div className="table-wrap">
              <table>
                <caption>
                  Payment at the beginning of the year, then reinvestment until the next payment. 2042 has no further return.
                  Starting assets in this view: {usd(initial)}.
                </caption>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Assets</th>
                    <th>Due</th>
                    <th>Funded</th>
                    <th>Shortfall</th>
                    <th>After payment</th>
                    <th>Return</th>
                    <th>Next-year assets</th>
                    <th>Liability left</th>
                    <th>PV left</th>
                    <th>Funded ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.calendarYear} className={row.shortfall > 1 ? "bad-row" : ""}>
                      <td>{row.calendarYear}</td>
                      <td className="num">{usd(row.boyAssets)}</td>
                      <td className="num">{usd(row.paymentDue)}</td>
                      <td className="num">{usd(row.paymentFunded)}</td>
                      <td className="num">{usd(row.shortfall)}</td>
                      <td className="num">{usd(row.afterPayment)}</td>
                      <td className="num">{row.reinvestmentReturn === null ? "—" : pct(row.reinvestmentReturn, 2)}</td>
                      <td className="num">{row.reinvestmentReturn === null ? "—" : usd(row.eoyAssets)}</td>
                      <td className="num">{usd(row.undiscountedLiability)}</td>
                      <td className="num">{usd(row.pvLiability)}</td>
                      <td className="num">{row.fundedRatio === null ? "—" : num(row.fundedRatio, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="callout">This method did not produce a finite reserve, so there is no schedule.</p>
        )}
      </section>
      <DisclaimerLine />
    </div>
  );
}

function LiabilityCard({ yieldPerYear }: { yieldPerYear: number }) {
  const liability = caseLiabilitySchedule();
  const pv = caseLiabilityPv(yieldPerYear);
  return (
    <section className="card">
      <h3>Liability cash flows</h3>
      <p>
        {liability.name}. {liability.count} payments of {usd(liability.payment)}, beginning of {liability.firstYear} through{" "}
        {liability.lastYear}. Nominal sum {usd(liability.nominalSum)}. Inflation-linked: no.
      </p>
      <p className="formula">PV = Σ<sub>k=0..9</sub> 50,000 / (1+y)^k. The k = 0 payment is due the day the reserve is set aside.</p>
      <p>
        At the discount yield currently typed, present value is <strong className="num">{usd(pv, 2)}</strong>.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Case operating schedule. These amounts are locked. The discounted column uses the yield above.</caption>
          <thead>
            <tr>
              <th>Year</th>
              <th>k</th>
              <th>Payment</th>
              <th>Discount factor</th>
              <th>Discounted payment</th>
            </tr>
          </thead>
          <tbody>
            {liability.payments.map((payment) => {
              const factor = discountFactor(yieldPerYear, payment.k);
              return (
                <tr key={payment.calendarYear}>
                  <td>{payment.calendarYear}</td>
                  <td className="num">{payment.k}</td>
                  <td className="num">{usd(payment.payment)}</td>
                  <td className="num">{num(factor, 4)}</td>
                  <td className="num">{usd(payment.payment * factor, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
