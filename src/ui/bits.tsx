import type { KeyboardEvent } from "react";
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

/** Arrow up and down move between inputs in the same column. */
export function onTableArrow(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const target = event.target as HTMLElement;
  if (target.tagName !== "INPUT" && target.tagName !== "SELECT") return;
  const cell = target.closest("td, th");
  const row = target.closest("tr");
  if (!cell || !row) return;
  const index = [...row.children].indexOf(cell);
  const nextRow = event.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling;
  const next = nextRow?.children[index]?.querySelector("input, select") as HTMLElement | null;
  if (!next) return;
  event.preventDefault();
  next.focus();
}

/** Dotted label whose tooltip cites the source of an assumption. */
export function SourceTip({ label, source }: { label: string; source: string }) {
  return (
    <abbr className="source-tip" title={source}>
      {label}
    </abbr>
  );
}

export function DisclaimerLine() {
  const { output } = useStore();
  return <p className="disclaimer-line">{output.disclaimer}</p>;
}
