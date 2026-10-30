import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditRelease, parseChangelog } from "./lib/release-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-11-01
### Añadido
- algo nuevo

## [1.1.0] - 2026-10-24
- release anterior
`;

const BASE = {
  tag: "v1.2.0",
  dirty: false,
  changelog: CHANGELOG,
  appJsonVersion: "1.0.0",
  existingTags: [],
  tagType: null,
  tagCommit: null,
  headSha: "a".repeat(40),
  deployWorkflow: '--var APP_VERSION="$REF" --var GIT_SHA="$SHA"',
  apkWorkflow: 'on:\n  push:\n    tags: ["v*"]\n',
  journal: { entries: [{ tag: "0000_tablas" }] },
  sqlExists: () => true,
};

const audit = (patch = {}, options = {}) => auditRelease({ ...BASE, ...patch }, options);
const rules = (problems) => problems.map((problem) => problem.slice(0, 40));

test("parseChangelog separa secciones, fechas y notas", () => {
  const sections = parseChangelog(CHANGELOG);
  assert.deepEqual([...sections.keys()], ["Unreleased", "1.2.0", "1.1.0"]);
  assert.equal(sections.get("1.2.0").date, "2026-11-01");
  assert.equal(sections.get("1.2.0").bullets.length, 1);
  assert.equal(sections.get("Unreleased").bullets.length, 0);
});

test("un árbol limpio con sección propia y notas pasa", () => {
  assert.deepEqual(audit().problems, []);
});

test("sin sección en el CHANGELOG no hay release", () => {
  const { problems } = audit({
    changelog: CHANGELOG.replace("## [1.2.0] - 2026-11-01", "## [9.9.9]"),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no tiene sección ## \[1\.2\.0\]/);
});

test("notas sin fechar en [Unreleased] bloquean el tag", () => {
  const { problems } = audit({
    changelog: CHANGELOG.replace("## [Unreleased]\n", "## [Unreleased]\n- sin fechar\n"),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[Unreleased\] tiene 1 nota/);
});

test("al auditar un tag publicado las notas sin fechar son de la siguiente release", () => {
  const changelog = CHANGELOG.replace("## [Unreleased]\n", "## [Unreleased]\n- trabajo en curso\n");
  const { problems, notes } = audit(
    { changelog, existingTags: ["v1.2.0"], tagType: "tag" },
    { allowExisting: true },
  );
  assert.deepEqual(problems, []);
  assert.ok(notes.some((note) => /próxima release/.test(note)));
});

test("una sección sin notas o sin fecha no vale como release", () => {
  const sinNotas = audit({ changelog: CHANGELOG.replace("- algo nuevo\n", "") });
  assert.ok(sinNotas.problems.some((problem) => /no tiene ninguna nota/.test(problem)));

  const sinFecha = audit({ changelog: CHANGELOG.replace(" - 2026-11-01", "") });
  assert.ok(sinFecha.problems.some((problem) => /no tiene fecha/.test(problem)));
});

test("republicar un tag existente se rechaza salvo con --allow-existing", () => {
  const existing = { existingTags: ["v1.2.0"], tagType: "tag" };
  assert.ok(/ya existe/.test(audit(existing).problems.join("\n")));
  assert.deepEqual(audit(existing, { allowExisting: true }).problems, []);
});

test("un tag ligero no lleva mensaje: se rechaza", () => {
  const { problems } = audit({ tagType: "commit" });
  assert.ok(/es ligero/.test(problems[0]));
});

test("un tag que apunta a otro commit no publica este código", () => {
  const { problems } = audit({ tagType: "tag", tagCommit: "b".repeat(40) });
  assert.ok(/apunta a bbbbbbb/.test(problems.join("\n")));
});

test("el deploy tiene que inyectar APP_VERSION y GIT_SHA", () => {
  const { problems } = audit({ deployWorkflow: '--var APP_VERSION="$REF"' });
  assert.ok(/no inyecta APP_VERSION y GIT_SHA/.test(problems.join("\n")));
});

test("el workflow de APK tiene que dispararse con tags v*", () => {
  const { problems } = audit({ apkWorkflow: "on:\n  workflow_dispatch:\n" });
  assert.ok(/no se dispara con tags/.test(problems.join("\n")));
});

test("una migración del journal sin SQL se detecta", () => {
  const { problems } = audit({ sqlExists: (name) => name !== "0000_tablas" });
  assert.ok(/sin archivo SQL: 0000_tablas/.test(problems.join("\n")));
});

test("el árbol sucio bloquea salvo en preflight", () => {
  assert.ok(/árbol sucio/.test(audit({ dirty: true }).problems.join("\n")));
  assert.deepEqual(audit({ dirty: true }, { allowDirty: true }).problems, []);
});

test("sin --tag no hay preflight válido", () => {
  const { problems } = audit({ tag: undefined });
  assert.ok(/falta --tag/.test(problems.join("\n")));
});

test("los workflows reales del repo cumplen las dos reglas de cableado", () => {
  const { problems } = audit({
    tag: "v9.9.9",
    changelog: "## [9.9.9] - 2026-12-01\n- nota\n",
    deployWorkflow: read(".github/workflows/ci.yml"),
    apkWorkflow: read(".github/workflows/release-apk.yml"),
  });
  assert.deepEqual(rules(problems), []);
});

test("el CHANGELOG real tiene sección fechada para el tag publicado", () => {
  const sections = parseChangelog(read("CHANGELOG.md"));
  const published = sections.get("1.1.0");
  assert.ok(published, "falta ## [1.1.0] en CHANGELOG.md");
  assert.match(published.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(published.bullets.length > 0);
});
