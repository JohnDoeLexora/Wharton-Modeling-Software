import { useStore } from "../state";
import { usd } from "./format";

const METRICS = [
  ["baseWealth2033", "Base-path 2033 wealth"],
  ["mcP50Wealth2033", "MC p50 2033 wealth"],
  ["rangeLow", "Range low"],
  ["rangeHigh", "Range high"],
] as const;

export function SensitivityCard() {
  const { sensitivity, sensitivityPending, computeSensitivity, assumptions } = useStore();
  const rows = sensitivity?.factors ?? [];
  const span = Math.max(
    1,
    ...rows.map((factor) => Math.abs(factor.metrics.mcP50Wealth2033.deltaUp ?? 0)),
    ...rows.map((factor) => Math.abs(factor.metrics.mcP50Wealth2033.deltaDown ?? 0)),
  );

  return (
    <section className="card">
      <div className="section-row">
        <h3>Local sensitivity</h3>
        <button type="button" onClick={computeSensitivity} disabled={sensitivityPending}>
          {sensitivityPending ? "Computing…" : "Compute sensitivities"}
        </button>
      </div>
      <p className="formula">
        Central difference (V(x+h) − V(x−h)) / (2h). h is 1 percentage point for μ, σ, and the scenario base return;
        5 percentage points for the first-sleeve glide weight; 0.5 percentage point for the discount yield. The median
        is the type-7 50th percentile of beginning-of-2033 wealth. Range endpoints use the active communication method
        ({assumptions.facility.rangeMethod}).
      </p>
      <p className="muted">
        μ and σ move the Monte Carlo. The scenario base return moves the base path only. The discount yield moves the
        reserve and therefore the contribution band, not portfolio wealth. This is a local probe, not a search for a portfolio.
      </p>
      {!sensitivity && !sensitivityPending ? <p className="muted">Not computed for the current inputs yet.</p> : null}
      {sensitivity ? (
        <>
          <div className="tornado" aria-label="Tornado of one-at-a-time effects on the Monte Carlo median">
            {rows.map((factor) => {
              const up = factor.metrics.mcP50Wealth2033.deltaUp ?? 0;
              const down = factor.metrics.mcP50Wealth2033.deltaDown ?? 0;
              return (
                <div key={factor.id} className="tornado-row">
                  <span>{factor.label}</span>
                  <span className="tornado-track" title={`Up ${usd(up)}, down ${usd(down)}`}>
                    <i className="tornado-bar up" style={{ left: "50%", width: `${(Math.abs(up) / span) * 50}%` }} />
                    <i className="tornado-bar down" style={{ right: "50%", width: `${(Math.abs(down) / span) * 50}%` }} />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted">Bars are the one-at-a-time change in the Monte Carlo median. Right is the upward bump.</p>
          <div className="table-wrap">
            <table>
              <caption>Finite-difference detail. Greek is dollars per 1.00 of the input, not per percentage point.</caption>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Metric</th>
                  <th>+h</th>
                  <th>−h</th>
                  <th>Greek</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((factor) =>
                  METRICS.map(([key, label], index) => {
                    const cell = factor.metrics[key];
                    return (
                      <tr key={`${factor.id}-${key}`}>
                        <td>
                          {index === 0 ? factor.label : ""}
                          {index === 0 ? <small className="sub">{factor.bumpLabel}{factor.clamped ? " · clamped" : ""}</small> : null}
                        </td>
                        <td>{label}</td>
                        <td className="num">{usd(cell.deltaUp)}</td>
                        <td className="num">{usd(cell.deltaDown)}</td>
                        <td className="num">{cell.greek === null ? "—" : usd(cell.greek)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="muted">{sensitivity.formula}</p>
        </>
      ) : null}
    </section>
  );
}
