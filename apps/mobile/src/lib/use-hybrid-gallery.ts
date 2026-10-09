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
import { useSettings } from "./store";
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
 * Permite filtrar por tipo de medio (filter) y por álbum específico (albumFilter),
 * y respeta los álbumes seleccionados con flag (syncedAlbumIds).
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
  const syncedAlbumIds = useSettings((s) => s.syncedAlbumIds);
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);

  const refreshLocal = useCallback(async () => {
    try {
      const albId = albumFilter?.type === "local" ? albumFilter.albumId : undefined;
      setLocalAssets(await listLocalAssets(2000, albId, syncedAlbumIds));
    } catch {
      // Sin permisos o error de MediaLibrary: galería solo remota/cola.
    }
  }, [albumFilter, syncedAlbumIds]);

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
          ? localAssets.filter((a) => a.albumId === albumFilter.albumId)
          : syncedAlbumIds !== null
            ? localAssets.filter((a) => a.albumId && syncedAlbumIds.includes(a.albumId))
            : localAssets;

    const allQueue = getQueueItems();
    let effectiveQueue = allQueue;

    if (albumFilter?.type === "local" || (albumFilter === null && syncedAlbumIds !== null)) {
      const localIdSet = new Set(effectiveLocal.map((a) => a.id));
      effectiveQueue = allQueue.filter((q) => localIdSet.has(q.asset_id));
    } else if (albumFilter?.type === "remote") {
      const remoteIdSet = new Set(remoteItems.map((r) => r.id));
      const remoteShaSet = new Set(remoteItems.map((r) => r.sha256).filter(Boolean));
      effectiveQueue = allQueue.filter(
        (q) =>
          (q.remote_id && remoteIdSet.has(q.remote_id)) || (q.sha256 && remoteShaSet.has(q.sha256)),
      );
    }

    let merged = mergeGallery({
      localAssets: effectiveLocal,
      queueItems: effectiveQueue,
      remoteItems,
    });

    if (albumFilter?.type === "local") {
      // Al filtrar por álbum local, los remotos huérfanos del timeline general ('r-*')
      // no pertenecen a este álbum del dispositivo y deben excluirse.
      merged = merged.filter((p) => !p.key.startsWith("r-"));
    }
    // Los locales/en-cola no conocen favoritos: bajo ese filtro solo quedan
    // los remotos marcados (y las filas de cola enlazadas a ellos).
    if (filter === "favorites") return merged.filter((p) => p.remote?.isFavorite === true);
    if (filter === "photos") return merged.filter((p) => p.mediaType === "photo");
    if (filter === "videos") return merged.filter((p) => p.mediaType === "video");
    if (filter === "screenshots") return merged.filter((p) => p.remote?.isScreenshot === true);
    if (filter === "documents") return merged.filter((p) => p.remote?.isDocument === true);
    return merged;
  }, [query.data, remoteAlbumQuery.data, localAssets, tick, filter, albumFilter, syncedAlbumIds]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return { photos, rows, query, refreshLocal, remoteAlbumQuery };
}
