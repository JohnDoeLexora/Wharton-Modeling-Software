/**
 * Recompute fixture claims on three windows. Exit 0 when the honest claim
 * is inside the cross-window range and fresh, and the wild claim is flagged.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { frameFromCsv, verifyClaims, citationTable } from "../src/core/verifyStats.ts";

const dates: string[] = [];
const market: number[] = [];
const name: number[] = [];
let price = 100;
let other = 50;
let cursor = Date.parse("2021-01-04T00:00:00Z");
let state = 42;
while (dates.length < 1400) {
  const day = new Date(cursor).getUTCDay();
  if (day !== 0 && day !== 6) {
    state = (1664525 * state + 1013904223) % 4294967296;
    const shock = (state / 4294967296 - 0.5) * 0.02;
    price *= 1 + shock;
    other *= 1 + shock * 0.4;
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    market.push(price);
    name.push(other);
  }
  cursor += 86_400_000;
}
const lines = ["date,MKT,LRN", ...dates.map((date, index) => `${date},${market[index].toFixed(6)},${name[index].toFixed(6)}`)];
const text = lines.join("\n") + "\n";
mkdirSync("fixtures/verify-stats", { recursive: true });
writeFileSync("fixtures/verify-stats/prices.csv", text);
const frame = frameFromCsv(text, "fixtures/verify-stats/prices.csv");
const probe = verifyClaims(frame, [{ id: "probe", stat: "vol", asset: "MKT", quoted: 0 }], frame.asOf);
const honest = probe[0].windows.map((row) => row.value).filter((value): value is number => value !== null && Number.isFinite(value));
const quoted = honest.length ? honest.reduce((sum, value) => sum + value, 0) / honest.length : 0;
const rows = verifyClaims(
  frame,
  [
    { id: "vol-mkt", stat: "vol", asset: "MKT", quoted },
    { id: "vol-wild", stat: "vol", asset: "MKT", quoted: 5 },
    { id: "beta-lrn", stat: "beta", asset: "LRN", benchmark: "MKT", quoted: 0.4 },
  ],
  frame.asOf,
);
console.log(citationTable(rows));
const good = rows.find((row) => row.id === "vol-mkt");
const wild = rows.find((row) => row.id === "vol-wild");
if (!good || good.outsideRange || good.stale) {
  console.error("honest vol claim was flagged", good);
  process.exit(1);
}
if (!wild?.outsideRange) {
  console.error("wild vol claim was not flagged", wild);
  process.exit(1);
}
const stale = verifyClaims(frame, [{ id: "old", stat: "vol", asset: "MKT", quoted }], "2030-01-01");
if (!stale[0]?.stale) {
  console.error("an old as-of date was not marked stale");
  process.exit(1);
}
console.log(`verify-stats ok as of ${frame.asOf} sha ${frame.sha256.slice(0, 8)}`);
