import { linkRestoredByFilename } from "../queue/db";
import { restoreFilename } from "./plan";
import { listRestoredItems } from "./store";

/**
 * Enlaza con su remoto los archivos restaurados que el escáner encoló como nuevos (restauraciones
 * anteriores a registrar el enlace al guardar). Idempotente y barata. Devuelve filas cambiadas.
 */
export function repairRestoredLinks(userId: string): number {
  try {
    const items = listRestoredItems(userId);
    if (items.length === 0) return 0;
    return linkRestoredByFilename(
      items.map((i) => ({
        sha256: i.sha256,
        remoteId: i.remoteId,
        takenAt: i.takenAt,
        // restore-<sha16>.<ext>: el ext original puede variar, se compara solo el prefijo.
        filenameLike: `${restoreFilename({ sha256: i.sha256, ext: "x" }).replace(/\.x$/, "")}.%`,
      })),
    );
  } catch (e) {
    console.warn("[restore] repairRestoredLinks falló:", e);
    return 0;
  }
}
