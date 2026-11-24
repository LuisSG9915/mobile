import { ALLOWED_EXTENSIONS } from "@photos/shared";
import * as MediaLibrary from "expo-media-library/legacy";
import { useLibraryEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import {
  clearQueue,
  type EnqueueInput,
  enqueueAssetsBatch,
  getLastScannedCreationTime,
  getLastScanTs,
  pruneQueueExcept,
  setLastScannedCreationTime,
  setLastScanTs,
} from "./db";
import { cancelQueue } from "./processor";
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

  const settings = useSettings.getState();
  const includeVideos = settings.includeVideos;
  const syncedAlbumIds = settings.syncedAlbumIds ?? null;

  // Si syncedAlbumIds es un arreglo vacío, no hay álbumes seleccionados para sincronizar:
  // vaciamos la cola y cancelamos subidas en curso.
  if (Array.isArray(syncedAlbumIds) && syncedAlbumIds.length === 0) {
    cancelQueue();
    await clearQueue();
    setLastScanTs(Date.now());
    useLibraryEvents.getState().emit();
    return { added: 0, skipped: 0 };
  }

  const lastScan = opts.forceScan ? 0 : getLastScanTs();
  const createdAfter = opts.forceScan
    ? undefined
    : opts.incrementalWindowMs
      ? Math.max(0, (lastScan || Date.now()) - opts.incrementalWindowMs)
      : lastScan > 0
        ? Math.max(0, lastScan - SCAN_SAFETY_MARGIN_MS)
        : undefined;

  let added = 0;
  let skipped = 0;
  const allowedAssetIds = new Set<string>();

  async function scanAlbum(albumId?: string) {
    let after: string | undefined;
    do {
      const page = await MediaLibrary.getAssetsAsync({
        first: 200,
        after,
        mediaType: includeVideos
          ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
          : [MediaLibrary.MediaType.photo],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        ...(createdAfter !== undefined ? { createdAfter } : {}),
        ...(albumId !== undefined ? { album: albumId } : {}),
      });
      const batch: EnqueueInput[] = [];
      for (const a of page.assets) {
        if (albumId !== undefined) {
          allowedAssetIds.add(a.id);
        }
        const ext = (a.filename?.split(".").pop() ?? "").toLowerCase();
        if (ext && !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
          skipped++;
          continue;
        }
        // creationTime llega en unidad variable según el asset (segundos o
        // milisegundos) y 0 cuando falta EXIF/DATE_TAKEN — usar modificationTime
        // si falta, o fallback estable determinista (nunca Date.now()).
        const rawTime =
          a.creationTime > 0
            ? a.creationTime
            : (a.modificationTime ?? 0) > 0
              ? a.modificationTime
              : 0;
        let stableFallback = 1577836800000;
        if (!rawTime && a.id) {
          let hash = 0;
          for (let i = 0; i < a.id.length; i++) hash = (hash * 31 + a.id.charCodeAt(i)) >>> 0;
          stableFallback += hash % 86400000;
        }
        const creationTime =
          rawTime > 0 ? (rawTime < 1e12 ? rawTime * 1000 : rawTime) : stableFallback;
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
  }

  if (syncedAlbumIds === null) {
    await scanAlbum();
  } else {
    for (const albId of syncedAlbumIds) {
      await scanAlbum(albId);
    }
    // Si fue un escaneo forzado o completo, depurar los elementos de la cola que no pertenecen
    // a los álbumes seleccionados
    if (opts.forceScan || lastScan === 0) {
      await pruneQueueExcept(allowedAssetIds);
    }
  }

  setLastScanTs(Date.now());
  // La biblioteca se re-listó: la galería híbrida refresca sus assets locales.
  useLibraryEvents.getState().emit();
  return { added, skipped };
}

// ---------- Escaneo incremental + watcher en vivo (API documentada) ----------

export interface ScanGalleryOptions {
  pageSize?: number;
  forceFullScan?: boolean;
  onBatchEnqueued?: (enqueuedSoFar: number) => void;
}

export interface ScanGalleryResult {
  scannedAssets: number;
  newlyEnqueued: number;
  latestCreationTime: number;
}

let isScanningIncremental = false;

export async function scanDeviceGalleryIncremental(
  options: ScanGalleryOptions = {},
): Promise<ScanGalleryResult> {
  if (isScanningIncremental) {
    return { scannedAssets: 0, newlyEnqueued: 0, latestCreationTime: 0 };
  }
  isScanningIncremental = true;
  try {
    const pageSize = options.pageSize ?? 200;
    const savedWatermark = options.forceFullScan ? 0 : await getLastScannedCreationTime();
    const createdAfter = savedWatermark > 1000 ? savedWatermark - 1000 : undefined;

    let afterCursor: string | undefined;
    let hasNextPage = true;
    let scannedAssets = 0;
    let newlyEnqueued = 0;
    let maxCreationTimeSeen = savedWatermark;

    while (hasNextPage) {
      const page = await MediaLibrary.getAssetsAsync({
        first: pageSize,
        after: afterCursor,
        createdAfter,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, true]],
      });

      if (page.assets.length === 0) break;

      const batch: any[] = [];
      for (const asset of page.assets) {
        scannedAssets += 1;
        const creationTimeMs = asset.creationTime || Date.now();
        if (creationTimeMs > maxCreationTimeSeen) maxCreationTimeSeen = creationTimeMs;
        batch.push({
          id: asset.id,
          uri: asset.uri,
          filename: asset.filename || `asset_${asset.id}`,
          mediaType: asset.mediaType === "video" ? "video" : "photo",
          creationTime: creationTimeMs,
        });
      }

      await enqueueAssetsBatch(batch as any);
      newlyEnqueued += batch.length;
      options.onBatchEnqueued?.(newlyEnqueued);

      hasNextPage = page.hasNextPage;
      afterCursor = page.endCursor;
    }

    try {
      if (maxCreationTimeSeen > savedWatermark) {
        await setLastScannedCreationTime(maxCreationTimeSeen);
      }
    } catch {
      // noop
    }
    return { scannedAssets, newlyEnqueued, latestCreationTime: maxCreationTimeSeen };
  } finally {
    isScanningIncremental = false;
  }
}

export function startMediaLibraryLiveWatcher(
  onNewAssetsEnqueued: (count: number) => void,
  debounceMs = 1500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const subscription = MediaLibrary.addListener(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const res = await scanDeviceGalleryIncremental();
        if (res.newlyEnqueued > 0) onNewAssetsEnqueued(res.newlyEnqueued);
      } catch (err) {
        console.warn("[queue/scanner] Error en live watcher:", err);
      }
    }, debounceMs);
  });

  return () => {
    if (timer) clearTimeout(timer);
    subscription.remove();
  };
}
