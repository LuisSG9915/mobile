#!/usr/bin/env node
/**
 * Puerta de verificación local para agentes (Gemini 3.8 Flash).
 *
 *   node scripts/gemini-gate.mjs            # lint + typecheck + tests + pipeline
 *   node scripts/gemini-gate.mjs --quick    # sin tests (lint + typecheck + pipeline)
 *   node scripts/gemini-gate.mjs --e2e      # añade el E2E de resume (requiere R2 dev)
 *
 * No modifica el repositorio, no hace commit, no toca producción.
 * Escribe un resumen en test-results/gemini-gate-<timestamp>.md (gitignored).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quick = process.argv.includes("--quick");
const withE2e = process.argv.includes("--e2e");
const steps = [];

function run(label, command, args, opts = {}) {
  const started = Date.now();
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  const ms = Date.now() - started;
  const ok = result.status === 0;
  steps.push({ label, command: [command, ...args].join(" "), ok, ms });
  if (!ok) {
    console.error(`\n✗ ${label} falló (exit ${result.status ?? "signal"})`);
    writeReport();
    process.exit(result.status || 1);
  }
  console.log(`✓ ${label} (${(ms / 1000).toFixed(1)}s)`);
}

function writeReport() {
  const dir = path.join(ROOT, "test-results");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `gemini-gate-${stamp}.md`);
  const ok = steps.every((s) => s.ok);
  const body = [
    `# Gemini gate — ${new Date().toISOString()}`,
    "",
    `Resultado: **${ok ? "OK" : "FALLO"}**`,
    "",
    "| Paso | Comando | Estado | Tiempo |",
    "| :--- | :--- | :---: | ---: |",
    ...steps.map(
      (s) =>
        `| ${s.label} | \`${s.command}\` | ${s.ok ? "✅" : "❌"} | ${(s.ms / 1000).toFixed(1)}s |`,
    ),
    "",
  ].join("\n");
  writeFileSync(file, body);
  console.log(`\nResumen: ${path.relative(ROOT, file)}`);
}

run("Lint (Biome)", "pnpm", ["lint"]);
run("Typecheck", "pnpm", ["typecheck"]);
if (!quick) run("Tests (API + mobile)", "pnpm", ["test"]);
run("Pipeline selftest", "pnpm", ["test:pipeline"]);

if (withE2e) {
  const devVars = path.join(ROOT, "apps/api/.dev.vars");
  if (!existsSync(devVars)) {
    console.log("\n⚠ E2E omitido: falta apps/api/.dev.vars (R2 dev).");
    steps.push({
      label: "E2E multipart-resume",
      command: "playwright test e2e/multipart-resume.spec.ts",
      ok: false,
      ms: 0,
    });
    writeReport();
    process.exit(2);
  }
  run("E2E multipart-resume", "pnpm", [
    "--filter",
    "@photos/mobile",
    "exec",
    "playwright",
    "test",
    "e2e/multipart-resume.spec.ts",
  ]);
}

writeReport();
process.exit(0);
