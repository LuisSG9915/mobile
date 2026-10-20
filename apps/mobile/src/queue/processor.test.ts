import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem, QueueState } from "./types";

/**
 * Tests del pool de `processQueue` NATIVO (processor.ts). vitest resuelve
 * "./processor" a processor.web.ts, así que se importa la ruta literal.
 *
 * Todo el I/O (SQLite, MediaLibrary, FileSystem, API) está mockeado: el test
 * mide el scheduling — cuántas subidas conviven y que ningún asset se repita.
 */

type MockItem = QueueItem & { state: QueueState };

const h = vi.hoisted(() => ({
  pending: [] as MockItem[],
  activeUploads: 0,
  maxActiveUploads: 0,
  finished: [] as string[],
  queuedWithoutHashCalls: 0,
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    size = 1000;
    constructor(uri: string) {
      this.uri = uri;
    }
    delete() {}
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  createUploadTask: (
    _url: string,
    _file: string,
    _opts: unknown,
    onProgress?: (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void,
  ) => {
    h.activeUploads++;
    h.maxActiveUploads = Math.max(h.maxActiveUploads, h.activeUploads);
    return {
      uploadAsync: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        onProgress?.({ totalBytesSent: 1000, totalBytesExpectedToSend: 1000 });
        h.activeUploads--;
        return { status: 200 };
      },
      cancelAsync: async () => {
        h.activeUploads = Math.max(0, h.activeUploads - 1);
      },
    };
  },
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  FileSystemSessionType: { BACKGROUND: 0 },
}));

vi.mock("expo-media-library/legacy", () => ({
  getAssetInfoAsync: async (id: string) => ({
    localUri: `file:///${id}.jpg`,
    exif: null,
    location: null,
    width: 100,
    height: 100,
    duration: 0,
  }),
}));

vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ type: "wifi", isConnected: true }),
  NetworkStateType: { WIFI: "wifi", ETHERNET: "ethernet" },
}));

vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));

vi.mock("../api/client", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    api: {
      checkHashes: async () => ({ existing: [] }),
      initUpload: async (input: { sha256: string }) => ({
        status: "pending",
        id: `remote-${input.sha256}`,
        thumb: { url: "https://r2/thumb", headers: {} },
        original: { url: "https://r2/original", headers: {} },
      }),
      completeUpload: async () => ({}),
    },
  };
});

vi.mock("../lib/events", () => ({
  useQueueEvents: { getState: () => ({ emit: () => {} }) },
}));

vi.mock("../lib/query-client", () => ({
  queryClient: { invalidateQueries: async () => {} },
}));

vi.mock("../lib/store", () => ({
  useSettings: { getState: () => ({ wifiOnly: false, syncedAlbumIds: null }) },
  useItemProgress: { getState: () => ({ clearItemProgress: () => {} }) },
}));

vi.mock("./progress", () => ({
  publishByteTick: () => {},
  publishSyncProgress: () => {},
}));

vi.mock("./hash", () => ({
  sha256File: async (uri: string) => `sha-${uri}`,
}));

vi.mock("./thumb", () => ({
  makeThumbAndHash: async () => ({ uri: "file:///thumb.webp", bytes: 10, thumbhash: "hash" }),
}));

vi.mock("./db", () => ({
  getQueueDb: () => ({ runSync: () => {}, getFirstSync: () => null }),
  getNextPending: (opts?: { excludeAssetId?: string; excludeAssetIds?: string[] }) => {
    const excluded = new Set(opts?.excludeAssetIds ?? []);
    if (opts?.excludeAssetId) excluded.add(opts.excludeAssetId);
    return h.pending.find((i) => i.state === "queued" && !excluded.has(i.asset_id)) ?? null;
  },
  getQueuedWithoutHash: () => {
    h.queuedWithoutHashCalls++;
    return [];
  },
  getQueuedWithSha: () => [],
  isBackupPaused: () => false,
  recoverInterrupted: async () => {},
  setState: async (assetId: string, state: QueueState) => {
    const item = h.pending.find((i) => i.asset_id === assetId);
    if (item) item.state = state;
    if ((state === "done" || state === "duplicate") && !h.finished.includes(assetId)) {
      h.finished.push(assetId);
    }
  },
  finishItem: async (assetId: string, state: "done" | "duplicate") => {
    const item = h.pending.find((i) => i.asset_id === assetId);
    if (item) item.state = state;
    if (!h.finished.includes(assetId)) h.finished.push(assetId);
  },
  setItemHash: async () => {},
  bumpAttempt: async () => {},
  setNextRetryAt: async () => {},
  setBackupPaused: () => {},
}));

function makeItem(id: string): MockItem {
  return {
    asset_id: id,
    uri: `file:///${id}.jpg`,
    filename: `${id}.jpg`,
    media_type: "photo",
    created_at: 1_000,
    state: "queued",
    sha256: null,
    remote_id: null,
    attempts: 0,
    last_error: null,
    bytes_total: 0,
    bytes_sent: 0,
    updated_at: 1_000,
  };
}

type NativeProcessor = typeof import("./processor");

async function importNativeProcessor(): Promise<NativeProcessor> {
  vi.resetModules();
  // @ts-expect-error -- ruta con extensión para saltar la resolución *.web.ts
  return await import("./processor.ts");
}

beforeEach(() => {
  h.pending = [];
  h.activeUploads = 0;
  h.maxActiveUploads = 0;
  h.finished = [];
  h.queuedWithoutHashCalls = 0;
});

describe("processQueue nativo: concurrencia", () => {
  it("con concurrency 3 mantiene 3 subidas simultáneas y procesa cada asset una vez", async () => {
    h.pending = ["a", "b", "c", "d", "e", "f"].map(makeItem);
    const processor = await importNativeProcessor();

    await processor.processQueue({ concurrency: 3 });

    expect(h.maxActiveUploads).toBe(3);
    expect(h.finished.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(h.pending.every((i) => i.state === "done")).toBe(true);
  });

  it("con concurrency 1 es secuencial (una subida a la vez)", async () => {
    h.pending = ["a", "b", "c"].map(makeItem);
    const processor = await importNativeProcessor();

    await processor.processQueue();

    expect(h.maxActiveUploads).toBe(1);
    expect(h.finished).toHaveLength(3);
  });

  it("skipBatchPrehash evita el pre-hasheo por lotes", async () => {
    h.pending = [makeItem("a")];
    const processor = await importNativeProcessor();

    await processor.processQueue({ concurrency: 3, skipBatchPrehash: true });

    expect(h.queuedWithoutHashCalls).toBe(0);
    expect(h.finished).toEqual(["a"]);
  });

  it("sin skipBatchPrehash el lote inicial sí se consulta", async () => {
    h.pending = [makeItem("a")];
    const processor = await importNativeProcessor();

    await processor.processQueue();

    expect(h.queuedWithoutHashCalls).toBeGreaterThan(0);
  });

  it("no arranca una segunda pasada si ya hay una en curso", async () => {
    h.pending = ["a", "b"].map(makeItem);
    const processor = await importNativeProcessor();

    const first = processor.processQueue({ concurrency: 2 });
    const second = processor.processQueue({ concurrency: 2 });
    await Promise.all([first, second]);

    expect(h.finished).toHaveLength(2);
    expect(new Set(h.finished).size).toBe(2);
  });
});
