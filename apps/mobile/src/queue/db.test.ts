import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de la implementación NATIVA de la cola (db.ts, expo-sqlite).
 *
 * OJO: vitest resuelve "./db" a db.web.ts por resolve.extensions, así que hay
 * que importar la ruta literal "./db.ts" para llegar a la variante nativa.
 * expo-sqlite se mockea: se espían las llamadas SQL sobre una BD falsa.
 */

const sqliteDb = {
  execSync: vi.fn((_sql?: string) => {}),
  runSync: vi.fn((_sql?: string, _params?: unknown[]) => ({
    changes: 1,
    lastInsertRowId: 0,
  })),
  getFirstSync: vi.fn((_sql?: string, _params?: unknown[]) => null as unknown),
  getAllSync: vi.fn((_sql?: string, _params?: unknown[]) => [] as unknown[]),
  withTransactionSync: vi.fn((fn: () => void) => fn()),
};

const openDatabaseSync = vi.fn(() => sqliteDb);

vi.mock("expo-sqlite", () => ({ openDatabaseSync }));

type NativeDb = typeof import("./db");

async function importNativeDb(): Promise<NativeDb> {
  vi.resetModules();
  // @ts-expect-error -- ruta con extensión para saltar la resolución *.web.ts
  return await import("./db.ts");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initializeQueue/closeQueue (nativo)", () => {
  it("initializeQueue fija el dueño, adopta filas NULL y persiste el owner", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");

    expect(openDatabaseSync).toHaveBeenCalledWith("photos_queue.db");
    expect(sqliteDb.execSync).toHaveBeenCalled(); // DDL
    // Adopción de filas heredadas sin dueño.
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id IS NULL"),
      ["u1"],
    );
    // Owner persistido para la tarea en segundo plano (headless).
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["queue.owner", "u1"],
    );
  });

  it("closeQueue suelta el contexto y limpia el owner persistido", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    sqliteDb.runSync.mockClear();
    await db.closeQueue();
    expect(sqliteDb.runSync).toHaveBeenCalledWith("DELETE FROM kv WHERE k = ?", ["queue.owner"]);
  });

  it("la migración añade user_id y PK compuesta si la tabla es antigua", async () => {
    // getAllSync devuelve [] para PRAGMA table_info → sin user_id → migra.
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    const ddl = sqliteDb.execSync.mock.calls.map((c) => String(c[0])).join("\n");
    expect(ddl).toContain("PRIMARY KEY (user_id, asset_id)");
    expect(sqliteDb.execSync).toHaveBeenCalledWith(
      expect.stringContaining("ALTER TABLE queue RENAME TO queue_old"),
    );
  });

  it("no migra si la tabla ya tiene user_id", async () => {
    // Solo la primera llamada (PRAGMA del getQueueDb de este test) devuelve
    // columnas; no contaminar el mock de los tests siguientes.
    sqliteDb.getAllSync.mockImplementationOnce((sql?: string) =>
      String(sql).includes("table_info") ? [{ name: "user_id" }, { name: "asset_id" }] : [],
    );
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    expect(sqliteDb.execSync).not.toHaveBeenCalledWith(
      expect.stringContaining("RENAME TO queue_old"),
    );
  });
});

describe("mutadores async sobre SQLite", () => {
  it("enqueueAsset inserta con user_id del contexto activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    const p = db.enqueueAsset({
      id: "a",
      uri: "content://a",
      filename: "a.jpg",
      mediaType: "photo",
      creationTime: 100,
    });
    expect(p).toBeInstanceOf(Promise);
    await p;

    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO queue"),
      ["u1", "a", "content://a", "a.jpg", "photo", 100, expect.any(Number)],
    );
  });

  it("el mismo asset_id puede encolarse para dos usuarios distintos", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.enqueueAsset({ id: "a", uri: "u", mediaType: "photo", creationTime: 1 });
    await db.initializeQueue("u2");
    await db.enqueueAsset({ id: "a", uri: "u", mediaType: "photo", creationTime: 1 });

    const inserts = sqliteDb.runSync.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT OR IGNORE INTO queue"),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]?.[0]).toBe("u1");
    expect(inserts[1][1]?.[0]).toBe("u2");
  });

  it("enqueueAssetsBatch inserta todo en una transacción", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    sqliteDb.runSync.mockClear();
    await db.enqueueAssetsBatch([
      { id: "a", uri: "ua", mediaType: "photo", creationTime: 1 },
      { id: "b", uri: "ub", mediaType: "video", creationTime: 2 },
    ]);

    expect(sqliteDb.withTransactionSync).toHaveBeenCalledTimes(1);
    const inserts = sqliteDb.runSync.mock.calls.filter((c) =>
      String(c[0]).includes("INSERT OR IGNORE INTO queue"),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]?.[0]).toBe("u1");
    expect(inserts[1][1]?.[0]).toBe("u1");
  });

  it("setState usa UPDATE con coalesce acotado al usuario activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.setState("a", "init", { sha256: "f".repeat(64) });
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE asset_id = ? AND user_id IS ?"),
      expect.arrayContaining(["init", "f".repeat(64), "a", "u1"]),
    );
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("coalesce"),
      expect.anything(),
    );
  });

  it("bumpAttempt incrementa attempts solo del usuario activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.bumpAttempt("a");
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "UPDATE queue SET attempts = attempts + 1 WHERE asset_id = ? AND user_id IS ?",
      ["a", "u1"],
    );
  });

  it("setNextRetryAt actualiza next_retry_at solo del usuario activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.setNextRetryAt("a", 999);
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "UPDATE queue SET next_retry_at = ? WHERE asset_id = ? AND user_id IS ?",
      [999, "a", "u1"],
    );
  });

  it("retryFailed reencola solo los fallidos del usuario activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.retryFailed();
    const [sql, params] = sqliteDb.runSync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("state = 'queued'");
    expect(sql).toContain("attempts = 0");
    expect(sql).toContain("last_error = NULL");
    expect(sql).toContain("bytes_sent = 0");
    expect(sql).toContain("next_retry_at = 0");
    expect(sql).toContain("user_id IS ?");
    expect(sql).toContain("state = 'failed'");
    expect(params).toEqual(["u1"]);
  });

  it("finishItem marca el estado terminal con la misma escritura coalesce", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.finishItem("a", "done", { remote_id: "r1", bytes_sent: 10 });
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("coalesce"),
      expect.arrayContaining(["done", "r1", 10, "a", "u1"]),
    );
  });

  it("pruneQueueExcept elimina filas que no pertenecen al conjunto permitido", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    sqliteDb.getAllSync.mockReturnValueOnce([{ asset_id: "a" }, { asset_id: "b" }]);
    await db.pruneQueueExcept(new Set(["a"]));
    expect(sqliteDb.withTransactionSync).toHaveBeenCalled();
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "DELETE FROM queue WHERE user_id IS ? AND asset_id = ?",
      ["u1", "b"],
    );
  });

  it("clearQueue elimina todas las filas del usuario", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    await db.clearQueue();
    expect(sqliteDb.runSync).toHaveBeenCalledWith("DELETE FROM queue WHERE user_id IS ?", ["u1"]);
  });
});

describe("getters síncronos con scoping", () => {
  it("getNextPending filtra por usuario y estados pendientes con next_retry_at", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ asset_id: "a" });
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    const item = db.getNextPending();
    expect(item?.asset_id).toBe("a");
    const [sql, params] = sqliteDb.getFirstSync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("user_id IS ?");
    expect(sql).toContain("next_retry_at <= ?");
    expect(sql).toContain("ORDER BY created_at ASC");
    expect(params).toEqual(["u1", expect.any(Number)]);
  });

  it("getQueueItems filtra por el usuario activo", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    db.getQueueItems();
    const [sql, params] = sqliteDb.getAllSync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("WHERE user_id IS ?");
    expect(params).toEqual(["u1", 2000]);
  });

  it("sin sesión los getters solo ven filas sin dueño (user_id NULL)", async () => {
    const db = await importNativeDb();
    // Sin initializeQueue: activeUserId = null → user_id IS NULL.
    db.getQueueItems();
    const [sql, params] = sqliteDb.getAllSync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("WHERE user_id IS ?");
    expect(params).toEqual([null, 2000]);
  });

  it("getQueueStats agrega done/pending/failed del usuario", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ total: 4, done: 2, pending: 1, failed: 1 });
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    expect(db.getQueueStats()).toEqual({ total: 4, done: 2, pending: 1, failed: 1 });
  });

  it("kvGet/kvSet usan la tabla kv", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ v: "1" });
    const db = await importNativeDb();
    db.kvSet("wifi_only", "1");
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["wifi_only", "1"],
    );
    expect(db.kvGet("wifi_only")).toBe("1");
    expect(sqliteDb.getFirstSync).toHaveBeenCalledWith("SELECT v FROM kv WHERE k = ?", [
      "wifi_only",
    ]);
  });
});

describe("owner para el contexto headless", () => {
  it("getQueueOwner lee kv y se limpia al cerrar", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ v: "u9" });
    const db = await importNativeDb();
    expect(db.getQueueOwner()).toBe("u9");
  });
});

describe("marca de escaneo por usuario", () => {
  it("getLastScanTs/setLastScanTs usan la clave last_scan_ts:<userId>", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u1");
    db.setLastScanTs(1234);
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["last_scan_ts:u1", "1234"],
    );
    sqliteDb.getFirstSync.mockReturnValueOnce({ v: "1234" });
    db.getLastScanTs();
    expect(sqliteDb.getFirstSync).toHaveBeenCalledWith("SELECT v FROM kv WHERE k = ?", [
      "last_scan_ts:u1",
    ]);
  });

  it("otro usuario tiene su propia marca", async () => {
    const db = await importNativeDb();
    await db.initializeQueue("u2");
    db.setLastScanTs(9);
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["last_scan_ts:u2", "9"],
    );
  });
});

describe("pausa persistente", () => {
  it("isBackupPaused lee backup.paused de kv y setBackupPaused lo persiste", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce(null);
    const db = await importNativeDb();
    expect(db.isBackupPaused()).toBe(false);

    sqliteDb.getFirstSync.mockReturnValueOnce({ v: "1" });
    expect(db.isBackupPaused()).toBe(true);

    db.setBackupPaused(true);
    expect(sqliteDb.runSync).toHaveBeenLastCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["backup.paused", "1"],
    );
    db.setBackupPaused(false);
    expect(sqliteDb.runSync).toHaveBeenLastCalledWith(
      "INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)",
      ["backup.paused", "0"],
    );
  });
});
