import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  blankHolding,
  defaultRules,
  type Holding,
  type MarketRow,
  type RulesConfig,
} from "./core/holdings";
import { setExportAudience, type ExportAudience } from "./ui/format";

const KEY = "gao-toolkit-v4-book";

export interface PinnedMetrics {
  label: string;
  funded: number | null;
  p5: number | null;
  gift: number | null;
  low: number | null;
  high: number | null;
}

export interface StressRow {
  id: string;
  label: string;
  funded: number | null;
  p5: number | null;
  gift: number | null;
}

interface BookStore {
  holdings: Holding[];
  baseline: Holding[];
  market: MarketRow[];
  rules: RulesConfig;
  audience: ExportAudience;
  pinned: PinnedMetrics | null;
  stresses: StressRow[];
  setHoldings: (holdings: Holding[]) => void;
  setBaseline: (holdings: Holding[]) => void;
  setMarket: (market: MarketRow[]) => void;
  setRules: (rules: RulesConfig) => void;
  setAudience: (audience: ExportAudience) => void;
  setPinned: (pinned: PinnedMetrics | null) => void;
  setStresses: (rows: StressRow[]) => void;
}

const Ctx = createContext<BookStore | null>(null);

function load(): Pick<BookStore, "holdings" | "baseline" | "market" | "rules" | "audience"> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw) as Partial<BookStore>;
    return {
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
      baseline: Array.isArray(parsed.baseline) ? parsed.baseline : [],
      market: Array.isArray(parsed.market) ? parsed.market : [],
      rules: { ...defaultRules(), ...(parsed.rules ?? {}) },
      audience: parsed.audience === "INTERNAL" ? "INTERNAL" : "EXTERNAL",
    };
  } catch {
    return { holdings: [], baseline: [], market: [], rules: defaultRules(), audience: "EXTERNAL" };
  }
}

export function BookProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [holdings, setHoldings] = useState<Holding[]>(initial.holdings);
  const [baseline, setBaseline] = useState<Holding[]>(initial.baseline);
  const [market, setMarket] = useState<MarketRow[]>(initial.market);
  const [rules, setRules] = useState<RulesConfig>(initial.rules);
  const [audience, setAudienceState] = useState<ExportAudience>(initial.audience);
  const [pinned, setPinned] = useState<PinnedMetrics | null>(null);
  const [stresses, setStresses] = useState<StressRow[]>([]);

  useEffect(() => {
    setExportAudience(audience);
    try {
      localStorage.setItem(KEY, JSON.stringify({ holdings, baseline, market, rules, audience }));
    } catch {
      /* The session still runs if storage is full. */
    }
  }, [holdings, baseline, market, rules, audience]);

  const store = useMemo<BookStore>(
    () => ({
      holdings,
      baseline,
      market,
      rules,
      audience,
      pinned,
      stresses,
      setHoldings,
      setBaseline,
      setMarket,
      setRules,
      setAudience: (next) => {
        setExportAudience(next);
        setAudienceState(next);
      },
      setPinned,
      setStresses,
    }),
    [holdings, baseline, market, rules, audience, pinned, stresses],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useBook(): BookStore {
  const store = useContext(Ctx);
  if (!store) throw new Error("useBook must be used inside BookProvider.");
  return store;
}

export function nextHoldingId(holdings: Holding[]): string {
  return blankHolding(`h${holdings.length + 1}-${Date.now().toString(36)}`).id;
}
