import { useState } from "react";
import { StoreProvider } from "../state";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { ExportPanel } from "./ExportPanel";
import { FacilityPanel } from "./FacilityPanel";
import { GuidePanel } from "./GuidePanel";
import { ProjectionsPanel } from "./ProjectionsPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ReservePanel } from "./ReservePanel";

const TABS = [
  ["assumptions", "Assumptions"],
  ["projections", "Projections"],
  ["reserve", "Operating reserve"],
  ["facility", "Facility & range"],
  ["research", "Research"],
  ["export", "Export"],
  ["guide", "How to model"],
] as const;

type Tab = (typeof TABS)[number][0];

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("assumptions");
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="top">
        <div>
          <p className="eyebrow">Independent team toolkit · Wharton Global High School Investment Competition</p>
          <h1>Gao modeling toolkit</h1>
          <p className="deck">A workspace for the Laura Gao case. It runs scenarios. It does not choose a strategy.</p>
        </div>
      </header>
      <div className="banner" role="note">
        Every amber field is an assumption for the team to set and stress. Case cash flows and dates are locked.
        WInS trading gains and losses are not an input. Nothing here is a recommendation for Laura.
      </div>
      <nav className="tabs" aria-label="Toolkit sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main id="content">
        {tab === "assumptions" ? <AssumptionsPanel /> : null}
        {tab === "projections" ? <ProjectionsPanel /> : null}
        {tab === "reserve" ? <ReservePanel /> : null}
        {tab === "facility" ? <FacilityPanel /> : null}
        {tab === "research" ? <ResearchPanel /> : null}
        {tab === "export" ? <ExportPanel /> : null}
        {tab === "guide" ? <GuidePanel /> : null}
      </main>
      <footer className="foot">
        <p>
          Not affiliated with the Wharton School or with Laura Gao. Case facts follow the 2026–2027 competition materials in{" "}
          <code>case-materials/</code>.
        </p>
        <p>
          Optional sentiment model: ProsusAI/finbert, from Araci, D. (2019),{" "}
          <a href="https://arxiv.org/abs/1908.10063" target="_blank" rel="noreferrer">
            FinBERT
          </a>
          . Sentiment never places a trade.
        </p>
      </footer>
    </>
  );
}
