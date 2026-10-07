import type { CurveReserveMethod } from "../core/types";
import { useStore } from "../state";
import { pct, usd } from "./format";

const METHOD_TITLE: Record<CurveReserveMethod, string> = {
  pv_curve: "PV on the 2033 curve",
  nominal: "Nominal $500,000",
  tbill_ladder: "T-bill ladder",
  duration_matched: "Duration-matched",
};

export function RegimeFundingTable() {
  const { output } = useStore();
  const rows = output.reserve.regimeFunding;
  return (
    <section className="card" id="regime-funding">
      <h3>Funded status by rate regime</h3>
      <p className="muted">{output.reserve.regimeNote}</p>
      <div className="table-wrap">
        <table>
          <caption>Reserve size and funded ratios under each regime template. Order is not a ranking.</caption>
          <thead>
            <tr>
              <th>Regime</th>
              <th>Short rate, 2033</th>
              <th>Method</th>
              <th>Reserve</th>
              <th>Min funded ratio</th>
              <th>+100 bp ratio</th>
              <th>Terminal shortfall</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) =>
              row.methods.map((method, index) => (
                <tr key={`${row.regime}-${method.method}`}>
                  <td>{index === 0 ? row.regime : ""}</td>
                  <td className="num">{index === 0 ? pct(row.short2033, 2) : ""}</td>
                  <td>
                    {METHOD_TITLE[method.method]}
                    <span className="sub">{method.note}</span>
                  </td>
                  <td className="num">{usd(method.reserve)}</td>
                  <td className="num">{method.minFundedRatio === null ? "—" : method.minFundedRatio.toFixed(3)}</td>
                  <td className="num">{method.shockFundedRatio === null ? "—" : method.shockFundedRatio.toFixed(3)}</td>
                  <td className="num">{usd(method.terminalShortfall)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
