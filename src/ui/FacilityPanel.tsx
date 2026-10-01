import { useMemo, useState } from "react";
import { applyRule } from "../core/facility";
import { histogram } from "../core/math";
import type { Assumptions, CandidateKind, CandidateRule, RangeMethod, ScenarioName } from "../core/types";
import { useStore } from "../state";
import { DisclaimerLine, Issues } from "./bits";
import { Histogram } from "./Chart";
import { DollarField, PercentField } from "./fields";
import { pct, usd } from "./format";

export function FacilityPanel() {
  const { assumptions, output, update } = useStore();
  const facility = output.facility;
  const [scratch, setScratch] = useState(600_000);
  const bins = useMemo(
    () => histogram(facility?.contributionSamples ?? [], 24),
    [facility?.contributionSamples],
  );

  return (
    <div className="stack">
      <header className="panel-head">
        <h2>Facility contribution and the 2031 range</h2>
        <p className="lede">
          A facility dollar is calculated only from wealth left after the operating reserve. If 2033 wealth is below
          the reserve, the contribution is zero and the gap is shown. Ranges are exploratory sentences under a method
          you pick. They are not a pledge to co-sponsors.
        </p>
      </header>
      <Issues />

      <section className="card">
        <h3>Reserve used in this illustration</h3>
        <p>
          {facility ? (
            <>
              <strong className="num">{usd(facility.reserveTarget)}</strong>
              <span className="muted"> — {facility.reserveSource}</span>
            </>
          ) : (
            <span>Unavailable until the selected reserve method returns a finite amount and the portfolio inputs are valid.</span>
          )}
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={assumptions.facility.useReserveOverride}
            onChange={(event) =>
              update((a) => ({ ...a, facility: { ...a.facility, useReserveOverride: event.target.checked } }))
            }
          />
          Ignore the sized reserve and type a different amount for this page only
        </label>
        {assumptions.facility.useReserveOverride ? (
          <DollarField
            label="Reserve override"
            value={assumptions.facility.reserveOverride}
            onChange={(reserveOverride) => update((a) => ({ ...a, facility: { ...a.facility, reserveOverride } }))}
          />
        ) : null}
        <p className="formula">
          If wealth W is at least the reserve R: W = R + facility contribution + flexibility kept. If W is below R:
          contribution = 0, flexibility = 0, and the gap is R − W.
        </p>
      </section>

      <section className="card">
        <div className="section-row">
          <h3>Candidate rules</h3>
          <button type="button" className="ghost" onClick={() => update(addRule)}>
            Add a rule
          </button>
        </div>
        <p className="muted">
          The marked rule is copied into the draft range sentence. Marking it does not make it the team’s choice.
          The table still shows every rule.
        </p>
        <div className="rule-grid">
          {assumptions.facility.rules.map((rule) => (
            <article key={rule.id} className={rule.id === assumptions.facility.activeRuleId ? "rule on" : "rule"}>
              <label className="check">
                <input
                  type="radio"
                  name="active-rule"
                  checked={rule.id === assumptions.facility.activeRuleId}
                  onChange={() => update((a) => ({ ...a, facility: { ...a.facility, activeRuleId: rule.id } }))}
                />
                Use in the range sentence
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  value={rule.name}
                  aria-label={`Rule name ${rule.name}`}
                  onChange={(event) => update((a) => patchRule(a, rule.id, { name: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Form</span>
                <select
                  value={rule.kind}
                  onChange={(event) => update((a) => patchRule(a, rule.id, { kind: event.target.value as CandidateKind }))}
                >
                  <option value="retain_fraction">Contribute (1 − retain) × residual</option>
                  <option value="keep_dollars">Contribute residual minus a dollar buffer</option>
                  <option value="cap_dollars">Contribute at most a dollar cap</option>
                </select>
              </label>
              {rule.kind === "retain_fraction" ? (
                <PercentField
                  label="Fraction of residual to keep"
                  value={rule.retainFraction}
                  hint="100% keeps everything. 0% contributes the entire residual."
                  onChange={(retainFraction) => update((a) => patchRule(a, rule.id, { retainFraction }))}
                />
              ) : null}
              {rule.kind === "keep_dollars" ? (
                <DollarField
                  label="Dollars of residual to keep"
                  value={rule.keepDollars}
                  onChange={(keepDollars) => update((a) => patchRule(a, rule.id, { keepDollars }))}
                />
              ) : null}
              {rule.kind === "cap_dollars" ? (
                <DollarField
                  label="Contribution cap"
                  value={rule.capDollars}
                  onChange={(capDollars) => update((a) => patchRule(a, rule.id, { capDollars }))}
                />
              ) : null}
              <button
                type="button"
                className="text"
                disabled={assumptions.facility.rules.length <= 1}
                onClick={() => update((a) => removeRule(a, rule.id))}
              >
                Remove rule
              </button>
            </article>
          ))}
        </div>
      </section>

      {facility ? (
        <>
          <section className="card">
            <h3>Contributions by scenario</h3>
            <div className="table-wrap">
              <table>
                <caption>Beginning-of-2033 wealth on each deterministic path, after the reserve and under every rule.</caption>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Wealth in 2031</th>
                    <th>Wealth in 2033</th>
                    {assumptions.facility.rules.map((rule) => (
                      <th key={rule.id}>{rule.name}</th>
                    ))}
                    <th>Operating reserve funded?</th>
                  </tr>
                </thead>
                <tbody>
                  {facility.scenarioRows.map((row) => (
                    <tr key={row.scenario}>
                      <td>{row.scenario}</td>
                      <td className="num">{usd(row.wealth2031)}</td>
                      <td className="num">{usd(row.wealth2033)}</td>
                      {row.byRule.map((applied) => (
                        <td key={applied.ruleId} className="num">
                          {usd(applied.contribution)}
                          <small className="sub">keep {usd(applied.flexibility)}</small>
                        </td>
                      ))}
                      <td>{row.byRule[0]?.operatingFullyFunded ? "Yes" : `No, gap ${usd(row.byRule[0]?.reserveGap)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3>Scratch pad</h3>
            <p className="muted">Type any hypothetical beginning-of-2033 wealth. This does not change the scenarios.</p>
            <DollarField label="Hypothetical 2033 wealth" value={scratch} onChange={setScratch} />
            <div className="table-wrap">
              <table>
                <caption>Rules applied to the typed wealth and the reserve above.</caption>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Contribution</th>
                    <th>Flexibility kept</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {assumptions.facility.rules.map((rule) => {
                    const applied = applyRule(scratch, facility.reserveTarget ?? 0, rule);
                    return (
                      <tr key={rule.id}>
                        <td>{rule.name}</td>
                        <td className="num">{usd(applied.contribution)}</td>
                        <td className="num">{usd(applied.flexibility)}</td>
                        <td className="num">{usd(applied.reserveGap)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3>Communication ranges</h3>
            <div className="choice-grid">
              <PercentField
                label="Low percentile"
                value={assumptions.facility.rangeLowPercentile}
                onChange={(rangeLowPercentile) => update((a) => ({ ...a, facility: { ...a.facility, rangeLowPercentile } }))}
              />
              <PercentField
                label="High percentile"
                value={assumptions.facility.rangeHighPercentile}
                onChange={(rangeHighPercentile) =>
                  update((a) => ({ ...a, facility: { ...a.facility, rangeHighPercentile } }))
                }
              />
              <label className="field">
                <span>2031 anchor for the conditional band</span>
                <select
                  value={assumptions.facility.conditionalSource}
                  onChange={(event) =>
                    update((a) => ({
                      ...a,
                      facility: {
                        ...a.facility,
                        conditionalSource: event.target.value as ScenarioName | "median_2031" | "manual",
                      },
                    }))
                  }
                >
                  <option value="bear">Bear path, beginning of 2031</option>
                  <option value="base">Base path, beginning of 2031</option>
                  <option value="bull">Bull path, beginning of 2031</option>
                  <option value="median_2031">Median simulated 2031 wealth</option>
                  <option value="manual">Type a 2031 wealth</option>
                </select>
              </label>
              {assumptions.facility.conditionalSource === "manual" ? (
                <DollarField
                  label="Manual 2031 wealth"
                  value={assumptions.facility.conditionalManualWealth}
                  onChange={(conditionalManualWealth) =>
                    update((a) => ({ ...a, facility: { ...a.facility, conditionalManualWealth } }))
                  }
                />
              ) : null}
            </div>
            <fieldset className="checks">
              <legend>Scenarios inside the envelope</legend>
              {(["bear", "base", "bull"] as ScenarioName[]).map((name) => (
                <label key={name} className="check">
                  <input
                    type="checkbox"
                    checked={assumptions.facility.envelopeScenarios.includes(name)}
                    onChange={(event) =>
                      update((a) => {
                        const has = a.facility.envelopeScenarios.includes(name);
                        const envelopeScenarios = event.target.checked
                          ? has
                            ? a.facility.envelopeScenarios
                            : [...a.facility.envelopeScenarios, name]
                          : a.facility.envelopeScenarios.filter((item) => item !== name);
                        return { ...a, facility: { ...a.facility, envelopeScenarios } };
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Conditional anchor: {facility.conditionalAnchorLabel}
              {facility.conditionalAnchor !== null ? ` (${usd(facility.conditionalAnchor)})` : ""}.
            </p>
            <div className="range-grid">
              {facility.ranges.map((range) => (
                <article key={range.method} className={range.method === assumptions.facility.rangeMethod ? "range on" : "range"}>
                  <label className="check">
                    <input
                      type="radio"
                      name="range-method"
                      checked={range.method === assumptions.facility.rangeMethod}
                      onChange={() =>
                        update((a) => ({ ...a, facility: { ...a.facility, rangeMethod: range.method as RangeMethod } }))
                      }
                    />
                    Primary draft
                  </label>
                  <h3>{range.title}</h3>
                  <p className="range-figures">
                    <strong>{usd(range.low)}</strong>
                    <span> to </span>
                    <strong>{usd(range.high)}</strong>
                  </p>
                  <p className="muted">
                    Sample share inside the band: {range.empiricalCoverage === null ? "not a probability method" : pct(range.empiricalCoverage, 1)}
                    . Operating shortfall share: {pct(range.operatingShortfallProbability, 1)}.
                  </p>
                  <p>{range.detail}</p>
                </article>
              ))}
            </div>
            <h3>Draft wording for the primary method</h3>
            <p className="muted">Generated from the method you marked. Edit it before it goes near a deliverable. It is not a recommendation.</p>
            <textarea className="note" readOnly rows={8} value={facility.primary?.wording ?? ""} />
          </section>

          <section className="card">
            <h3>Distribution of the full-horizon contribution</h3>
            <Histogram
              bins={bins}
              ariaLabel="Histogram of simulated 2033 facility contributions under the rule used in the range"
            />
          </section>
        </>
      ) : null}
      <DisclaimerLine />
    </div>
  );
}

function patchRule(assumptions: Assumptions, id: string, patch: Partial<CandidateRule>): Assumptions {
  return {
    ...assumptions,
    facility: {
      ...assumptions.facility,
      rules: assumptions.facility.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    },
  };
}

function addRule(assumptions: Assumptions): Assumptions {
  const rule: CandidateRule = {
    id: `rule-${Math.random().toString(36).slice(2, 7)}`,
    name: "New rule",
    kind: "retain_fraction",
    retainFraction: 1,
    keepDollars: 0,
    capDollars: 0,
  };
  return { ...assumptions, facility: { ...assumptions.facility, rules: [...assumptions.facility.rules, rule] } };
}

function removeRule(assumptions: Assumptions, id: string): Assumptions {
  const rules = assumptions.facility.rules.filter((rule) => rule.id !== id);
  if (rules.length === 0) return assumptions;
  const activeRuleId = rules.some((rule) => rule.id === assumptions.facility.activeRuleId)
    ? assumptions.facility.activeRuleId
    : rules[0].id;
  return { ...assumptions, facility: { ...assumptions.facility, rules, activeRuleId } };
}
