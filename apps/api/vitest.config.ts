import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Carga .dev.vars si existe (para tests que firmen con credenciales reales no es necesario)
function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(path.join(dirname, ".dev.vars"), "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const migrations = await readD1Migrations(path.join(dirname, "migrations"));
const devVars = loadDevVars();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Los tests deben seguir 100% locales: el binding BUCKET es `remote: true`
      // en wrangler.jsonc solo para `wrangler dev`.
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          R2_ACCOUNT_ID: "test-account",
          R2_ACCESS_KEY_ID: "test-key",
          R2_SECRET_ACCESS_KEY: "test-secret",
          BETTER_AUTH_SECRET: "test-secret-key-for-tests-only-32chars",
          BETTER_AUTH_URL: "http://localhost:8787",
          WEB_ORIGINS: "http://localhost:8081,https://web.test.dev",
          ...devVars,
        },
      },
    }),
  ],
  test: {
    globals: true,
    setupFiles: ["./test/apply-migrations.ts"],
    include: ["test/**/*.test.ts"],
  },
});
