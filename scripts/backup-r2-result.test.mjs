/**
 * Tests del veredicto del respaldo R2 (node:test, sin credenciales ni red).
 *
 *   node --test scripts/backup-r2-result.test.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateBackup, formatBackupSummary } from "./lib/backup-r2-result.mjs";

test("un respaldo sin errores sale con 0", () => {
  const verdict = evaluateBackup({ errorCount: 0, objectsCount: 120 });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.exitCode, 0);
  assert.equal(verdict.reason, null);
});

test("un solo objeto fallido tumba el respaldo", () => {
  const verdict = evaluateBackup({ errorCount: 1, objectsCount: 120 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.exitCode, 1);
  assert.match(verdict.reason, /1 objeto/);
});

test("un bucket vacío se trata como fallo, salvo con --allow-empty", () => {
  assert.equal(evaluateBackup({ errorCount: 0, objectsCount: 0 }).exitCode, 1);
  assert.equal(evaluateBackup({ errorCount: 0, objectsCount: 0, allowEmpty: true }).exitCode, 0);
});

test("el veredicto por errores gana a --allow-empty", () => {
  const verdict = evaluateBackup({ errorCount: 2, objectsCount: 0, allowEmpty: true });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.exitCode, 1);
});

test("el resumen en fallo lista las claves y avisa de que la copia no vale", () => {
  const lines = formatBackupSummary({
    outDir: "/tmp/backup",
    scanned: 120,
    skipped: 100,
    downloaded: 18,
    downloadedHuman: "1.20 GB",
    errors: 2,
    failedKeys: ["users/a/originals/1.jpg", "users/b/originals/2.jpg"],
  });
  const text = lines.join("\n");
  assert.match(text, /RESPALDO INCOMPLETO/);
  assert.match(text, /Archivos con error:\s+2/);
  assert.match(text, /users\/a\/originals\/1\.jpg/);
  assert.match(text, /NO es válido/);
});

test("el resumen en éxito no menciona claves fallidas y trunca la lista a 10", () => {
  const ok = formatBackupSummary({
    outDir: "/tmp/backup",
    scanned: 5,
    skipped: 0,
    downloaded: 5,
    downloadedHuman: "5.00 MB",
    errors: 0,
  }).join("\n");
  assert.match(ok, /Respaldo completado/);
  assert.doesNotMatch(ok, /NO es válido/);

  const many = formatBackupSummary({
    outDir: "/tmp/backup",
    scanned: 20,
    skipped: 0,
    downloaded: 0,
    downloadedHuman: "0 B",
    errors: 13,
    failedKeys: Array.from({ length: 13 }, (_, i) => `k${i}`),
  }).join("\n");
  assert.match(many, /… y 3 más/);
});
