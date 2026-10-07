import { ALLOWED_EXTENSIONS } from "@photos/shared";
import * as MediaLibrary from "expo-media-library/legacy";
import { useLibraryEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import { type EnqueueInput, enqueueAssetsBatch, setLastScanTs } from "./db";
import type { ScanResult } from "./types";

export type { ScanResult } from "./types";

/**
 * Descubre assets nuevos y los encola recorriendo toda la biblioteca. No se
 * puede cortar al primer asset "viejo": MediaStore indexa tarde y los archivos
 * copiados traen fechas antiguas — un corte por fecha dejaría esos assets sin
 * respaldar para siempre. La deduplicación la hace el INSERT OR IGNORE por
 * (user_id, asset_id).
 *
 * Se omiten los assets cuya extensión no está soportada (RAW, AVIF…): subirlos
 * con el fallback de ext/mime los etiquetaría mal en R2.
 */
export async function scanLibrary(): Promise<ScanResult> {
  // Sin granularPermissions, Android chequea TODAS las declaradas en el
  // manifiesto (incluye READ_MEDIA_AUDIO) y la pasada saldría siempre vacía.
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return { added: 0, skipped: 0 };

  const includeVideos = useSettings.getState().includeVideos;

  let after: string | undefined;
  let added = 0;
  let skipped = 0;
  do {
    const page = await MediaLibrary.getAssetsAsync({
      first: 200,
      after,
      mediaType: includeVideos
        ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
        : [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    const batch: EnqueueInput[] = [];
    for (const a of page.assets) {
      const ext = (a.filename?.split(".").pop() ?? "").toLowerCase();
      if (ext && !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        skipped++;
        continue;
      }
      // creationTime llega en unidad variable según el asset (segundos o
      // milisegundos) y 0 cuando falta EXIF/DATE_TAKEN — normalizar a ms.
      const creationTime =
        a.creationTime <= 0
          ? Date.now()
          : a.creationTime < 1e12
            ? a.creationTime * 1000
            : a.creationTime;
      batch.push({
        id: a.id,
        uri: a.uri,
        filename: a.filename,
        mediaType: a.mediaType === MediaLibrary.MediaType.video ? "video" : "photo",
        creationTime,
      });
      added++;
    }
    // Una transacción por página: ~200 INSERT OR IGNORE amortizados.
    await enqueueAssetsBatch(batch);
    after = page.hasNextPage ? page.endCursor : undefined;
  } while (after);

  setLastScanTs(Date.now());
  // La biblioteca se re-listó: la galería híbrida refresca sus assets locales.
  useLibraryEvents.getState().emit();
  return { added, skipped };
}
