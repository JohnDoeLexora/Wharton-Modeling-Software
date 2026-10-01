import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { teachingAssumptions, zeroAssumptions } from "./core/defaults";
import { runModel } from "./core/run";
import type { Assumptions, ModelOutput, ResearchNote } from "./core/types";

const KEY = "gao-toolkit-v1";

interface Saved {
  v: 1;
  assumptions: Assumptions;
  notes: ResearchNote[];
}

interface Store {
  assumptions: Assumptions;
  notes: ResearchNote[];
  output: ModelOutput;
  update: (fn: (assumptions: Assumptions) => Assumptions) => void;
  replace: (assumptions: Assumptions) => void;
  setNotes: (notes: ResearchNote[]) => void;
  resetZeros: () => void;
  loadTeaching: () => void;
}

const Ctx = createContext<Store | null>(null);

function coerce(raw: Assumptions): Assumptions {
  const base = zeroAssumptions();
  return {
    ...base,
    ...raw,
    schema: 1,
    certaintyNote: typeof raw.certaintyNote === "string" ? raw.certaintyNote : "",
    sleeves: Array.isArray(raw.sleeves) && raw.sleeves.length > 0 ? raw.sleeves : base.sleeves,
    glide: Array.isArray(raw.glide) && raw.glide.length > 0 ? raw.glide : base.glide,
    reserve: { ...base.reserve, ...raw.reserve },
    facility: {
      ...base.facility,
      ...raw.facility,
      rules:
        Array.isArray(raw.facility?.rules) && raw.facility.rules.length > 0
          ? raw.facility.rules
          : base.facility.rules,
    },
  };
}

function load(): { assumptions: Assumptions; notes: ResearchNote[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { assumptions: zeroAssumptions(), notes: [] };
    const parsed = JSON.parse(raw) as Saved;
    if (parsed.v !== 1 || !parsed.assumptions) return { assumptions: zeroAssumptions(), notes: [] };
    return {
      assumptions: coerce(parsed.assumptions),
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return { assumptions: zeroAssumptions(), notes: [] };
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [assumptions, setAssumptions] = useState<Assumptions>(initial.assumptions);
  const [notes, setNotes] = useState<ResearchNote[]>(initial.notes);
  const output = useMemo(() => runModel(assumptions), [assumptions]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, assumptions, notes }));
    } catch {
      /* A full browser can refuse storage. The session still runs. */
    }
  }, [assumptions, notes]);

  const store = useMemo<Store>(
    () => ({
      assumptions,
      notes,
      output,
      update: (fn) => setAssumptions((prev) => ({ ...fn(prev), tag: "edited" })),
      replace: (next) => setAssumptions(next),
      setNotes,
      resetZeros: () => setAssumptions(zeroAssumptions()),
      loadTeaching: () => setAssumptions(teachingAssumptions()),
    }),
    [assumptions, notes, output],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useStore must be used inside StoreProvider.");
  return store;
}
