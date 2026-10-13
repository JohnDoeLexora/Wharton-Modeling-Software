import { execSync } from "node:child_process";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
})();

export default defineConfig({
  define: {
    __GIT_COMMIT__: JSON.stringify(commit),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/finbert": {
        target: "http://127.0.0.1:8765",
        rewrite: (path) => path.replace(/^\/finbert/, ""),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: [
        "src/core/yearStep.ts",
        "src/core/kernel.ts",
        "src/core/math.ts",
        "src/core/verifyStats.ts",
        "src/core/attribution.ts",
        "src/core/ladder.ts",
        "src/core/frontier.ts",
        "src/core/scenarioLib.ts",
        "src/core/bundle.ts",
        "src/core/paired.ts",
        "src/core/pdfText.ts",
        "src/core/parityKernel.ts",
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 85,
        branches: 75,
      },
    },
  },
});
