import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "./types";

// db.web.ts usa IndexedDB (fake-indexeddb, instalado en vitest.setup.ts) como
// fuente de verdad y proyecta metadatos en un Map. Entre tests hay que cerrar
// la conexión del módulo anterior, borrar la BD y recargar los módulos.
let db: typeof import("./db");
let store: typeof import("../web/queue-store");

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
  // El módulo del test anterior aún tiene la conexión IDB abierta: cerrarla
  // ANTES de borrar la BD y de resetear los módulos.
  const prev = await import("./db");
  await prev.closeQueue().catch(() => {});
  await deleteDb();
  vi.resetModules();
  localStorage.clear();
  db = await import("./db");
  store = await import("../web/queue-store");
  await db.initializeQueue("u1");
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Row = QueueItem & { next_retry_at: number };

describe("kvSet/kvGet", () => {
  it("guarda en localStorage con el prefijo photos.kv.", () => {
    db.kvSet("wifi_only", "1");
    expect(localStorage.getItem("photos.kv.wifi_only")).toBe("1");
    expect(db.kvGet("wifi_only")).toBe("1");
  });

  it("devuelve null para una clave inexistente", () => {
    expect(db.kvGet("no_existe")).toBeNull();
  });
});

describe("pausa persistente", () => {
  it("por defecto no está pausada", () => {
    expect(db.isBackupPaused()).toBe(false);
  });

  it("setBackupPaused persiste en photos.kv.backup.paused y se puede quitar", () => {
    db.setBackupPaused(true);
    expect(localStorage.getItem("photos.kv.backup.paused")).toBe("1");
    expect(db.isBackupPaused()).toBe(true);
    db.setBackupPaused(false);
    expect(db.isBackupPaused()).toBe(false);
  });

  it("sobrevive al cierre y reapertura de la cola (no auto-resume)", async () => {
    db.setBackupPaused(true);
    await db.closeQueue();
    await db.initializeQueue("u1");
    expect(db.isBackupPaused()).toBe(true);
    db.setBackupPaused(false);
  });
});

describe("enqueueAsset", () => {
  it("ignora ids repetidos", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    expect(db.getQueueStats().total).toBe(1);
    expect(await store.loadItems("u1")).toHaveLength(1);
  });

  it("persiste la fila y el archivo en la misma transacción", async () => {
    const file = new File(["contenido-jpg"], "foto.jpg", {
      type: "image/jpeg",
      lastModified: 123_456,
    });
    await db.enqueueAsset(
      { id: "a", uri: "a", filename: "foto.jpg", mediaType: "photo", creationTime: 100 },
      file,
    );

    const row = await store.loadFile("u1", "a");
    expect(row).toBeDefined();
    expect(row?.name).toBe("foto.jpg");
    expect(row?.type).toBe("image/jpeg");
    expect(row?.lastModified).toBe(123_456);
    expect(new Uint8Array(row?.data ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(await file.arrayBuffer()),
    );
    expect(await store.loadItems("u1")).toHaveLength(1);
  });

  it("no deja la fila encolada si falla la escritura del archivo", async () => {
    // Simula QuotaExceededError en el store de archivos: la tx items+files
    // aborta entera y ni la fila ni el blob quedan persistidos.
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "files") {
        throw new DOMException("The operation exceeded quota", "QuotaExceededError");
      }
      return original.call(this, value, key);
    });
    try {
      const file = new File(["x".repeat(1024)], "grande.jpg", { type: "image/jpeg" });
      await expect(
        db.enqueueAsset(
          { id: "a", uri: "a", filename: "grande.jpg", mediaType: "photo", creationTime: 100 },
          file,
        ),
      ).rejects.toThrow(/espacio/i);

      expect(db.getQueueStats().total).toBe(0);
      expect(await store.loadItems("u1")).toHaveLength(0);
      expect(await store.loadFile("u1", "a")).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("getNextPending", () => {
  it("devuelve el pendiente con menor created_at", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 300 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "c", uri: "c", mediaType: "photo", creationTime: 200 });
    expect(db.getNextPending()?.asset_id).toBe("b");
  });

  it("ignora items con next_retry_at en el futuro", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.setNextRetryAt("a", Date.now() + 60_000);
    expect(db.getNextPending()?.asset_id).toBe("b");
  });

  it("ignora estados done, duplicate y failed", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.enqueueAsset({ id: "c", uri: "c", mediaType: "photo", creationTime: 300 });
    await db.setState("a", "done");
    await db.setState("b", "duplicate");
    await db.setState("c", "failed");
    expect(db.getNextPending()).toBeNull();
  });

  it("hidrata la proyección desde IndexedDB al reabrir la cola (recarga)", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.setNextRetryAt("a", Date.now() + 60_000);

    // Recarga simulada: cerrar y volver a inicializar SIN borrar la BD.
    await db.closeQueue();
    expect(db.getQueueStats().total).toBe(0); // la proyección quedó vacía
    await db.initializeQueue("u1");

    expect(db.getQueueStats().total).toBe(2);
    // next_retry_at se persistió: "a" sigue vetada aunque su created_at es menor.
    expect(db.getNextPending()?.asset_id).toBe("b");
  });
});

describe("setState", () => {
  it("con extra vacío pone last_error a null", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.setState("a", "queued", { last_error: "boom" });
    expect(db.getPendingItems()[0].last_error).toBe("boom");
    await db.setState("a", "queued", {});
    expect(db.getPendingItems()[0].last_error).toBeNull();
  });

  it("guarda sha256 cuando se pasa en extra", async () => {
    const sha = "f".repeat(64);
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.setState("a", "init", { sha256: sha });
    const item = db.getPendingItems()[0];
    expect(item.state).toBe("init");
    expect(item.sha256).toBe(sha);
  });

  it("hace coalesce de sha256/remote_id/bytes como el SQL nativo", async () => {
    const sha = "a".repeat(64);
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.setState("a", "init", { sha256: sha });
    await db.setState("a", "uploading_thumb", { remote_id: "r1" });
    const item = db.getPendingItems()[0];
    expect(item.sha256).toBe(sha); // no se pierde al no venir en extra
    expect(item.remote_id).toBe("r1");
  });
});

describe("getQueueStats", () => {
  it("cuenta done+duplicate como done, failed aparte y el resto pending", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.enqueueAsset({ id: "c", uri: "c", mediaType: "photo", creationTime: 300 });
    await db.enqueueAsset({ id: "d", uri: "d", mediaType: "photo", creationTime: 400 });
    await db.setState("a", "done");
    await db.setState("b", "duplicate");
    await db.setState("c", "failed");
    expect(db.getQueueStats()).toEqual({ total: 4, done: 2, pending: 1, failed: 1 });
  });
});

describe("retryFailed", () => {
  it("reencola los fallidos limpiando attempts, last_error, bytes_sent y next_retry_at", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.setState("a", "failed", { last_error: "x", bytes_sent: 10 });
    await db.bumpAttempt("a");
    await db.setNextRetryAt("a", Date.now() + 3_600_000);
    await db.setState("b", "failed", { last_error: "y" });

    await db.retryFailed();

    const items = db.getPendingItems() as Row[];
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.state).toBe("queued");
      expect(item.attempts).toBe(0);
      expect(item.last_error).toBeNull();
      expect(item.bytes_sent).toBe(0);
      expect(item.next_retry_at).toBe(0);
    }
    // next_retry_at = 0: el retry manual es inmediato, no espera el backoff.
    expect(db.getNextPending()?.asset_id).toBe("a");
  });
});

describe("aislamiento por usuario", () => {
  it("los items de otro usuario no aparecen en el contexto activo", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });

    await db.initializeQueue("u2");
    expect(db.getQueueStats().total).toBe(0);
    expect(db.getNextPending()).toBeNull();
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    expect(db.getQueueStats().total).toBe(1);
    expect(db.getNextPending()?.asset_id).toBe("b");

    await db.initializeQueue("u1");
    expect(db.getQueueStats().total).toBe(1);
    expect(db.getNextPending()?.asset_id).toBe("a");
  });

  it("tras cambiar de usuario las escrituras van al nuevo contexto", async () => {
    await db.initializeQueue("u2");
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    expect(db.getQueueStats().total).toBe(1);
    expect((await store.loadItems("u1")).length).toBe(0);
    expect((await store.loadItems("u2")).length).toBe(1);
  });

  it("los mutadores rechazan si no hay contexto activo", async () => {
    await db.closeQueue();
    await expect(
      db.enqueueAsset({ id: "x", uri: "x", mediaType: "photo", creationTime: 1 }),
    ).rejects.toThrow("El contexto de la cola ya no es válido.");
    await expect(db.setState("x", "done")).rejects.toThrow(
      "El contexto de la cola ya no es válido.",
    );
  });
});

describe("wipeUserQueue", () => {
  it("borra items, archivos y cuenta solo de ese usuario", async () => {
    await db.enqueueAsset(
      { id: "a", uri: "a", filename: "a.jpg", mediaType: "photo", creationTime: 100 },
      new File(["a"], "a.jpg", { type: "image/jpeg" }),
    );
    await db.initializeQueue("u2");
    await db.enqueueAsset(
      { id: "b", uri: "b", filename: "b.jpg", mediaType: "photo", creationTime: 200 },
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    );

    await store.wipeUserQueue("u1");

    await db.initializeQueue("u1");
    expect(db.getQueueStats().total).toBe(0);
    expect(await store.loadFile("u1", "a")).toBeUndefined();

    await db.initializeQueue("u2");
    expect(db.getQueueStats().total).toBe(1);
    expect(await store.loadFile("u2", "b")).toBeDefined();
  });
});

describe("finishItem", () => {
  it("marca el estado terminal y borra el archivo en una transacción", async () => {
    const file = new File(["bytes-jpg"], "foto.jpg", {
      type: "image/jpeg",
      lastModified: 50,
    });
    await db.enqueueAsset(
      { id: "a", uri: "a", filename: "foto.jpg", mediaType: "photo", creationTime: 100 },
      file,
    );
    const sha = "c".repeat(64);
    await db.setState("a", "init", { sha256: sha });

    await db.finishItem("a", "done", { remote_id: "r1", bytes_sent: file.size });

    expect(await store.loadFile("u1", "a")).toBeUndefined();
    expect(db.getPendingItems()).toHaveLength(0);
    expect(db.getQueueStats()).toEqual({ total: 1, done: 1, pending: 0, failed: 0 });
    // La transición a terminal conserva sha256 (coalesce) y guarda remote_id.
    const items = await store.loadItems("u1");
    expect(items[0].state).toBe("done");
    expect(items[0].sha256).toBe(sha);
    expect(items[0].remote_id).toBe("r1");
  });

  it("duplicate también borra el archivo", async () => {
    await db.enqueueAsset(
      { id: "a", uri: "a", filename: "foto.jpg", mediaType: "photo", creationTime: 100 },
      new File(["x"], "foto.jpg", { type: "image/jpeg" }),
    );
    await db.finishItem("a", "duplicate", { remote_id: "r2" });
    expect(await store.loadFile("u1", "a")).toBeUndefined();
    expect(db.getQueueStats().done).toBe(1);
  });
});

describe("recoverInterrupted", () => {
  it("devuelve los estados transitorios a queued conservando backoff y datos", async () => {
    const sha = "f".repeat(64);
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.setState("a", "init", { sha256: sha });
    await db.setState("a", "uploading_original", {
      remote_id: "r1",
      bytes_total: 1000,
      bytes_sent: 500,
    });
    await db.bumpAttempt("a");
    await db.setNextRetryAt("a", 9_999_999);
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });

    await db.recoverInterrupted();

    const items = await store.loadItems("u1");
    const a = items.find((i) => i.assetId === "a");
    expect(a?.state).toBe("queued");
    expect(a?.bytes_sent).toBe(0);
    // Se conservan attempts, next_retry_at, sha256 y remote_id.
    expect(a?.attempts).toBe(1);
    expect(a?.next_retry_at).toBe(9_999_999);
    expect(a?.sha256).toBe(sha);
    expect(a?.remote_id).toBe("r1");
    // "b" ya estaba queued: sin cambios.
    expect(items.find((i) => i.assetId === "b")?.state).toBe("queued");
    // La proyección también quedó actualizada.
    const pending = db.getPendingItems() as Row[];
    expect(pending.find((i) => i.asset_id === "a")?.state).toBe("queued");
    expect(pending.find((i) => i.asset_id === "a")?.bytes_sent).toBe(0);
  });

  it("no toca items queued, done, duplicate ni failed", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    await db.enqueueAsset({ id: "c", uri: "c", mediaType: "photo", creationTime: 300 });
    await db.enqueueAsset({ id: "d", uri: "d", mediaType: "photo", creationTime: 400 });
    await db.setState("b", "done", { bytes_sent: 10 });
    await db.setState("c", "duplicate");
    await db.setState("d", "failed", { last_error: "x", bytes_sent: 7 });

    await db.recoverInterrupted();

    const items = await store.loadItems("u1");
    expect(items.find((i) => i.assetId === "a")?.state).toBe("queued");
    expect(items.find((i) => i.assetId === "b")?.state).toBe("done");
    expect(items.find((i) => i.assetId === "b")?.bytes_sent).toBe(10);
    expect(items.find((i) => i.assetId === "c")?.state).toBe("duplicate");
    expect(items.find((i) => i.assetId === "d")?.state).toBe("failed");
    expect(items.find((i) => i.assetId === "d")?.bytes_sent).toBe(7);
  });
});

describe("refreshProjection", () => {
  it("relee desde IndexedDB lo que escribió otro actor (otra pestaña)", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });

    // Simula una escritura de otra pestaña: directo al store, sin pasar por
    // los mutadores (que además proyectarían en el Map).
    await store.saveItemWithFile(
      {
        userId: "u1",
        assetId: "b",
        asset_id: "b",
        uri: "b",
        filename: "b.jpg",
        media_type: "photo",
        created_at: 50,
        state: "queued",
        sha256: null,
        remote_id: null,
        attempts: 0,
        last_error: null,
        bytes_total: 0,
        bytes_sent: 0,
        next_retry_at: 0,
        updated_at: Date.now(),
      },
      null,
    );

    // La proyección sigue vieja hasta refrescar.
    expect(db.getQueueStats().total).toBe(1);
    await db.refreshProjection();
    expect(db.getQueueStats().total).toBe(2);
    // El item nuevo tiene created_at menor → es el siguiente pendiente.
    expect(db.getNextPending()?.asset_id).toBe("b");
  });

  it("sin contexto activo no toca la proyección (queda vacía) ni lanza", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.closeQueue();

    await db.refreshProjection();

    expect(db.getQueueStats()).toEqual({ total: 0, done: 0, pending: 0, failed: 0 });
    expect(db.getPendingItems()).toEqual([]);
    expect(db.getFailed()).toEqual([]);
    expect(db.getNextPending()).toBeNull();
  });
});

describe("contexto y epoch", () => {
  it("una escritura con un epoch viejo aborta si la cuenta avanzó", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    // Otro actor (otra pestaña, re-login) incrementa el epoch de la cuenta:
    // el contexto activo {u1, e1} queda invalidado para nuevas escrituras.
    await store.createOrBumpEpoch("u1");
    await expect(db.setState("a", "done")).rejects.toThrow(
      "El contexto de la cola ya no es válido.",
    );
    // La escritura abortó dentro de la tx: la fila sigue queued.
    const items = await store.loadItems("u1");
    expect(items[0].state).toBe("queued");
    expect(db.getNextPending()?.asset_id).toBe("a");
  });
});

describe("pruneQueueExcept y clearQueue (web)", () => {
  it("pruneQueueExcept elimina filas que no están en el conjunto permitido", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    expect(db.getQueueStats().total).toBe(2);

    await db.pruneQueueExcept(new Set(["a"]));
    expect(db.getQueueStats().total).toBe(1);
    expect(db.getNextPending()?.asset_id).toBe("a");
  });

  it("clearQueue vacía completamente la cola en memoria y en IndexedDB", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    expect(db.getQueueStats().total).toBe(1);

    await db.clearQueue();
    expect(db.getQueueStats().total).toBe(0);
    expect(db.getNextPending()).toBeNull();
  });
});

describe("removeQueueItems (web)", () => {
  it("elimina items de la memoria y de IndexedDB (items y files)", async () => {
    await db.enqueueAsset({ id: "a", uri: "a", mediaType: "photo", creationTime: 100 });
    await db.enqueueAsset({ id: "b", uri: "b", mediaType: "photo", creationTime: 200 });
    expect(db.getQueueStats().total).toBe(2);

    await db.removeQueueItems(["a"]);
    expect(db.getQueueStats().total).toBe(1);
    expect(db.getNextPending()?.asset_id).toBe("b");

    const items = await store.loadItems("u1");
    expect(items.map((i) => i.asset_id)).toEqual(["b"]);
  });
});

describe("getQueueDb", () => {
  it("lanza porque SQLite no está disponible en web", () => {
    expect(() => db.getQueueDb()).toThrow("SQLite no está disponible en web.");
  });
});
