import { removeQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

/**
 * En web no hay camera roll que liberar: los File elegidos se borran de
 * IndexedDB en la misma transacción que marca el item done/duplicate.
 */
export function getSyncedLocal(): { assetIds: string[]; totalBytes: number } {
  return { assetIds: [], totalBytes: 0 };
}

export async function freeSyncedSpace(): Promise<number> {
  return 0;
}

export function hasLocalCopy(_remoteId: string): boolean {
  return false;
}

export async function deleteLocalCopy(_remoteId: string): Promise<boolean> {
  return false;
}

/**
 * Elimina uno o más items locales de la cola en web (IndexedDB).
 */
export async function deleteLocalAssets(assetIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (!uniqueIds.length) return 0;
  await removeQueueItems(uniqueIds);
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return uniqueIds.length;
}

/**
 * Elimina un item local de la cola en web por su asset_id.
 */
export async function deleteLocalAsset(assetId: string): Promise<boolean> {
  const count = await deleteLocalAssets([assetId]);
  return count > 0;
}
