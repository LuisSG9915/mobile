import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status =
          error && typeof error === "object" && "status" in error
            ? (error as { status: unknown }).status
            : undefined;
        if (typeof status === "number" && [401, 403, 404].includes(status)) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

export const MEDIA_LIFECYCLE_QUERY_KEYS = [
  ["storage"],
  ["user-storage"],
  ["timeline"],
  ["timeline-months"],
  ["trash"],
  ["albums"],
  ["search"],
  ["locations"],
  ["memories"],
] as const;

/**
 * Invalida simultáneamente las queries afectadas por mutaciones en el ciclo de vida
 * de un medio (borrado, restauración, vaciado de papelera o limpieza).
 */
export async function invalidateMediaLifecycleQueries(
  qc: QueryClient = queryClient,
): Promise<void> {
  await Promise.all(
    MEDIA_LIFECYCLE_QUERY_KEYS.map((queryKey) =>
      qc.invalidateQueries({ queryKey }).catch(() => {}),
    ),
  );
}

// ---------- Bloque 4: persistencia offline-first en disco ----------

import {
  type DehydratedState,
  dehydrate,
  hydrate,
  QueryClient as QC,
  type Query,
} from "@tanstack/react-query";
// expo-file-system se importa de forma diferida para no forzar su parseo en Vitest

export const OFFLINE_CACHE_VERSION = 1;
export const OFFLINE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const PERSISTABLE_QUERY_PREFIXES = new Set([
  "timeline",
  "albums",
  "memories",
  "locations",
  "storage-stats",
  "favorites",
]);

export interface PersistedQueryEnvelope {
  version: number;
  timestamp: number;
  state: DehydratedState;
}

export interface OfflineStorageAdapter {
  read(): Promise<string | null>;
  write(payload: string): Promise<void>;
  clear(): Promise<void>;
}

async function getCacheFileUri(): Promise<string | null> {
  if (typeof window !== "undefined") return null;
  try {
    const FileSystem = await import("expo-file-system");
    const dir = (FileSystem as any).documentDirectory;
    if (!dir) return null;
    return `${dir}rq_offline_cache_v${OFFLINE_CACHE_VERSION}.json`;
  } catch {
    return null;
  }
}

export const defaultFileStorageAdapter: OfflineStorageAdapter = {
  async read() {
    const uri = await getCacheFileUri();
    if (!uri) return null;
    try {
      const FileSystem = await import("expo-file-system");
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(uri);
    } catch {
      return null;
    }
  },
  async write(payload: string) {
    const uri = await getCacheFileUri();
    if (!uri) return;
    try {
      const FileSystem = await import("expo-file-system");
      const tmpUri = `${uri}.tmp`;
      await FileSystem.writeAsStringAsync(tmpUri, payload);
      await FileSystem.moveAsync({ from: tmpUri, to: uri });
    } catch {}
  },
  async clear() {
    const uri = await getCacheFileUri();
    if (!uri) return;
    try {
      const FileSystem = await import("expo-file-system");
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {}
  },
};

export function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;
  const rootKey = query.queryKey[0];
  if (typeof rootKey !== "string") return false;
  return PERSISTABLE_QUERY_PREFIXES.has(rootKey);
}

export function createAppQueryClient(): QC {
  return new QC({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2,
        gcTime: 1000 * 60 * 60 * 24,
        retry: 2,
        refetchOnReconnect: true,
      },
    },
  });
}

export async function hydrateQueryClientFromDisk(
  client: QC = queryClient,
  adapter: OfflineStorageAdapter = defaultFileStorageAdapter,
  maxAgeMs = OFFLINE_CACHE_MAX_AGE_MS,
): Promise<boolean> {
  const raw = await adapter.read();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as PersistedQueryEnvelope;
    if (
      !parsed ||
      parsed.version !== OFFLINE_CACHE_VERSION ||
      typeof parsed.timestamp !== "number" ||
      !parsed.state
    ) {
      await adapter.clear();
      return false;
    }
    if (Date.now() - parsed.timestamp > maxAgeMs) {
      await adapter.clear();
      return false;
    }
    hydrate(client, parsed.state);
    return true;
  } catch {
    await adapter.clear();
    return false;
  }
}

export function setupQueryClientPersistence(
  client: QC = queryClient,
  adapter: OfflineStorageAdapter = defaultFileStorageAdapter,
  debounceMs = 800,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flushToDisk = async () => {
    try {
      const state = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
      const envelope: PersistedQueryEnvelope = {
        version: OFFLINE_CACHE_VERSION,
        timestamp: Date.now(),
        state,
      };
      await adapter.write(JSON.stringify(envelope));
    } catch {}
  };
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    if (!shouldPersistQuery(event.query)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flushToDisk();
    }, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export async function clearPersistedQueryCache(
  client: QC = queryClient,
  adapter: OfflineStorageAdapter = defaultFileStorageAdapter,
): Promise<void> {
  client.clear();
  await adapter.clear();
}
