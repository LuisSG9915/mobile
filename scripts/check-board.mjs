#!/usr/bin/env node
/**
 * `pnpm check:board` — el tablero se audita solo.
 *
 * Uso:
 *   node scripts/check-board.mjs           # falla si hay violaciones
 *   node scripts/check-board.mjs --json    # mismas violaciones, en JSON
 *
 * Sale 1 cuando el plan miente: fila `done` con trabajo abierto dentro, fila
 * sin enlace, enlace roto, estado fuera de vocabulario o hallazgo «Resuelto»
 * sin artefacto.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditBoard } from "./lib/board-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const planPath = resolve(root, "docs/PLAN_MEJORAS.md");
const decisionsPath = resolve(root, "docs/decisions.md");

if (!existsSync(planPath)) {
  console.error(`✗ No existe ${planPath}`);
  process.exit(1);
}

const plan = readFileSync(planPath, "utf8");
const decisions = existsSync(decisionsPath) ? readFileSync(decisionsPath, "utf8") : "";

/** Los enlaces del plan son relativos a `docs/` (o a la raíz del repo). */
const fileExists = (relative) =>
  existsSync(resolve(root, "docs", relative)) || existsSync(resolve(root, relative));

const problems = auditBoard({ plan, decisions, fileExists });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
} else if (problems.length === 0) {
  console.log(
    "✓ Tablero íntegro: cada fila con estado enlaza evidencia y ninguna cierra con pendientes.",
  );
} else {
  for (const problem of problems)
    console.error(`${problem.file}:${problem.line} [${problem.rule}] ${problem.message}`);
  console.error(`\n✗ ${problems.length} violación(es) del tablero.`);
}

process.exit(problems.length === 0 ? 0 : 1);
