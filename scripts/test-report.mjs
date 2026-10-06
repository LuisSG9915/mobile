#!/usr/bin/env node
/**
 * Lee los JSON de una corrida (test-results/<runId>/) y genera
 * summary.json + REPORT.md. Es re-ejecutable: tras rellenar native.json
 * a mano, volver a correr `pnpm test:report -- <dir>` refresca el resumen.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const arg = process.argv[2];
if (!arg) {
  console.error("Uso: node scripts/test-report.mjs <test-results/<runId>>");
  process.exit(1);
}
const outDir = path.resolve(arg);
if (!existsSync(outDir) || !statSync(outDir).isDirectory()) {
  console.error(`La carpeta de resultados no existe: ${outDir}`);
  process.exit(1);
}

const clip = (s, n = 300) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// ---- Normalización por capa --------------------------------------------------

const notRun = (layer, command, exitCode, durationMs) => ({
  layer,
  status: "not_run",
  command,
  exitCode,
  durationMs,
  totals: { passed: 0, failed: 0, skipped: 0 },
  failures: [],
});

// Una capa ejecutada que no dejó JSON válido falla: el reporte no puede
// acreditar resultados que no puede leer. `note` describe la causa (p. ej.
// falló la preparación) cuando existe.
function missingJson(layer, command, exitCode, durationMs, note, file) {
  const cause = existsSync(file)
    ? "el JSON de resultados es inválido o está incompleto"
    : "no se generó el JSON de resultados";
  return {
    layer,
    status: "failed",
    command,
    exitCode,
    durationMs,
    totals: { passed: 0, failed: 0, skipped: 0 },
    failures: [
      {
        file: "-",
        test: layer,
        message: clip([note, cause].filter(Boolean).join("; ")),
        artifacts: [],
      },
    ],
  };
}

function vitestLayer(layer, command, exitCode, durationMs, note) {
  const file = path.join(outDir, `${layer}.json`);
  // exitCode null = omitida o manual: un JSON residual no acredita la capa.
  if (exitCode === null) return notRun(layer, command, exitCode, durationMs);
  const data = readJson(file);
  if (!data || !Array.isArray(data.testResults)) {
    return missingJson(layer, command, exitCode, durationMs, note, file);
  }
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const failures = [];
  for (const f of data.testResults) {
    for (const t of f.assertionResults ?? []) {
      if (t.status === "passed") totals.passed++;
      else if (t.status === "failed") {
        totals.failed++;
        failures.push({
          file: path.basename(f.name ?? ""),
          test: t.fullName ?? t.title ?? "?",
          message: clip((t.failureMessages ?? []).join(" ")),
          artifacts: [],
        });
      } else totals.skipped++;
    }
  }
  return {
    layer,
    status: totals.failed > 0 || exitCode !== 0 ? "failed" : "passed",
    command,
    exitCode,
    durationMs,
    totals,
    failures,
  };
}

function e2eLayer(command, exitCode, durationMs, note) {
  const file = path.join(outDir, "e2e.json");
  if (exitCode === null) return notRun("e2e", command, exitCode, durationMs);
  const data = readJson(file);
  if (!data || !Array.isArray(data.suites)) {
    return missingJson("e2e", command, exitCode, durationMs, note, file);
  }
  const totals = { passed: 0, failed: 0, skipped: 0 };
  const failures = [];
  const walk = (suites, file) => {
    for (const s of suites ?? []) {
      const f = s.file ?? file;
      for (const spec of s.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const last = (test.results ?? []).at(-1) ?? {};
          if (test.expectedStatus === "skipped" || last.status === "skipped") totals.skipped++;
          else if (last.status === "passed") totals.passed++;
          else {
            totals.failed++;
            const stepTitles = (last.steps ?? [])
              .map((st) => st.title)
              .filter(
                (t) =>
                  t && !t.startsWith("expect") && !t.startsWith("before") && !t.startsWith("after"),
              );
            failures.push({
              file: f ?? "?",
              test: spec.title ?? "?",
              message: clip(last.error?.message),
              search: `${spec.title} ${stepTitles.join(" ")}`,
              artifacts: (last.attachments ?? []).map((a) => a.path).filter(Boolean),
            });
          }
        }
      }
      walk(s.suites, f);
    }
  };
  walk(data.suites ?? [], null);
  return {
    layer: "e2e",
    status: totals.failed > 0 || exitCode !== 0 ? "failed" : "passed",
    command,
    exitCode,
    durationMs,
    totals,
    failures,
  };
}

function nativeLayer() {
  const data = readJson(path.join(outDir, "native.json"));
  const layer = {
    layer: "native",
    status: "not_run",
    command: null,
    exitCode: null,
    durationMs: 0,
    totals: { passed: 0, failed: 0, skipped: 0 },
    failures: [],
  };
  if (!Array.isArray(data)) return layer;
  for (const item of data) {
    if (item.status === "ok") layer.totals.passed++;
    else if (item.status === "falla") {
      layer.totals.failed++;
      layer.failures.push({
        file: item.id,
        test: item.pasos?.[0] ?? item.id,
        message: clip(item.notas || item.esperado),
        artifacts: [],
      });
    } else layer.totals.skipped++; // pendiente, bloqueado u otro
  }
  // La capa manual solo es "passed" si TODO el checklist está en ok: unos
  // pocos casos verdes con el resto pendiente es "partial", no un éxito.
  layer.status =
    layer.totals.failed > 0
      ? "failed"
      : layer.totals.passed === 0
        ? "not_run"
        : layer.totals.skipped > 0
          ? "partial"
          : "passed";
  return layer;
}

// ---- Ensamblado --------------------------------------------------------------

const runs = readJson(path.join(outDir, "runs.json")) ?? [];
const meta = new Map(runs.map((r) => [r.layer, r]));
const cmdOf = (l, def) => meta.get(l)?.command ?? def;
const exitOf = (l) => meta.get(l)?.exitCode ?? null;
const msOf = (l) => meta.get(l)?.durationMs ?? 0;
const noteOf = (l) => meta.get(l)?.note;

// Capa de proceso sin JSON propio (lint, typecheck, selftest del pipeline):
// verde solo si el comando salió con 0.
function procLayer(layer, defCommand) {
  const exitCode = exitOf(layer);
  return {
    layer,
    status: exitCode === null ? "not_run" : exitCode === 0 ? "passed" : "failed",
    command: cmdOf(layer, defCommand),
    exitCode,
    durationMs: msOf(layer),
    totals: {
      passed: exitCode === 0 ? 1 : 0,
      failed: exitCode !== null && exitCode !== 0 ? 1 : 0,
      skipped: 0,
    },
    failures:
      exitCode !== null && exitCode !== 0
        ? [
            {
              file: "-",
              test: layer,
              message: clip(noteOf(layer) ?? `exit code ${exitCode}`),
              artifacts: [],
            },
          ]
        : [],
  };
}

const layers = [
  procLayer("pipeline", "node --test scripts/test-pipeline.test.mjs"),
  procLayer("lint", "pnpm lint"),
  procLayer("typecheck", "pnpm typecheck"),
  vitestLayer("api", cmdOf("api", null), exitOf("api"), msOf("api"), noteOf("api")),
  vitestLayer("mobile", cmdOf("mobile", null), exitOf("mobile"), msOf("mobile"), noteOf("mobile")),
  e2eLayer(cmdOf("e2e", null), exitOf("e2e"), msOf("e2e"), noteOf("e2e")),
  nativeLayer(),
];

const git = (() => {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
})();

const findings = readJson(path.join(ROOT, "docs", "testing", "findings.json")) ?? [];
const failuresByText = layers.flatMap((l) =>
  l.failures.flatMap((f) => [`${f.test} ${f.file}`, f.message, f.search ?? ""]),
);
const failedText = failuresByText.join("\n").toLowerCase();
const annotated = findings.map((f) => ({
  ...f,
  reproducidoEstaCorrida: (f.relatedTests ?? []).some(
    (t) => t && failedText.includes(t.toLowerCase()),
  ),
}));

const summary = {
  runId: path.basename(outDir),
  startedAt: new Date().toISOString(),
  git,
  env: { node: process.version, os: `${process.platform} ${process.arch}` },
  layers,
  findings: annotated,
};

writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

// ---- REPORT.md ---------------------------------------------------------------

const badge = { passed: "✅", failed: "❌", partial: "⚠️", not_run: "➖" };
const sev = { alta: "🔴", media: "🟡", baja: "⚪" };

const md = [];
md.push(`# Reporte de pruebas — ${summary.runId}`);
md.push("");
md.push(
  `Commit: \`${git.commit ?? "?"}\`${git.dirty ? " (árbol sucio)" : ""} · Node ${process.version} · ${process.platform}`,
);
md.push("");
md.push("## Resumen por capa");
md.push("");
md.push("| Capa | Estado | Pasan | Fallan | Omitidas | Duración |");
md.push("|---|---|---|---|---|---|");
for (const l of layers) {
  md.push(
    `| ${l.layer} | ${badge[l.status]} ${l.status} | ${l.totals.passed} | ${l.totals.failed} | ${l.totals.skipped} | ${(l.durationMs / 1000).toFixed(1)}s |`,
  );
}
const failures = layers.flatMap((l) => l.failures.map((f) => ({ ...f, layer: l.layer })));
if (failures.length) {
  md.push("");
  md.push("## Fallos");
  md.push("");
  for (const f of failures) {
    md.push(`- **${f.layer}** · \`${f.file}\` · ${f.test}`);
    md.push(`  - ${f.message}`);
    for (const a of f.artifacts) md.push(`  - evidencia: \`${a}\``);
  }
}
const pendingNative = (readJson(path.join(outDir, "native.json")) ?? []).filter(
  (i) => i.status === "pendiente" || i.status === "bloqueado",
);
if (pendingNative.length) {
  md.push("");
  md.push(`## Checklist nativo incompleto (${pendingNative.length})`);
  md.push("");
  for (const i of pendingNative) {
    const detalle = i.status === "bloqueado" ? ` · bloqueado: ${i.notas || "sin motivo"}` : "";
    md.push(`- [ ] ${i.id} — ${i.pasos?.[0] ?? ""}${detalle}`);
  }
}
md.push("");
md.push("## Hallazgos abiertos");
md.push("");
md.push("| ID | Área | Severidad | Esfuerzo | Propuesta | Reproducido |");
md.push("|---|---|---|---|---|---|");
const order = { alta: 0, media: 1, baja: 2 };
for (const f of [...annotated]
  // "en_progreso" también es pendiente: tiene trabajo sin verificar.
  .filter((f) => f.status !== "resuelto")
  .sort((a, b) => order[a.severity] - order[b.severity])) {
  const estado = f.status === "en_progreso" ? " *(en progreso)*" : "";
  md.push(
    `| ${f.id} | ${f.area} | ${sev[f.severity] ?? ""} ${f.severity} | ${f.effort} | ${f.proposal}${estado} | ${f.reproducidoEstaCorrida ? "**sí, esta corrida**" : "no"} |`,
  );
}
md.push("");
md.push("## Insumos para planificación");
md.push("");
md.push(
  "Detalle completo en `summary.json` (esta misma carpeta) y `docs/testing/findings.json` (registro curado).",
);
md.push(
  'Para registrar un hallazgo nuevo: añadir una entrada en `findings.json` con `status: "abierto"` y `relatedTests` apuntando al texto del test que lo detecta.',
);

const reportPath = path.join(outDir, "REPORT.md");
writeFileSync(reportPath, `${md.join("\n")}\n`);
console.log(`Reporte: ${reportPath}`);
console.log(`Resumen: ${path.join(outDir, "summary.json")}`);
