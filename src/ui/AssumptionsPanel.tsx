import { placeholderBond, creditFlag } from "../core/bonds";
import { newSleeve } from "../core/defaults";
import { normalizeWeights, weightsAtYear } from "../core/glide";
import type { Assumptions, ShockModel, Sleeve, SleeveKind } from "../core/types";
import { useStore } from "../state";
import { BasketEditor } from "./BasketEditor";
import { CaseTimeline, Issues, TagPill } from "./bits";
import { LineChart, StackedWeights } from "./Chart";
import { NumberField, PercentField } from "./fields";
import { Inspector } from "./Inspector";
import { MixEditor } from "./MixEditor";
import { RateCard } from "./RateCard";

const KIND_LABEL: Record<SleeveKind, string> = {
  parametric: "Parametric μ/σ (ignores the rate path)",
  tbill: "T-bills (duration and carry)",
  intermediate: "Intermediate Treasuries",
  long_treasury: "Long Treasuries",
  credit: "Credit (spread, default, recovery)",
  equity_index: "Broad equity index (Student-t)",
  basket: "Satellite basket (one-factor names)",
};

const SLEEVE_COLORS = ["#0e5f5a", "#8a4b08", "#1e3348", "#8d2b2b", "#3d5a3a", "#6b4c7a"];

export function AssumptionsPanel() {
  const { assumptions, update, resetZeros, loadTeaching } = useStore();
  const years = range(2027, 2042);
  const weightSeries = assumptions.sleeves.map((sleeve, index) => ({
    name: sleeve.name,
    color: SLEEVE_COLORS[index % SLEEVE_COLORS.length],
    values: years.map((year) => weightsAtYear(assumptions.glide, year)[index] ?? 0),
  }));

  return (
    <div className="stack">
      <header className="panel-head">
        <div>
          <h2>Assumptions</h2>
          <TagPill />
        </div>
        <p className="lede">
          Amber fields are inputs for the team to explore. The case timeline and the two contributions are locked.
          A 0% return is the starting point so the screen does not smuggle in a market view.
        </p>
      </header>
      <Issues />

      <section className="card locked">
        <h3>Case facts</h3>
        <p>
          Year N is {2026}+N. Living expenses stay outside the portfolio. The ten operating payments are a fixed
          $50,000 at the beginning of each year from 2033 through 2042, not adjusted for inflation. There is no
          preset facility contribution. Personal taxes and the legal setup of a residency in Taiwan are out of scope.
          WInS trading profit and loss is not an input to any projection.
        </p>
        <CaseTimeline />
      </section>

      <section className="card">
        <div className="section-row">
          <h3>Sleeves</h3>
          <div className="row-actions">
            <button type="button" className="ghost" onClick={() => update(addSleeve)} disabled={assumptions.sleeves.length >= 6}>
              Add sleeve
            </button>
          </div>
        </div>
        <p className="muted">
          Names are labels for roles you want to compare, such as growth versus funding. They are not a list of
          funds to buy. Scenario columns are the deterministic bull, base, and bear paths. μ and σ feed Monte Carlo only.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Editable return assumptions by sleeve</caption>
            <thead>
              <tr>
                <th>Label</th>
                <th>μ</th>
                <th>σ</th>
                <th>Bear</th>
                <th>Base</th>
                <th>Bull</th>
                <th>Pricing</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assumptions.sleeves.map((sleeve, index) => (
                <tr key={sleeve.id}>
                  <td>
                    <input
                      aria-label={`Sleeve ${index + 1} name`}
                      value={sleeve.name}
                      onChange={(event) => update((a) => patchSleeve(a, index, { name: event.target.value }))}
                    />
                  </td>
                  <td>
                    <PercentField bare label="Expected return" value={sleeve.mu} onChange={(mu) => update((a) => patchSleeve(a, index, { mu }))} />
                  </td>
                  <td>
                    <PercentField bare label="Volatility" value={sleeve.sigma} onChange={(sigma) => update((a) => patchSleeve(a, index, { sigma }))} />
                  </td>
                  <td>
                    <PercentField bare label="Bear return" value={sleeve.bear} onChange={(bear) => update((a) => patchSleeve(a, index, { bear }))} />
                  </td>
                  <td>
                    <PercentField bare label="Base return" value={sleeve.base} onChange={(base) => update((a) => patchSleeve(a, index, { base }))} />
                  </td>
                  <td>
                    <PercentField bare label="Bull return" value={sleeve.bull} onChange={(bull) => update((a) => patchSleeve(a, index, { bull }))} />
                  </td>
                  <td>
                    <select
                      aria-label={`Sleeve ${index + 1} pricing`}
                      value={sleeve.kind}
                      onChange={(event) => {
                        const kind = event.target.value as SleeveKind;
                        update((a) => patchSleeve(a, index, { kind, ...placeholderBond(kind) }));
                      }}
                    >
                      {(Object.keys(KIND_LABEL) as SleeveKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text"
                      disabled={assumptions.sleeves.length <= 1}
                      onClick={() => update((a) => removeSleeve(a, index))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SleevePricing />
      </section>

      <RateCard />
      <BasketEditor />
      <MixEditor />

      <section className="card">
        <div className="section-row">
          <h3>Glide path</h3>
          <div className="row-actions">
            <button type="button" className="ghost" onClick={() => update(normalizeAll)}>
              Normalize knots to 100%
            </button>
            <button type="button" className="ghost" onClick={() => update(addKnot)}>
              Add knot
            </button>
          </div>
        </div>
        <p className="muted">
          Weights are the policy mix at the beginning of that year. Between knots the mix is a straight line.
          Before the first knot and after the last knot, the nearest knot is held. The two starter knots are equal,
          so the path is flat until you bend it. Annual rebalancing resets the whole portfolio to these weights.
          Drift mode applies them only to new contributions.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Policy weights by year</caption>
            <thead>
              <tr>
                <th>Year</th>
                {assumptions.sleeves.map((sleeve) => (
                  <th key={sleeve.id}>{sleeve.name}</th>
                ))}
                <th>Sum</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assumptions.glide
                .map((knot, index) => ({ knot, index }))
                .sort((a, b) => a.knot.year - b.knot.year)
                .map(({ knot, index }) => {
                  const total = knot.weights.reduce((sum, weight) => sum + weight, 0);
                  return (
                    <tr key={`${knot.year}-${index}`}>
                      <td>
                        <NumberField
                          bare
                          label={`Knot ${index + 1} year`}
                          value={knot.year}
                          step="1"
                          onChange={(year) => update((a) => patchKnot(a, index, { year: Math.round(year) }))}
                        />
                      </td>
                      {knot.weights.map((weight, sleeveIndex) => (
                        <td key={assumptions.sleeves[sleeveIndex]?.id ?? sleeveIndex}>
                          <PercentField
                            bare
                            label={`${knot.year} weight ${sleeveIndex + 1}`}
                            value={weight}
                            onChange={(next) =>
                              update((a) => {
                                const glide = a.glide.map((item, itemIndex) => {
                                  if (itemIndex !== index) return item;
                                  const weights = item.weights.slice();
                                  weights[sleeveIndex] = next;
                                  return { ...item, weights };
                                });
                                return { ...a, glide };
                              })
                            }
                          />
                        </td>
                      ))}
                      <td className={Math.abs(total - 1) < 1e-6 ? "num ok" : "num bad"}>{(total * 100).toFixed(1)}%</td>
                      <td>
                        <button type="button" className="text" disabled={assumptions.glide.length <= 1} onClick={() => update((a) => ({ ...a, glide: a.glide.filter((_, i) => i !== index) }))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <LineChart
          years={years}
          series={weightSeries}
          ariaLabel="Glide-path weights from 2027 to 2042"
          markers={[2031, 2033]}
          formatTick={(value) => `${Math.round(value * 100)}%`}
          yDomain={[0, 1]}
          downloadName="gao-glide-weights"
        />
        <p className="muted">The chart shows weights, not dollars. The vertical scale is a share of the portfolio.</p>
        <StackedWeights years={years} series={weightSeries} ariaLabel="Stacked glide-path mix from 2027 to 2042" />
        <p className="muted">The stacked preview is the same knots, drawn as a mix that fills the portfolio. A gap under 100% is a knot that does not sum to 1.</p>
      </section>

      <section className="card">
        <h3>Correlation of Monte Carlo shocks</h3>
        <p className="muted">
          Correlation is applied to the normal shocks before the return model (a Gaussian copula). It does not
          affect the bull, base, or bear paths. Diagonal cells stay at 1.
        </p>
        <div className="table-wrap">
          <table className="matrix">
            <caption>Shock correlation</caption>
            <thead>
              <tr>
                <th></th>
                {assumptions.sleeves.map((sleeve) => (
                  <th key={sleeve.id}>{sleeve.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assumptions.sleeves.map((rowSleeve, i) => (
                <tr key={rowSleeve.id}>
                  <th>{rowSleeve.name}</th>
                  {assumptions.sleeves.map((colSleeve, j) => (
                    <td key={colSleeve.id}>
                      {i === j ? (
                        <span className="num">1</span>
                      ) : (
                        <NumberField
                          bare
                          label={`Correlation ${i + 1}, ${j + 1}`}
                          value={assumptions.correlation[i]?.[j] ?? 0}
                          step="0.05"
                          onChange={(value) => update((a) => setCorrelation(a, i, j, value))}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h3>Simulation choices</h3>
        <div className="choice-grid">
          <label className="field">
            <span>Rebalancing</span>
            <select
              value={assumptions.rebalance}
              onChange={(event) => update((a) => ({ ...a, rebalance: event.target.value as Assumptions["rebalance"] }))}
            >
              <option value="annual">Rebalance to the glide path every year</option>
              <option value="drift">Let sleeve weights drift; new cash follows the glide</option>
            </select>
          </label>
          <label className="field">
            <span>Monte Carlo return model</span>
            <select
              value={assumptions.returnModel}
              onChange={(event) => update((a) => ({ ...a, returnModel: event.target.value as Assumptions["returnModel"] }))}
            >
              <option value="lognormal">Lognormal (cannot lose more than the sleeve)</option>
              <option value="normal">Normal, with a floor</option>
            </select>
          </label>
          {assumptions.returnModel === "normal" ? (
            <PercentField
              label="Normal-model floor"
              value={assumptions.normalFloor}
              hint="Simple return is not allowed below this. Default is just above −100%."
              onChange={(normalFloor) => update((a) => ({ ...a, normalFloor }))}
            />
          ) : null}
          <PercentField
            label="Inflation, for the purchasing-power view only"
            value={assumptions.inflation}
            hint="Does not change the $50,000 payments. They stay nominal."
            onChange={(inflation) => update((a) => ({ ...a, inflation }))}
          />
          <NumberField
            label="Monte Carlo trials"
            value={assumptions.trials}
            step="1"
            hint="Whole number from 50 to 20,000."
            onChange={(trials) => update((a) => ({ ...a, trials: Math.round(trials) }))}
          />
          <NumberField
            label="Random seed"
            value={assumptions.seed}
            step="1"
            hint="Master seed. Streams 1–3 are portfolio, reserve, and bootstrap. Stream 4 is the short rate, stream 5 is credit default, stream 6 is single-name shocks. Quote it with the run package."
            onChange={(seed) => update((a) => ({ ...a, seed: Math.round(seed) }))}
          />
          <NumberField
            label="Correlation stress"
            value={assumptions.correlationStress}
            step="0.05"
            hint="Added to every off-diagonal, then clipped to ±0.999. Zero leaves the typed matrix unchanged."
            onChange={(correlationStress) => update((a) => ({ ...a, correlationStress }))}
          />
          <label className="field">
            <span>Shock model</span>
            <select
              value={assumptions.shockModel}
              onChange={(event) => update((a) => ({ ...a, shockModel: event.target.value as ShockModel }))}
            >
              <option value="parametric">Parametric: μ, σ, and the Gaussian copula</option>
              <option value="block_bootstrap">Circular block bootstrap of rows you type</option>
            </select>
            <small>Bootstrap ignores μ, σ, and the copula on the Monte Carlo paths. Scenario paths still use bear, base, and bull.</small>
          </label>
          {assumptions.shockModel === "block_bootstrap" ? (
            <>
              <NumberField
                label="Block length"
                value={assumptions.blockLength}
                step="1"
                hint="1 resamples single rows. Longer blocks keep consecutive rows together, wrapping around the list."
                onChange={(blockLength) => update((a) => ({ ...a, blockLength: Math.round(blockLength) }))}
              />
              <BootstrapEditor />
            </>
          ) : null}
        </div>
        <p className="formula">
          Parametric draw: z = Box–Muller at (master seed, stream 1, trial, calendar year, sleeve), then Lz. Lognormal
          matches E[1+r] = 1+μ and Var(1+r) = σ². The 2031–2033 band reuses those same 2031 and 2032 draws.
        </p>
        <PercentileEditor />
      </section>

      <Inspector />

      <section className="card actions-card">
        <h3>Reset the workspace inputs</h3>
        <p>Research notes are kept. These buttons replace sleeves, the glide path, reserve inputs, and facility rules.</p>
        <div className="row-actions">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Replace the current assumptions with the zero-return starting point?")) resetZeros();
            }}
          >
            Reset to zero returns
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (
                window.confirm(
                  "Load round teaching numbers so the charts move? They are not a strategy and should not be pasted into a deliverable.",
                )
              )
                loadTeaching();
            }}
          >
            Load teaching example
          </button>
        </div>
      </section>
    </div>
  );
}

function BootstrapEditor() {
  const { assumptions, update } = useStore();
  const text = assumptions.bootstrapHistory
    .map((row) => row.map((value) => String(Math.round(value * 100000) / 1000)).join(", "))
    .join("\n");
  return (
    <label className="field wide">
      <span>Historical sleeve returns, in percent</span>
      <textarea
        className="note"
        rows={5}
        defaultValue={text}
        key={text}
        aria-label="Bootstrap history"
        placeholder={"7, 3\n-4, 1"}
        onBlur={(event) => {
          const rows = event.target.value
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => line.split(/[, ]+/).filter((part) => part.length > 0).map((part) => Number(part) / 100));
          if (rows.length === 0) {
            update((current) => ({ ...current, bootstrapHistory: [] }));
            return;
          }
          if (rows.some((row) => row.length !== assumptions.sleeves.length || row.some((value) => !Number.isFinite(value)))) {
            return;
          }
          update((current) => ({ ...current, bootstrapHistory: rows }));
        }}
      />
      <small>
        One period per line, sleeve order left to right, in percent. A line that does not match the sleeve count is ignored
        until it does.
      </small>
    </label>
  );
}

function PercentileEditor() {
  const { assumptions, update } = useStore();
  const text = assumptions.percentiles.map((p) => String(Math.round(p * 1000) / 10)).join(", ");
  return (
    <label className="field wide">
      <span>Wealth percentiles to report</span>
      <input
        defaultValue={text}
        key={text}
        aria-label="Percentiles"
        onBlur={(event) => {
          const values = event.target.value
            .split(/[, ]+/)
            .map((part) => Number(part))
            .filter((part) => Number.isFinite(part))
            .map((part) => (part > 1 ? part / 100 : part));
          if (values.length > 0) update((a) => ({ ...a, percentiles: values }));
        }}
      />
      <small>Type numbers such as 5, 25, 50, 75, 95. They are percents of the simulated sample.</small>
    </label>
  );
}

function SleevePricing() {
  const { assumptions, update } = useStore();
  return (
    <div className="stack tight">
      <p className="muted">
        Changing the pricing rule copies round duration, spread, and default placeholders into that sleeve. Those
        numbers are assumptions, not forecasts. A parametric sleeve keeps μ, σ, and the scenario columns and ignores
        the rate path. Credit is not a Treasury bill.
      </p>
      {assumptions.sleeves.map((sleeve, index) => (
        <details key={sleeve.id} open={sleeve.kind !== "parametric"}>
          <summary>
            {sleeve.name} · {KIND_LABEL[sleeve.kind]}
          </summary>
          {creditFlag(sleeve) ? <p className="callout warn">{creditFlag(sleeve)}</p> : null}
          <div className="choice-grid">
            <PercentField
              label={`${sleeve.name} expense ratio`}
              value={sleeve.expenseRatio}
              hint="Applied as (1+r)·(1−fee)−1. Zero leaves the return unchanged."
              onChange={(expenseRatio) => update((a) => patchSleeve(a, index, { expenseRatio }))}
            />
            {sleeve.kind === "tbill" || sleeve.kind === "intermediate" || sleeve.kind === "long_treasury" || sleeve.kind === "credit" ? (
              <>
                <NumberField
                  label={`${sleeve.name} modified duration`}
                  value={sleeve.duration}
                  step="0.1"
                  suffix="y"
                  hint="Placeholder when you switch kind. Edit it."
                  onChange={(duration) => update((a) => patchSleeve(a, index, { duration }))}
                />
                <NumberField
                  label={`${sleeve.name} convexity`}
                  value={sleeve.convexity}
                  step="1"
                  hint="Price term is ½ · convexity · dy²."
                  onChange={(convexity) => update((a) => patchSleeve(a, index, { convexity }))}
                />
              </>
            ) : null}
            {sleeve.kind === "credit" ? (
              <>
                <PercentField
                  label={`${sleeve.name} credit spread`}
                  value={sleeve.spread}
                  hint="Added to the intermediate yield. Assumption, not a quote."
                  onChange={(spread) => update((a) => patchSleeve(a, index, { spread }))}
                />
                <PercentField
                  label={`${sleeve.name} annual default probability`}
                  value={sleeve.defaultProb}
                  onChange={(defaultProb) => update((a) => patchSleeve(a, index, { defaultProb }))}
                />
                <PercentField
                  label={`${sleeve.name} recovery`}
                  value={sleeve.recovery}
                  hint="Loss given default is 1 − recovery."
                  onChange={(recovery) => update((a) => patchSleeve(a, index, { recovery }))}
                />
                <NumberField
                  label={`${sleeve.name} spread beta`}
                  value={sleeve.spreadBeta}
                  step="0.1"
                  hint="Spread widens by this times the equity loss, when the equity factor is negative."
                  onChange={(spreadBeta) => update((a) => patchSleeve(a, index, { spreadBeta }))}
                />
                <label className="field">
                  <span>Issuer label</span>
                  <input
                    aria-label={`${sleeve.name} issuer`}
                    value={sleeve.issuer}
                    placeholder="Label only. Not a CUSIP."
                    onChange={(event) => update((a) => patchSleeve(a, index, { issuer: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Flags</span>
                  <span className="entry">
                    <input
                      type="checkbox"
                      checked={sleeve.tradable}
                      aria-label={`${sleeve.name} publicly tradable`}
                      onChange={(event) => update((a) => patchSleeve(a, index, { tradable: event.target.checked }))}
                    />
                    Publicly tradable
                  </span>
                  <span className="entry">
                    <input
                      type="checkbox"
                      checked={sleeve.winsEligible}
                      aria-label={`${sleeve.name} WInS eligible`}
                      onChange={(event) => update((a) => patchSleeve(a, index, { winsEligible: event.target.checked }))}
                    />
                    WInS eligible
                  </span>
                </label>
              </>
            ) : null}
            {sleeve.kind === "equity_index" ? (
              <NumberField
                label={`${sleeve.name} Student-t degrees of freedom`}
                value={sleeve.studentDf}
                step="1"
                hint="Around 5 is a fat-tail illustration. The draw is scaled to unit variance. 3 to 30."
                onChange={(studentDf) => update((a) => patchSleeve(a, index, { studentDf: Math.round(studentDf) }))}
              />
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

function range(start: number, end: number): number[] {
  const years: number[] = [];
  for (let year = start; year <= end; year++) years.push(year);
  return years;
}

function patchSleeve(assumptions: Assumptions, index: number, patch: Partial<Sleeve>): Assumptions {
  return {
    ...assumptions,
    sleeves: assumptions.sleeves.map((sleeve, sleeveIndex) => (sleeveIndex === index ? { ...sleeve, ...patch } : sleeve)),
  };
}

function addSleeve(assumptions: Assumptions): Assumptions {
  if (assumptions.sleeves.length >= 6) return assumptions;
  const id = `sleeve-${Math.random().toString(36).slice(2, 7)}`;
  const sleeve: Sleeve = newSleeve(id, "New sleeve (label only)");
  const count = assumptions.sleeves.length + 1;
  const correlation = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => {
      if (row === col) return 1;
      if (row < assumptions.sleeves.length && col < assumptions.sleeves.length) {
        return assumptions.correlation[row]?.[col] ?? 0;
      }
      return 0;
    }),
  );
  return {
    ...assumptions,
    sleeves: [...assumptions.sleeves, sleeve],
    glide: assumptions.glide.map((knot) => ({ ...knot, weights: [...knot.weights, 0] })),
    correlation,
  };
}

function removeSleeve(assumptions: Assumptions, index: number): Assumptions {
  if (assumptions.sleeves.length <= 1) return assumptions;
  const keep = assumptions.sleeves.map((_, sleeveIndex) => sleeveIndex).filter((sleeveIndex) => sleeveIndex !== index);
  return {
    ...assumptions,
    sleeves: keep.map((sleeveIndex) => assumptions.sleeves[sleeveIndex]),
    glide: assumptions.glide.map((knot) => ({ ...knot, weights: keep.map((sleeveIndex) => knot.weights[sleeveIndex] ?? 0) })),
    correlation: keep.map((row) => keep.map((col) => assumptions.correlation[row]?.[col] ?? (row === col ? 1 : 0))),
  };
}

function patchKnot(assumptions: Assumptions, index: number, patch: { year: number }): Assumptions {
  return {
    ...assumptions,
    glide: assumptions.glide.map((knot, knotIndex) => (knotIndex === index ? { ...knot, year: patch.year } : knot)),
  };
}

function addKnot(assumptions: Assumptions): Assumptions {
  const used = new Set(assumptions.glide.map((knot) => knot.year));
  let year = 2030;
  while (used.has(year) && year < 2042) year += 1;
  const weights = weightsAtYear(assumptions.glide, year);
  return { ...assumptions, glide: [...assumptions.glide, { year, weights }] };
}

function normalizeAll(assumptions: Assumptions): Assumptions {
  return {
    ...assumptions,
    glide: assumptions.glide.map((knot) => ({ ...knot, weights: normalizeWeights(knot.weights) })),
  };
}

function setCorrelation(assumptions: Assumptions, i: number, j: number, value: number): Assumptions {
  const correlation = assumptions.correlation.map((row) => row.slice());
  if (!correlation[i] || !correlation[j]) return assumptions;
  correlation[i][j] = value;
  correlation[j][i] = value;
  return { ...assumptions, correlation };
}


