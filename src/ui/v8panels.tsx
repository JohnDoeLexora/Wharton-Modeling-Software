/**
 * Analytics, exploration, citations, the scenario library, and the glossary.
 * None of these panels selects a portfolio. MODEL_SPEC §8–§12.
 */
import { useMemo, useState } from "react";
import { brinson, decomposeRisk, repairCovariance, trackingError, type FactorModel } from "../core/attribution";
import { EXPLORATION_LABEL, blackLitterman, fundedBreakeven, meanCvar, worstCaseMean } from "../core/frontier";
import { buildLadderReport, type LadderBond } from "../core/ladder";
import { modelRiskSpread, type ModelRiskRow } from "../core/modelRisk";
import { SCENARIO_LIBRARY, applyFactorShock, fitMarkov, replayPath, reverseStress } from "../core/scenarioLib";
import { frameFromCsv, verifyClaims, type Citation } from "../core/verifyStats";
import { useStore } from "../state";
import { MetricInfo } from "./bits";
import { num, pct } from "./format";

const GLOSSARY: { term: string; definition: string; estimator: string; window: string; se: string }[] = [
  { term: "P(funded)", definition: "Share of trials whose beginning-of-2033 wealth covers that trial's reserve.", estimator: "Sample mean of a 0/1 indicator.", window: "The trials on the assumptions form.", se: "sqrt(p(1−p)/n), or the paired SE when two runs share a seed." },
  { term: "Beginning-of-2033 wealth", definition: "Portfolio value after the 2033 rebalance and before that year's return. The reserve is carved here.", estimator: "Year step in MODEL_SPEC §5.1.", window: "2027 through 2033.", se: "Batch-means SE on the Decision screen." },
  { term: "Facility gift", definition: "What remains after the reserve rule. It is not a required gift.", estimator: "Active facility rule applied to each trial.", window: "Beginning of 2033.", se: "Percentile of the trial gifts. Not a confidence interval by itself." },
  { term: "Sharpe", definition: "Mean excess return over the cash yield, divided by the sample standard deviation.", estimator: "n−1 standard deviation. Sortino uses the root mean square of negative excess returns.", window: "Annual steps of one trial, then averaged.", se: "Batch-means SE of the per-trial Sharpes." },
  { term: "Key-rate duration", definition: "Change in liability present value when one part of the curve is bumped.", estimator: "Central difference on the simulated curve, MODEL_SPEC §10.", window: "2033–2042 payments.", se: "Not a sampling SE. It is a price sensitivity." },
  { term: "Effective number of bets", definition: "Meucci's exp(entropy of the positive eigenvalues of covariance).", estimator: "Jacobi eigenvalues, negatives clipped.", window: "The covariance the team typed.", se: "None. A repaired matrix is flagged." },
  { term: "Tracking error", definition: "Standard deviation of active weights versus the benchmark the team chose.", estimator: "Factor variance plus specific variance, MODEL_SPEC §9.", window: "The factor model, one period unless you annualize.", se: "Not a sampling SE." },
  { term: "Quote richness", definition: "WInS quote minus Nelson-Siegel fair value.", estimator: "(yield − fair yield) in basis points, and dollars per trade from the ask.", window: "The quote on the row.", se: "None." },
];

export function Glossary() {
  return (
    <section className="card" id="glossary">
      <h3>Glossary</h3>
      <p className="muted">Each entry is a definition. It is not a view about the case.</p>
      <dl className="glossary">
        {GLOSSARY.map((row) => (
          <div key={row.term}>
            <dt>
              <MetricInfo label={row.term} definition={row.definition} estimator={row.estimator} window={row.window} se={row.se} />
            </dt>
            <dd>{row.definition}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function AnalyticsPanel() {
  const [model, setModel] = useState<FactorModel>({
    assetNames: ["sleeve A", "sleeve B"],
    factorNames: ["market", "rates"],
    exposures: [
      [1, 0],
      [0, 1],
    ],
    factorCov: [
      [0.04, 0],
      [0, 0.0004],
    ],
    specific: [0.01, 0.0004],
  });
  const [weights, setWeights] = useState("0.5, 0.5");
  const [bench, setBench] = useState("0.5, 0.5");
  const [universeText, setUniverseText] = useState("");
  const parsedWeights = parseVector(weights);
  const risk = parsedWeights.length === model.assetNames.length ? decomposeRisk(parsedWeights, model) : null;
  const benchmark = parseVector(bench);
  const te = risk && benchmark.length === parsedWeights.length ? trackingError(parsedWeights, benchmark, model) : null;
  const brinsonResult = brinson({
    names: model.assetNames,
    portfolioWeights: parsedWeights.length === 2 ? parsedWeights : [0.5, 0.5],
    benchmarkWeights: benchmark.length === 2 ? benchmark : [0.5, 0.5],
    portfolioReturns: [0, 0],
    benchmarkReturns: [0, 0],
  });
  const ladder = useMemo(() => {
    const universe = parseUniverse(universeText);
    if (universe.length === 0) return null;
    return buildLadderReport({ universe, flatYield: 0.03 });
  }, [universeText]);
  return (
    <div className="stack" id="analytics-panel">
      <header className="panel-head">
        <h2>Analytics</h2>
        <p className="lede">
          Factor risk, a Brinson sketch, and the reserve ladder. Weights and the bond list are yours. {EXPLORATION_LABEL}
        </p>
      </header>
      <section className="card">
        <h3>
          <MetricInfo
            label="Ex-ante risk"
            definition="Factor variance plus specific variance. Marginal risk is Σw / σ. Component risk is weight times marginal (Euler)."
            estimator="The factor model in the fields below."
            window="One period, annual if the covariance is annual."
            se="None. A negative eigenvalue is clipped and flagged."
          />
        </h3>
        <label className="field">
          <span>Weights</span>
          <input value={weights} onChange={(event) => setWeights(event.target.value)} aria-label="Analytics weights" />
        </label>
        <label className="field">
          <span>Benchmark weights</span>
          <input value={bench} onChange={(event) => setBench(event.target.value)} aria-label="Benchmark weights" />
        </label>
        {risk ? (
          <ul>
            <li>Total {num(risk.total, 4)}. Factor {num(risk.factor, 4)}. Specific {num(risk.specific, 4)}.</li>
            <li>Diversification ratio {num(risk.diversificationRatio, 3)}. Effective bets {num(risk.effectiveBets, 3)}.</li>
            <li>Euler components {risk.component.map((value) => num(value, 4)).join(", ")}. They sum to total risk.</li>
            <li>{risk.repaired ? "Covariance was not PSD and was repaired." : "Covariance was left as typed."}</li>
          </ul>
        ) : (
          <p className="muted">Type one weight per sleeve.</p>
        )}
        {te ? <p>Tracking error {num(te.trackingError, 4)}. Factor {num(te.factor, 4)}. Specific {num(te.specific, 4)}.</p> : null}
        <p className="muted">
          Brinson on zero returns is a blank active return ({num(brinsonResult.active, 2)}). Replace the returns in a memo only after you have measured them.
          The repair check on a typed matrix is separate from the correlation repair on the Monte Carlo.
        </p>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const repaired = repairCovariance(model.factorCov);
            setModel({ ...model, factorCov: repaired.cov });
          }}
        >
          Repair factor covariance if needed
        </button>
      </section>
      <section className="card" id="ladder-panel">
        <h3>
          <MetricInfo
            label="Reserve ladder"
            definition="Minimise the cost of covering the ten $50,000 payments, subject to round lots, volume, and the $300,000 capital."
            estimator="Year-by-year minimum-cost selection. Optimal for zero-coupon instruments. MODEL_SPEC §10."
            window="Payments 2033–2042."
            se="Funded share is the fraction of yield shifts where assets still cover the liability. It is not a Monte Carlo SE."
          />
        </h3>
        <p className="muted">
          One bond per line: id, kind, maturity, coupon, ask, bid, fair, duration, yield, fairYield, lot, volume. Kind is coupon, strip, bill, tips, or etf.
        </p>
        <textarea
          value={universeText}
          onChange={(event) => setUniverseText(event.target.value)}
          rows={5}
          aria-label="Bond universe"
          placeholder="strip-2033, strip, 2033, 0, 100, 99.5, 100, 6, 0, 0.001, 1000, 5000000"
        />
        {ladder ? (
          <div className="table-wrap">
            <table>
              <caption>{ladder.note}</caption>
              <tbody>
                <tr>
                  <td>Liability PV</td>
                  <td className="num">{num(ladder.liabilityPv, 0)}</td>
                </tr>
                <tr>
                  <td>Modified duration / convexity</td>
                  <td className="num">
                    {num(ladder.liabilityDuration, 2)} / {num(ladder.liabilityConvexity, 1)}
                  </td>
                </tr>
                <tr>
                  <td>Immunization cost</td>
                  <td className="num">{num(ladder.immunization.cost, 0)}</td>
                </tr>
                <tr>
                  <td>Bill ladder cost</td>
                  <td className="num">{num(ladder.billLadder.cost, 0)}</td>
                </tr>
                <tr>
                  <td>Duration-match cost</td>
                  <td className="num">{num(ladder.durationMatch.cost, 0)}</td>
                </tr>
                <tr>
                  <td>Funded share, immunization, across yield shifts</td>
                  <td className="num">{ladder.immunization.fundedShare === null ? "—" : pct(ladder.immunization.fundedShare, 0)}</td>
                </tr>
              </tbody>
            </table>
            <table>
              <caption>Quote richness versus the fair price on the row. Not an order.</caption>
              <thead>
                <tr>
                  <th>Bond</th>
                  <th>Richness, bp</th>
                  <th>Dollars per lot</th>
                </tr>
              </thead>
              <tbody>
                {ladder.richness.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td className="num">{num(row.richBp, 1)}</td>
                    <td className="num">{num(row.dollarsPerTrade, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Paste a universe to price the three constructions.</p>
        )}
      </section>
    </div>
  );
}

export function ExplorePanel() {
  const { assumptions } = useStore();
  const [rows, setRows] = useState<ModelRiskRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [threshold, setThreshold] = useState(0.8);
  const [slope, setSlope] = useState(2);
  const [viewMean, setViewMean] = useState(0.04);
  const scenarios = useMemo(() => illustrativeScenarios(assumptions.sleeves[0]?.mu ?? 0, assumptions.sleeves[0]?.sigma ?? 0), [assumptions]);
  const points = meanCvar({ scenarios, targetMean: -1, steps: 12 });
  const posterior = blackLitterman({
    marketWeights: [0.5, 0.5],
    covariance: [
      [0.04, 0.005],
      [0.005, 0.01],
    ],
    riskAversion: 2.5,
    tau: 0.05,
    views: [{ assets: [1, 0], mean: viewMean, variance: 0.02 }],
  });
  const worst = worstCaseMean([0.5, 0.5], [assumptions.sleeves[0]?.mu ?? 0, assumptions.sleeves[1]?.mu ?? 0], [
    [Math.max(1e-6, (assumptions.sleeves[0]?.sigma ?? 0) ** 2), 0],
    [0, Math.max(1e-6, (assumptions.sleeves[1]?.sigma ?? 0) ** 2)],
  ], 1);
  const funded = 0.5;
  const line = fundedBreakeven({ threshold, baseMean: assumptions.sleeves[0]?.mu ?? 0, baseFunded: funded, slope });
  return (
    <div className="stack" id="explore-panel">
      <header className="panel-head">
        <h2>Explore</h2>
        <p className="lede">{EXPLORATION_LABEL} Nothing on this screen is applied to the book unless you copy a number yourself.</p>
      </header>
      <section className="card">
        <h3>Mean-CVaR, resampled cloud, Black-Litterman, ellipsoid</h3>
        <p className="muted">The cloud uses the first sleeve's μ and σ as a scale for an illustration, not as a forecast. Points: {points.length}. Each label is exploration.</p>
        <p>
          Black-Litterman posterior on sleeve A, given your view of {num(viewMean, 3)}: {num(posterior.posterior[0], 4)}. Prior {num(posterior.prior[0], 4)}. {posterior.label}
        </p>
        <label className="field">
          <span>View, sleeve A excess</span>
          <input type="number" step="0.01" value={viewMean} onChange={(event) => setViewMean(Number(event.target.value))} />
        </label>
        <p>Worst-case mean on an equal mix, κ = 1: {num(worst.worst, 4)}. {worst.label}</p>
      </section>
      <section className="card" id="model-risk">
        <h3>Model-risk spread</h3>
        <p className="muted">Return model × shock model × correlation regime, then V6 vol ratios when you pass a return series from the Citations screen later. Bootstrap without a history is reported as an error, not a silent fallback.</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            window.setTimeout(() => {
              setRows(modelRiskSpread(assumptions));
              setPending(false);
            }, 0);
          }}
        >
          {pending ? "Running the spread…" : "Run the spread"}
        </button>
        {rows ? (
          <div className="table-wrap">
            <table>
              <caption>{EXPLORATION_LABEL}</caption>
              <thead>
                <tr>
                  <th>Family</th>
                  <th>Return</th>
                  <th>Shock</th>
                  <th>Correlation</th>
                  <th>P(funded)</th>
                  <th>p50</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.family}-${row.returnModel}-${row.shock}-${row.correlation}`}>
                    <td>{row.family}</td>
                    <td>{row.returnModel}</td>
                    <td>{row.shock}</td>
                    <td>{row.correlation}</td>
                    <td className="num">{row.funded === null ? "—" : pct(row.funded, 1)}</td>
                    <td className="num">{row.p50 === null ? "—" : num(row.p50, 0)}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <section className="card">
        <h3>
          <MetricInfo
            label="What would have to be true"
            definition="The equity mean at which a straight line through the current funded probability crosses your threshold."
            estimator="baseMean + (threshold − baseFunded) / slope."
            window="The slope is yours. It is not estimated on this screen."
            se="None. The line is an assumption."
          />
        </h3>
        <div className="choice-grid">
          <label className="field">
            <span>Funded threshold</span>
            <input type="number" step="0.05" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Slope, funded per unit of mean</span>
            <input type="number" step="0.1" value={slope} onChange={(event) => setSlope(Number(event.target.value))} />
          </label>
        </div>
        <p>
          Breakeven equity mean {line.equityMean === null ? "is undefined at this slope" : num(line.equityMean, 4)}. {line.note}
        </p>
      </section>
    </div>
  );
}

export function CitationsPanel() {
  const [csv, setCsv] = useState("date,MKT,LRN\n2024-05-01,100,50\n2024-05-02,101,50.2\n");
  const [quoted, setQuoted] = useState(0.02);
  const [rows, setRows] = useState<Citation[] | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="stack" id="citations-panel">
      <header className="panel-head">
        <h2>Citations</h2>
        <p className="lede">
          Every quoted statistic is recomputed on 1-year daily, 3-year weekly, and 5-year monthly windows. A quote outside that range, or an as-of date more than five trading days old, is flagged.
        </p>
      </header>
      <section className="card">
        <textarea value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} aria-label="Price CSV" />
        <label className="field">
          <span>Quoted beta of LRN on MKT</span>
          <input type="number" step="0.01" value={quoted} onChange={(event) => setQuoted(Number(event.target.value))} />
        </label>
        <button
          type="button"
          onClick={() => {
            try {
              const frame = frameFromCsv(csv, "pasted.csv");
              const today = new Date().toISOString().slice(0, 10);
              setRows(verifyClaims(frame, [{ id: "beta-pasted", stat: "beta", asset: "LRN", benchmark: "MKT", quoted }], today));
              setError("");
            } catch (caught) {
              setRows(null);
              setError(caught instanceof Error ? caught.message : "The file could not be read.");
            }
          }}
        >
          Verify claim
        </button>
        {error ? <p className="alert">{error}</p> : null}
        {rows ? (
          <div className="table-wrap">
            <table>
              <caption>Citation table. The hash is the SHA-256 of the pasted file.</caption>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.outsideRange || row.stale ? "diff" : undefined}>
                    <td>{row.id}</td>
                    <td>{row.text}</td>
                    <td>{row.outsideRange ? "outside the cross-window range" : row.stale ? "stale" : "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function ScenarioBoard() {
  const { output } = useStore();
  const [startYear, setStartYear] = useState(2008);
  const [history, setHistory] = useState("2008,-0.37\n2009,0.26\n");
  const [markovText, setMarkovText] = useState("0.08,-0.12,0.04,-0.2,0.11,-0.05,0.03,-0.18");
  const wealth = output.metrics?.wealthPercentiles["50"] ?? null;
  const reserve = output.reserve.active.reserve;
  const stress = wealth !== null && reserve !== null ? reverseStress({ wealth, reserve, shock: -0.2 }) : null;
  const replay = replayPath({
    history: history
      .split(/\n/)
      .map((line) => line.split(","))
      .filter((cells) => cells.length >= 2)
      .map((cells) => ({ year: Number(cells[0]), returns: { market: Number(cells[1]) } }))
      .filter((row) => Number.isFinite(row.year) && Number.isFinite(row.returns.market)),
    startYear,
    first: 2027,
    last: 2030,
  });
  const markov = fitMarkov(
    markovText
      .split(/[,\s]+/)
      .map(Number)
      .filter((value) => Number.isFinite(value)),
    2,
  );
  const shocked = applyFactorShock(
    [
      [1, 0],
      [0.2, 4],
    ],
    ["market", "rates"],
    SCENARIO_LIBRARY[3].shocks,
  );
  return (
    <section className="card" id="scenario-library">
      <h3>Scenario library</h3>
      <p className="muted">Cited histories and two hypotheticals. Applying one does not change the book until you use the numbers yourself.</p>
      <div className="table-wrap">
        <table>
          <caption>Library. Hypothetical rows are marked.</caption>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Market</th>
              <th>Rates</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {SCENARIO_LIBRARY.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.label}
                  {row.hypothetical ? " (hypothetical)" : ""}
                </td>
                <td className="num">{pct(row.shocks.market ?? 0, 1)}</td>
                <td className="num">{pct(row.shocks.rates ?? 0, 1)}</td>
                <td>{row.citation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>A 2008-sized market shock through exposures [1, 0] and [0.2, 4] maps to asset shocks {shocked.map((value) => num(value, 3)).join(", ")}.</p>
      <h4>Replay</h4>
      <label className="field">
        <span>History, year and market return</span>
        <textarea value={history} onChange={(event) => setHistory(event.target.value)} rows={3} aria-label="Replay history" />
      </label>
      <label className="field">
        <span>Align at start year</span>
        <input type="number" value={startYear} onChange={(event) => setStartYear(Number(event.target.value))} />
      </label>
      <p className="muted">
        {replay.map((row) => `${row.calendarYear} ← ${row.sourceYear} (${pct(row.returns.market ?? 0, 1)})`).join("; ") || "No rows."}
      </p>
      <h4>Reverse stress</h4>
      <p>
        {stress
          ? `Smallest scale of a −20% shock that puts p50 wealth under the active reserve: ${stress.scale === null ? "the cap is not enough, or the shock does not reduce wealth" : num(stress.scale, 3)}.`
          : "Run a sample with a reserve to see the scale."}
      </p>
      <h4>Markov fit</h4>
      <label className="field">
        <span>Annual returns</span>
        <input value={markovText} onChange={(event) => setMarkovText(event.target.value)} aria-label="Markov returns" />
      </label>
      <p>
        Transition {markov.transition.map((row) => row.map((value) => num(value, 2)).join(" ")).join(" | ")}. SE{" "}
        {markov.standardErrors.map((row) => row.map((value) => (value === null ? "—" : num(value, 2))).join(" ")).join(" | ")}.
      </p>
    </section>
  );
}

function parseVector(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((cell) => Number(cell))
    .filter((value) => Number.isFinite(value));
}

function parseUniverse(text: string): LadderBond[] {
  const bonds: LadderBond[] = [];
  for (const line of text.split(/\n/)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 12) continue;
    const kind = cells[1];
    if (kind !== "coupon" && kind !== "strip" && kind !== "bill" && kind !== "tips" && kind !== "etf") continue;
    bonds.push({
      id: cells[0] || "bond",
      kind,
      maturityYear: Number(cells[2]),
      coupon: Number(cells[3]),
      ask: Number(cells[4]),
      bid: Number(cells[5]),
      fair: Number(cells[6]),
      duration: Number(cells[7]),
      convexity: 0,
      yield: Number(cells[8]),
      fairYield: Number(cells[9]),
      lot: Number(cells[10]),
      volume: Number(cells[11]),
      maxVolumeFraction: 0.1,
    });
  }
  return bonds.filter((bond) => Number.isFinite(bond.maturityYear) && bond.lot > 0);
}

/** A short cloud around the sleeve the team typed. Not a history and not a forecast. */
function illustrativeScenarios(mu: number, sigma: number): number[][] {
  const vol = sigma > 0 ? sigma : 0.01;
  const rows: number[][] = [];
  for (let i = 0; i < 24; i++) {
    const z = ((i % 7) - 3) / 3;
    rows.push([mu + vol * z, (mu * 0.4) + vol * 0.2 * ((i % 5) - 2)]);
  }
  return rows;
}
