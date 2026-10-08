import { useBook } from "../bookState";
import { useStore } from "../state";
import { compactUsd, pct } from "./format";
import { SourceTip } from "./bits";

export function DashboardPanel() {
  const { output, pending, progress, fromCache, assumptions } = useStore();
  const { pinned, setPinned, stresses } = useBook();
  const metrics = output.metrics;
  const funded = metrics?.fullyFundedProbability ?? null;
  const p5 = metrics?.wealthPercentiles["5"] ?? null;
  const gift = metrics?.facilityPercentiles["50"] ?? null;
  const low = metrics?.conditionalLow ?? null;
  const high = metrics?.conditionalHigh ?? null;
  const regimes = output.reserve.regimeFunding;
  const worst = worstRegime(regimes);
  const worstStress = stresses.reduce<(typeof stresses)[number] | null>((best, row) => {
    if (row.funded === null) return best;
    if (!best || best.funded === null || row.funded < best.funded) return row;
    return best;
  }, null);
  return (
    <div className="stack" id="decision-dashboard">
      <header className="panel-head">
        <h2>Decision dashboard</h2>
        <p className="lede">
          One screen for the sample that is on now. The figures move when the assumptions move. They are not a
          recommendation.
        </p>
      </header>
      <p className="status-line" role="status">
        {pending
          ? `Updating the sample… ${progress ? `${progress.done}/${progress.total}` : "starting"}`
          : fromCache
            ? "Sample reused from the cache for this run hash."
            : `Sample ready. Seed ${output.masterSeed}. ${assumptions.trials} trials.`}
      </p>
      <section className="metric-strip">
        <Tile
          label="P(funded)"
          value={funded === null ? "—" : pct(funded, 1)}
          source="Share of trials whose beginning-of-2033 wealth covers the active reserve. SE is sqrt(p(1−p)/n)."
          delta={delta(funded, pinned?.funded ?? null, pct)}
        />
        <Tile label="p5 wealth" value={p5 === null ? "—" : compactUsd(p5)} source="5th percentile of beginning-of-2033 wealth in this seeded sample." delta={delta(p5, pinned?.p5 ?? null, compactUsd)} />
        <Tile
          label="Median gift"
          value={gift === null ? "—" : compactUsd(gift)}
          source="Median facility contribution after the active reserve rule. A gift is taken only from surplus."
          delta={delta(gift, pinned?.gift ?? null, compactUsd)}
        />
        <Tile
          label="2031 range"
          value={low === null || high === null ? "—" : `${compactUsd(low)} – ${compactUsd(high)}`}
          source="Conditional two-year band on the facility rule. It is a communication range under the method you selected, not a promise."
          delta={null}
        />
        <Tile
          label="Worst regime"
          value={worst ? worst.regime : "—"}
          source="Lowest minimum funded ratio on the present-value ladder across the five rate-regime templates, with volatility set to zero. Templates are illustrations."
          delta={null}
        />
        <Tile
          label="Worst stress"
          value={worstStress ? worstStress.label : "Not run"}
          source="Lowest P(funded) among stresses you have run on the Stress tab. Empty until you run them."
          delta={null}
        />
      </section>
      <div className="row-actions">
        <button
          type="button"
          onClick={() =>
            setPinned({
              label: "Pinned sample",
              funded,
              p5,
              gift,
              low,
              high,
            })
          }
        >
          Pin this sample
        </button>
        <button type="button" className="ghost" disabled={!pinned} onClick={() => setPinned(null)}>
          Clear pin
        </button>
        {pinned ? <span className="muted">Deltas are versus the pinned sample.</span> : <span className="muted">Pin a sample to see deltas.</span>}
      </div>
    </div>
  );
}

function Tile({ label, value, source, delta: change }: { label: string; value: string; source: string; delta: string | null }) {
  return (
    <article>
      <h4>
        <SourceTip label={label} source={source} />
      </h4>
      <p className="metric-value">{value}</p>
      {change ? <p className="muted">Δ {change}</p> : null}
    </article>
  );
}

function delta(current: number | null, base: number | null, format: (value: number, digits?: number) => string): string | null {
  if (current === null || base === null) return null;
  const gap = current - base;
  const sign = gap > 0 ? "+" : "";
  return sign + format(gap, 1);
}

function worstRegime(rows: { regime: string; methods: { method: string; minFundedRatio: number | null }[] }[]) {
  let worst: { regime: string; ratio: number } | null = null;
  for (const row of rows) {
    const method = row.methods.find((item) => item.method === "pv_curve") ?? row.methods[0];
    const ratio = method?.minFundedRatio;
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) continue;
    if (!worst || ratio < worst.ratio) worst = { regime: row.regime, ratio };
  }
  return worst;
}
