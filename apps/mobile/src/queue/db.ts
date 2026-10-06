import * as SQLite from "expo-sqlite";
import type { QueueItem, QueueState, QueueStats } from "./types";

export type { QueueItem, QueueState, QueueStats } from "./types";

const DDL = `
CREATE TABLE IF NOT EXISTS queue (
  asset_id TEXT PRIMARY KEY,
  uri TEXT NOT NULL,
  filename TEXT,
  media_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  sha256 TEXT,
  remote_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  bytes_total INTEGER NOT NULL DEFAULT 0,
  bytes_sent INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_state ON queue(state, updated_at);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

let dbInstance: SQLite.SQLiteDatabase | null = null;

export function getQueueDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync("photos_queue.db");
    dbInstance.execSync(DDL);
  }
  return dbInstance;
}

/**
 * En nativo SQLite no cambia de lifecycle por usuario: no-ops async para
 * mantener la misma API que db.web.ts (que sí abre/cierra IndexedDB).
 */
export async function initializeQueue(_userId: string): Promise<void> {}

export async function closeQueue(): Promise<void> {}

export function kvGet(key: string): string | null {
  const row = getQueueDb().getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", [key]);
  return row?.v ?? null;
}

export function kvSet(key: string, value: string): void {
  getQueueDb().runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", [key, value]);
}

export async function enqueueAsset(
  asset: {
    id: string;
    uri: string;
    filename?: string | null;
    mediaType: "photo" | "video";
    creationTime: number;
  },
  // Solo web lo usa (persistir el File en IndexedDB); firma unificada.
  _file?: File,
): Promise<void> {
  getQueueDb().runSync(
    `INSERT OR IGNORE INTO queue (asset_id, uri, filename, media_type, created_at, state, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    [asset.id, asset.uri, asset.filename ?? null, asset.mediaType, asset.creationTime, Date.now()],
  );
}

export async function setState(
  assetId: string,
  state: QueueState,
  extra: Partial<
    Pick<QueueItem, "sha256" | "remote_id" | "last_error" | "bytes_total" | "bytes_sent">
  > = {},
): Promise<void> {
  const db = getQueueDb();
  db.runSync(
    `UPDATE queue SET state = ?, sha256 = coalesce(?, sha256), remote_id = coalesce(?, remote_id),
       last_error = ?, bytes_total = coalesce(?, bytes_total), bytes_sent = coalesce(?, bytes_sent), updated_at = ?
     WHERE asset_id = ?`,
    [
      state,
      extra.sha256 ?? null,
      extra.remote_id ?? null,
      extra.last_error ?? null,
      extra.bytes_total ?? null,
      extra.bytes_sent ?? null,
      Date.now(),
      assetId,
    ],
  );
}

/**
 * Estado terminal en una sola operación. En web además borra el blob del
 * asset en la misma transacción; en nativo equivale a setState.
 */
export async function finishItem(
  assetId: string,
  state: "done" | "duplicate",
  extra: Partial<
    Pick<QueueItem, "sha256" | "remote_id" | "last_error" | "bytes_total" | "bytes_sent">
  > = {},
): Promise<void> {
  await setState(assetId, state, extra);
}

export async function bumpAttempt(assetId: string): Promise<void> {
  getQueueDb().runSync("UPDATE queue SET attempts = attempts + 1 WHERE asset_id = ?", [assetId]);
}

export async function setNextRetryAt(assetId: string, at: number): Promise<void> {
  getQueueDb().runSync("UPDATE queue SET next_retry_at = ? WHERE asset_id = ?", [at, assetId]);
}

export function getNextPending(): QueueItem | null {
  return (
    getQueueDb().getFirstSync<QueueItem>(
      `SELECT * FROM queue
       WHERE state IN ('queued','hashing','thumbnailing','init','uploading_thumb','uploading_original','completing')
         AND next_retry_at <= ?
       ORDER BY created_at ASC LIMIT 1`,
      [Date.now()],
    ) ?? null
  );
}

export function getPendingItems(limit = 100): QueueItem[] {
  return getQueueDb().getAllSync<QueueItem>(
    `SELECT * FROM queue WHERE state NOT IN ('done','duplicate') ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export function getFailed(limit = 50): QueueItem[] {
  return getQueueDb().getAllSync<QueueItem>(
    "SELECT * FROM queue WHERE state = 'failed' ORDER BY updated_at DESC LIMIT ?",
    [limit],
  );
}

export async function retryFailed(): Promise<void> {
  getQueueDb().runSync(
    "UPDATE queue SET state = 'queued', attempts = 0, last_error = NULL, bytes_sent = 0, next_retry_at = 0 WHERE state = 'failed'",
  );
}

/**
 * Misma API que db.web.ts: tras un cierre a mitad de item, los estados
 * transitorios vuelven a 'queued' (conservando attempts/next_retry_at/
 * sha256/remote_id). En web lo exige la recarga de pestaña; en nativo cubre
 * un posible kill de la app a mitad de subida.
 */
export async function recoverInterrupted(): Promise<void> {
  getQueueDb().runSync(
    `UPDATE queue SET state = 'queued', bytes_sent = 0, updated_at = ?
     WHERE state IN ('hashing','thumbnailing','init','uploading_thumb','uploading_original','completing')`,
    [Date.now()],
  );
}

/** En nativo los getters leen SQLite en vivo: refrescar no hace falta. */
export async function refreshProjection(): Promise<void> {}

export function getQueueStats(): QueueStats {
  const row = getQueueDb().getFirstSync<QueueStats>(
    `SELECT count(*) AS total,
       sum(CASE WHEN state IN ('done','duplicate') THEN 1 ELSE 0 END) AS done,
       sum(CASE WHEN state NOT IN ('done','duplicate','failed') THEN 1 ELSE 0 END) AS pending,
       sum(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM queue`,
  );
  return row ?? { total: 0, done: 0, pending: 0, failed: 0 };
}
