import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Igual que Metro en web: *.web.ts tiene prioridad.
    extensions: [".web.ts", ".web.tsx", ".ts", ".tsx", ".mjs", ".js", ".json"],
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
