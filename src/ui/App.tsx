import { useEffect, useState, type KeyboardEvent } from "react";
import { BookProvider, useBook } from "../bookState";
import { StoreProvider, useStore } from "../state";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { CurvePanel } from "./CurvePanel";
import { InstrumentPanel } from "./InstrumentPanel";
import { TrackingPanel } from "./TrackingPanel";
import { RiskPanel } from "./RiskPanel";
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
import { CaseTour, CommandPalette, StatusBanners, TOUR, useTheme } from "./shell";
import { AnalyticsPanel, CitationsPanel, ExplorePanel } from "./v8panels";

const TABS = [
  ["decision", "Decision"],
  ["holdings", "Holdings"],
  ["trades", "Trades"],
  ["compare", "Compare"],
  ["stress", "Stresses"],
  ["assumptions", "Assumptions"],
  ["projections", "Projections"],
  ["reserve", "Operating reserve"],
  ["curve", "Curve"],
  ["instruments", "Instruments"],
  ["tracking", "Tracking"],
  ["risk", "Risk"],
  ["analytics", "Analytics"],
  ["explore", "Explore"],
  ["citations", "Citations"],
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
  const [palette, setPalette] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const { pending, progress, output, undo, redo, cancelRun, assumptions } = useStore();
  const { audience, setAudience } = useBook();
  const [, toggleTheme] = useTheme();
  const share = () => {
    const payload = encodeURIComponent(JSON.stringify(assumptions));
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#run=${payload}`;
    window.history.replaceState(null, "", `#run=${payload}`);
    void navigator.clipboard?.writeText(url);
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
        return;
      }
      if (event.key === "Escape") setPalette(false);
      if (typing) return;
      if (meta && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (meta && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
        event.preventDefault();
        redo();
      } else if (event.key === "?" ) {
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
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
      <StatusBanners />
      <p className="status-line" role="status">
        {pending
          ? `Updating the sample… ${progress ? `${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} trials` : "starting"}${
              progress && progress.p50 !== null ? ` · p50 ${Math.round(progress.p50).toLocaleString("en-US")}` : ""
            }`
          : `Master seed ${output.masterSeed}. Streams 1–6: portfolio, reserve, bootstrap, rates, credit, single-name. Schema ${output.schemaVersion}.`}
        <button type="button" className="audience" onClick={() => setAudience(audience === "EXTERNAL" ? "INTERNAL" : "EXTERNAL")}>
          Export tag: {audience}
        </button>
        <button type="button" className="ghost" onClick={() => setPalette(true)}>
          Commands
        </button>
        {pending ? (
          <button type="button" className="ghost" onClick={cancelRun}>
            Cancel
          </button>
        ) : null}
      </p>
      {pending && progress ? (
        <div className="progress" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
          <span style={{ width: `${Math.min(100, (100 * progress.done) / Math.max(1, progress.total))}%` }} />
        </div>
      ) : null}
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
        {tab === "curve" ? <CurvePanel /> : null}
        {tab === "instruments" ? <InstrumentPanel /> : null}
        {tab === "tracking" ? <TrackingPanel /> : null}
        {tab === "risk" ? <RiskPanel /> : null}
        {tab === "analytics" ? <AnalyticsPanel /> : null}
        {tab === "explore" ? <ExplorePanel /> : null}
        {tab === "citations" ? <CitationsPanel /> : null}
        {tab === "facility" ? <FacilityPanel /> : null}
        {tab === "ledger" ? <LedgerPanel /> : null}
        {tab === "research" ? <ResearchPanel /> : null}
        {tab === "export" ? <ExportPanel /> : null}
        {tab === "guide" ? <GuidePanel /> : null}
      </main>
      <CommandPalette
        open={palette}
        tabs={TABS}
        onClose={() => setPalette(false)}
        onGo={(id) => setTab(id as Tab)}
        onUndo={undo}
        onRedo={redo}
        onTour={() => {
          setTour(0);
          setTab(TOUR[0].tab as Tab);
        }}
        onTheme={toggleTheme}
        onShare={share}
        onCancel={cancelRun}
      />
      <CaseTour
        step={tour}
        onClose={() => setTour(null)}
        onStep={(next) => {
          setTour(next);
          const card = TOUR[next];
          if (card) setTab(card.tab as Tab);
        }}
      />
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
