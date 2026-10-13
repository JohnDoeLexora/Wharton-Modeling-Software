import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chrome = process.env.CHROME_PATH || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : "");

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: {
      ...(chrome ? { executablePath: chrome } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
    port: 4173,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
