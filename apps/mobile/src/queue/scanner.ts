import { ALLOWED_EXTENSIONS } from "@photos/shared";
import * as MediaLibrary from "expo-media-library/legacy";
import { useLibraryEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import { type EnqueueInput, enqueueAssetsBatch, getLastScanTs, setLastScanTs } from "./db";
import type { ScanOptions, ScanResult } from "./types";

export type { ScanOptions, ScanResult } from "./types";

/** Margen de 24 horas para cubrir fotos indexadas tarde por el SO o recibidas con fecha anterior */
const SCAN_SAFETY_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * Descubre assets nuevos y los encola en la base de datos local.
 *
 * Si opts.forceScan es true o es el primer escaneo (lastScan == 0), se recorre
 * toda la biblioteca sin filtro de fecha.
 * En escaneos periódicos o en segundo plano, se aplica un filtro incremental
 * `createdAfter = lastScanTs - 24h` para evitar paginar decenas de miles de
 * fotos en cada pasada y ahorrar batería/tiempo de CPU.
 *
 * La deduplicación final la garantiza el INSERT OR IGNORE por (user_id, asset_id).
 * Se omiten los assets cuya extensión no está soportada (RAW, AVIF…): subirlos
 * con el fallback de ext/mime los etiquetaría mal en R2.
 */
export async function scanLibrary(opts: ScanOptions = {}): Promise<ScanResult> {
  // Sin granularPermissions, Android chequea TODAS las declaradas en el
  // manifiesto (incluye READ_MEDIA_AUDIO) y la pasada saldría siempre vacía.
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return { added: 0, skipped: 0 };

  const includeVideos = useSettings.getState().includeVideos;

  const lastScan = opts.forceScan ? 0 : getLastScanTs();
  const createdAfter = lastScan > 0 ? Math.max(0, lastScan - SCAN_SAFETY_MARGIN_MS) : undefined;

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
      ...(createdAfter !== undefined ? { createdAfter } : {}),
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
