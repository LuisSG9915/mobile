import * as MediaLibrary from "expo-media-library/legacy";
import { useSettings } from "../lib/store";
import { enqueueAsset, kvSet } from "./db";

/**
 * Descubre assets nuevos y los encola recorriendo toda la biblioteca. No se
 * puede cortar al primer asset "viejo": MediaStore indexa tarde y los archivos
 * copiados traen fechas antiguas — un corte por fecha dejaría esos assets sin
 * respaldar para siempre. La deduplicación la hace enqueueAsset (INSERT OR
 * IGNORE por asset_id).
 */
export async function scanLibrary(): Promise<number> {
  // Sin granularPermissions, Android chequea TODAS las declaradas en el
  // manifiesto (incluye READ_MEDIA_AUDIO) y la pasada saldría siempre vacía.
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return 0;

  const includeVideos = useSettings.getState().includeVideos;

  let after: string | undefined;
  let added = 0;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: includeVideos
        ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
        : [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    for (const a of page.assets) {
      // creationTime llega en unidad variable según el asset (segundos o
      // milisegundos) y 0 cuando falta EXIF/DATE_TAKEN — normalizar a ms.
      const creationTime =
        a.creationTime <= 0
          ? Date.now()
          : a.creationTime < 1e12
            ? a.creationTime * 1000
            : a.creationTime;
      await enqueueAsset({
        id: a.id,
        uri: a.uri,
        filename: a.filename,
        mediaType: a.mediaType === MediaLibrary.MediaType.video ? "video" : "photo",
        creationTime,
      });
      added++;
    }
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);

  kvSet("last_scan_ts", String(Date.now()));
  return added;
}
