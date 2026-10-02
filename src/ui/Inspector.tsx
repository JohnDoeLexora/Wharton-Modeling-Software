import { caseContribution, FIRST_PROJECTION_YEAR, LAST_PROJECTION_YEAR } from "../core/case";
import { prepareCorrelation } from "../core/correlation";
import { weightsAtYear } from "../core/glide";
import { useStore } from "../state";
import { num, pct, usd } from "./format";

export function Inspector() {
  const { assumptions, output } = useStore();
  const report = prepareCorrelation(assumptions.correlation, assumptions.correlationStress);
  const years: number[] = [];
  for (let year = FIRST_PROJECTION_YEAR; year <= LAST_PROJECTION_YEAR; year++) years.push(year);

  return (
    <section className="card">
      <h3>Assumption inspector</h3>
      <p className="muted">
        Effective inputs the next sample will use. The master seed is {output.masterSeed}. Portfolio shocks are stream 1,
        reserve shortfall shocks are stream 2, and block starts are stream 3. The conditional band reuses stream 1 at
        2031 and 2032.
      </p>
      {report.warning ? <p className="callout warn">{report.warning}</p> : null}

      <h4>Case contributions</h4>
      <div className="table-wrap">
        <table>
          <caption>External cash into the portfolio at the beginning of the year. Locked.</caption>
          <thead>
            <tr>
              <th>Year</th>
              <th>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year}>
                <td>{year}</td>
                <td className="num">{usd(caseContribution(year))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Policy weights by year</h4>
      <p className="formula">Linear interpolation between glide knots. Outside the knots, the nearest knot is held.</p>
      <div className="table-wrap">
        <table>
          <caption>Glide weight applied at the beginning of each year, before that year’s return.</caption>
          <thead>
            <tr>
              <th>Year</th>
              {assumptions.sleeves.map((sleeve) => (
                <th key={sleeve.id}>{sleeve.name}</th>
              ))}
              <th>Sum</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const weights = weightsAtYear(assumptions.glide, year);
              const total = weights.reduce((sum, weight) => sum + weight, 0);
              return (
                <tr key={year}>
                  <td>{year}</td>
                  {weights.map((weight, index) => (
                    <td key={assumptions.sleeves[index]?.id ?? index} className="num">
                      {pct(weight, 1)}
                    </td>
                  ))}
                  <td className={Math.abs(total - 1) < 1e-6 ? "num ok" : "num bad"}>{pct(total, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4>Correlation actually used</h4>
      <p className="formula">
        Stressed entry = clip(typed entry + stress, −0.999, 0.999) off the diagonal. If the minimum eigenvalue is below
        −1e−8, negative eigenvalues are clipped and the diagonal is restored to 1.
      </p>
      <p className="muted">
        Stress {num(assumptions.correlationStress, 3)}. Minimum eigenvalue of the typed matrix{" "}
        {report.rawMinEigenvalue === null ? "—" : num(report.rawMinEigenvalue, 4)}. Repaired: {report.repaired ? "yes" : "no"}.
        Monte Carlo {assumptions.shockModel === "block_bootstrap" ? "ignores this matrix while block bootstrap is selected." : "uses the matrix below."}
      </p>
      <div className="table-wrap">
        <table className="matrix">
          <caption>Correlation matrix passed to the Cholesky factor</caption>
          <thead>
            <tr>
              <th></th>
              {assumptions.sleeves.map((sleeve) => (
                <th key={sleeve.id}>{sleeve.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.used.map((row, i) => (
              <tr key={assumptions.sleeves[i]?.id ?? i}>
                <th>{assumptions.sleeves[i]?.name ?? i + 1}</th>
                {row.map((value, j) => (
                  <td key={j} className="num">
                    {num(value, 3)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
