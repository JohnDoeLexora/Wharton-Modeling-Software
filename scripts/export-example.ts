/**
 * Write the example book's tear sheet into examples/. The book is the CSV
 * under examples/. It is not a recommended portfolio.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tearSheetHtml } from "../src/core/tearSheet.ts";
import { findChrome } from "./chrome.ts";

const csv = readFileSync("examples/example-holdings.csv", "utf8").trim().split(/\n/).slice(1);
const holdings = csv.map((line) => {
  const [ticker, name, sleeve, weight] = line.split(",");
  const parsed = Number(weight);
  return { name: name || ticker, weight: parsed > 1 ? parsed / 100 : parsed, kind: sleeve || "sleeve" };
});
const html = tearSheetHtml({
  audience: "INTERNAL",
  title: "example book",
  asOf: "2026-10-09",
  holdings,
  riskLines: ["Example rows from examples/example-holdings.csv. Not a book the toolkit chose."],
  citations: [],
  scenarios: [{ label: "Library", note: "The nine cited scenarios are in the app. They are not applied to this sheet." }],
  reservePv: 500000,
  giftP5: null,
  giftP50: null,
  giftP95: null,
  methodology: [
    "Year step MODEL_SPEC §5.1. SplitMix64 MODEL_SPEC §6.1.",
    "The reserve at a zero yield is the nominal sum of ten $50,000 payments.",
    "This sheet is an example of the export. It is not an investment recommendation.",
  ],
});
const htmlPath = resolve("examples/INTERNAL - example-book.html");
const pdfPath = resolve("examples/INTERNAL - example-book.pdf");
writeFileSync(htmlPath, html);
const chrome = findChrome();
if (!chrome) {
  console.error("Chrome is not installed, so the example tear sheet PDF was not printed.");
  process.exit(1);
}
const printed = spawnSync(
  chrome,
  ["--headless", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, htmlPath],
  { encoding: "utf8" },
);
if (printed.status !== 0) {
  console.error(printed.stderr || printed.stdout);
  process.exit(1);
}
console.log("wrote examples/INTERNAL - example-book.html and examples/INTERNAL - example-book.pdf");
