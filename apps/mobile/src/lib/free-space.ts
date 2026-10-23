import * as MediaLibrary from "expo-media-library/legacy";
import { api } from "../api/client";
import { getQueueItems, removeQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

/**
 * "Liberar espacio": fotos con respaldo confirmado (done/duplicate con
 * remote_id y sha256 registrado) cuya copia local sigue ocupando espacio
 * en el dispositivo. Opcionalmente filtradas por antigüedad en días.
 */
export function getSyncedLocal(olderThanDays?: number): {
  assetIds: string[];
  totalBytes: number;
  items: { asset_id: string; sha256: string | null; bytes_total: number }[];
} {
  const cutoffMs = olderThanDays != null ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : null;
  const items = getQueueItems().filter(
    (i) =>
      (i.state === "done" || i.state === "duplicate") &&
      i.remote_id != null &&
      i.sha256 != null &&
      i.asset_id &&
      (cutoffMs == null || i.created_at <= cutoffMs),
  );
  return {
    assetIds: items.map((i) => i.asset_id),
    totalBytes: items.reduce((s, i) => s + (i.bytes_total || 0), 0),
    items: items.map((i) => ({
      asset_id: i.asset_id,
      sha256: i.sha256,
      bytes_total: i.bytes_total || 0,
    })),
  };
}

/**
 * Verifica la existencia e integridad remota en R2/D1 mediante el endpoint
 * /uploads/check-hashes antes de borrar cualquier archivo local.
 * Devuelve solo los assetIds cuyos hashes están confirmados en el servidor.
 */
export async function verifyRemoteIntegrity(
  items: { asset_id: string; sha256: string | null }[],
): Promise<string[]> {
  const valid = items.filter((i) => Boolean(i.sha256 && i.asset_id));
  if (!valid.length) return [];
  const hashes = Array.from(new Set(valid.map((i) => i.sha256 as string)));
  try {
    const res = await api.checkHashes(hashes);
    const existingSet = new Set(res.existing.map((e) => e.sha256));
    return valid.filter((i) => existingSet.has(i.sha256 as string)).map((i) => i.asset_id);
  } catch {
    // Si la API no está disponible o falla la verificación, abortamos para proteger los archivos
    return [];
  }
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
 * Elimina uno o más assets locales del dispositivo (por su asset_id de MediaLibrary).
 * También purga los items de la cola si estaban registrados.
 * Devuelve cuántos assets se eliminaron (0 si el usuario cancela o falla).
 */
export async function deleteLocalAssets(assetIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (!uniqueIds.length) return 0;
  const ok = await MediaLibrary.deleteAssetsAsync(uniqueIds);
  if (!ok) return 0;
  await removeQueueItems(uniqueIds);
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return uniqueIds.length;
}

/**
 * Elimina un asset local específico del dispositivo por su asset_id.
 * Devuelve true si se eliminó con éxito, false en caso contrario.
 */
export async function deleteLocalAsset(assetId: string): Promise<boolean> {
  const count = await deleteLocalAssets([assetId]);
  return count > 0;
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
  return deleteLocalAsset(item.asset_id);
}

/**
 * Borra las copias locales de los elementos ya respaldados con verificación
 * de integridad remota obligatoria. Devuelve cuántos assets eliminó MediaLibrary
 * (0 si el usuario cancela el diálogo del sistema o no hay nada que liberar).
 */
export async function freeSyncedSpace(
  olderThanDays?: number,
  verifyIntegrity = true,
): Promise<number> {
  const { items } = getSyncedLocal(olderThanDays);
  if (!items.length) return 0;

  let idsToDelete = items.map((i) => i.asset_id);
  if (verifyIntegrity) {
    idsToDelete = await verifyRemoteIntegrity(items);
  }
  if (!idsToDelete.length) return 0;

  return deleteLocalAssets(idsToDelete);
}
