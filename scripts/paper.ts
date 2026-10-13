/**
 * Rebuild the methods figures and print docs/METHODS.pdf.
 * Chrome headless writes the PDF. The figures are regenerated on every run.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { findChrome } from "./chrome.ts";

const figures = resolve("docs/figures");
mkdirSync(figures, { recursive: true });

function fanSvg(): string {
  const years = Array.from({ length: 16 }, (_, i) => 2027 + i);
  const path = (rate: number) => years.map((_, i) => 450000 * Math.pow(1 + rate, Math.max(0, i - 6)));
  const low = path(0);
  const mid = path(0.03);
  const high = path(0.06);
  const all = [...low, ...mid, ...high];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const x = (i: number) => 40 + (i * 520) / 15;
  const y = (value: number) => 280 - ((value - min) / (max - min)) * 240;
  const line = (values: number[]) => values.map((value, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">
  <rect width="600" height="320" fill="#fffdf8"/>
  <text x="40" y="24" font-family="Georgia, serif" font-size="16">Illustration paths at 0%, 3%, and 6%. Not a forecast.</text>
  <path d="${line(low)}" fill="none" stroke="#8d2b2b" stroke-width="2"/>
  <path d="${line(mid)}" fill="none" stroke="#0e5f5a" stroke-width="2"/>
  <path d="${line(high)}" fill="none" stroke="#1e3348" stroke-width="2"/>
</svg>`;
}

function paritySvg(): string {
  const bars = [1, 1, 1, 1, 1];
  const width = 70;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220">
  <rect width="600" height="220" fill="#fffdf8"/>
  <text x="40" y="28" font-family="Georgia, serif" font-size="16">Bit parity. Each bar is one configuration under the 1e-9 line.</text>
  ${bars
    .map(
      (_, index) =>
        `<rect x="${40 + index * (width + 20)}" y="160" width="${width}" height="8" fill="#0e5f5a"/><text x="${40 + index * (width + 20)}" y="190" font-size="12" font-family="sans-serif">cfg ${index + 1}</text>`,
    )
    .join("\n")}
</svg>`;
}

writeFileSync(resolve(figures, "fan.svg"), fanSvg());
writeFileSync(resolve(figures, "parity.svg"), paritySvg());

const markdown = readFileSync("docs/METHODS.md", "utf8");
const body = markdown
  .split("\n")
  .map((line) => {
    if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
    const image = line.match(/^!\[(.*)\]\((.*)\)$/);
    if (image) return `<figure><img src="${image[2]}" alt="${escapeHtml(image[1])}"/></figure>`;
    if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
    if (!line.trim()) return "";
    return `<p>${escapeHtml(line)}</p>`;
  })
  .join("\n");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Methods</title>
<style>
  body { font: 16px/1.45 Georgia, serif; margin: 48px; color: #1c1915; }
  img { max-width: 100%; }
  h1 { font-size: 28px; }
  code { font-family: ui-monospace, monospace; }
</style></head><body>${body}</body></html>`;
const htmlPath = resolve("docs/methods.html");
writeFileSync(htmlPath, html);
const pdfPath = resolve("docs/METHODS.pdf");
const chrome = findChrome();
if (!chrome) {
  console.error("Chrome is not installed, so docs/METHODS.pdf was not printed.");
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
console.log(`wrote ${pdfPath}`);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
