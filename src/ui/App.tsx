import { useState, type KeyboardEvent } from "react";
import { BookProvider, useBook } from "../bookState";
import { StoreProvider, useStore } from "../state";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { ComparePanel } from "./ComparePanel";
import { DashboardPanel } from "./DashboardPanel";
import { ExportPanel } from "./ExportPanel";
import { FacilityPanel } from "./FacilityPanel";
import { GuidePanel } from "./GuidePanel";
import { HoldingsPanel } from "./HoldingsPanel";
import { LedgerPanel } from "./LedgerPanel";
import { ProjectionsPanel } from "./ProjectionsPanel";
import { ResearchPanel } from "./ResearchPanel";
import { ReservePanel } from "./ReservePanel";
import { StressPanel } from "./StressPanel";
import { TradesPanel } from "./TradesPanel";

const TABS = [
  ["decision", "Decision"],
  ["holdings", "Holdings"],
  ["trades", "Trades"],
  ["compare", "Compare"],
  ["stress", "Stresses"],
  ["assumptions", "Assumptions"],
  ["projections", "Projections"],
  ["reserve", "Operating reserve"],
  ["facility", "Facility & range"],
  ["ledger", "Run ledger"],
  ["research", "Research"],
  ["export", "Export"],
  ["guide", "How to model"],
] as const;

type Tab = (typeof TABS)[number][0];

export function App() {
  return (
    <StoreProvider>
      <BookProvider>
        <Shell />
      </BookProvider>
    </StoreProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("decision");
  const { pending, progress, output } = useStore();
  const { audience, setAudience } = useBook();
  const onTabsKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = TABS.findIndex(([id]) => id === tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const id = TABS[next][0];
    setTab(id);
    window.requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  };
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
      <p className="status-line" role="status">
        {pending
          ? `Updating the sample… ${progress ? `${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} trials` : "starting"}`
          : `Master seed ${output.masterSeed}. Streams 1–6: portfolio, reserve, bootstrap, rates, credit, single-name. Schema ${output.schemaVersion}.`}
        <button type="button" className="audience" onClick={() => setAudience(audience === "EXTERNAL" ? "INTERNAL" : "EXTERNAL")}>
          Export tag: {audience}
        </button>
      </p>
      <nav className="tabs" role="tablist" aria-label="Toolkit sections" onKeyDown={onTabsKeyDown}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="content"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main id="content" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "decision" ? <DashboardPanel /> : null}
        {tab === "holdings" ? <HoldingsPanel /> : null}
        {tab === "trades" ? <TradesPanel /> : null}
        {tab === "compare" ? <ComparePanel /> : null}
        {tab === "stress" ? <StressPanel /> : null}
        {tab === "assumptions" ? <AssumptionsPanel /> : null}
        {tab === "projections" ? <ProjectionsPanel /> : null}
        {tab === "reserve" ? <ReservePanel /> : null}
        {tab === "facility" ? <FacilityPanel /> : null}
        {tab === "ledger" ? <LedgerPanel /> : null}
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
