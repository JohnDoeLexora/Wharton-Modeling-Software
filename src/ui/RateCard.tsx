import { REGIME_TEMPLATE, RATE_REGIMES, applyRegimeTemplate } from "../core/rates";
import type { RateRegime } from "../core/types";
import { useStore } from "../state";
import { LineChart } from "./Chart";
import { NumberField, PercentField } from "./fields";
import { pct } from "./format";

export function RateCard() {
  const { assumptions, output, update } = useStore();
  const rates = assumptions.rates;
  const equity = assumptions.equity;
  const path = output.views.ratePath;
  const template = REGIME_TEMPLATE[rates.regime];

  return (
    <section className="card" id="rate-regime">
      <h3>Rate regime</h3>
      <p className="muted">
        One short-rate path per trial, on stream 4. The curve is three points: bills, intermediate, and long. Choosing
        a regime copies that template’s drift, one-year shock, equity correlation, and equity drag into the fields
        below. It leaves the starting short rate and the mean-reversion speed as you typed them. Templates are
        illustrations, not forecasts. A parametric sleeve ignores this card.
      </p>
      <div className="choice-grid">
        {RATE_REGIMES.map((regime) => (
          <label key={regime} className={rates.regime === regime ? "method on" : "method"}>
            <input
              type="radio"
              name="rate-regime"
              checked={rates.regime === regime}
              onChange={() =>
                update((current) => {
                  const next = applyRegimeTemplate(current.rates, current.equity, regime);
                  return { ...current, rates: next.rates, equity: next.equity };
                })
              }
            />
            <span>
              <strong>{regimeLabel(regime)}</strong>
              <span className="formula">{REGIME_TEMPLATE[regime].label}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="formula">{template.label}</p>
      <div className="choice-grid">
        <PercentField
          label="Short rate at the beginning of 2027"
          value={rates.r0}
          hint="Level of the path. A regime click does not replace this."
          onChange={(r0) => update((a) => ({ ...a, rates: { ...a.rates, r0 } }))}
        />
        <NumberField
          label="Mean-reversion speed κ"
          value={rates.kappa}
          step="0.05"
          hint="Annual step adds κ(θ − r). Zero turns mean reversion off. A regime click does not replace this."
          onChange={(kappa) => update((a) => ({ ...a, rates: { ...a.rates, kappa } }))}
        />
        <PercentField
          label="Reversion level θ"
          value={rates.theta}
          onChange={(theta) => update((a) => ({ ...a, rates: { ...a.rates, theta } }))}
        />
        <PercentField
          label="Short-rate volatility σ"
          value={rates.sigma}
          hint="Zero makes the regime path a single curve. The funded-status table forces this to zero; the portfolio sample does not."
          onChange={(sigma) => update((a) => ({ ...a, rates: { ...a.rates, sigma } }))}
        />
        <PercentField
          label="Intermediate premium over the short rate"
          value={rates.intermediatePremium}
          onChange={(intermediatePremium) => update((a) => ({ ...a, rates: { ...a.rates, intermediatePremium } }))}
        />
        <PercentField
          label="Long premium over the short rate"
          value={rates.longPremium}
          onChange={(longPremium) => update((a) => ({ ...a, rates: { ...a.rates, longPremium } }))}
        />
        <PercentField
          label="Extra long-yield slope"
          value={rates.slope}
          hint="Added on top of the long premium. A parallel move lives in the short rate."
          onChange={(slope) => update((a) => ({ ...a, rates: { ...a.rates, slope } }))}
        />
        <PercentField
          label="Regime pace per year"
          value={rates.driftPerYear}
          hint="Rising and stagflation add it. Falling subtracts the absolute value. Flat and shock-up ignore it."
          onChange={(driftPerYear) => update((a) => ({ ...a, rates: { ...a.rates, driftPerYear } }))}
        />
        <NumberField
          label="Years the pace applies, from 2027"
          value={rates.driftYears}
          step="1"
          onChange={(driftYears) => update((a) => ({ ...a, rates: { ...a.rates, driftYears: Math.round(driftYears) } }))}
        />
        <PercentField
          label="One-year level shock during 2027"
          value={rates.levelShock}
          hint="Shock-up uses this. Other regimes ignore it."
          onChange={(levelShock) => update((a) => ({ ...a, rates: { ...a.rates, levelShock } }))}
        />
        <NumberField
          label="Equity correlation with the rate shock"
          value={rates.equityRateCorr}
          step="0.05"
          hint="Clipped to ±0.999 inside the draw. An illustration, not a measured beta."
          onChange={(equityRateCorr) => update((a) => ({ ...a, rates: { ...a.rates, equityRateCorr } }))}
        />
        <PercentField
          label="Equity regime drag"
          value={equity.regimeDrag}
          hint="Added to equity and single-name expected returns. The stagflation template sets this below zero."
          onChange={(regimeDrag) => update((a) => ({ ...a, equity: { ...a.equity, regimeDrag } }))}
        />
        <NumberField
          label="Market-factor Student-t degrees of freedom"
          value={equity.studentDf}
          step="1"
          hint="Used when no equity-index sleeve supplies its own. Scaled to unit variance. 3 to 30."
          onChange={(studentDf) => update((a) => ({ ...a, equity: { ...a.equity, studentDf: Math.round(studentDf) } }))}
        />
        <PercentField
          label="Basket market μ, if no equity-index sleeve"
          value={equity.marketMu}
          hint="Assumption for the single-name factor. Not a forecast."
          onChange={(marketMu) => update((a) => ({ ...a, equity: { ...a.equity, marketMu } }))}
        />
        <PercentField
          label="Basket market σ, if no equity-index sleeve"
          value={equity.marketSigma}
          onChange={(marketSigma) => update((a) => ({ ...a, equity: { ...a.equity, marketSigma } }))}
        />
        <PercentField
          label="Sector-factor volatility"
          value={equity.sectorSigma}
          hint="Zero turns sector shocks off. Drawn on stream 6."
          onChange={(sectorSigma) => update((a) => ({ ...a, equity: { ...a.equity, sectorSigma } }))}
        />
        <NumberField
          label="Turnover cost"
          value={assumptions.costs.transactionCostBps}
          step="1"
          suffix="bp"
          hint="Charged on annual rebalance after the first year. Zero leaves wealth unchanged."
          onChange={(transactionCostBps) => update((a) => ({ ...a, costs: { transactionCostBps } }))}
        />
      </div>
      {path.length > 0 ? (
        <>
          <LineChart
            years={path.map((row) => row.calendarYear)}
            series={[
              { name: "Short", color: "#0e5f5a", values: path.map((row) => row.short) },
              { name: "Intermediate", color: "#8a4b08", values: path.map((row) => row.intermediate) },
              { name: "Long", color: "#1e3348", values: path.map((row) => row.long) },
            ]}
            ariaLabel="Base-path yields from 2027 to 2042, rate shock set to zero"
            formatTick={(value) => pct(value, 2)}
            downloadName="gao-rate-path"
          />
          <p className="muted">
            Base path, shock set to zero. Bear adds 100 bp to the 2027 step and bull subtracts 100 bp. Monte Carlo
            adds σ times a stream-4 normal. Short rate at the beginning of 2033 on this path:{" "}
            {pct(path.find((row) => row.calendarYear === 2033)?.short, 2)}.
          </p>
        </>
      ) : null}
    </section>
  );
}

function regimeLabel(regime: RateRegime): string {
  if (regime === "shock-up") return "Shock up";
  return regime.charAt(0).toUpperCase() + regime.slice(1);
}
