#!/usr/bin/env node
/**
 * Preflight de release (H1.4): comprueba que el árbol puede liberarse.
 *
 *   node scripts/release-check.mjs --tag v1.2.0
 *   node scripts/release-check.mjs --tag v1.2.0 --allow-dirty     # preflight antes de commitear
 *   node scripts/release-check.mjs --tag v1.1.0 --allow-existing  # auditar un tag ya publicado
 *   node scripts/release-check.mjs --tag v1.2.0 --json
 *
 * Reglas en `scripts/lib/release-audit.mjs`; aquí solo se leen git y archivos.
 * Exit 0 = listo; 1 = hay que arreglar algo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditRelease } from "./lib/release-audit.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const tag = value("--tag");

function git(gitArgs, fallback = "") {
  try {
    return execFileSync("git", gitArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

const read = (relative, fallback = "") => {
  const full = path.join(ROOT, relative);
  return existsSync(full) ? readFileSync(full, "utf8") : fallback;
};

const tagType = tag ? git(["cat-file", "-t", tag], "") || null : null;
const tagCommit = tag && tagType ? git(["rev-list", "-n", "1", tag], "") || null : null;

const { problems, notes } = auditRelease(
  {
    tag,
    dirty: git(["status", "--porcelain"]) !== "",
    changelog: read("CHANGELOG.md"),
    appJsonVersion: JSON.parse(read("apps/mobile/app.json", '{"expo":{}}')).expo?.version ?? "?",
    existingTags: git(["tag", "--list"]).split("\n").filter(Boolean),
    tagType,
    tagCommit,
    headSha: git(["rev-parse", "HEAD"]),
    deployWorkflow: read(".github/workflows/ci.yml"),
    apkWorkflow: read(".github/workflows/release-apk.yml"),
    journal: JSON.parse(read("apps/api/migrations/meta/_journal.json", '{"entries":[]}')),
    sqlExists: (name) => existsSync(path.join(ROOT, "apps/api/migrations", `${name}.sql`)),
  },
  { allowDirty: flag("--allow-dirty"), allowExisting: flag("--allow-existing") },
);

if (flag("--json")) {
  console.log(JSON.stringify({ ok: problems.length === 0, tag, problems, notes }, null, 2));
} else {
  console.log(`release-check ${tag ?? "(sin tag)"}`);
  for (const note of notes) console.log(`  · ${note}`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  if (problems.length === 0) console.log(`  ✓ listo para etiquetar ${tag}`);
}

process.exit(problems.length === 0 ? 0 : 1);
