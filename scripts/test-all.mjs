#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Ejecuta todas las capas de pruebas y deja un JSON por capa en
 * test-results/<runId>/ para que test-report.mjs genere el resumen.
 *
 * Uso: node scripts/test-all.mjs [--skip lint,typecheck,e2e] [--run-id <id>]
 *
 * Código de salida: 1 si alguna capa ejecutada falla (incl. JSON de resultados
 * ausente/corrupto o fallo del generador de reporte); 0 solo si lo ejecutado
 * pasó. Capas omitidas con --skip quedan "not_run" y no cambian el exit code.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSteps } from "./lib/pipeline.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const skip = new Set((flagValue("skip") ?? "").split(",").filter(Boolean));
// Con segundos: dos corridas en el mismo minuto no pisan la misma carpeta.
const runId = flagValue("run-id") ?? new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const outDir = path.join(ROOT, "test-results", runId);

// Una corrida completada no se reutiliza: los resultados son evidencia.
if (existsSync(path.join(outDir, "runs.json"))) {
  console.error(`La corrida "${runId}" ya existe en ${outDir}. Usa --run-id distinto.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const E2E_ARTIFACTS = path.join(outDir, "artifacts", "e2e");

const steps = [
  {
    layer: "pipeline",
    command: `node --test "${path.join(ROOT, "scripts", "test-pipeline.test.mjs")}"`,
  },
  {
    layer: "lint",
    command: "pnpm lint",
  },
  {
    layer: "typecheck",
    command: "pnpm typecheck",
  },
  {
    layer: "api",
    command: `pnpm --filter @photos/api exec vitest run --reporter=default --reporter=json --outputFile.json="${path.join(outDir, "api.json")}"`,
  },
  {
    layer: "mobile",
    command: `pnpm --filter @photos/mobile exec vitest run --reporter=default --reporter=json --outputFile.json="${path.join(outDir, "mobile.json")}"`,
  },
  {
    layer: "e2e",
    // La API local necesita las migraciones D1 aplicadas antes de levantarse.
    // Si la preparación falla, el E2E no se lanza y la capa queda en failed.
    preCommand: `node "${WRANGLER}" d1 migrations apply photos-db --local`,
    preCwd: path.join(ROOT, "apps", "api"),
    command: "pnpm --filter @photos/mobile exec playwright test",
    // JSON y artifacts (screenshot/trace) quedan dentro de la corrida.
    env: { E2E_JSON: path.join(outDir, "e2e.json"), E2E_OUTPUT_DIR: E2E_ARTIFACTS },
  },
  {
    layer: "native",
    // Capa manual: si no hay native.json para esta corrida se copia la plantilla.
    manual: true,
    template: path.join(ROOT, "docs", "testing", "native-checklist.template.json"),
  },
];

const runs = runSteps(steps, { skip, outDir });

writeFileSync(path.join(outDir, "runs.json"), JSON.stringify(runs, null, 2));
console.log(`\nResultados crudos en ${outDir}`);
console.log("Generando reporte…");
const report = spawnSync(`node "${path.join(ROOT, "scripts", "test-report.mjs")}" "${outDir}"`, {
  cwd: ROOT,
  shell: true,
  stdio: "inherit",
});

// El exit code sale del summary, no de los comandos: una capa ejecutada sin
// JSON válido o con tests fallidos parseados también cuenta como fallida.
let failed = report.status !== 0;
if (!failed) {
  try {
    const summary = JSON.parse(readFileSync(path.join(outDir, "summary.json"), "utf8"));
    failed = (summary.layers ?? []).some((l) => l.status === "failed");
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
