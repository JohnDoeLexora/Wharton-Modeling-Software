import { CASE_TIMELINE } from "../core/case";
import { useStore } from "../state";

export function Issues() {
  const { output } = useStore();
  if (output.errors.length === 0) return null;
  return (
    <div className="issues" role="alert">
      <strong>Portfolio projections are paused until these inputs are valid.</strong>
      <ul>
        {output.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
      <p>Reserve formulas that do not depend on the mix still run, so you can keep comparing liability math.</p>
    </div>
  );
}

export function TagPill() {
  const { assumptions } = useStore();
  const label =
    assumptions.tag === "zero-default"
      ? "Zero-return starting point"
      : assumptions.tag === "teaching-example"
        ? "Teaching example — not a strategy"
        : "Edited assumptions";
  return <span className={`pill tag-${assumptions.tag}`}>{label}</span>;
}

export function CaseTimeline() {
  return (
    <ol className="timeline">
      {CASE_TIMELINE.map((row) => (
        <li key={row.calendarYear}>
          <span className="when">
            {row.calendarYear}
            <small>Y{row.yearIndex}</small>
          </span>
          <span>
            <strong>{row.title}</strong>
            <span className="muted">{row.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DisclaimerLine() {
  const { output } = useStore();
  return <p className="disclaimer-line">{output.disclaimer}</p>;
}
