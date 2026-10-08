/**
 * A Trading Note draft. The template stays inside 300 characters.
 * The team edits it. The app does not submit it to WInS.
 */

export const TRADE_NOTE_LIMIT = 300;

export interface NoteStats {
  ticker: string;
  sleeve: string;
  weight: number;
  kind: string;
  role: string;
  duration: number | null;
  modeledYield: number | null;
  expense: number | null;
}

export interface NoteCount {
  length: number;
  limit: number;
  over: boolean;
}

export function noteCount(text: string): NoteCount {
  return { length: text.length, limit: TRADE_NOTE_LIMIT, over: text.length > TRADE_NOTE_LIMIT };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** Role, sleeve, weight, and modeled stats. The result is at most 300 characters. */
export function buildTradeNote(stats: NoteStats): string {
  const parts = [
    `${stats.ticker || "Holding"} · ${stats.sleeve || "no sleeve"} sleeve.`,
    `Weight ${(stats.weight * 100).toFixed(1)}%.`,
    `Kind ${stats.kind || "unspecified"}.`,
    stats.role ? `Role: ${stats.role}.` : "",
    stats.duration != null && Number.isFinite(stats.duration) ? `Modeled duration ${stats.duration.toFixed(2)}y.` : "",
    stats.modeledYield != null && Number.isFinite(stats.modeledYield) ? `Modeled yield ${pct(stats.modeledYield)}.` : "",
    stats.expense != null && Number.isFinite(stats.expense) ? `Expense ${pct(stats.expense)}.` : "",
    "Assumption, not a forecast. Edit before a Trading Note.",
  ].filter((part) => part !== "");
  let text = parts.join(" ");
  if (text.length > TRADE_NOTE_LIMIT) text = `${text.slice(0, TRADE_NOTE_LIMIT - 3)}...`;
  return text;
}
