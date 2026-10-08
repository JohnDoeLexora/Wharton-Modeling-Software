import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { teachingAssumptions, zeroAssumptions } from "./core/defaults";
import { assumptionsHash, createLedgerEntry, type LedgerEntry } from "./core/ledger";
import type { WorkerRequest, WorkerResponse } from "./core/model.worker";
import { migrateStoredWorkspace } from "./core/migrate";
import { cachedOutput, rememberRun, runCached } from "./core/runCache";
import { runModel } from "./core/run";
import type { SensitivityReport } from "./core/sensitivity";
import { runSensitivity } from "./core/sensitivity";
import type { Assumptions, ModelOutput, ResearchNote } from "./core/types";

const KEY = "gao-toolkit-v3";
const PREVIOUS_KEYS = ["gao-toolkit-v2", "gao-toolkit-v1"];

interface Store {
  assumptions: Assumptions;
  notes: ResearchNote[];
  ledger: LedgerEntry[];
  output: ModelOutput;
  /** True while a worker is replacing the sample. The previous output stays on screen. */
  pending: boolean;
  /** Trials finished in the worker that is currently replacing the sample. */
  progress: { done: number; total: number } | null;
  /** True when the sample on screen was reused for this assumption hash. */
  fromCache: boolean;
  /** True while a ledger row is waiting for a sample that matches its snapshot. */
  savePending: boolean;
  sensitivity: SensitivityReport | null;
  sensitivityPending: boolean;
  update: (fn: (assumptions: Assumptions) => Assumptions) => void;
  replace: (assumptions: Assumptions) => void;
  setNotes: (notes: ResearchNote[]) => void;
  resetZeros: () => void;
  loadTeaching: () => void;
  saveRun: (name: string) => void;
  removeRun: (id: string) => void;
  computeSensitivity: () => void;
}

const Ctx = createContext<Store | null>(null);

function load(): { assumptions: Assumptions; notes: ResearchNote[]; ledger: LedgerEntry[] } {
  try {
    const current = localStorage.getItem(KEY);
    if (current) return migrateStoredWorkspace(JSON.parse(current));
    for (const key of PREVIOUS_KEYS) {
      const previous = localStorage.getItem(key);
      if (previous) return migrateStoredWorkspace(JSON.parse(previous));
    }
  } catch {
    /* Storage can be full or unreadable. Start from the zero case. */
  }
  return { assumptions: zeroAssumptions(), notes: [], ledger: [] };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [assumptions, setAssumptions] = useState<Assumptions>(initial.assumptions);
  const [notes, setNotes] = useState<ResearchNote[]>(initial.notes);
  const [ledger, setLedger] = useState<LedgerEntry[]>(initial.ledger);
  const [output, setOutput] = useState<ModelOutput>(() => {
    const first = runModel(initial.assumptions);
    rememberRun(assumptionsHash(initial.assumptions), first);
    return first;
  });
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [sensitivity, setSensitivity] = useState<SensitivityReport | null>(null);
  const [sensitivityPending, setSensitivityPending] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const modelRequest = useRef(0);
  const sensitivityRequest = useRef(0);
  const saveRequest = useRef(0);
  const pendingSaves = useRef(new Map<number, { name: string; assumptions: Assumptions }>());
  const assumptionsRef = useRef(assumptions);
  assumptionsRef.current = assumptions;
  const sawAssumptions = useRef(false);

  function commitSave(name: string, snapshot: Assumptions, result: ModelOutput) {
    const entry = createLedgerEntry(name, snapshot, result);
    setLedger((prev) => [entry, ...prev]);
  }

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 3, assumptions, notes, ledger }));
    } catch {
      /* A full browser can refuse storage. The session still runs. */
    }
  }, [assumptions, notes, ledger]);

  function ensureWorker(): Worker | null {
    if (workerRef.current) return workerRef.current;
    try {
      const worker = new Worker(new URL("./core/model.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.kind === "progress") {
          if (data.id === modelRequest.current) setProgress({ done: data.done, total: data.total });
          return;
        }
        if (data.kind === "model") {
          const queued = pendingSaves.current.get(data.id);
          if (queued) {
            pendingSaves.current.delete(data.id);
            commitSave(queued.name, queued.assumptions, data.output);
            setSavePending(pendingSaves.current.size > 0);
          }
          if (data.id === modelRequest.current) {
            rememberRun(assumptionsHash(assumptionsRef.current), data.output);
            setOutput(data.output);
            setPending(false);
            setProgress(null);
            setFromCache(false);
          }
          return;
        }
        if (data.kind === "sensitivity" && data.id === sensitivityRequest.current) {
          setSensitivity(data.report);
          setSensitivityPending(false);
          return;
        }
        if (data.kind === "error") {
          const queued = pendingSaves.current.get(data.id);
          if (queued) {
            pendingSaves.current.delete(data.id);
            try {
              commitSave(queued.name, queued.assumptions, runModel(queued.assumptions));
            } catch {
              /* The snapshot stays unsaved if the same inputs throw on the page thread. */
            }
            setSavePending(pendingSaves.current.size > 0);
          }
          if (data.id === modelRequest.current) {
            setPending(false);
            setProgress(null);
          }
          if (data.id === sensitivityRequest.current) setSensitivityPending(false);
        }
      };
      worker.onerror = () => {
        workerRef.current = null;
        setSensitivityPending(false);
        const queued = [...pendingSaves.current.values()];
        pendingSaves.current.clear();
        if (queued.length > 0) {
          const entries = queued.map((item) => createLedgerEntry(item.name, item.assumptions, runModel(item.assumptions)));
          setLedger((prev) => [...entries.reverse(), ...prev]);
        }
        setSavePending(false);
        setProgress(null);
        const requestId = ++modelRequest.current;
        const next = runCached(assumptionsRef.current);
        if (modelRequest.current === requestId) {
          setOutput(next);
          setPending(false);
        }
      };
      workerRef.current = worker;
      return worker;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    setSensitivity(null);
    const first = !sawAssumptions.current;
    sawAssumptions.current = true;
    if (first) {
      ensureWorker();
      return;
    }
    const requestId = ++modelRequest.current;
    const timer = window.setTimeout(() => {
      const hit = cachedOutput(assumptions);
      if (hit) {
        setOutput(hit);
        setPending(false);
        setProgress(null);
        setFromCache(true);
        return;
      }
      setPending(true);
      setFromCache(false);
      setProgress(null);
      const worker = ensureWorker();
      if (!worker) {
        setOutput(runCached(assumptions));
        setPending(false);
        setFromCache(false);
        return;
      }
      const message: WorkerRequest = { kind: "model", id: requestId, assumptions, slot: "main" };
      worker.postMessage(message);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [assumptions]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const store = useMemo<Store>(
    () => ({
      assumptions,
      notes,
      ledger,
      output,
      pending,
      progress,
      fromCache,
      savePending,
      sensitivity,
      sensitivityPending,
      update: (fn) => setAssumptions((prev) => ({ ...fn(prev), tag: "edited", schemaVersion: 3, schema: 3 })),
      replace: (next) => setAssumptions(next),
      setNotes,
      resetZeros: () => setAssumptions(zeroAssumptions()),
      loadTeaching: () => setAssumptions(teachingAssumptions()),
      saveRun: (name) => {
        const snapshot = structuredClone(assumptionsRef.current);
        const worker = ensureWorker();
        if (!worker) {
          commitSave(name, snapshot, runModel(snapshot));
          return;
        }
        // Negative ids are ledger snapshots. They do not replace the on-screen sample.
        const id = -(++saveRequest.current);
        pendingSaves.current.set(id, { name, assumptions: snapshot });
        setSavePending(true);
        const message: WorkerRequest = { kind: "model", id, assumptions: snapshot };
        worker.postMessage(message);
      },
      removeRun: (id) => setLedger((prev) => prev.filter((entry) => entry.id !== id)),
      computeSensitivity: () => {
        setSensitivityPending(true);
        const id = ++sensitivityRequest.current;
        const message: WorkerRequest = { kind: "sensitivity", id, assumptions: assumptionsRef.current };
        const worker = workerRef.current;
        if (worker) {
          worker.postMessage(message);
          return;
        }
        const report = runSensitivity(assumptionsRef.current);
        if (sensitivityRequest.current === id) {
          setSensitivity(report);
          setSensitivityPending(false);
        }
      },
    }),
    [assumptions, notes, ledger, output, pending, progress, fromCache, savePending, sensitivity, sensitivityPending],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useStore must be used inside StoreProvider.");
  return store;
}
