import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditBoard, linksIn, parseTables } from "./lib/board-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documentsInRepo = (relative) =>
  existsSync(resolve(root, "docs", relative)) || existsSync(resolve(root, relative));

const TABLE = `| ID | Resultado | Trabajo | Evidencia | Estado |
| :--- | :--- | :--- | :--- | :---: |
`;

const audit = (plan, { decisions = "" } = {}) =>
  auditBoard({ plan, decisions, fileExists: documentsInRepo });

test("parseTables aísla la tabla y numera sus filas", () => {
  const [table] = parseTables(`${TABLE}| **H1.1** | a | b | c | \`done\` |\n`);
  assert.deepEqual(table.header, ["ID", "Resultado", "Trabajo", "Evidencia", "Estado"]);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].line, 3);
});

test("linksIn ignora anclas", () => {
  assert.deepEqual(linksIn("ver [x](../apps/a.ts#L10) y [y](https://ejemplo.mx)"), [
    "../apps/a.ts",
    "https://ejemplo.mx",
  ]);
});

test("una fila done sin enlace se reporta", () => {
  const problems = audit(`${TABLE}| **H1.1** | a | b | c | \`done\` |\n`);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.equal(problems[0].rule, "sin-enlace");
});

test("una fila done no puede declarar trabajo abierto", () => {
  const problems = audit(
    `${TABLE}| **H1.1** | a | [código](../apps/api/src/lib/s3.ts) | Falta el drill remoto | \`done\` |\n`,
  );
  assert.ok(problems.some((problem) => problem.rule === "done-con-pendientes"));
});

test("una fila en curso tiene que decir qué falta", () => {
  const problems = audit(
    `${TABLE}| **H1.3** | a | [test](testing/PLAN_PRUEBAS.md) | verde | \`in_progress\` |\n`,
  );
  assert.ok(problems.some((problem) => problem.rule === "en-curso-sin-brecha"));

  const ok = audit(
    `${TABLE}| **H1.3** | a | [test](testing/PLAN_PRUEBAS.md) | verde; falta el banner | \`in_progress\` |\n`,
  );
  assert.deepEqual(ok, []);
});

test("un estado fuera de vocabulario se reporta y corta las demás reglas", () => {
  const problems = audit(`${TABLE}| **H1.1** | a | b | c | \`WIP\` |\n`);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].rule, "estado-desconocido");
});

test("un enlace inexistente se reporta", () => {
  const problems = audit(
    `${TABLE}| **H1.2** | a | [no existe](testing/NO_EXISTE.md) | — | \`done\` |\n`,
  );
  assert.ok(problems.some((problem) => problem.rule === "enlace-roto"));
});

test("un hallazgo Resuelto sin artefacto se reporta", () => {
  const findings = `| ID | Hallazgo | Estado | Evidencia actual |
| :--- | :--- | :--- | :--- |
| **I-07** | lag | Resuelto (unit) | snapshots 15/15 |\n`;
  const problems = audit(findings);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].rule, "hallazgo-sin-evidencia");
});

test("decisions.md no puede guardar trabajo abierto", () => {
  const decisions = `## Decisión\n- [ ] decidir si hay staging\n`;
  const problems = audit(TABLE, { decisions });
  assert.ok(problems.some((problem) => problem.rule === "decision-abierta"));
});

test("la columna «Evidencia de cierre» también se audita", () => {
  const board = `| ID | Resultado | Trabajo | Evidencia de cierre | Semana | Estado |
| :--- | :--- | :--- | :--- | :---: | :---: |
`;
  const lies = audit(
    `${board}| **H1.2** | a | [test](testing/PLAN_PRUEBAS.md) | nada; falta el drill | S1 | \`done\` |\n`,
  );
  assert.deepEqual(
    lies.map((problem) => problem.rule),
    ["done-con-pendientes"],
  );

  const broken = audit(
    `${board}| **H1.2** | a | [test](testing/PLAN_PRUEBAS.md) | [roto](testing/NO_EXISTE.md) | S1 | \`done\` |\n`,
  );
  assert.ok(broken.some((problem) => problem.rule === "enlace-roto"));
});

test("el tablero real del repo está íntegro", () => {
  const plan = readFileSync(resolve(root, "docs/PLAN_MEJORAS.md"), "utf8");
  const decisions = readFileSync(resolve(root, "docs/decisions.md"), "utf8");
  const problems = audit(plan, { decisions });
  assert.deepEqual(
    problems,
    [],
    `El tablero tiene ${problems.length} violación(es):\n${problems
      .map((problem) => `${problem.file}:${problem.line} [${problem.rule}] ${problem.message}`)
      .join("\n")}`,
  );
});
