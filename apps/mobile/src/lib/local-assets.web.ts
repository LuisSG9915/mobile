import type { LocalAsset } from "./gallery";

/**
 * En web no hay camera roll: lo "local" son los File que el usuario eligió,
 * que ya viven en la cola (IndexedDB) con su uri. mergeGallery los refleja.
 */
export async function listLocalAssets(_limit = 2000): Promise<LocalAsset[]> {
  return [];
}
