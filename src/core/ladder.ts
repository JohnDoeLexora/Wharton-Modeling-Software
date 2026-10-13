/**
 * Liability-driven ladder for the ten $50,000 payments, 2033 through 2042.
 * The optimizer reports costs. It does not pick a reserve for the case. MODEL_SPEC §10.
 */
import { OPERATING_PAYMENT, OPERATING_PAYMENTS, OPERATING_FIRST_YEAR } from "./case";
import { pvAnnuityDue } from "./math";

export const WINS_CAPITAL = 300_000;

export interface LadderBond {
  id: string;
  kind: "coupon" | "strip" | "bill" | "tips" | "etf";
  maturityYear: number;
  /** Annual coupon rate on face. Zero for a strip or a bill. */
  coupon: number;
  /** Dirty ask and bid per 100 face. */
  ask: number;
  bid: number;
  /** Nelson-Siegel dirty price per 100 face. */
  fair: number;
  duration: number;
  convexity: number;
  /** Quoted yield and the curve's fair yield, both annual decimals. */
  yield: number;
  fairYield: number;
  /** Minimum face increment. */
  lot: number;
  /** Quoted face available. */
  volume: number;
  maxVolumeFraction: number;
}

export interface LadderTrade {
  id: string;
  face: number;
  cost: number;
  year: number;
}

export interface LadderPlan {
  label: string;
  trades: LadderTrade[];
  cost: number;
  capitalLeft: number;
  turnover: number;
  fundedShare: number | null;
  note: string;
}

export interface QuoteRichness {
  id: string;
  richBp: number;
  dollarsPerTrade: number;
  face: number;
}

export interface LadderReport {
  liabilityPv: number;
  liabilityDuration: number;
  liabilityConvexity: number;
  keyRateDurations: { tenor: number; duration: number }[];
  immunization: LadderPlan;
  billLadder: LadderPlan;
  durationMatch: LadderPlan;
  richness: QuoteRichness[];
  rebalance: { year: number; turnover: number; trades: number }[];
  note: string;
}

const LIABILITY_NOTE =
  "Costs of three reserve constructions under the bond universe the team loaded. Not a reserve decision and not a WInS order.";

export function liabilityCashflows(asOfYear = OPERATING_FIRST_YEAR): { year: number; amount: number }[] {
  const flows = [];
  for (let k = 0; k < OPERATING_PAYMENTS; k++) flows.push({ year: asOfYear + k, amount: OPERATING_PAYMENT });
  return flows;
}

/** Key-rate durations by bumping one tenor of a flat curve and leaving the others. */
export function liabilityKeyRates(flatYield: number, tenors = [2, 5, 10, 30]): { tenor: number; duration: number }[] {
  const base = presentValue(flatYield);
  const bump = 0.0001;
  return tenors.map((tenor) => {
    const up = presentValueShifted(flatYield, tenor, bump);
    const down = presentValueShifted(flatYield, tenor, -bump);
    const duration = base > 0 ? (down - up) / (2 * bump * base) : Number.NaN;
    return { tenor, duration };
  });
}

export function liabilityConvexity(flatYield: number): number {
  const base = presentValue(flatYield);
  const bump = 0.0001;
  const up = presentValue(flatYield + bump);
  const down = presentValue(flatYield - bump);
  if (!(base > 0)) return Number.NaN;
  return (up + down - 2 * base) / (base * bump * bump);
}

export function presentValue(flatYield: number, asOfYear = OPERATING_FIRST_YEAR): number {
  // The ten payments are an annuity due at `asOfYear`, so the first one is not discounted.
  void asOfYear;
  return pvAnnuityDue(OPERATING_PAYMENT, OPERATING_PAYMENTS, flatYield);
}

function presentValueShifted(flatYield: number, tenor: number, bump: number): number {
  let total = 0;
  for (let k = 0; k < OPERATING_PAYMENTS; k++) {
    const year = k;
    const yieldHere = Math.abs(year - tenor) <= 2.5 || (tenor >= 30 && year >= 10) ? flatYield + bump : flatYield;
    const y = yieldHere <= -0.999999 ? -0.999999 : yieldHere;
    total += OPERATING_PAYMENT / (1 + y) ** year;
  }
  return total;
}

export function quoteRichness(bond: LadderBond, face: number): QuoteRichness {
  const richBp = (bond.yield - bond.fairYield) * 10_000;
  const dollarsPerTrade = ((bond.ask - bond.fair) / 100) * face;
  return { id: bond.id, richBp, dollarsPerTrade, face };
}

/**
 * Cash-flow match from the last payment year backward.
 * Each year's residual is filled with the cheapest instrument that pays that year,
 * in round lots, inside the volume cap and the remaining capital.
 */
export function matchCashflows(universe: LadderBond[], capital = WINS_CAPITAL, buffer = 0): LadderPlan {
  const need = new Map<number, number>();
  for (const flow of liabilityCashflows()) need.set(flow.year, flow.amount * (1 + buffer));
  let left = capital;
  const trades: LadderTrade[] = [];
  const years = [...need.keys()].sort((a, b) => b - a);
  for (const year of years) {
    let residual = need.get(year) ?? 0;
    const candidates = universe
      .filter((bond) => bondPays(bond, year) > 0 && bond.ask > 0)
      .map((bond) => ({ bond, cashPerDollar: bondPays(bond, year) / (bond.ask / 100) }))
      .sort((a, b) => b.cashPerDollar - a.cashPerDollar);
    for (const { bond } of candidates) {
      if (residual <= 1 || left <= 1) break;
      const perFace = bondPays(bond, year);
      if (!(perFace > 0)) continue;
      const capFace = Math.min(bond.volume * bond.maxVolumeFraction, (left / (bond.ask / 100)));
      let face = Math.floor(Math.min(capFace, residual / perFace) / bond.lot) * bond.lot;
      if (!(face > 0)) continue;
      const cost = (face * bond.ask) / 100;
      if (cost > left + 1e-6) face = Math.floor(left / (bond.ask / 100) / bond.lot) * bond.lot;
      if (!(face > 0)) continue;
      const spent = (face * bond.ask) / 100;
      trades.push({ id: bond.id, face, cost: spent, year });
      left -= spent;
      residual -= face * perFace;
      need.set(year, Math.max(0, residual));
    }
  }
  const cost = trades.reduce((sum, trade) => sum + trade.cost, 0);
  return {
    label: "Cash-flow match",
    trades,
    cost,
    capitalLeft: capital - cost,
    turnover: 1,
    fundedShare: null,
    note: "Greedy cash-flow match in round lots. Exploration of this universe, not an order.",
  };
}

export function billLadder(yieldPerYear: number, capital = WINS_CAPITAL): LadderPlan {
  let cost = 0;
  const trades: LadderTrade[] = [];
  for (let k = 0; k < OPERATING_PAYMENTS; k++) {
    const price = 100 / (1 + yieldPerYear) ** k;
    const face = OPERATING_PAYMENT;
    const spent = (face * price) / 100;
    trades.push({ id: `bill-${OPERATING_FIRST_YEAR + k}`, face, cost: spent, year: OPERATING_FIRST_YEAR + k });
    cost += spent;
  }
  return {
    label: "Bill ladder",
    trades,
    cost,
    capitalLeft: capital - cost,
    turnover: 1,
    fundedShare: null,
    note: "A discount bill for each nominal payment. The yield is the team's input.",
  };
}

export function durationMatch(universe: LadderBond[], flatYield: number, capital = WINS_CAPITAL): LadderPlan {
  const target = modifiedDuration(flatYield);
  const ranked = universe
    .filter((bond) => bond.ask > 0 && bond.lot > 0)
    .slice()
    .sort((a, b) => Math.abs(a.duration - target) - Math.abs(b.duration - target));
  const bond = ranked[0];
  if (!bond) {
    return { label: "Duration match", trades: [], cost: 0, capitalLeft: capital, turnover: 0, fundedShare: null, note: "No bond in the universe." };
  }
  const pv = presentValue(flatYield);
  const rawFace = bond.fair > 0 ? (pv / bond.fair) * 100 : 0;
  const capFace = Math.min(bond.volume * bond.maxVolumeFraction, (capital / (bond.ask / 100)));
  const face = Math.floor(Math.min(rawFace, capFace) / bond.lot) * bond.lot;
  const cost = (face * bond.ask) / 100;
  return {
    label: "Duration match",
    trades: face > 0 ? [{ id: bond.id, face, cost, year: bond.maturityYear }] : [],
    cost,
    capitalLeft: capital - cost,
    turnover: 1,
    fundedShare: null,
    note: "One bond whose duration is closest to the liability. Face is capped by the lot, the volume limit, and the capital.",
  };
}

export function fundedUnderShifts(assetPv: number, flatYield: number, shifts: number[]): number | null {
  if (shifts.length === 0 || !(assetPv > 0)) return null;
  let ok = 0;
  for (const shift of shifts) {
    const liability = presentValue(flatYield + shift);
    if (assetPv + 1e-6 >= liability) ok += 1;
  }
  return ok / shifts.length;
}

export function rebalanceSchedule(current: Map<string, number>, target: LadderTrade[], years: number[]): { year: number; turnover: number; trades: number }[] {
  const next = new Map<string, number>();
  for (const trade of target) next.set(trade.id, (next.get(trade.id) ?? 0) + trade.face);
  const ids = new Set([...current.keys(), ...next.keys()]);
  let traded = 0;
  let base = 0;
  for (const id of ids) {
    const before = current.get(id) ?? 0;
    const after = next.get(id) ?? 0;
    traded += Math.abs(after - before);
    base += Math.max(before, after);
  }
  const turnover = base > 0 ? traded / (2 * base) : 0;
  return years.map((year) => ({ year, turnover, trades: target.length }));
}

export function buildLadderReport(args: {
  universe: LadderBond[];
  flatYield: number;
  capital?: number;
  buffer?: number;
  shifts?: number[];
}): LadderReport {
  const capital = args.capital ?? WINS_CAPITAL;
  const immunization = matchCashflows(args.universe, capital, args.buffer ?? 0);
  const bills = billLadder(args.flatYield, capital);
  const matched = durationMatch(args.universe, args.flatYield, capital);
  const asset = immunization.cost;
  const shifts = args.shifts ?? [-0.02, -0.01, 0, 0.01, 0.02];
  immunization.fundedShare = fundedUnderShifts(asset, args.flatYield, shifts);
  bills.fundedShare = fundedUnderShifts(bills.cost, args.flatYield, shifts);
  matched.fundedShare = fundedUnderShifts(matched.cost, args.flatYield, shifts);
  const richness = args.universe.map((bond) => quoteRichness(bond, bond.lot));
  const schedule = rebalanceSchedule(new Map(), immunization.trades, [2033, 2034, 2035]);
  return {
    liabilityPv: presentValue(args.flatYield),
    liabilityDuration: modifiedDuration(args.flatYield),
    liabilityConvexity: liabilityConvexity(args.flatYield),
    keyRateDurations: liabilityKeyRates(args.flatYield),
    immunization,
    billLadder: bills,
    durationMatch: matched,
    richness,
    rebalance: schedule,
    note: LIABILITY_NOTE,
  };
}

function bondPays(bond: LadderBond, year: number): number {
  if (year > bond.maturityYear || year < OPERATING_FIRST_YEAR) return 0;
  const coupon = bond.kind === "strip" || bond.kind === "bill" ? 0 : bond.coupon;
  const principal = year === bond.maturityYear ? 1 : 0;
  return coupon + principal;
}

function modifiedDuration(flatYield: number): number {
  const base = presentValue(flatYield);
  const bump = 0.0001;
  if (!(base > 0)) return Number.NaN;
  const up = presentValue(flatYield + bump);
  const down = presentValue(flatYield - bump);
  return (down - up) / (2 * bump * base);
}
