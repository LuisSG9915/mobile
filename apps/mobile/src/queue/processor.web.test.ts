import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { QueueItem } from "./db";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      m: string,
    ) {
      super(m);
    }
  },
  api: { initUpload: vi.fn(), completeUpload: vi.fn(), checkHashes: vi.fn() },
}));
vi.mock("../web/hash", () => ({ sha256File: vi.fn(async () => "a".repeat(64)) }));
vi.mock("../web/thumb", () => ({
  makeThumb: vi.fn(async () => ({
    blob: new Blob(["t"], { type: "image/webp" }),
    bytes: 1,
    thumbhash: "AQAAAA==",
    width: 10,
    height: 8,
  })),
}));
vi.mock("../web/upload", () => ({ uploadBlob: vi.fn(async () => {}) }));
vi.mock("../lib/query-client", () => ({
  queryClient: { invalidateQueries: vi.fn(async () => {}) },
}));
vi.mock("../web/files", () => {
  const m = new Map<string, File>();
  return {
    __files: m,
    // El processor ya no borra archivos: eso lo hace finishItem en la tx de IDB.
    getFile: vi.fn(async (id: string) => m.get(id)),
  };
});

// db.web.ts proyecta los Row en un Map hidratado desde IndexedDB; el item que
// retorna getNextPending refleja los cambios de estado (incluido
// next_retry_at, que no forma parte del tipo QueueItem).
type Row = QueueItem & { next_retry_at: number };

type FilesModuleMock = {
  __files: Map<string, File>;
  getFile: Mock;
};
type ApiClientMock = {
  api: { initUpload: Mock; completeUpload: Mock; checkHashes: Mock };
  ApiError: new (status: number, code: string, message: string) => Error;
};

let db: typeof import("./db");
let store: typeof import("../web/queue-store");
let processor: typeof import("./processor");
let filesMock: FilesModuleMock;
let apiMock: ApiClientMock;
let uploadBlobMock: Mock;
let queryClientMock: { invalidateQueries: Mock };

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("photos.queue");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("deleteDatabase bloqueado: quedó una conexión abierta"));
  });
}

beforeEach(async () => {
  // Cierra la conexión IDB del test anterior antes de borrar la BD.
  const prev = await import("./db");
  await prev.closeQueue().catch(() => {});
  await deleteDb();
  vi.resetModules();
  localStorage.clear();
  db = await import("./db");
  store = await import("../web/queue-store");
  await db.initializeQueue("u1");
  processor = await import("./processor");
  filesMock = (await import("../web/files")) as unknown as FilesModuleMock;
  apiMock = (await import("../api/client")) as unknown as ApiClientMock;
  uploadBlobMock = ((await import("../web/upload")) as { uploadBlob: Mock }).uploadBlob;
  queryClientMock = (
    (await import("../lib/query-client")) as unknown as {
      queryClient: { invalidateQueries: Mock };
    }
  ).queryClient;
  // vi.resetModules() no vuelve a ejecutar las factorías de vi.mock: los vi.fn
  // y el Map persisten entre tests → hay que limpiarlos a mano.
  apiMock.api.initUpload.mockReset();
  apiMock.api.completeUpload.mockReset();
  apiMock.api.checkHashes.mockReset();
  apiMock.api.checkHashes.mockResolvedValue({ existing: [] });
  uploadBlobMock.mockReset();
  queryClientMock.invalidateQueries.mockReset();
  queryClientMock.invalidateQueries.mockResolvedValue(undefined);
  filesMock.getFile.mockClear();
  filesMock.__files.clear();
});

async function encolar(
  id: string,
  filename = "foto.png",
  creationTime = 1,
  file?: File,
): Promise<Row> {
  await db.enqueueAsset({ id, uri: id, filename, mediaType: "photo", creationTime }, file);
  const row = db.getNextPending() as Row | null;
  if (!row) throw new Error("No se encoló el item");
  return row;
}

function initRespuestaUpload(id = "r1") {
  return {
    status: "upload" as const,
    id,
    expiresAt: 1,
    thumb: { url: "t", headers: {} },
    original: { url: "o", headers: {} },
  };
}

describe("processQueue", () => {
  it("sube miniatura y original y completa el item (done)", async () => {
    const file = new File(["contenido"], "foto.png", {
      type: "image/png",
      lastModified: 12_345,
    });
    const row = await encolar("web-1", "foto.png", 12_345, file);
    filesMock.__files.set("web-1", file);
    apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r1"));
    apiMock.api.completeUpload.mockResolvedValue({ id: "r1", status: "ready" });

    await processor.processQueue();

    expect(apiMock.api.initUpload).toHaveBeenCalledTimes(1);
    expect(apiMock.api.initUpload).toHaveBeenCalledWith(
      {
        sha256: "a".repeat(64),
        ext: "png",
        mediaType: "photo",
        mimeType: "image/png",
        fileSize: file.size,
        thumbSize: 1,
        takenAt: 12_345,
        width: 10,
        height: 8,
        durationMs: null,
        thumbhash: "AQAAAA==",
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(uploadBlobMock).toHaveBeenCalledTimes(2);
    expect(uploadBlobMock.mock.calls[0][0]).toEqual({ url: "t", headers: {} });
    expect(uploadBlobMock.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(uploadBlobMock.mock.calls[1][0]).toEqual({ url: "o", headers: {} });
    expect(uploadBlobMock.mock.calls[1][1]).toBe(file);
    expect(uploadBlobMock.mock.calls[1][3]).toBeInstanceOf(AbortSignal);
    expect(apiMock.api.completeUpload).toHaveBeenCalledWith("r1", {
      signal: expect.any(AbortSignal),
    });
    expect(row.state).toBe("done");
    // finishItem borró el blob de IndexedDB en la misma transacción terminal.
    expect(await store.loadFile("u1", "web-1")).toBeUndefined();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["timeline"] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
  });

  it("marca duplicate sin subir nada cuando el servidor ya lo tiene", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    const row = await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    apiMock.api.initUpload.mockResolvedValue({ status: "duplicate", id: "r2" });

    await processor.processQueue();

    expect(row.state).toBe("duplicate");
    expect(uploadBlobMock).not.toHaveBeenCalled();
    expect(apiMock.api.completeUpload).not.toHaveBeenCalled();
    expect(await store.loadFile("u1", "web-1")).toBeUndefined();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["timeline"] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["stats"] });
  });

  it("checkHashes hit → duplicate sin miniatura ni PUTs (dedup temprana)", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    const row = await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    apiMock.api.checkHashes.mockResolvedValue({
      existing: [{ sha256: "a".repeat(64), id: "r9" }],
    });
    // El mock persiste entre tests (las factorías no se re-ejecutan): limpiar.
    const makeThumb = ((await import("../web/thumb")) as { makeThumb: Mock }).makeThumb;
    makeThumb.mockClear();

    await processor.processQueue();

    expect(row.state).toBe("duplicate");
    expect(row.sha256).toBe("a".repeat(64));
    expect(row.remote_id).toBe("r9");
    expect(row.bytes_sent).toBe(file.size);
    // No se generó miniatura, no hubo init ni PUTs y el blob se borró de IDB.
    expect(makeThumb).not.toHaveBeenCalled();
    expect(apiMock.api.initUpload).not.toHaveBeenCalled();
    expect(uploadBlobMock).not.toHaveBeenCalled();
    expect(apiMock.api.completeUpload).not.toHaveBeenCalled();
    expect(await store.loadFile("u1", "web-1")).toBeUndefined();
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["timeline"] });
  });

  it("si checkHashes falla (sin red) sigue el flujo normal: /init deduplica", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    const row = await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    apiMock.api.checkHashes.mockRejectedValue(new Error("offline"));
    apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r2"));
    apiMock.api.completeUpload.mockResolvedValue({ id: "r2", status: "ready" });

    await processor.processQueue();

    expect(apiMock.api.initUpload).toHaveBeenCalledTimes(1);
    expect(row.state).toBe("done");
  });

  it("marca failed si el File ya no está disponible", async () => {
    const row = await encolar("web-1");

    await processor.processQueue();

    expect(row.state).toBe("failed");
    expect(row.last_error).toBe("El archivo ya no está disponible. Vuelve a seleccionarlo.");
    expect(apiMock.api.initUpload).not.toHaveBeenCalled();
  });

  it("reintenta con backoff cuando completeUpload falla", async () => {
    const NOW = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    try {
      const file = new File(["x"], "foto.png", { type: "image/png" });
      const row = await encolar("web-1", "foto.png", 1, file);
      filesMock.__files.set("web-1", file);
      apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r1"));
      apiMock.api.completeUpload.mockRejectedValue(
        new apiMock.ApiError(409, "object_missing", "Falta la miniatura en el almacenamiento."),
      );

      await processor.processQueue();

      expect(row.state).toBe("queued");
      expect(row.attempts).toBe(1);
      expect(row.last_error).toBe("Falta la miniatura en el almacenamiento.");
      expect(row.next_retry_at).toBe(NOW + 60_000);
      expect(queryClientMock.invalidateQueries).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("marca failed tras agotar los 6 reintentos", async () => {
    let now = 1_800_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const file = new File(["x"], "foto.png", { type: "image/png" });
      const row = await encolar("web-1", "foto.png", 1, file);
      filesMock.__files.set("web-1", file);
      apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r1"));
      apiMock.api.completeUpload.mockRejectedValue(
        new apiMock.ApiError(500, "boom", "Fallo del servidor."),
      );

      for (let i = 0; i < 6; i++) {
        now = row.next_retry_at + 1;
        await processor.processQueue();
      }

      expect(row.state).toBe("failed");
      expect(row.attempts).toBe(6);
      expect(row.last_error).toBe("Fallo del servidor.");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("ignora llamadas simultáneas (una pasada por item)", async () => {
    await encolar("web-1", "a.png", 1);
    await encolar("web-2", "b.png", 2);
    filesMock.__files.set("web-1", new File(["a"], "a.png", { type: "image/png" }));
    filesMock.__files.set("web-2", new File(["b"], "b.png", { type: "image/png" }));
    apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r1"));
    apiMock.api.completeUpload.mockResolvedValue({ id: "r1", status: "ready" });

    await Promise.all([processor.processQueue(), processor.processQueue()]);

    expect(apiMock.api.initUpload).toHaveBeenCalledTimes(2);
    expect(db.getQueueStats()).toEqual({ total: 2, done: 2, pending: 0, failed: 0 });
    expect(processor.isRunning()).toBe(false);
  });

  it("completa el item aunque invalidateQueries lance de forma síncrona", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    const row = await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    apiMock.api.initUpload.mockResolvedValue(initRespuestaUpload("r1"));
    apiMock.api.completeUpload.mockResolvedValue({ id: "r1", status: "ready" });
    // El refresco de queries nunca debe convertir un done en retry.
    queryClientMock.invalidateQueries.mockImplementation(() => {
      throw new Error("boom");
    });

    try {
      await processor.processQueue();

      expect(apiMock.api.completeUpload).toHaveBeenCalledWith("r1", {
        signal: expect.any(AbortSignal),
      });
      expect(row.state).toBe("done");
      expect(await store.loadFile("u1", "web-1")).toBeUndefined();
    } finally {
      queryClientMock.invalidateQueries.mockReset();
      queryClientMock.invalidateQueries.mockResolvedValue(undefined);
    }
  });

  it("con el contexto cerrado no procesa ni lanza", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    await db.closeQueue();

    await processor.processQueue();

    expect(apiMock.api.initUpload).not.toHaveBeenCalled();
    expect(processor.isRunning()).toBe(false);
  });

  it("cancelQueue a mitad de pasada deja el item queued sin consumir intento", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    const row = await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    // init queda en vuelo hasta que el test lo resuelva (el abort llega antes).
    let resolveInit!: (v: ReturnType<typeof initRespuestaUpload>) => void;
    apiMock.api.initUpload.mockImplementation(
      () => new Promise((res) => (resolveInit = res as typeof resolveInit)),
    );

    const pass = processor.processQueue();
    await vi.waitFor(() => expect(apiMock.api.initUpload).toHaveBeenCalled());

    processor.cancelQueue();
    resolveInit(initRespuestaUpload("r1"));
    await pass;

    // La cancelación no es un fallo: ni intento consumido ni backoff.
    expect(row.state).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.next_retry_at).toBe(0);
    expect(uploadBlobMock).not.toHaveBeenCalled();
    expect(apiMock.api.completeUpload).not.toHaveBeenCalled();
    expect(processor.isRunning()).toBe(false);
  });

  it("con la pausa persistente activada no toma ningún item (sin auto-resume)", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    db.setBackupPaused(true);
    try {
      await processor.processQueue();

      expect(apiMock.api.initUpload).not.toHaveBeenCalled();
      expect(db.getNextPending()?.asset_id).toBe("web-1");
      expect(processor.isRunning()).toBe(false);
    } finally {
      db.setBackupPaused(false);
    }
  });

  it("pausar a mitad de pasada deja terminar el item en vuelo y frena el siguiente", async () => {
    const f1 = new File(["a"], "a.png", { type: "image/png" });
    const f2 = new File(["b"], "b.png", { type: "image/png" });
    // OJO: encolar devuelve siempre el primer pendiente (web-1); para web-2
    // hay que buscar su fila en la proyección tras la pasada.
    await encolar("web-1", "a.png", 1, f1);
    await encolar("web-2", "b.png", 2, f2);
    filesMock.__files.set("web-1", f1);
    filesMock.__files.set("web-2", f2);
    apiMock.api.completeUpload.mockResolvedValue({ id: "r1", status: "ready" });
    // La pausa se activa durante el init del primer item: debe terminar y cortar.
    apiMock.api.initUpload.mockImplementation(async () => {
      db.setBackupPaused(true);
      return initRespuestaUpload("r1");
    });
    try {
      await processor.processQueue();

      const stateOf = (id: string) => db.getQueueItems().find((i) => i.asset_id === id)?.state;
      expect(stateOf("web-1")).toBe("done");
      expect(stateOf("web-2")).toBe("queued");
      expect(apiMock.api.initUpload).toHaveBeenCalledTimes(1);
    } finally {
      db.setBackupPaused(false);
    }
  });

  it("si otra pestaña tiene el lock (ifAvailable → null) no procesa", async () => {
    const file = new File(["x"], "foto.png", { type: "image/png" });
    await encolar("web-1", "foto.png", 1, file);
    filesMock.__files.set("web-1", file);
    const requestSpy = vi
      .spyOn(navigator.locks, "request")
      .mockImplementation(((_n: string, _o: unknown, cb: (lock: unknown) => unknown) =>
        Promise.resolve(cb(null))) as typeof navigator.locks.request);
    try {
      await processor.processQueue();
      expect(apiMock.api.initUpload).not.toHaveBeenCalled();
      expect(db.getNextPending()?.asset_id).toBe("web-1");
      expect(processor.isRunning()).toBe(false);
    } finally {
      requestSpy.mockRestore();
    }
  });
});
