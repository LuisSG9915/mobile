import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // test-all fija E2E_OUTPUT_DIR a test-results/<runId>/artifacts/e2e para que
  // los screenshots/traces queden dentro de cada corrida; sin la variable se
  // usa la carpeta local de siempre.
  outputDir: process.env.E2E_OUTPUT_DIR ?? "./e2e/.artifacts",
  // Guardarraíl: el E2E escribe en un bucket R2 real; aborta si la config no
  // apunta al bucket de desarrollo antes de lanzar ningún test.
  globalSetup: require.resolve("./e2e/global-setup.ts"),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: {
    // La primera carga espera a que Metro empaquete la app web.
    timeout: 15_000,
  },
  reporter: [["list"], ["json", { outputFile: process.env.E2E_JSON ?? "e2e/.artifacts/e2e.json" }]],
  use: {
    baseURL: "http://localhost:8081",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // El shim .bin/wrangler de apps/api está roto con linker hoisted (H-003):
      // se invoca el binario real de la raíz del monorepo.
      command: "node ../../node_modules/wrangler/bin/wrangler.js dev --port 8787",
      cwd: "../api",
      url: "http://localhost:8787/health",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "npx expo start --web --port 8081",
      env: {
        CI: "1",
        EXPO_PUBLIC_API_URL: "http://localhost:8787",
      },
      url: "http://localhost:8081",
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
