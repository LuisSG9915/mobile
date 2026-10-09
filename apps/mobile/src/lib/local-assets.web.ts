import type { LocalAsset } from "./gallery";

export type DeviceAlbum = {
  id: string;
  title: string;
  assetCount: number;
  coverUri?: string | null;
};

export async function listLocalAlbums(): Promise<DeviceAlbum[]> {
  return [];
}

/**
 * En web no hay camera roll: lo "local" son los File que el usuario eligió,
 * que ya viven en la cola (IndexedDB) con su uri. mergeGallery los refleja.
 */
export async function listLocalAssets(
  _limit = 2000,
  _albumId?: string | null,
  _syncedAlbumIds?: string[] | null,
): Promise<LocalAsset[]> {
  return [];
}
