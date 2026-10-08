import type { TimelineFilter, TimelineItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { getQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";
import {
  buildGalleryRows,
  type GalleryRow,
  type HybridPhoto,
  type LocalAsset,
  mergeGallery,
} from "./gallery";
import { listLocalAssets } from "./local-assets";
import { useTimeline } from "./timeline";

export type AlbumFilter =
  | { type: "remote"; albumId: string; title: string }
  | { type: "local"; albumId: string; title: string };

/**
 * Hook unificado de la galería híbrida: combina los assets locales del
 * dispositivo (MediaLibrary en nativo, la cola en web), el estado en vivo de
 * la cola de respaldo y el timeline remoto paginado del API en una lista
 * única de HybridPhoto con su syncStatus resuelto.
 *
 * Permite filtrar por tipo de medio (filter) y por álbum específico (albumFilter).
 */
export function useHybridGallery(
  filter: TimelineFilter = "all",
  albumFilter: AlbumFilter | null = null,
) {
  const tick = useQueueEvents((s) => s.tick);
  // Solo se re-lista MediaLibrary al montar, al refrescar a mano y cuando la
  // biblioteca cambia de verdad (escaneo o "Liberar espacio"), no ante cada
  // tick de la cola — el listado completo es demasiado caro para cada badge.
  const libTick = useLibraryEvents((s) => s.tick);
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);

  const refreshLocal = useCallback(async () => {
    try {
      const albId = albumFilter?.type === "local" ? albumFilter.albumId : undefined;
      setLocalAssets(await listLocalAssets(2000, albId));
    } catch {
      // Sin permisos o error de MediaLibrary: galería solo remota/cola.
    }
  }, [albumFilter]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal, libTick]);

  const query = useTimeline(filter);

  // Consulta de fotos si hay un álbum remoto activo
  const remoteAlbumQuery = useQuery({
    queryKey: ["album-detail-filter", albumFilter?.type === "remote" ? albumFilter.albumId : null],
    queryFn: () => (albumFilter?.type === "remote" ? api.albumDetail(albumFilter.albumId) : null),
    enabled: albumFilter?.type === "remote",
  });

  const photos = useMemo<HybridPhoto[]>(() => {
    void tick; // la cola local se lee en vivo dentro del memo

    let remoteItems: TimelineItem[] = [];
    if (albumFilter?.type === "remote") {
      remoteItems = remoteAlbumQuery.data?.items ?? [];
    } else {
      remoteItems = query.data?.pages.flatMap((p) => p.items) ?? [];
    }

    const effectiveLocal =
      albumFilter?.type === "remote"
        ? []
        : albumFilter?.type === "local"
          ? localAssets.filter((a) => !a.albumId || a.albumId === albumFilter.albumId)
          : localAssets;

    const merged = mergeGallery({
      localAssets: effectiveLocal,
      queueItems: getQueueItems(),
      remoteItems,
    });
    // Los locales/en-cola no conocen favoritos: bajo ese filtro solo quedan
    // los remotos marcados (y las filas de cola enlazadas a ellos).
    if (filter === "favorites") return merged.filter((p) => p.remote?.isFavorite === true);
    if (filter === "photos") return merged.filter((p) => p.mediaType === "photo");
    if (filter === "videos") return merged.filter((p) => p.mediaType === "video");
    if (filter === "screenshots") return merged.filter((p) => p.remote?.isScreenshot === true);
    if (filter === "documents") return merged.filter((p) => p.remote?.isDocument === true);
    return merged;
  }, [query.data, remoteAlbumQuery.data, localAssets, tick, filter, albumFilter]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return { photos, rows, query, refreshLocal, remoteAlbumQuery };
}
