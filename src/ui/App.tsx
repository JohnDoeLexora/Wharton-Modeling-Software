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

const SCREEN_NOTE: Record<Tab, string> = {
  decision: "Decision starts from the sample on screen. A halted sample leaves the tiles blank and names the input in the alert.",
  holdings: "The holdings editor starts empty. Load an example shape or type a book. An empty book is not an error.",
  trades: "Trades starts empty until the holdings book has rows. A rule break is an alert, not a silent pass.",
  compare: "Compare starts empty. Score two books to see a paired difference. The page says so until you do.",
  stress: "Stresses start empty. Nothing is applied until you run a button. A failed run stays on the alert.",
  assumptions: "Assumptions start at the zero book or the teaching example you loaded. Invalid numbers pause the sample and show an alert.",
  projections: "Projections stay blank until the sample runs. An invalid input is an alert, not a chart of zeros.",
  reserve: "The reserve schedule starts from the case payments. A custom schedule you have not filled in stays empty.",
  curve: "Curve fit, the history backtest, and the sampler lab start empty until you load a file or press the button.",
  instruments: "Instrument prices start empty until you enter a coupon bond or import maturity buckets.",
  tracking: "Tracking starts empty. Import fills to see weights and WInS P&L. That P&L is not an input.",
  risk: "Risk starts empty until you import a daily price file. A file that does not parse is an alert.",
  analytics: "Analytics starts empty until you supply the series or the exposure matrix the screen asks for.",
  explore: "Explore starts empty. Frontiers appear after you run them. They are labeled exploration.",
  citations: "Citations start empty until a price file is loaded. A quote the file does not support is flagged.",
  facility: "The facility gift and the 2031 range follow the rule on screen. They stay blank when the sample is halted.",
  ledger: "The run ledger starts empty. A completed sample appends a row. Nothing is stored until a run finishes.",
  research: "Research starts empty. The demo lexicon works without FinBERT. A missing service is an error, not a score.",
  export: "Export starts from the sample on screen. A halted sample names the error instead of writing a file.",
  guide: "The guide is the modeling notes. It does not fill in a portfolio. Case cash flows stay locked.",
};

function ScreenNotice({ tab }: { tab: Tab }) {
  const { output } = useStore();
  if (output.errors.length > 0) {
    return (
      <p className="alert" role="alert" id="screen-error">
        {SCREEN_NOTE[tab]} {output.errors[0]}
      </p>
    );
  }
  return (
    <p className="screen-note" role="status" id="screen-status">
      {SCREEN_NOTE[tab]}
    </p>
  );
}

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
        <ScreenNotice tab={tab} />
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
