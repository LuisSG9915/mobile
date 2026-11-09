import type { TimelineFilter, TimelineItem } from "@photos/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { getQueueItems, reconcileQueueWithRemote } from "../queue/db";
import { useLibraryEvents, useQueueEvents, useThrottledQueueTick } from "./events";
import {
  buildGalleryRows,
  filterToBefore,
  type GalleryRow,
  type HybridPhoto,
  type LocalAsset,
  matchLocalToRemote,
  mergeGallery,
} from "./gallery";
import { getLocalAssetById, listLocalAssets, listLocalAssetsPage } from "./local-assets";
import { useSettings, useSyncProgress } from "./store";
import { useTimeline } from "./timeline";

export type AlbumFilter =
  | { type: "remote"; albumId: string; title: string }
  | { type: "local"; albumId: string; title: string };

/**
 * Último listado local por alcance (toda la biblioteca / álbum / álbumes con
 * flag). El visor lo usa para montar el carrusel con índice válido desde el
 * primer frame, sin esperar a que MediaLibrary vuelva a paginar. Se conservan
 * varios alcances para que al salir de un álbum a "Todo" la lista anterior se
 * restaure al instante en vez de quedar con datos del alcance previo.
 */
const LOCAL_SCOPES_KEPT = 4;

// Caché del modo ventana: assets + cursor + hasMore por alcance, para que el
// visor (que remonta el hook) restaure la ventana sin re-escanear MediaLibrary.
const windowedCursorCache = new Map<string, string | null>();
const windowedHasMoreCache = new Map<string, boolean>();

/**
 * Tope de assets locales materializados en memoria para el grafo híbrido.
 * H-024 (pendiente mayor): paginar el grafo completo en lugar de materializarlo.
 * Mientras tanto, acotamos el tope para no sostener 20k HybridPhoto en gama media.
 * Los más antiguos siguen accesibles por el timeline remoto (paginado por `before`).
 */
const LOCAL_ASSETS_CAP = 2_000;
const FIRST_LOCAL_PAGE = 500;
const LOCAL_PAGE_SIZE = 300;
const localAssetsCache = new Map<string, LocalAsset[]>();

/**
 * Última enumeración completa por alcance. El visor vuelve a montar
 * `useHybridGallery` al abrir una foto; sin esta marca cada apertura repetía
 * el escaneo de MediaLibrary (hasta 20 000 assets) aunque la caché estuviera
 * caliente. Se invalida sola por tiempo o cuando `libTick` cambia (escaneo,
 * "Liberar espacio", nueva foto).
 */
const LOCAL_SCAN_TTL_MS = 60_000;
const localScanInfo = new Map<string, { at: number; libTick: number }>();

function cacheScope(key: string, assets: LocalAsset[]) {
  localAssetsCache.delete(key);
  localAssetsCache.set(key, assets);
  while (localAssetsCache.size > LOCAL_SCOPES_KEPT) {
    const oldest = localAssetsCache.keys().next().value;
    if (oldest === undefined) break;
    localAssetsCache.delete(oldest);
  }
}

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
  // La cola emite en cada transición de estado (~7 por archivo). La
  // suscripción va throttleada: la pantalla se re-renderiza ~3 veces/seg y la
  // fusión se recomputa en ese mismo ritmo (borde final incluido), en vez de
  // una evaluación por emit. Con el respaldo activo se afloja a ~1.5 s: cada
  // fusión+filas recorre toda la biblioteca y a 300 ms consumía casi todo el
  // presupuesto del hilo JS (cuadrícula negra, navegación congelada).
  const syncStatus = useSyncProgress((s) => s.status);
  const tick = useThrottledQueueTick(syncStatus === "syncing" ? 3000 : 1000);
  // Solo se re-lista MediaLibrary al montar, al refrescar a mano y cuando la
  // biblioteca cambia de verdad (escaneo o "Liberar espacio"), no ante cada
  // tick de la cola — el listado completo es demasiado caro para cada badge.
  const libTick = useLibraryEvents((s) => s.tick);
  // Espejo para que `refreshLocal` (estable) pueda marcar el escaneo con el
  // tick de biblioteca vigente sin volverse a crear en cada evento.
  const libTickRef = useRef(libTick);
  libTickRef.current = libTick;
  const syncedAlbumIds = useSettings((s) => s.syncedAlbumIds);
  const localAlbumId = albumFilter?.type === "local" ? albumFilter.albumId : undefined;
  const scopeKey = localScopeKey(localAlbumId, syncedAlbumIds);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  // Modo ventana: toda la biblioteca O un álbum concreto. Los álbumes con flag
  // (varios a la vez) siguen cargando el conjunto acotado por LOCAL_ASSETS_CAP.
  const isWindowedMode =
    localAlbumId != null || syncedAlbumIds == null || syncedAlbumIds === undefined;
  const [localAssets, setLocalAssets] = useState<LocalAsset[]>(
    () => localAssetsCache.get(scopeKey) ?? [],
  );
  // Paginación por cursor del listado local (H-024 Fase 2): solo se usa en el
  // caso "toda la biblioteca" (sin álbum ni filtro de álbumes con flag). En los
  // demás casos se sigue cargando el conjunto completo acotado por LOCAL_ASSETS_CAP.
  const [localCursor, setLocalCursor] = useState<string | null>(null);
  const [localHasMore, setLocalHasMore] = useState<boolean>(false);
  const [localLoadingMore, setLocalLoadingMore] = useState<boolean>(false);

  // Cambio de alcance (álbum/filtro): reutilizar el listado cacheado de ese
  // alcance mientras el refresco real llega; si no hay caché, limpiar para no
  // mostrar assets del alcance anterior (filtros como syncedAlbumIds los
  // reducirían a una cuadrícula vacía).
  useEffect(() => {
    setLocalLoadingMore(false);
    // Liberar referencias de fotos del alcance anterior para no retener el
    // grafo híbrido previo en memoria (H-024).
    photoByKeyRef.current.clear();
    const cached = localAssetsCache.get(scopeKey);
    if (cached) {
      setLocalAssets(cached);
      if (isWindowedMode) {
        setLocalCursor(windowedCursorCache.get(scopeKey) ?? null);
        setLocalHasMore(windowedHasMoreCache.get(scopeKey) ?? cached.length >= FIRST_LOCAL_PAGE);
      } else {
        setLocalCursor(null);
        setLocalHasMore(false);
      }
    } else {
      setLocalAssets([]);
      setLocalCursor(null);
      setLocalHasMore(false);
    }
  }, [scopeKey, isWindowedMode]);

  const refreshLocal = useCallback(
    async (signal?: AbortSignal) => {
      const key = scopeKey;
      // Modo ventana (toda la biblioteca): solo la primera página en memoria;
      // el resto se carga con loadMoreLocal al hacer scroll. Reduce el grafo
      // materializado de ~8k a ~500 items.
      if (isWindowedMode) {
        setLocalLoadingMore(true);
        try {
          const page = await listLocalAssetsPage(FIRST_LOCAL_PAGE, undefined, localAlbumId ?? null);
          if (signal?.aborted || scopeRef.current !== key) return;
          setLocalAssets(page.assets);
          setLocalCursor(page.nextCursor);
          setLocalHasMore(page.hasNextPage);
          cacheScope(key, page.assets);
          windowedCursorCache.set(key, page.nextCursor);
          windowedHasMoreCache.set(key, page.hasNextPage);
          localScanInfo.set(key, { at: Date.now(), libTick: libTickRef.current });
        } catch {
          // Sin permisos o error de MediaLibrary: galería solo remota/cola.
        } finally {
          setLocalLoadingMore(false);
        }
        return;
      }
      // Modo completo (álbum o álbumes con flag): carga acotada por LOCAL_ASSETS_CAP.
      const commit = (assets: LocalAsset[]) => {
        if (scopeRef.current !== key || signal?.aborted) return;
        cacheScope(key, assets);
        setLocalAssets(assets);
      };
      try {
        const assets = await listLocalAssets(
          LOCAL_ASSETS_CAP,
          localAlbumId,
          syncedAlbumIds,
          commit,
          {
            signal,
            initialBatchSize: 300,
            pageSize: 1000,
          },
        );
        if (!signal?.aborted && scopeRef.current === key) {
          localScanInfo.set(key, { at: Date.now(), libTick: libTickRef.current });
        }
        commit(assets);
      } catch {
        // Sin permisos o error de MediaLibrary: galería solo remota/cola.
      }
    },
    [localAlbumId, syncedAlbumIds, scopeKey, isWindowedMode],
  );

  const loadMoreLocal = useCallback(async () => {
    if (localLoadingMore || !localHasMore || localCursor == null) return;
    if (!isWindowedMode) return;
    const startScope = scopeKey;
    setLocalLoadingMore(true);
    try {
      const page = await listLocalAssetsPage(LOCAL_PAGE_SIZE, localCursor, localAlbumId ?? null);
      if (scopeRef.current !== startScope) return;
      setLocalAssets((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const added = page.assets.filter((a) => !seen.has(a.id));
        const next = added.length ? prev.concat(added) : prev;
        cacheScope(startScope, next);
        return next;
      });
      setLocalCursor(page.nextCursor);
      setLocalHasMore(page.hasNextPage);
      windowedCursorCache.set(startScope, page.nextCursor);
      windowedHasMoreCache.set(startScope, page.hasNextPage);
    } catch {
      // Fallo de MediaLibrary: se reintenta en el siguiente scroll.
    } finally {
      setLocalLoadingMore(false);
    }
  }, [localLoadingMore, localHasMore, localCursor, isWindowedMode]);

  useEffect(() => {
    const cached = localAssetsCache.get(scopeKey);
    const scan = localScanInfo.get(scopeKey);
    const fresh =
      scan != null && scan.libTick === libTick && Date.now() - scan.at < LOCAL_SCAN_TTL_MS;
    // Caché caliente + sin cambios de biblioteca: reutilizarla. Es el caso del
    // visor, que monta este hook otra vez al abrir una foto y antes repetía el
    // escaneo completo de MediaLibrary.
    if (cached && fresh) {
      setLocalAssets(cached);
      if (isWindowedMode) {
        setLocalCursor(windowedCursorCache.get(scopeKey) ?? null);
        setLocalHasMore(windowedHasMoreCache.get(scopeKey) ?? cached.length >= FIRST_LOCAL_PAGE);
      }
      return;
    }
    const controller = new AbortController();
    void refreshLocal(controller.signal);
    return () => {
      controller.abort();
    };
  }, [refreshLocal, libTick, scopeKey]);

  const query = useTimeline(filter, before);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const tasks: Promise<unknown>[] = [];
    if (localHasMore && !localLoadingMore) {
      tasks.push(loadMoreLocal());
    }
    if (query.hasNextPage && !query.isFetchingNextPage) {
      tasks.push(query.fetchNextPage());
    }
    if (!tasks.length) return;
    loadingMoreRef.current = true;
    try {
      await Promise.allSettled(tasks);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [localHasMore, localLoadingMore, loadMoreLocal, query]);

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
    if (!remoteItems.length) return;
    const queue = getQueueItems();
    if (!queue.length) return;

    const localById = new Map(localAssets.map((a) => [a.id, a]));
    const claimed = new Set<string>();
    const remoteIdBySha = new Map<string, string>();
    for (const r of remoteItems) if (r.sha256) remoteIdBySha.set(r.sha256, r.id);

    // Candidatos a reconciliar: filas `queued` sin sha ni remote_id.
    const candidates = queue.filter((q) => q.state === "queued" && !q.sha256 && !q.remote_id);
    if (!candidates.length) return;

    let cancelled = false;
    void (async () => {
      // Resolver los locals que no están en la ventana actual (modo ventana)
      // consultando MediaLibrary por id, para no depender de cargar toda la
      // biblioteca. El conjunto de candidatos es pequeño (cola de respaldo).
      const resolved: LocalAsset[] = [];
      for (const q of candidates) {
        if (cancelled) return;
        if (q.remote_id) claimed.add(q.remote_id);
        else if (q.sha256) {
          const id = remoteIdBySha.get(q.sha256);
          if (id) claimed.add(id);
        }
        let local = localById.get(q.asset_id);
        if (!local) {
          local = (await getLocalAssetById(q.asset_id)) ?? undefined;
          if (local) localById.set(q.asset_id, local);
        }
        if (local) resolved.push(local);
      }
      if (cancelled || !resolved.length) return;

      const matches = matchLocalToRemote(resolved, remoteItems, claimed);
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
    })();

    return () => {
      cancelled = true;
    };
  }, [remoteItems]);

  const photoByKeyRef = useRef<Map<string, HybridPhoto>>(new Map());

  const queueCacheRef = useRef<{ tick: number; items: ReturnType<typeof getQueueItems> } | null>(
    null,
  );

  const photosCacheRef = useRef<{
    localAssets: LocalAsset[];
    remoteItems: TimelineItem[];
    filter: TimelineFilter;
    albumFilter: AlbumFilter | null;
    syncedAlbumIds: string[] | null | undefined;
    before: string | undefined;
    queueFp: string;
    result: HybridPhoto[];
  } | null>(null);

  // Filtrado de locales memoizado: no depende del tick de la cola, así evita
  // re-filtrar toda la biblioteca en cada emisión de la cola.
  const effectiveLocal = useMemo(() => {
    if (albumFilter?.type === "remote") return [];
    if (albumFilter?.type === "local") {
      return localAssets.filter((a) => a.albumId === albumFilter.albumId);
    }
    if (syncedAlbumIds !== null) {
      return localAssets.filter((a) => a.albumId && syncedAlbumIds.includes(a.albumId));
    }
    return localAssets;
  }, [localAssets, albumFilter, syncedAlbumIds]);

  const photos = useMemo<HybridPhoto[]>(() => {
    void tick; // la cola local se lee en vivo dentro del memo

    // Reutilizar la lectura de la cola si el tick no cambió (evita re-leer
    // hasta 20k filas cuando solo cambian remotos/locales).
    let allQueue: ReturnType<typeof getQueueItems>;
    if (queueCacheRef.current && queueCacheRef.current.tick === tick) {
      allQueue = queueCacheRef.current.items;
    } else {
      allQueue = getQueueItems();
      queueCacheRef.current = { tick, items: allQueue };
    }
    // Fingerprint numérico (barato) en lugar de un string gigante.
    let h = 0;
    for (const q of allQueue) {
      h = (Math.imul(h, 31) + (q.asset_id?.length ?? 0)) >>> 0;
      h = (Math.imul(h, 31) + (q.state?.charCodeAt(0) ?? 0)) >>> 0;
      h = (Math.imul(h, 31) + (q.bytes_sent | 0)) >>> 0;
      h = (Math.imul(h, 31) + (q.remote_id?.length ?? 0)) >>> 0;
    }
    const queueFp = `${allQueue.length}:${h}`;

    const cached = photosCacheRef.current;
    if (
      cached &&
      cached.localAssets === localAssets &&
      cached.remoteItems === remoteItems &&
      cached.filter === filter &&
      cached.albumFilter === albumFilter &&
      cached.syncedAlbumIds === syncedAlbumIds &&
      cached.before === before &&
      cached.queueFp === queueFp
    ) {
      return cached.result;
    }

    // effectiveLocal ya está memoizado fuera (no re-filtrar en cada tick).

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

    // Fase C: reutilizar instancias de HybridPhoto por key cuando los campos
    // visibles no cambian, para que React.memo de las celdas no re-renderice
    // y se reduzcan asignaciones en cada pasada del memo.
    const nextByKey = new Map<string, HybridPhoto>();
    merged = merged.map((p) => {
      const prev = photoByKeyRef.current.get(p.key);
      if (
        prev &&
        prev.syncStatus === p.syncStatus &&
        prev.progress === p.progress &&
        prev.localUri === p.localUri &&
        prev.thumbUrl === p.thumbUrl &&
        prev.remoteId === p.remoteId &&
        prev.takenAt === p.takenAt &&
        prev.mediaType === p.mediaType &&
        prev.width === p.width &&
        prev.height === p.height &&
        prev.durationMs === p.durationMs &&
        prev.thumbhash === p.thumbhash &&
        prev.assetId === p.assetId &&
        prev.albumId === p.albumId
      ) {
        nextByKey.set(p.key, prev);
        return prev;
      }
      nextByKey.set(p.key, p);
      return p;
    });
    photoByKeyRef.current = nextByKey;

    if (albumFilter?.type === "local") {
      // Al filtrar por álbum local, los remotos huérfanos del timeline general ('r-*')
      // no pertenecen a este álbum del dispositivo y deben excluirse.
      merged = merged.filter((p) => !p.key.startsWith("r-"));
    }
    // El `before` del API solo acota los remotos: locales y pendientes de la
    // cola (incluidas las fotos de hoy) se colaban en un mes antiguo.
    merged = filterToBefore(merged, before);
    // Los locales/en-cola no conocen favoritos: bajo ese filtro solo quedan
    // los remotos marcados (y las filas de cola enlazadas a ellos).
    if (filter === "favorites") {
      const result = merged.filter((p) => p.remote?.isFavorite === true);
      photosCacheRef.current = {
        localAssets,
        remoteItems,
        filter,
        albumFilter,
        syncedAlbumIds,
        before,
        queueFp,
        result,
      };
      return result;
    }
    if (filter === "photos") {
      const result = merged.filter((p) => p.mediaType === "photo");
      photosCacheRef.current = {
        localAssets,
        remoteItems,
        filter,
        albumFilter,
        syncedAlbumIds,
        before,
        queueFp,
        result,
      };
      return result;
    }
    if (filter === "videos") {
      const result = merged.filter((p) => p.mediaType === "video");
      photosCacheRef.current = {
        localAssets,
        remoteItems,
        filter,
        albumFilter,
        syncedAlbumIds,
        before,
        queueFp,
        result,
      };
      return result;
    }
    if (filter === "screenshots") {
      const result = merged.filter((p) => p.remote?.isScreenshot === true);
      photosCacheRef.current = {
        localAssets,
        remoteItems,
        filter,
        albumFilter,
        syncedAlbumIds,
        before,
        queueFp,
        result,
      };
      return result;
    }
    if (filter === "documents") {
      const result = merged.filter((p) => p.remote?.isDocument === true);
      photosCacheRef.current = {
        localAssets,
        remoteItems,
        filter,
        albumFilter,
        syncedAlbumIds,
        before,
        queueFp,
        result,
      };
      return result;
    }
    photosCacheRef.current = {
      localAssets,
      remoteItems,
      filter,
      albumFilter,
      syncedAlbumIds,
      before,
      queueFp,
      result: merged,
    };
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
    before,
  ]);

  const rows = useMemo<GalleryRow[]>(() => buildGalleryRows(photos), [photos]);

  return {
    photos,
    rows,
    query,
    refreshLocal,
    remoteAlbumQuery,
    loadMoreLocal,
    loadMore,
    localHasMore,
    localLoadingMore,
  };
}
