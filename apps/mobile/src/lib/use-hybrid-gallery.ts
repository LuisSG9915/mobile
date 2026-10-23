import type { TimelineFilter, TimelineItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { getQueueItems, reconcileQueueWithRemote } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";
import {
  buildGalleryRows,
  type GalleryRow,
  type HybridPhoto,
  type LocalAsset,
  matchLocalToRemote,
  mergeGallery,
} from "./gallery";
import { listLocalAssets } from "./local-assets";
import { useSettings } from "./store";
import { useTimeline } from "./timeline";

export type AlbumFilter =
  | { type: "remote"; albumId: string; title: string }
  | { type: "local"; albumId: string; title: string };

/**
 * Último listado local por alcance (toda la biblioteca / álbum / álbumes con
 * flag). El visor lo usa para montar el carrusel con índice válido desde el
 * primer frame, sin esperar a que MediaLibrary vuelva a paginar.
 */
let localAssetsCache: { key: string; assets: LocalAsset[] } | null = null;

function localScopeKey(albumId: string | null | undefined, synced: string[] | null): string {
  return `${albumId ?? "all"}|${synced === null ? "ALL" : synced.join(",")}`;
}

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
  before?: string,
) {
  const tick = useQueueEvents((s) => s.tick);
  // Solo se re-lista MediaLibrary al montar, al refrescar a mano y cuando la
  // biblioteca cambia de verdad (escaneo o "Liberar espacio"), no ante cada
  // tick de la cola — el listado completo es demasiado caro para cada badge.
  const libTick = useLibraryEvents((s) => s.tick);
  const syncedAlbumIds = useSettings((s) => s.syncedAlbumIds);
  const localAlbumId = albumFilter?.type === "local" ? albumFilter.albumId : undefined;
  const scopeKey = localScopeKey(localAlbumId, syncedAlbumIds);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>(() =>
    localAssetsCache?.key === scopeKey ? localAssetsCache.assets : [],
  );

  // Cambio de alcance (álbum/filtro): reutilizar el listado cacheado de ese
  // alcance mientras el refresco real llega.
  useEffect(() => {
    if (localAssetsCache?.key === scopeKey) setLocalAssets(localAssetsCache.assets);
  }, [scopeKey]);

  const refreshLocal = useCallback(async () => {
    const key = scopeKey;
    const commit = (assets: LocalAsset[]) => {
      if (scopeRef.current !== key) return;
      localAssetsCache = { key, assets };
      setLocalAssets(assets);
    };
    try {
      // Primera página (60) en cuanto MediaLibrary la entrega; el resto sigue
      // paginando en segundo plano sin bloquear el primer render (sin tope fijo de 2.000).
      const assets = await listLocalAssets(20_000, localAlbumId, syncedAlbumIds, commit);
      commit(assets);
    } catch {
      // Sin permisos o error de MediaLibrary: galería solo remota/cola.
    }
  }, [localAlbumId, syncedAlbumIds, scopeKey]);

  useEffect(() => {
    void refreshLocal();
  }, [refreshLocal, libTick]);

  const query = useTimeline(filter, before);

  // Consulta de fotos si hay un álbum remoto activo
  const remoteAlbumQuery = useQuery({
    queryKey: ["album-detail-filter", albumFilter?.type === "remote" ? albumFilter.albumId : null],
    queryFn: () => (albumFilter?.type === "remote" ? api.albumDetail(albumFilter.albumId) : null),
    enabled: albumFilter?.type === "remote",
  });

  const remoteItems = useMemo<TimelineItem[]>(() => {
    if (albumFilter?.type === "remote") return remoteAlbumQuery.data?.items ?? [];
    return query.data?.pages.flatMap((p) => p.items) ?? [];
  }, [albumFilter, remoteAlbumQuery.data, query.data]);

  /**
   * Reconciliación tras reinstalar: una fila `queued` sin sha ni remote_id cuyo
   * asset local coincide (tipo, dimensiones, captura ±3 s) con un remoto ya
   * cargado se marca `duplicate` en la cola. Así no se re-hashea ni se re-sube
   * nada de lo que ya estaba en R2 antes de desinstalar.
   */
  useEffect(() => {
    if (!remoteItems.length || !localAssets.length) return;
    const localById = new Map(localAssets.map((a) => [a.id, a]));
    const queue = getQueueItems();
    if (!queue.length) return;

    const claimed = new Set<string>();
    const remoteIdBySha = new Map<string, string>();
    for (const r of remoteItems) if (r.sha256) remoteIdBySha.set(r.sha256, r.id);
    const queuedLocals: LocalAsset[] = [];
    for (const q of queue) {
      if (q.remote_id) claimed.add(q.remote_id);
      else if (q.sha256) {
        const id = remoteIdBySha.get(q.sha256);
        if (id) claimed.add(id);
      }
      if (q.state !== "queued" || q.sha256 || q.remote_id) continue;
      const local = localById.get(q.asset_id);
      if (local) queuedLocals.push(local);
    }
    if (!queuedLocals.length) return;

    const matches = matchLocalToRemote(queuedLocals, remoteItems, claimed);
    const rows: { assetId: string; remoteId: string; sha256: string }[] = [];
    for (const [assetId, remote] of matches) {
      if (remote.sha256) rows.push({ assetId, remoteId: remote.id, sha256: remote.sha256 });
    }
    if (!rows.length) return;
    void reconcileQueueWithRemote(rows)
      .then((updated) => {
        if (updated > 0) useQueueEvents.getState().emit();
      })
      .catch(() => {});
  }, [remoteItems, localAssets]);

  const photos = useMemo<HybridPhoto[]>(() => {
    void tick; // la cola local se lee en vivo dentro del memo

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
  }, [
    remoteItems,
    query.data,
    remoteAlbumQuery.data,
    localAssets,
    tick,
    filter,
    albumFilter,
    syncedAlbumIds,
  ]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return { photos, rows, query, refreshLocal, remoteAlbumQuery };
}
