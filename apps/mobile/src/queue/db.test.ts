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
  it("son no-ops que resuelven sin tocar SQLite", async () => {
    const db = await importNativeDb();
    await expect(db.initializeQueue("u1")).resolves.toBeUndefined();
    await expect(db.closeQueue()).resolves.toBeUndefined();
    expect(openDatabaseSync).not.toHaveBeenCalled();
  });
});

describe("mutadores async sobre SQLite", () => {
  it("enqueueAsset devuelve Promise y hace INSERT OR IGNORE", async () => {
    const db = await importNativeDb();
    const p = db.enqueueAsset({
      id: "a",
      uri: "content://a",
      filename: "a.jpg",
      mediaType: "photo",
      creationTime: 100,
    });
    expect(p).toBeInstanceOf(Promise);
    await p;

    expect(openDatabaseSync).toHaveBeenCalledWith("photos_queue.db");
    expect(sqliteDb.execSync).toHaveBeenCalled(); // DDL
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR IGNORE INTO queue"),
      ["a", "content://a", "a.jpg", "photo", 100, expect.any(Number)],
    );
  });

  it("setState usa UPDATE con coalesce", async () => {
    const db = await importNativeDb();
    await db.setState("a", "init", { sha256: "f".repeat(64) });
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("coalesce"),
      expect.arrayContaining(["init", "f".repeat(64)]),
    );
  });

  it("bumpAttempt incrementa attempts", async () => {
    const db = await importNativeDb();
    await db.bumpAttempt("a");
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "UPDATE queue SET attempts = attempts + 1 WHERE asset_id = ?",
      ["a"],
    );
  });

  it("setNextRetryAt actualiza next_retry_at", async () => {
    const db = await importNativeDb();
    await db.setNextRetryAt("a", 999);
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      "UPDATE queue SET next_retry_at = ? WHERE asset_id = ?",
      [999, "a"],
    );
  });

  it("retryFailed reencola y pone next_retry_at = 0 (retry manual inmediato)", async () => {
    const db = await importNativeDb();
    await db.retryFailed();
    const sql = sqliteDb.runSync.mock.calls[0][0] as string;
    expect(sql).toContain("state = 'queued'");
    expect(sql).toContain("attempts = 0");
    expect(sql).toContain("last_error = NULL");
    expect(sql).toContain("bytes_sent = 0");
    expect(sql).toContain("next_retry_at = 0");
    expect(sql).toContain("WHERE state = 'failed'");
  });

  it("finishItem marca el estado terminal con la misma escritura coalesce", async () => {
    const db = await importNativeDb();
    await db.finishItem("a", "done", { remote_id: "r1", bytes_sent: 10 });
    expect(sqliteDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining("coalesce"),
      expect.arrayContaining(["done", "r1", 10, "a"]),
    );
  });
});

describe("getters síncronos", () => {
  it("getNextPending consulta estados pendientes con next_retry_at", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ asset_id: "a" });
    const db = await importNativeDb();
    const item = db.getNextPending();
    expect(item?.asset_id).toBe("a");
    const [sql, params] = sqliteDb.getFirstSync.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain("next_retry_at <= ?");
    expect(sql).toContain("ORDER BY created_at ASC");
    expect(params).toHaveLength(1);
  });

  it("getQueueStats agrega done/pending/failed", async () => {
    sqliteDb.getFirstSync.mockReturnValueOnce({ total: 4, done: 2, pending: 1, failed: 1 });
    const db = await importNativeDb();
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
