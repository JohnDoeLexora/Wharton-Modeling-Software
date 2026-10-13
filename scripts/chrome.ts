/**
 * Headless browser used to print HTML to PDF.
 * Prefers CHROME_PATH, then a system Chrome, then Playwright's Chromium cache
 * so GitHub Actions can print after `npx playwright install chromium`.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function findChrome(): string {
  const named = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((path): path is string => Boolean(path));
  for (const path of named) {
    if (existsSync(path)) return path;
  }
  const root = resolve(homedir(), ".cache/ms-playwright");
  if (!existsSync(root)) return "";
  const dirs = readdirSync(root).filter((name) => name.startsWith("chromium"));
  for (const dir of dirs) {
    for (const relative of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const path = resolve(root, dir, relative);
      if (existsSync(path)) return path;
    }
  }
  return "";
}
