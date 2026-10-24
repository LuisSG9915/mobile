import * as MediaLibrary from "expo-media-library/legacy";
import type { LocalAsset } from "./gallery";

export type DeviceAlbum = {
  id: string;
  title: string;
  assetCount: number;
  coverUri?: string | null;
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
 * Obtiene la lista de álbumes locales del dispositivo con su miniatura de portada.
 */
export async function listLocalAlbums(): Promise<DeviceAlbum[]> {
  try {
    const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
    if (!perm.granted) return [];
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    // En iOS, el smart album "Recents"/"Recientes" contiene toda la biblioteca del dispositivo
    // (el carrete completo), lo cual duplica la opción general de todos los álbumes y confunde la selección.
    const valid = albums.filter(
      (alb) =>
        alb.assetCount > 0 &&
        !(
          alb.type === "smartAlbum" &&
          (alb.title?.toLowerCase() === "recents" || alb.title?.toLowerCase() === "recientes")
        ),
    );
    const withCovers = await Promise.all(
      valid.map(async (alb) => {
        let coverUri: string | null = null;
        try {
          const sample = await MediaLibrary.getAssetsAsync({
            album: alb.id,
            first: 1,
            sortBy: [[MediaLibrary.SortBy.creationTime, false]],
          });
          if (sample.assets.length > 0) {
            coverUri = sample.assets[0].uri;
          }
        } catch {
          // Si falla obtener muestra, el álbum se muestra con icono de carpeta
        }
        return {
          id: alb.id,
          title: alb.title,
          assetCount: alb.assetCount,
          coverUri,
        };
      }),
    );
    return withCovers;
  } catch {
    return [];
  }
}

/**
 * Lista los assets locales del dispositivo para la galería híbrida. Paginación
 * incremental progresiva: primer lote rápido de 300 para TTI instantáneo, seguido
 * de páginas de 1.000 activos en segundo plano cediendo el hilo principal (16 ms)
 * con soporte para cancelación vía AbortSignal.
 */
export async function listLocalAssets(
  limit = 20_000,
  albumId?: string | null,
  syncedAlbumIds?: string[] | null,
  onFirstPage?: (assets: LocalAsset[]) => void,
  options?: {
    signal?: AbortSignal;
    pageSize?: number;
    initialBatchSize?: number;
  },
): Promise<LocalAsset[]> {
  // Sin granularPermissions, Android chequea TODAS las declaradas (ver scanner).
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return [];

  const out: LocalAsset[] = [];
  let firstPageReported = false;
  const initialBatch = options?.initialBatchSize ?? 300;
  const pageSize = options?.pageSize ?? 1000;

  // Primera página en cuanto está (300 items): la galería pinta sin esperar la biblioteca entera.
  const reportFirstPage = () => {
    if (firstPageReported || out.length === 0) return;
    firstPageReported = true;
    try {
      onFirstPage?.(out.slice());
    } catch {
      // Un consumidor roto no debe abortar el listado completo.
    }
  };

  async function scanSource(sourceAlbumId?: string) {
    let after: string | undefined;
    do {
      if (options?.signal?.aborted) return;

      const isFirst = out.length === 0;
      const batchToFetch = isFirst
        ? Math.min(initialBatch, limit)
        : Math.min(pageSize, limit - out.length);

      const page = await MediaLibrary.getAssetsAsync({
        first: batchToFetch,
        after,
        mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
        sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        ...(sourceAlbumId ? { album: sourceAlbumId } : {}),
      });

      if (options?.signal?.aborted) return;

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
          albumId: a.albumId ?? sourceAlbumId ?? null,
        });
        if (out.length >= limit) break;
      }
      after = page.hasNextPage && out.length < limit ? page.endCursor : undefined;
      reportFirstPage();

      if (after && out.length < limit) {
        // Ceder el hilo principal (16 ms) entre páginas para no congelar la UI a 60 fps
        await new Promise((resolve) => setTimeout(resolve, 16));
        if (options?.signal?.aborted) return;
      }
    } while (after && out.length < limit);
  }

  if (albumId) {
    // Consulta de un álbum específico solicitado
    await scanSource(albumId);
  } else if (syncedAlbumIds !== null && syncedAlbumIds !== undefined) {
    // Solo consultar los álbumes seleccionados con flag
    if (syncedAlbumIds.length === 0) {
      return [];
    }
    for (const alb of syncedAlbumIds) {
      if (out.length >= limit || options?.signal?.aborted) break;
      await scanSource(alb);
    }
    out.sort((a, b) => b.creationTime - a.creationTime);
  } else {
    // Consulta general de toda la biblioteca
    await scanSource();
  }

  return out;
}

export type LocalAssetsPage = {
  assets: LocalAsset[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

/**
 * Consulta paginada por cursor (`after`) para carga bajo demanda en scroll infinito.
 */
export async function listLocalAssetsPage(
  first = 100,
  after?: string,
  albumId?: string | null,
): Promise<LocalAssetsPage> {
  const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
  if (!perm.granted) return { assets: [], nextCursor: null, hasNextPage: false };

  const page = await MediaLibrary.getAssetsAsync({
    first,
    after,
    mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    ...(albumId ? { album: albumId } : {}),
  });

  const assets: LocalAsset[] = page.assets.map((a) => {
    const rawTime =
      a.creationTime > 0 ? a.creationTime : (a.modificationTime ?? 0) > 0 ? a.modificationTime : 0;
    const creationTime =
      rawTime > 0 ? (rawTime < 1e12 ? rawTime * 1000 : rawTime) : stableTimestampFromId(a.id);
    const isVideo = a.mediaType === MediaLibrary.MediaType.video;
    return {
      id: a.id,
      uri: a.uri,
      mediaType: isVideo ? "video" : "photo",
      creationTime,
      width: a.width,
      height: a.height,
      durationMs: isVideo ? Math.round(a.duration * 1000) : null,
      albumId: a.albumId ?? albumId ?? null,
    };
  });

  return {
    assets,
    nextCursor: page.hasNextPage ? page.endCursor : null,
    hasNextPage: page.hasNextPage,
  };
}
