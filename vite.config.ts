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
    include: ["src/**/*.test.ts"],
  },
});
