#!/usr/bin/env node
/**
 * Preflight de release (H1.4): comprueba que el árbol puede liberarse.
 *
 *   node scripts/release-check.mjs --tag v1.1.0
 *
 * Verifica: tag SemVer y no existente, árbol limpio, migraciones locales
 * aplicables, CHANGELOG con la versión y que la versión de la app coincida.
 * Exit 0 = listo; 1 = hay que arreglar algo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : undefined;

const problems = [];
const notes = [];

function run(cmd, cmdArgs = []) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" }).trim();
}

if (!tag) problems.push("falta --tag vX.Y.Z");
else {
  const semver = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag);
  if (!semver) problems.push(`tag "${tag}" no es SemVer (vMAJOR.MINOR.PATCH)`);
  const existing = run("git", ["tag", "--list", tag]);
  if (existing) problems.push(`el tag ${tag} ya existe`);
}

const dirty = run("git", ["status", "--porcelain"]);
if (dirty) {
  problems.push(
    `árbol sucio (${dirty.split("\n").length} archivos sin commitear): commitea antes de etiquetar`,
  );
}

const changelogPath = path.join(ROOT, "CHANGELOG.md");
if (!existsSync(changelogPath)) problems.push("falta CHANGELOG.md");
else if (tag) {
  const changelog = readFileSync(changelogPath, "utf8");
  const version = tag.replace(/^v/, "");
  if (!changelog.includes(`## [${version}]`) && !changelog.includes(`## [Unreleased]`)) {
    problems.push(`CHANGELOG.md no tiene una sección para ${version} (ni [Unreleased])`);
  }
}

const appJson = JSON.parse(readFileSync(path.join(ROOT, "apps/mobile/app.json"), "utf8"));
notes.push(`app.json version: ${appJson.expo.version}`);
if (tag) {
  const version = tag.replace(/^v/, "");
  if (appJson.expo.version !== version) {
    notes.push(
      `app.json (${appJson.expo.version}) ≠ tag (${version}); EAS usa appVersionSource=remote`,
    );
  }
}

const journal = JSON.parse(
  readFileSync(path.join(ROOT, "apps/api/migrations/meta/_journal.json"), "utf8"),
);
notes.push(`migraciones registradas: ${journal.entries.length}`);
const missingSql = journal.entries.filter(
  (e) => !existsSync(path.join(ROOT, "apps/api/migrations", `${e.tag}.sql`)),
);
if (missingSql.length) {
  problems.push(
    `migraciones del journal sin archivo SQL: ${missingSql.map((e) => e.tag).join(", ")}`,
  );
}

console.log("release-check");
for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`  ✓ listo para etiquetar ${tag}`);
