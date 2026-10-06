import * as MediaLibrary from "expo-media-library/legacy";
import type { LocalAsset } from "./gallery";

/**
 * Lista los assets locales del dispositivo para la galería híbrida. A
 * diferencia del scanner (que encola), esto solo lee — y siempre incluye
 * videos: `includeVideos` es una preferencia de respaldo, no de la vista.
 */
export async function listLocalAssets(limit = 2000): Promise<LocalAsset[]> {
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
    });
    for (const a of page.assets) {
      // creationTime llega en unidad variable (s o ms) y 0 sin EXIF — igual
      // que en scanner.ts, normalizar a ms.
      const creationTime =
        a.creationTime <= 0
          ? Date.now()
          : a.creationTime < 1e12
            ? a.creationTime * 1000
            : a.creationTime;
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
      });
    }
    after = page.hasNextPage && out.length < limit ? page.endCursor : undefined;
  } while (after);
  return out;
}
