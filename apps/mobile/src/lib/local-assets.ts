import * as MediaLibrary from "expo-media-library/legacy";
import type { LocalAsset } from "./gallery";

export type DeviceAlbum = {
  id: string;
  title: string;
  assetCount: number;
};

function stableTimestampFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  // Fecha estable fija en el pasado (2020) para evitar que cambie en cada refresco
  return 1577836800000 + (hash % 86400000);
}

/**
 * Obtiene la lista de álbumes locales del dispositivo.
 */
export async function listLocalAlbums(): Promise<DeviceAlbum[]> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
    if (!perm.granted) return [];
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    return albums
      .filter((alb) => alb.assetCount > 0)
      .map((alb) => ({
        id: alb.id,
        title: alb.title,
        assetCount: alb.assetCount,
      }));
  } catch {
    return [];
  }
}

/**
 * Lista los assets locales del dispositivo para la galería híbrida. A
 * diferencia del scanner (que encola), esto solo lee — y siempre incluye
 * videos: `includeVideos` es una preferencia de respaldo, no de la vista.
 */
export async function listLocalAssets(
  limit = 2000,
  albumId?: string | null,
): Promise<LocalAsset[]> {
  // Sin granularPermissions, Android chequea TODAS las declaradas (ver scanner).
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return [];

  const out: LocalAsset[] = [];
  let after: string | undefined;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: Math.min(200, limit - out.length),
      after,
      mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
      ...(albumId ? { album: albumId } : {}),
    });
    for (const a of page.assets) {
      // creationTime llega en unidad variable (s o ms) y 0 sin EXIF.
      // Usar modificationTime si creationTime falta; de lo contrario fallback estable (nunca Date.now()).
      const rawTime =
        a.creationTime > 0
          ? a.creationTime
          : (a.modificationTime ?? 0) > 0
            ? a.modificationTime
            : 0;
      const creationTime =
        rawTime > 0 ? (rawTime < 1e12 ? rawTime * 1000 : rawTime) : stableTimestampFromId(a.id);
      const isVideo = a.mediaType === MediaLibrary.MediaType.video;
      out.push({
        id: a.id,
        uri: a.uri,
        mediaType: isVideo ? "video" : "photo",
        creationTime,
        width: a.width,
        height: a.height,
        // MediaLibrary devuelve duración en segundos.
        durationMs: isVideo ? Math.round(a.duration * 1000) : null,
        albumId: a.albumId ?? null,
      });
    }
    after = page.hasNextPage && out.length < limit ? page.endCursor : undefined;
  } while (after);
  return out;
}
