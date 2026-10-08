import type { TimelineFilter } from "@photos/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
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
export function useHybridGallery(filter: TimelineFilter = "all") {
  const tick = useQueueEvents((s) => s.tick);
  // Solo se re-lista MediaLibrary al montar, al refrescar a mano y cuando la
  // biblioteca cambia de verdad (escaneo o "Liberar espacio"), no ante cada
  // tick de la cola — el listado completo es demasiado caro para cada badge.
  const libTick = useLibraryEvents((s) => s.tick);
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
  }, [refreshLocal, libTick]);

  const query = useTimeline(filter);

  const photos = useMemo<HybridPhoto[]>(() => {
    void tick; // la cola local se lee en vivo dentro del memo
    const remoteItems = query.data?.pages.flatMap((p) => p.items) ?? [];
    const merged = mergeGallery({ localAssets, queueItems: getQueueItems(), remoteItems });
    // Los locales/en-cola no conocen favoritos: bajo ese filtro solo quedan
    // los remotos marcados (y las filas de cola enlazadas a ellos).
    if (filter === "favorites") return merged.filter((p) => p.remote?.isFavorite === true);
    if (filter === "photos") return merged.filter((p) => p.mediaType === "photo");
    if (filter === "videos") return merged.filter((p) => p.mediaType === "video");
    if (filter === "screenshots") return merged.filter((p) => p.remote?.isScreenshot === true);
    if (filter === "documents") return merged.filter((p) => p.remote?.isDocument === true);
    return merged;
  }, [query.data, localAssets, tick, filter]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return { photos, rows, query, refreshLocal };
}
