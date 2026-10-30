import { MULTIPART_PART_SIZE } from "@photos/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeXhr } from "../test-support/fake-xhr";
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
  backupPaused: false,
  initUploadFailures: new Map<string, { status: number; code: string; message: string }>(),
  multipartInitFailures: new Map<string, { status: number; code: string; message: string }>(),
  needsVerification: false,
  fileSize: 1000,
  multipartInitCalls: 0,
  multipartCompleteCalls: 0,
  completeUploadCalls: 0,
  /** Status por PUT de parte; se consume en orden y por defecto 200. */
  partUploadStatuses: [] as number[],
  partUploads: 0,
  presignCalls: [] as number[][],
  /** Partes ya subidas en el momento de cada presignado (prueba el encadenado). */
  partUploadsAtPresign: [] as number[],
  presignFailStatus: null as number | null,
  cleared: [] as string[],
}));

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    size = h.fileSize;
    constructor(uri: string) {
      this.uri = uri;
    }
    // Lo único que usa upload-part.ts: un Blob perezoso que se materializa a
    // ArrayBuffer. Se devuelve un buffer diminuto: el test no mide memoria.
    slice(_start?: number, _end?: number) {
      return { arrayBuffer: async () => new ArrayBuffer(4) };
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
  cacheDirectory: "file:///cache/",
  readAsStringAsync: async () => "AAAA",
  writeAsStringAsync: async () => {},
  uploadAsync: async (_url: string) => {
    h.partUploads++;
    const status = h.partUploadStatuses.length ? (h.partUploadStatuses.shift() ?? 200) : 200;
    return {
      status,
      headers: status === 200 ? { etag: '"etag-part"' } : {},
    };
  },
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
      initUpload: async (input: { sha256: string }) => {
        const failure = h.initUploadFailures.get(input.sha256);
        if (failure) {
          throw new ApiError(failure.status, failure.code, failure.message);
        }
        return {
          status: "pending",
          id: `remote-${input.sha256}`,
          thumb: { url: "https://r2/thumb", headers: {} },
          original: { url: "https://r2/original", headers: {} },
        };
      },
      completeUpload: async () => {
        h.completeUploadCalls++;
        return {};
      },
      multipartInit: async (input: {
        sha256: string;
        fileSize: number;
        previewSize?: number;
        uploadId?: string;
      }) => {
        h.multipartInitCalls++;
        const failure = h.multipartInitFailures.get(input.sha256);
        if (failure) {
          throw new ApiError(failure.status, failure.code, failure.message);
        }
        const partSize = MULTIPART_PART_SIZE;
        return {
          status: "upload",
          id: `remote-${input.sha256}`,
          uploadId: input.uploadId ?? `up-${input.sha256}-${h.multipartInitCalls}`,
          resumed: Boolean(input.uploadId),
          key: `users/u/originals/${input.sha256}.jpg`,
          partSize,
          totalParts: Math.max(1, Math.ceil(input.fileSize / partSize)),
          expiresAt: new Date().toISOString(),
          thumb: { url: "https://r2/thumb", headers: {} },
          ...(input.previewSize ? { preview: { url: "https://r2/preview", headers: {} } } : {}),
        };
      },
      multipartPresignParts: async ({ partNumbers }: { partNumbers: number[] }) => {
        h.presignCalls.push([...partNumbers]);
        h.partUploadsAtPresign.push(h.partUploads);
        // Solo la primera pasada falla: así se prueba que el reinicio recupera.
        if (h.presignFailStatus !== null && h.presignCalls.length === 1) {
          throw new ApiError(h.presignFailStatus, "upload_id_mismatch", "Sesión distinta.");
        }
        return {
          parts: partNumbers.map((partNumber) => ({
            partNumber,
            url: `https://r2/part/${partNumber}`,
          })),
        };
      },
      multipartComplete: async () => {
        h.multipartCompleteCalls++;
        return { id: "remote", status: "ready" };
      },
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
  makePreview: async () => ({ uri: "file:///preview.webp", bytes: 20 }),
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
  isBackupPaused: () => h.backupPaused,
  recoverInterrupted: async () => {},
  setState: async (assetId: string, state: QueueState, extra?: { last_error?: string | null }) => {
    const item = h.pending.find((i) => i.asset_id === assetId);
    if (item) {
      item.state = state;
      if (extra?.last_error !== undefined) {
        item.last_error = extra.last_error;
      }
    }
    if ((state === "done" || state === "duplicate") && !h.finished.includes(assetId)) {
      h.finished.push(assetId);
    }
  },
  finishItem: async (assetId: string, state: "done" | "duplicate") => {
    const item = h.pending.find((i) => i.asset_id === assetId);
    if (item) item.state = state;
    if (!h.finished.includes(assetId)) h.finished.push(assetId);
  },
  clearMultipartState: async (assetId: string) => {
    h.cleared.push(assetId);
  },
  setItemHash: async () => {},
  bumpAttempt: async () => {},
  setNextRetryAt: async () => {},
  setBackupPaused: (paused: boolean) => {
    h.backupPaused = paused;
  },
  setNeedsEmailVerification: (needed: boolean) => {
    h.needsVerification = needed;
  },
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

let fakeXhr: ReturnType<typeof installFakeXhr> | null = null;

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
  h.backupPaused = false;
  h.initUploadFailures.clear();
  h.multipartInitFailures.clear();
  h.needsVerification = false;
  h.fileSize = 1000;
  h.multipartInitCalls = 0;
  h.multipartCompleteCalls = 0;
  h.completeUploadCalls = 0;
  h.partUploadStatuses = [];
  h.partUploads = 0;
  h.presignCalls = [];
  h.partUploadsAtPresign = [];
  h.presignFailStatus = null;
  h.cleared = [];
  // Las partes ya no se suben con uploadAsync: van por XHR (upload-part.ts).
  fakeXhr = installFakeXhr(() => {
    h.partUploads++;
    const status = h.partUploadStatuses.length ? (h.partUploadStatuses.shift() ?? 200) : 200;
    return status === 200 ? { status, etag: '"etag-part"' } : { status };
  });
});

afterEach(() => {
  fakeXhr?.restore();
  fakeXhr = null;
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

  it("un vídeo > 5 GB (413 file_too_large) se marca como fallido sin pausar el resto de la cola", async () => {
    const hugeVideo = makeItem("video-huge");
    hugeVideo.media_type = "video";
    const normalPhoto = makeItem("photo-normal");
    h.pending = [hugeVideo, normalPhoto];

    h.initUploadFailures.set("sha-file:///video-huge.jpg", {
      status: 413,
      code: "file_too_large",
      message: "El archivo supera el máximo permitido (5 GB).",
    });

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(hugeVideo.state).toBe("failed");
    expect(hugeVideo.last_error).toBe("file_too_large");
    expect(h.backupPaused).toBe(false);
    expect(normalPhoto.state).toBe("done");
    expect(h.finished).toContain("photo-normal");
  });

  it("403 email_unverified no se trata como sesión: reencola con motivo y pausa el respaldo", async () => {
    h.fileSize = 21 * 1024 * 1024;
    h.pending = [makeItem("video-unverified")];
    h.multipartInitFailures.set("sha-file:///video-unverified.jpg", {
      status: 403,
      code: "email_unverified",
      message: "Debes verificar tu correo electrónico.",
    });

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.pending[0].state).toBe("queued");
    expect(h.pending[0].last_error).toContain("verificar");
    expect(h.backupPaused).toBe(true);
    expect(h.needsVerification).toBe(true);
    expect(h.finished).toEqual([]);
  });

  it("un archivo > 20 MB completa con multipartComplete, no con completeUpload", async () => {
    h.fileSize = 21 * 1024 * 1024;
    h.pending = [makeItem("video-big")];

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.multipartInitCalls).toBe(1);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(h.completeUploadCalls).toBe(0);
    expect(h.pending[0].state).toBe("done");
  });
});

describe("processQueue nativo: reanudación multipart y sesiones muertas", () => {
  it("reanuda una sesión viva: solo presigna y sube las partes que faltan", async () => {
    h.fileSize = 40 * 1024 * 1024; // 3 partes de 16 MiB
    const item = makeItem("video-resume");
    item.upload_id = "up-existente";
    item.parts = JSON.stringify([{ partNumber: 1, etag: '"e1"' }]);
    h.pending = [item];

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.cleared).toEqual([]);
    expect(h.multipartInitCalls).toBe(1);
    expect(h.presignCalls).toEqual([[2, 3]]);
    expect(h.partUploads).toBe(2);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(item.state).toBe("done");
  });

  it("un 404 en una parte descarta el journal y completa con una sesión nueva", async () => {
    h.fileSize = 40 * 1024 * 1024; // 3 partes de 16 MiB
    const item = makeItem("video-muerta");
    item.upload_id = "up-muerta";
    item.parts = JSON.stringify([{ partNumber: 1, etag: '"e1"' }]);
    h.pending = [item];
    // 1.ª pasada: la parte 2 devuelve 404 NoSuchUpload. 2.ª pasada: todo 200.
    h.partUploadStatuses = [404];

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.cleared).toEqual(["video-muerta"]);
    expect(h.multipartInitCalls).toBe(2);
    expect(h.presignCalls).toEqual([
      [2, 3],
      [1, 2, 3],
    ]);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(item.state).toBe("done");
  });

  it("un 409 al presignar también se trata como sesión muerta", async () => {
    h.fileSize = 21 * 1024 * 1024;
    const item = makeItem("video-409");
    item.upload_id = "up-de-otro-dispositivo";
    h.pending = [item];
    h.presignFailStatus = 409;

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.cleared).toEqual(["video-409"]);
    expect(h.multipartInitCalls).toBe(2);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(item.state).toBe("done");
  });

  it("si dos pasadas seguidas dan 404 el intento corta y el siguiente completa la copia", async () => {
    h.fileSize = 21 * 1024 * 1024;
    const item = makeItem("video-siempre-404");
    item.upload_id = "up-muerta";
    h.pending = [item];
    h.partUploadStatuses = [404, 404];

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    // Cada intento hace como máximo 2 inits (la original + la reiniciada) y el
    // reintento externo acota el resto: no hay inits sin fin. Cuando R2 deja de
    // devolver 404 la copia termina, así que el fallo no es permanente.
    expect(h.multipartInitCalls).toBeGreaterThanOrEqual(2);
    expect(h.multipartInitCalls).toBeLessThanOrEqual(6);
    expect(h.cleared.length).toBeGreaterThanOrEqual(1);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(item.state).toBe("done");
    expect(h.backupPaused).toBe(false);
  });

  it("prefirma de 12 en 12 y sube cada lote antes de firmar el siguiente", async () => {
    h.fileSize = 200 * 1024 * 1024; // 13 partes de 16 MiB
    const item = makeItem("video-200mb");
    h.pending = [item];

    const processor = await importNativeProcessor();
    await processor.processQueue({ concurrency: 1, skipBatchPrehash: true });

    expect(h.presignCalls).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [13]]);
    // Cada presignado ocurre cuando el lote anterior ya está subido: ninguna URL
    // espera 900 s a que le llegue el turno.
    expect(h.partUploadsAtPresign).toEqual([0, 12]);
    expect(h.partUploads).toBe(13);
    expect(h.multipartCompleteCalls).toBe(1);
    expect(item.state).toBe("done");
  });
});
