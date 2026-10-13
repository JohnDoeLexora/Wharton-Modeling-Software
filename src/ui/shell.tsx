/**
 * Command palette, case tour, and the banners that sit above every screen.
 */
import { useEffect, useMemo, useState } from "react";
import { tradingDaysBetween } from "../core/verifyStats";
import { useStore } from "../state";

export const TOUR: { tab: string; title: string; body: string }[] = [
  { tab: "decision", title: "The sample", body: "The decision screen shows the sample that is on now. Pin it if you want deltas. It does not choose a mix." },
  { tab: "assumptions", title: "Assumptions", body: "Amber fields are yours. Case cash flows and the ten reserve payments are locked." },
  { tab: "reserve", title: "The reserve", body: "Four sizing methods. The ladder at a zero yield is $500,000. Trial-curve mode uses each trial's 2033 curve." },
  { tab: "facility", title: "The gift and the 2031 range", body: "The facility receives what the rule leaves after the reserve. The 2031 range is a communication band, not a promise." },
  { tab: "citations", title: "Citations", body: "Paste a price file. A quoted beta is recomputed on three windows and flagged if it sits outside them or the file is stale." },
  { tab: "export", title: "Export", body: "Choose INTERNAL or EXTERNAL before you download. The tear sheet, the bundle, and the board workbook use that prefix." },
];

export function CommandPalette({
  open,
  tabs,
  onClose,
  onGo,
  onUndo,
  onRedo,
  onTour,
  onTheme,
  onShare,
  onCancel,
}: {
  open: boolean;
  tabs: readonly (readonly [string, string])[];
  onClose: () => void;
  onGo: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTour: () => void;
  onTheme: () => void;
  onShare: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const actions = useMemo(() => {
    const rows = [
      ...tabs.map(([id, label]) => ({ id, label: `Go to ${label}`, run: () => onGo(id) })),
      { id: "undo", label: "Undo assumptions", run: onUndo },
      { id: "redo", label: "Redo assumptions", run: onRedo },
      { id: "tour", label: "Start the case tour", run: onTour },
      { id: "theme", label: "Toggle dark and light", run: onTheme },
      { id: "share", label: "Copy a run link", run: onShare },
      { id: "cancel", label: "Cancel the run", run: onCancel },
    ];
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows;
  }, [tabs, query, onGo, onUndo, onRedo, onTour, onTheme, onShare, onCancel]);
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  if (!open) return null;
  return (
    <div className="palette-backdrop" role="presentation" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Jump to a screen or a command"
          aria-label="Command"
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && actions[0]) {
              actions[0].run();
              onClose();
            }
          }}
        />
        <ul>
          {actions.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => {
                  action.run();
                  onClose();
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function CaseTour({ step, onClose, onStep }: { step: number | null; onClose: () => void; onStep: (next: number) => void }) {
  if (step === null) return null;
  const card = TOUR[step];
  if (!card) return null;
  return (
    <div className="tour" role="dialog" aria-label="Case tour">
      <p className="eyebrow">Case tour {step + 1} / {TOUR.length}</p>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      <div className="row-actions">
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
        <button type="button" disabled={step === 0} onClick={() => onStep(step - 1)}>
          Back
        </button>
        <button type="button" disabled={step === TOUR.length - 1} onClick={() => onStep(step + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function StatusBanners() {
  const { output } = useStore();
  const repaired = output.correlation?.repaired;
  const seedIssue = output.errors.find((error) => /seed/i.test(error));
  const asOf = output.provenance?.dataAsOf;
  const today = new Date().toISOString().slice(0, 10);
  const stale = asOf ? tradingDaysBetween(asOf, today) > 5 : false;
  if (!repaired && !seedIssue && !stale) return null;
  return (
    <div className="banner-stack">
      {repaired ? (
        <p className="alert" role="alert">
          The correlation matrix was repaired before it was factored. The sample uses the repaired matrix.
        </p>
      ) : null}
      {seedIssue ? (
        <p className="alert" role="alert">
          {seedIssue}
        </p>
      ) : null}
      {stale && asOf ? (
        <p className="alert" role="alert">
          Bundled market data is as of {asOf}, more than five trading days before {today}.
        </p>
      ) : null}
    </div>
  );
}

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => (typeof localStorage === "undefined" ? "light" : localStorage.getItem("gao-theme") || "light"));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("gao-theme", theme);
    } catch {
      /* Theme is still applied for this session. */
    }
  }, [theme]);
  return [theme, () => setTheme((current) => (current === "dark" ? "light" : "dark"))];
}
