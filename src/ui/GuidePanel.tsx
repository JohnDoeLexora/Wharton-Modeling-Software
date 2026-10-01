import guide from "../../docs/HOW_TO_MODELING.md?raw";
import { Markdown } from "./markdown";

export function GuidePanel() {
  return (
    <div className="stack">
      <header className="panel-head">
        <h2>How to model</h2>
        <p className="lede">
          The same text lives in the repository at <code>docs/HOW_TO_MODELING.md</code>. It explains the formulas this
          toolkit uses and the usual questions in a long-horizon funding problem. It does not pick a portfolio for Laura.
        </p>
      </header>
      <section className="card prose-card">
        <Markdown source={guide} />
      </section>
    </div>
  );
}
