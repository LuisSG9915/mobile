import * as MediaLibrary from "expo-media-library/legacy";
import { getQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

/**
 * "Liberar espacio": fotos con respaldo confirmado (done/duplicate con
 * remote_id) cuya copia local sigue ocupando espacio en el dispositivo.
 * Tras borrarlas, mergeGallery las refleja como REMOTE_ONLY (la fila de la
 * cola queda como vínculo asset_id ↔ remote_id).
 */
export function getSyncedLocal(): { assetIds: string[]; totalBytes: number } {
  const items = getQueueItems().filter(
    (i) => (i.state === "done" || i.state === "duplicate") && i.remote_id != null,
  );
  return {
    assetIds: items.map((i) => i.asset_id),
    totalBytes: items.reduce((s, i) => s + (i.bytes_total || 0), 0),
  };
}

/**
 * Borra las copias locales de los elementos ya respaldados. Devuelve cuántos
 * assets eliminó MediaLibrary (0 si el usuario cancela el diálogo del
 * sistema o no hay nada que liberar).
 */
export async function freeSyncedSpace(): Promise<number> {
  const { assetIds } = getSyncedLocal();
  if (!assetIds.length) return 0;
  const ok = await MediaLibrary.deleteAssetsAsync(assetIds);
  if (!ok) return 0;
  // La biblioteca cambió (assets borrados): re-listar la galería y refrescar
  // las estadísticas de la pestaña Respaldo.
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return assetIds.length;
}
