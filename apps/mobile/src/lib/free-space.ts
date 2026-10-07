import * as MediaLibrary from "expo-media-library/legacy";
import { getQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

/**
 * "Liberar espacio": fotos con respaldo confirmado (done/duplicate con
 * remote_id y sha256 registrado) cuya copia local sigue ocupando espacio
 * en el dispositivo. Tras borrarlas, mergeGallery las refleja como
 * REMOTE_ONLY (la fila de la cola queda como vínculo asset_id ↔ remote_id).
 */
export function getSyncedLocal(): { assetIds: string[]; totalBytes: number } {
  const items = getQueueItems().filter(
    (i) =>
      (i.state === "done" || i.state === "duplicate") &&
      i.remote_id != null &&
      i.sha256 != null &&
      i.asset_id,
  );
  return {
    assetIds: items.map((i) => i.asset_id),
    totalBytes: items.reduce((s, i) => s + (i.bytes_total || 0), 0),
  };
}

/**
 * ¿Queda una copia local del elemento remoto? Cierto si la cola conserva la
 * fila done/duplicate que enlaza el asset del dispositivo con su remote_id.
 * (Si el asset ya se borró del sistema, deleteAssetsAsync devolverá false.)
 */
export function hasLocalCopy(remoteId: string): boolean {
  return getQueueItems().some(
    (i) => i.remote_id === remoteId && (i.state === "done" || i.state === "duplicate"),
  );
}

/**
 * Elimina solo la copia local de un elemento ya respaldado; la remota se
 * conserva y la galería lo refleja como REMOTE_ONLY. Devuelve false si no
 * había copia local o el usuario canceló el diálogo del sistema.
 */
export async function deleteLocalCopy(remoteId: string): Promise<boolean> {
  const item = getQueueItems().find(
    (i) => i.remote_id === remoteId && (i.state === "done" || i.state === "duplicate"),
  );
  if (!item) return false;
  const ok = await MediaLibrary.deleteAssetsAsync([item.asset_id]);
  if (!ok) return false;
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return true;
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
