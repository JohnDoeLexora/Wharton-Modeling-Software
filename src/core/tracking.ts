/**
 * WInS fills and positions. The profit and loss on this page is labeled
 * WInS P&L. It is not an input to the case projection. `runModel` does not read it.
 */

import type { Holding, MarketRow, RulesConfig } from "./holdings";
import { parseCsv } from "./holdings";

export const WINS_PNL_LABEL = "WInS P&L";

/** The case projection never reads this book. The constant is the test's pin. */
export function winsPnlEntersProjection(): false {
  return false;
}

export interface Fill {
  ticker: string;
  qty: number;
  fillPrice: number;
  date: string;
  markPrice: number | null;
}

export interface Position {
  ticker: string;
  qty: number;
  cost: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  pnl: number;
  lastDate: string;
}

export function parseFills(text: string): Fill[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const idx = (names: string[]) => names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
  const ticker = idx(["ticker", "symbol"]);
  const qty = idx(["qty", "quantity", "shares"]);
  const price = idx(["fill_price", "price", "fill"]);
  const date = idx(["date", "fill_date"]);
  const mark = idx(["mark_price", "mark"]);
  const body = ticker >= 0 ? rows.slice(1) : rows;
  return body.map((row) => {
    const markRaw = mark >= 0 ? Number(row[mark] ?? "") : Number.NaN;
    return {
      ticker: (row[ticker >= 0 ? ticker : 0] ?? "").trim(),
      qty: Number(row[qty >= 0 ? qty : 1] ?? "0"),
      fillPrice: Number(row[price >= 0 ? price : 2] ?? "0"),
      date: (row[date >= 0 ? date : 3] ?? "").trim(),
      markPrice: Number.isFinite(markRaw) ? markRaw : null,
    };
  }).filter((fill) => fill.ticker !== "" && Number.isFinite(fill.qty) && Number.isFinite(fill.fillPrice));
}

export function positionsFromFills(fills: Fill[]): Position[] {
  const grouped = new Map<string, Fill[]>();
  for (const fill of fills) {
    const key = fill.ticker.trim().toUpperCase();
    const list = grouped.get(key) ?? [];
    list.push(fill);
    grouped.set(key, list);
  }
  const positions: Position[] = [];
  for (const [ticker, lots] of grouped) {
    const ordered = [...lots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let qty = 0;
    let cost = 0;
    let realized = 0;
    let lastDate = "";
    let mark: number | null = null;
    for (const lot of ordered) {
      lastDate = lot.date || lastDate;
      if (lot.markPrice !== null) mark = lot.markPrice;
      if (lot.qty >= 0) {
        cost += lot.qty * lot.fillPrice;
        qty += lot.qty;
      } else {
        const sell = -lot.qty;
        const held = Math.max(qty, 0);
        const close = Math.min(sell, held);
        const average = held > 0 ? cost / held : lot.fillPrice;
        realized += close * (lot.fillPrice - average);
        cost -= close * average;
        qty -= close;
        if (sell > held) qty -= sell - held;
      }
    }
    const marketPrice = mark ?? (ordered.length > 0 ? ordered[ordered.length - 1].fillPrice : 0);
    const marketValue = qty * marketPrice;
    const unrealized = marketValue - cost;
    positions.push({
      ticker,
      qty,
      cost,
      averagePrice: qty !== 0 ? cost / qty : 0,
      marketPrice,
      marketValue,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      pnl: realized + unrealized,
      lastDate,
    });
  }
  return positions.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export interface WeightRow {
  ticker: string;
  targetWeight: number;
  realizedWeight: number;
  drift: number;
  marketValue: number;
  targetDollars: number;
}

export function weightComparison(positions: Position[], holdings: Holding[], capital: number): WeightRow[] {
  const gross = positions.reduce((sum, position) => sum + Math.abs(position.marketValue), 0);
  const keys = new Set<string>();
  for (const position of positions) keys.add(position.ticker.trim().toUpperCase());
  for (const holding of holdings) if (holding.ticker.trim()) keys.add(holding.ticker.trim().toUpperCase());
  return [...keys].sort().map((ticker) => {
    const position = positions.find((row) => row.ticker.trim().toUpperCase() === ticker);
    const holding = holdings.find((row) => row.ticker.trim().toUpperCase() === ticker);
    const marketValue = position?.marketValue ?? 0;
    const realizedWeight = gross > 0 ? marketValue / gross : 0;
    const targetWeight = holding?.weight ?? 0;
    return {
      ticker,
      targetWeight,
      realizedWeight,
      drift: realizedWeight - targetWeight,
      marketValue,
      targetDollars: targetWeight * capital,
    };
  });
}

export interface RebalanceIdea {
  ticker: string;
  side: "BUY" | "SELL" | "HOLD";
  qty: number;
  notional: number;
  reason: string;
  ok: boolean;
}

export function rebalanceIdeas(args: {
  rows: WeightRow[];
  positions: Position[];
  market: MarketRow[];
  rules: RulesConfig;
  tradesUsed: number;
}): RebalanceIdea[] {
  const remaining = Math.max(0, args.rules.maxTrades - args.tradesUsed);
  let used = 0;
  return args.rows.map((row) => {
    const position = args.positions.find((item) => item.ticker === row.ticker);
    const quote = args.market.find((item) => item.ticker.trim().toUpperCase() === row.ticker);
    const price = quote?.price ?? position?.marketPrice ?? 0;
    const gapDollars = row.targetDollars - row.marketValue;
    if (price <= 0 || Math.abs(gapDollars) < 1) {
      return { ticker: row.ticker, side: "HOLD" as const, qty: 0, notional: 0, reason: "No trade. The drift is under a dollar, or there is no price.", ok: true };
    }
    const rawQty = Math.trunc(gapDollars / price);
    const qty = rawQty;
    const side = qty > 0 ? "BUY" as const : qty < 0 ? "SELL" as const : "HOLD" as const;
    if (side === "HOLD") {
      return { ticker: row.ticker, side, qty: 0, notional: 0, reason: "Rounded to zero shares.", ok: true };
    }
    if (used >= remaining) {
      return { ticker: row.ticker, side, qty: 0, notional: 0, reason: `Trade budget is ${args.rules.maxTrades}. ${args.tradesUsed} already used.`, ok: false };
    }
    const volume = quote?.avgDailyVolume;
    if (volume != null && volume > 0 && Math.abs(qty) > args.rules.volumeMultiple * volume) {
      return {
        ticker: row.ticker,
        side,
        qty: 0,
        notional: 0,
        reason: `Order would exceed ${args.rules.volumeMultiple}× average daily volume.`,
        ok: false,
      };
    }
    used += 1;
    return {
      ticker: row.ticker,
      side,
      qty: Math.abs(qty),
      notional: Math.abs(qty) * price,
      reason: side === "BUY" ? "Buy toward the target weight." : "Sell toward the target weight.",
      ok: true,
    };
  });
}

export interface TrackingReport {
  label: typeof WINS_PNL_LABEL;
  positions: Position[];
  weights: WeightRow[];
  ideas: RebalanceIdea[];
  pnl: number;
  marketValue: number;
  tradesUsed: number;
  tradesLeft: number;
  entersProjection: false;
}

export function trackingReport(args: {
  fills: Fill[];
  holdings: Holding[];
  market: MarketRow[];
  rules: RulesConfig;
  tradesUsed?: number;
}): TrackingReport {
  const positions = positionsFromFills(args.fills);
  const weights = weightComparison(positions, args.holdings, args.rules.startingCapital);
  const tradesUsed = args.tradesUsed ?? args.fills.length;
  const ideas = rebalanceIdeas({ rows: weights, positions, market: args.market, rules: args.rules, tradesUsed });
  return {
    label: WINS_PNL_LABEL,
    positions,
    weights,
    ideas,
    pnl: positions.reduce((sum, position) => sum + position.pnl, 0),
    marketValue: positions.reduce((sum, position) => sum + position.marketValue, 0),
    tradesUsed,
    tradesLeft: Math.max(0, args.rules.maxTrades - tradesUsed),
    entersProjection: winsPnlEntersProjection(),
  };
}
