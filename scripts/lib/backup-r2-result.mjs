/**
 * Veredicto del respaldo físico R2 (3-2-1), separado de `backup-r2.mjs` para
 * poder testearlo sin credenciales ni red.
 *
 * La regla que importa: un respaldo que dice «completado exitosamente» con
 * errores dentro es peor que uno que falla, porque nadie lo mira. Por eso el
 * script solo sale con 0 cuando no hubo un solo fallo; cualquier otra cosa
 * termina en `exit 1` para que el operador (o el workflow) lo vea.
 */

/**
 * @param {object} input
 * @param {number} input.errorCount  Objetos que no se pudieron descargar/verificar.
 * @param {number} input.objectsCount Objetos listados en el bucket.
 * @param {boolean} [input.allowEmpty] Aceptar un bucket vacío (solo para buckets nuevos).
 * @returns {{ ok: boolean, exitCode: number, reason: string | null }}
 */
export function evaluateBackup({ errorCount, objectsCount, allowEmpty = false }) {
  if (errorCount > 0) {
    return {
      ok: false,
      exitCode: 1,
      reason: `${errorCount} objeto(s) no se pudieron respaldar`,
    };
  }
  if (objectsCount === 0 && !allowEmpty) {
    return {
      ok: false,
      exitCode: 1,
      reason: "el bucket devolvió 0 objetos (¿permisos, bucket equivocado o borrado?)",
    };
  }
  return { ok: true, exitCode: 0, reason: null };
}

/**
 * Resumen legible del respaldo, con el mismo formato en éxito y en fallo.
 *
 * @param {object} stats
 * @param {string} stats.outDir
 * @param {number} stats.scanned
 * @param {number} stats.skipped
 * @param {number} stats.downloaded
 * @param {string} stats.downloadedHuman
 * @param {number} stats.errors
 * @param {string[]} [stats.failedKeys] Claves fallidas (se listan como mucho 10).
 */
export function formatBackupSummary(stats) {
  const { outDir, scanned, skipped, downloaded, downloadedHuman, errors, failedKeys = [] } = stats;
  const lines = [
    "==================================================",
    errors > 0 ? "   ✗ RESPALDO INCOMPLETO" : "   ✓ Respaldo completado",
    "==================================================",
    `Archivos escaneados:   ${scanned}`,
    `Archivos omitidos:     ${skipped} (ya estaban actualizados)`,
    `Archivos descargados:  ${downloaded} (${downloadedHuman})`,
    `Archivos con error:    ${errors}`,
    `Ubicación de copia:    ${outDir}`,
    "==================================================",
  ];
  if (errors > 0) {
    lines.push("Claves fallidas (máx. 10):");
    for (const key of failedKeys.slice(0, 10)) lines.push(`  - ${key}`);
    if (failedKeys.length > 10) lines.push(`  … y ${failedKeys.length - 10} más`);
    lines.push(
      "Este respaldo NO es válido: repetir antes de dar por buena la copia o investigar el origen del fallo.",
    );
  }
  return lines;
}
