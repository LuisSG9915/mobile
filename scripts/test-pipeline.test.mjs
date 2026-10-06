/**
 * Tests del pipeline de pruebas (node:test, sin dependencias nuevas).
 * Usa directorios temporales y comandos simulados con `node -e`: nunca toca
 * wrangler, expo ni R2.
 *
 *   node --test scripts/test-pipeline.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runSteps } from "./lib/pipeline.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORT = path.join(ROOT, "scripts", "test-report.mjs");
const TEST_ALL = path.join(ROOT, "scripts", "test-all.mjs");
const NODE = `"${process.execPath}"`;

const tmp = () => mkdtempSync(path.join(tmpdir(), "photos-pipeline-"));
const writeJson = (dir, name, obj) => writeFileSync(path.join(dir, name), JSON.stringify(obj));
const runReport = (dir) => spawnSync(process.execPath, [REPORT, dir], { encoding: "utf8" });
const readSummary = (dir) => JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8"));
const layerOf = (dir, layer) => readSummary(dir).layers.find((l) => l.layer === layer);

const vitestJson = (assertions) => ({
  testResults: [{ name: "x.test.ts", assertionResults: assertions }],
});
const passed = { status: "passed", fullName: "ok", failureMessages: [] };
const failedT = { status: "failed", fullName: "rompe", failureMessages: ["boom"] };

const e2eJson = (status) => ({
  suites: [
    {
      file: "spec.ts",
      specs: [
        {
          title: "spec",
          tests: [
            {
              expectedStatus: status === "passed" ? "passed" : "failed",
              results: [{ status, steps: [], attachments: [] }],
            },
          ],
        },
      ],
    },
  ],
});
const nativeJson = (statuses) =>
  statuses.map((status, i) => ({
    id: `N-0${i + 1}`,
    pasos: [`paso ${i}`],
    esperado: "algo",
    status,
    notas: status === "bloqueado" ? "sin dispositivo" : "",
  }));

// ---------------------------------------------------------------- runSteps

test("runSteps: comando exitoso registra exitCode 0 y duración", () => {
  const runs = runSteps([{ layer: "ok", command: `${NODE} -e "process.exit(0)"` }], {
    outDir: tmp(),
    log: () => {},
  });
  assert.equal(runs[0].exitCode, 0);
  assert.ok(runs[0].durationMs >= 0);
});

test("runSteps: proceso que falla propaga exitCode", () => {
  const runs = runSteps([{ layer: "mal", command: `${NODE} -e "process.exit(3)"` }], {
    outDir: tmp(),
    log: () => {},
  });
  assert.equal(runs[0].exitCode, 3);
});

test("runSteps: skip no ejecuta el comando y queda exitCode null", () => {
  const dir = tmp();
  const marker = path.join(dir, "no-debe-existir");
  const runs = runSteps(
    [
      {
        layer: "api",
        command: `${NODE} -e "require('fs').writeFileSync(process.argv[1],'x')" ${marker}`,
      },
    ],
    { skip: new Set(["api"]), outDir: dir, log: () => {} },
  );
  assert.equal(runs[0].exitCode, null);
  assert.equal(runs[0].skipped, true);
  assert.equal(existsSync(marker), false);
});

test("runSteps: si la preparación falla el comando no se lanza y la capa queda fallida", () => {
  const dir = tmp();
  const marker = path.join(dir, "e2e-no-corrio");
  const runs = runSteps(
    [
      {
        layer: "e2e",
        preCommand: `${NODE} -e "process.exit(1)"`,
        command: `${NODE} -e "require('fs').writeFileSync(process.argv[1],'x')" ${marker}`,
      },
    ],
    { outDir: dir, log: () => {} },
  );
  assert.equal(runs[0].exitCode, 1);
  assert.match(runs[0].note, /preparación/);
  assert.equal(existsSync(marker), false);
});

test("runSteps: manual copia la plantilla y no sobrescribe un native.json existente", () => {
  const dir = tmp();
  const template = path.join(dir, "template.json");
  writeFileSync(template, JSON.stringify(nativeJson(["pendiente"])));
  let runs = runSteps([{ layer: "native", manual: true, template }], {
    outDir: dir,
    log: () => {},
  });
  assert.equal(runs[0].exitCode, null);
  assert.ok(existsSync(path.join(dir, "native.json")));

  writeJson(dir, "native.json", nativeJson(["ok"]));
  runs = runSteps([{ layer: "native", manual: true, template }], { outDir: dir, log: () => {} });
  const data = JSON.parse(readFileSync(path.join(dir, "native.json"), "utf8"));
  assert.equal(data[0].status, "ok");
});

// ------------------------------------------------------------- test-report

test("test-report: sin argumento o con ruta inexistente sale con 1", () => {
  assert.equal(spawnSync(process.execPath, [REPORT], { encoding: "utf8" }).status, 1);
  assert.equal(runReport(path.join(tmpdir(), "no-existe-xyz")).status, 1);
});

test("test-report: capa con exitCode 0 pero assertions fallidas queda failed", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "api", command: "x", exitCode: 0, durationMs: 5 }]);
  writeJson(dir, "api.json", vitestJson([passed, failedT]));

  assert.equal(runReport(dir).status, 0);
  const api = layerOf(dir, "api");
  assert.equal(api.status, "failed");
  assert.equal(api.totals.passed, 1);
  assert.equal(api.totals.failed, 1);
  assert.match(api.failures[0].message, /boom/);
});

test("test-report: capa ejecutada sin JSON queda failed, no not_run", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "api", command: "x", exitCode: 1, durationMs: 5 }]);
  assert.equal(runReport(dir).status, 0);
  const api = layerOf(dir, "api");
  assert.equal(api.status, "failed");
  assert.match(api.failures[0].message, /no se generó el JSON/);
});

test("test-report: JSON corrupto en capa ejecutada queda failed", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "mobile", command: "x", exitCode: 0, durationMs: 5 }]);
  writeFileSync(path.join(dir, "mobile.json"), "esto no es json");
  runReport(dir);
  assert.equal(layerOf(dir, "mobile").status, "failed");
});

test("test-report: JSON con estructura inesperada en capa ejecutada queda failed", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "api", command: "x", exitCode: 0, durationMs: 5 }]);
  writeJson(dir, "api.json", { otraCosa: true });
  runReport(dir);
  assert.equal(layerOf(dir, "api").status, "failed");
});

test("test-report: skip con JSON residual no acredita la capa (not_run)", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [
    { layer: "api", command: "x", exitCode: null, durationMs: 0, skipped: true },
  ]);
  writeJson(dir, "api.json", vitestJson([passed]));
  runReport(dir);
  assert.equal(layerOf(dir, "api").status, "not_run");
});

test("test-report: nota de preparación fallida aparece en el fallo", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [
    {
      layer: "e2e",
      command: "playwright test",
      exitCode: 1,
      durationMs: 5,
      note: "falló la preparación: migraciones",
    },
  ]);
  runReport(dir);
  assert.match(layerOf(dir, "e2e").failures[0].message, /preparación/);
});

test("test-report: e2e con suite verde queda passed", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "e2e", command: "x", exitCode: 0, durationMs: 5 }]);
  writeJson(dir, "e2e.json", e2eJson("passed"));
  runReport(dir);
  assert.equal(layerOf(dir, "e2e").status, "passed");
});

test("test-report: lint verde passed; capa ausente en runs.json queda not_run", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "lint", command: "x", exitCode: 0, durationMs: 5 }]);
  runReport(dir);
  assert.equal(layerOf(dir, "lint").status, "passed");
  assert.equal(layerOf(dir, "api").status, "not_run");
  assert.equal(layerOf(dir, "native").status, "not_run");
});

test("test-report: native solo passed cuando TODO el checklist está ok", () => {
  const casos = [
    [["ok", "ok"], "passed"],
    [["ok", "pendiente"], "partial"],
    [["ok", "bloqueado"], "partial"],
    [["pendiente", "pendiente"], "not_run"],
    [["ok", "falla"], "failed"],
  ];
  for (const [statuses, esperado] of casos) {
    const dir = tmp();
    writeJson(dir, "runs.json", [
      { layer: "native", command: null, exitCode: null, durationMs: 0 },
    ]);
    writeJson(dir, "native.json", nativeJson(statuses));
    assert.equal(runReport(dir).status, 0);
    assert.equal(layerOf(dir, "native").status, esperado, `statuses=${statuses}`);
  }
});

test("test-report: bloqueados del checklist aparecen en REPORT.md con motivo", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", []);
  writeJson(dir, "native.json", nativeJson(["ok", "bloqueado"]));
  runReport(dir);
  const md = readFileSync(path.join(dir, "REPORT.md"), "utf8");
  assert.match(md, /Checklist nativo incompleto \(1\)/);
  assert.match(md, /bloqueado: sin dispositivo/);
  assert.match(md, /⚠️ partial/);
});

test("test-report: genera summary.json + REPORT.md con git y capas", () => {
  const dir = tmp();
  writeJson(dir, "runs.json", [{ layer: "lint", command: "x", exitCode: 0, durationMs: 5 }]);
  assert.equal(runReport(dir).status, 0);
  assert.ok(existsSync(path.join(dir, "summary.json")));
  assert.ok(existsSync(path.join(dir, "REPORT.md")));
  const summary = readSummary(dir);
  assert.ok(Array.isArray(summary.layers));
  assert.ok("commit" in summary.git);
});

// ---------------------------------------------------------------- test-all

test("test-all: rechaza un runId ya usado sin re-ejecutar nada", () => {
  const runId = `collision-${process.pid}-${Date.now()}`;
  const dir = path.join(ROOT, "test-results", runId);
  try {
    mkdirSync(dir, { recursive: true });
    writeJson(dir, "runs.json", []);
    const res = spawnSync(process.execPath, [TEST_ALL, "--run-id", runId], { encoding: "utf8" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /ya existe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------- checks estáticos

test("playwright.config usa E2E_OUTPUT_DIR y declara globalSetup", () => {
  const cfg = readFileSync(path.join(ROOT, "apps/mobile/playwright.config.ts"), "utf8");
  assert.match(cfg, /E2E_OUTPUT_DIR/);
  assert.match(cfg, /global-setup/);
});

test("helpers.ts protege el cleanup contra buckets que no sean dev", () => {
  const src = readFileSync(path.join(ROOT, "apps/mobile/e2e/helpers.ts"), "utf8");
  assert.match(src, /photos-media-dev/);
  // El guard debe lanzar antes de cualquier llamada a S3 (la primera es el ListObjectsV2).
  assert.ok(src.indexOf('Bucket !== "photos-media-dev"') < src.indexOf("s3.send"));
});

// ---------------------------------------------------- check-web-env (H-008)

const CHECK_WEB_ENV = path.join(ROOT, "apps/mobile/scripts/check-web-env.mjs");
const MISSING_ENV_FILE = path.join(tmpdir(), `photos-env-${process.pid}-does-not-exist`);

/** Ejecuta check-web-env con la URL dada y sin .env real (via CHECK_WEB_ENV_FILE). */
function runEnvCheck(apiUrl) {
  const env = { ...process.env, CHECK_WEB_ENV_FILE: MISSING_ENV_FILE };
  delete env.EXPO_PUBLIC_API_URL;
  if (apiUrl !== undefined) env.EXPO_PUBLIC_API_URL = apiUrl;
  return spawnSync(process.execPath, [CHECK_WEB_ENV], { env, encoding: "utf8" });
}

test("check-web-env: EXPO_PUBLIC_API_URL ausente → exit 1", () => {
  const res = runEnvCheck(undefined);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /EXPO_PUBLIC_API_URL no está definida/);
});

test("check-web-env: http, loopback y URL inválida → exit 1", () => {
  for (const url of [
    "http://photos-api.workers.dev",
    "https://localhost:8787",
    "https://127.0.0.1:8787",
    "no-es-una-url",
    "https://u:p@photos-api.workers.dev",
    "https://photos-api.workers.dev/?x=1",
    "https://photos-api.workers.dev/#frag",
  ]) {
    const res = runEnvCheck(url);
    assert.equal(res.status, 1, url);
  }
});

test("check-web-env: https de producción → exit 0", () => {
  const res = runEnvCheck("https://photos-api.luis-sg9915.workers.dev");
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /API de producción OK/);
});

test("check-web-env: build:web y deploy:web pasan por el gate", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "apps/mobile/package.json"), "utf8"));
  assert.match(pkg.scripts["build:web"], /check-web-env\.mjs/);
  assert.match(pkg.scripts["deploy:web"], /check-web-env\.mjs/);
  // wrangler siempre por ruta al paquete hoisted (shim .bin roto en Windows).
  assert.match(
    pkg.scripts["deploy:web"],
    /node \.\.\/\.\.\/node_modules\/wrangler\/bin\/wrangler\.js/,
  );
  const apiPkg = JSON.parse(readFileSync(path.join(ROOT, "apps/api/package.json"), "utf8"));
  for (const s of ["dev", "deploy", "cf-typegen", "db:migrate:local", "db:migrate:remote"]) {
    assert.match(
      apiPkg.scripts[s],
      /node \.\.\/\.\.\/node_modules\/wrangler\/bin\/wrangler\.js/,
      s,
    );
  }
});
