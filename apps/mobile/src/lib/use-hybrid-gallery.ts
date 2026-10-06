import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { getQueueItems } from "../queue/db";
import { useQueueEvents } from "./events";
import {
  buildGalleryRows,
  type GalleryRow,
  type HybridPhoto,
  type LocalAsset,
  mergeGallery,
} from "./gallery";
import { listLocalAssets } from "./local-assets";

/**
 * Hook unificado de la galería híbrida: combina los assets locales del
 * dispositivo (MediaLibrary en nativo, la cola en web), el estado en vivo de
 * la cola de respaldo y el timeline remoto paginado del API en una lista
 * única de HybridPhoto con su syncStatus resuelto.
 *
 * Se re-fusiona ante: nuevas páginas del timeline, refresco de assets locales
 * y cada tick de la cola (useQueueEvents) — así el badge de una foto cambia
 * sin recargar la cuadrícula.
 */
export function useHybridGallery() {
  const tick = useQueueEvents((s) => s.tick);
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>([]);

  const refreshLocal = useCallback(async () => {
    try {
      setLocalAssets(await listLocalAssets());
    } catch {
      // Sin permisos o error de MediaLibrary: galería solo remota/cola.
    }
  }, []);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal]);

  const query = useInfiniteQuery({
    queryKey: ["timeline"],
    queryFn: ({ pageParam }) => api.timeline(pageParam, 60),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const photos = useMemo<HybridPhoto[]>(() => {
    void tick; // la cola local se lee en vivo dentro del memo
    const remoteItems = query.data?.pages.flatMap((p) => p.items) ?? [];
    return mergeGallery({ localAssets, queueItems: getQueueItems(), remoteItems });
  }, [query.data, localAssets, tick]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return { photos, rows, query, refreshLocal };
}
