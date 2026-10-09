import * as SQLite from "expo-sqlite";
import type { QueueItem, QueueState, QueueStats } from "./types";

export type { QueueItem, QueueState, QueueStats } from "./types";

const DDL = `
CREATE TABLE IF NOT EXISTS queue (
  user_id TEXT,
  asset_id TEXT NOT NULL,
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
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, asset_id)
);
CREATE INDEX IF NOT EXISTS queue_state ON queue(user_id, state, updated_at);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Usuario dueño de las filas visibles de la cola. Lo fija initializeQueue con
 * la sesión activa; null = sin usuario (pre-login o tests) — los getters solo
 * ven filas sin dueño en ese caso.
 */
let activeUserId: string | null = null;

/**
 * Migración a PK compuesta (user_id, asset_id): los ids de MediaLibrary son
 * globales del dispositivo, así que dos cuentas en el mismo teléfono pueden
 * producir el mismo asset_id — sin user_id en la clave una cuenta taparía la
 * cola de la otra. Las filas heredadas quedan con user_id NULL hasta que
 * initializeQueue las adopte.
 */
function migrateToUserScope(db: SQLite.SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>("PRAGMA table_info(queue)");
  if (cols.some((c) => c.name === "user_id")) return;
  db.execSync(`
    ALTER TABLE queue RENAME TO queue_old;
    CREATE TABLE queue (
      user_id TEXT,
      asset_id TEXT NOT NULL,
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
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, asset_id)
    );
    INSERT OR IGNORE INTO queue
      (user_id, asset_id, uri, filename, media_type, created_at, state, sha256,
       remote_id, attempts, last_error, bytes_total, bytes_sent, next_retry_at, updated_at)
      SELECT NULL, asset_id, uri, filename, media_type, created_at, state, sha256,
             remote_id, attempts, last_error, bytes_total, bytes_sent, next_retry_at, updated_at
      FROM queue_old;
    DROP TABLE queue_old;
    CREATE INDEX queue_state ON queue(user_id, state, updated_at);
  `);
}

export function getQueueDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync("photos_queue.db");
    dbInstance.execSync(DDL);
    migrateToUserScope(dbInstance);
  }
  return dbInstance;
}

/**
 * Último usuario con sesión en este dispositivo. Lo lee la tarea en segundo
 * plano (headless, sin React ni sesión cargada) para reabrir la cola con su
 * dueño; se limpia al cerrar la cola (logout o sesión perdida), porque sin
 * sesión las subidas fallarían con 401 consumiendo reintentos.
 */
const OWNER_KEY = "queue.owner";

/**
 * Fija el usuario activo de la cola y adopta las filas sin dueño (heredadas
 * de antes del scoping o encoladas sin sesión). El dispositivo es monousuario
 * en la práctica: quien inicia sesión primero tras la migración se queda con
 * los pendientes previos. Las filas de OTROS usuarios no se tocan — quedan
 * inertes y retoman si ese usuario vuelve a entrar.
 *
 * UPDATE OR IGNORE: si dos filas NULL compartieran asset_id (imposible en la
 * práctica — asset_id era PK única antes del scoping), la conflictiva queda
 * NULL en vez de abortar la inicialización.
 */
export async function initializeQueue(userId: string): Promise<void> {
  activeUserId = userId;
  const db = getQueueDb();
  db.runSync("UPDATE OR IGNORE queue SET user_id = ? WHERE user_id IS NULL", [userId]);
  kvSet(OWNER_KEY, userId);
}

/** Usuario al que pertenece la cola, para el contexto headless. */
export function getQueueOwner(): string | null {
  return kvGet(OWNER_KEY);
}

export async function closeQueue(): Promise<void> {
  activeUserId = null;
  try {
    getQueueDb().runSync("DELETE FROM kv WHERE k = ?", [OWNER_KEY]);
  } catch {}
}

export function kvGet(key: string): string | null {
  const row = getQueueDb().getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", [key]);
  return row?.v ?? null;
}

export function kvSet(key: string, value: string): void {
  getQueueDb().runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", [key, value]);
}

const PAUSE_KEY = "backup.paused";

/**
 * Pausa persistente del respaldo: vive en `kv`, así que sobrevive a reinicios
 * de la app. Nunca se limpia sola — solo "Reanudar" la quita (no auto-resume).
 * Es a nivel dispositivo, no por usuario.
 */
export function isBackupPaused(): boolean {
  return kvGet(PAUSE_KEY) === "1";
}

export function setBackupPaused(paused: boolean): void {
  kvSet(PAUSE_KEY, paused ? "1" : "0");
}

/**
 * Marca de tiempo del último escaneo completo, POR USUARIO: si A escaneó hace
 * un minuto y entra B, su primer escaneo no debe quedar suprimido por el
 * throttle (los assets del dispositivo aún no están en la cola de B).
 */
export function getLastScanTs(): number {
  return Number(kvGet(`last_scan_ts:${activeUserId ?? "anon"}`) ?? "0");
}

export function setLastScanTs(ts: number): void {
  kvSet(`last_scan_ts:${activeUserId ?? "anon"}`, String(ts));
}

export type EnqueueInput = {
  id: string;
  uri: string;
  filename?: string | null;
  mediaType: "photo" | "video";
  creationTime: number;
};

const INSERT_ASSET = `INSERT OR IGNORE INTO queue
   (user_id, asset_id, uri, filename, media_type, created_at, state, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`;

export async function enqueueAsset(
  asset: EnqueueInput,
  // Solo web lo usa (persistir el File en IndexedDB); firma unificada.
  _file?: File,
): Promise<void> {
  getQueueDb().runSync(INSERT_ASSET, [
    activeUserId,
    asset.id,
    asset.uri,
    asset.filename ?? null,
    asset.mediaType,
    asset.creationTime,
    Date.now(),
  ]);
}

/**
 * Variante por lote para el scanner: una sola transacción para toda la página
 * en vez de un INSERT awaited por asset.
 */
export async function enqueueAssetsBatch(assets: EnqueueInput[]): Promise<void> {
  if (!assets.length) return;
  const db = getQueueDb();
  const now = Date.now();
  db.withTransactionSync(() => {
    for (const asset of assets) {
      db.runSync(INSERT_ASSET, [
        activeUserId,
        asset.id,
        asset.uri,
        asset.filename ?? null,
        asset.mediaType,
        asset.creationTime,
        now,
      ]);
    }
  });
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
     WHERE asset_id = ? AND user_id IS ?`,
    [
      state,
      extra.sha256 ?? null,
      extra.remote_id ?? null,
      extra.last_error ?? null,
      extra.bytes_total ?? null,
      extra.bytes_sent ?? null,
      Date.now(),
      assetId,
      activeUserId,
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
  getQueueDb().runSync(
    "UPDATE queue SET attempts = attempts + 1 WHERE asset_id = ? AND user_id IS ?",
    [assetId, activeUserId],
  );
}

export async function setNextRetryAt(assetId: string, at: number): Promise<void> {
  getQueueDb().runSync("UPDATE queue SET next_retry_at = ? WHERE asset_id = ? AND user_id IS ?", [
    at,
    assetId,
    activeUserId,
  ]);
}

export function getNextPending(): QueueItem | null {
  return (
    getQueueDb().getFirstSync<QueueItem>(
      `SELECT * FROM queue
       WHERE user_id IS ?
         AND state IN ('queued','hashing','thumbnailing','init','uploading_thumb','uploading_original','completing')
         AND next_retry_at <= ?
       ORDER BY created_at ASC LIMIT 1`,
      [activeUserId, Date.now()],
    ) ?? null
  );
}

export function getPendingItems(limit = 100): QueueItem[] {
  return getQueueDb().getAllSync<QueueItem>(
    `SELECT * FROM queue WHERE user_id IS ? AND state NOT IN ('done','duplicate')
     ORDER BY created_at DESC LIMIT ?`,
    [activeUserId, limit],
  );
}

/** Todos los items de la cola (incluye done/duplicate) para la galería híbrida. */
export function getQueueItems(limit = 2000): QueueItem[] {
  return getQueueDb().getAllSync<QueueItem>(
    "SELECT * FROM queue WHERE user_id IS ? ORDER BY created_at DESC LIMIT ?",
    [activeUserId, limit],
  );
}

export function getFailed(limit = 50): QueueItem[] {
  return getQueueDb().getAllSync<QueueItem>(
    "SELECT * FROM queue WHERE user_id IS ? AND state = 'failed' ORDER BY updated_at DESC LIMIT ?",
    [activeUserId, limit],
  );
}

export async function retryFailed(): Promise<void> {
  getQueueDb().runSync(
    `UPDATE queue SET state = 'queued', attempts = 0, last_error = NULL, bytes_sent = 0,
       next_retry_at = 0 WHERE user_id IS ? AND state = 'failed'`,
    [activeUserId],
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
     WHERE user_id IS ? AND state IN ('hashing','thumbnailing','init','uploading_thumb','uploading_original','completing')`,
    [Date.now(), activeUserId],
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
     FROM queue WHERE user_id IS ?`,
    [activeUserId],
  );
  return row ?? { total: 0, done: 0, pending: 0, failed: 0 };
}

/**
 * Elimina items de la cola por asset_id. Usado al liberar espacio local
 * para que no sigan figurando como copias locales ni como pendientes de liberar.
 */
export async function removeQueueItems(assetIds: string[]): Promise<void> {
  if (!assetIds.length) return;
  const db = getQueueDb();
  db.withTransactionSync(() => {
    for (const id of assetIds) {
      db.runSync("DELETE FROM queue WHERE user_id IS ? AND asset_id = ?", [activeUserId, id]);
    }
  });
}

/**
 * Poda los elementos de la cola que no pertenezcan al conjunto de asset_ids permitidos.
 * Se utiliza al cambiar la selección de álbumes sincronizados para que la cola
 * no conserve fotos de álbumes excluidos.
 */
export async function pruneQueueExcept(allowedAssetIds: Set<string>): Promise<void> {
  const db = getQueueDb();
  const all = db.getAllSync<{ asset_id: string }>("SELECT asset_id FROM queue WHERE user_id IS ?", [
    activeUserId,
  ]);
  const toDelete = all.filter((row) => !allowedAssetIds.has(row.asset_id)).map((r) => r.asset_id);
  if (toDelete.length > 0) {
    db.withTransactionSync(() => {
      for (const id of toDelete) {
        db.runSync("DELETE FROM queue WHERE user_id IS ? AND asset_id = ?", [activeUserId, id]);
      }
    });
  }
}

/**
 * Elimina todos los elementos de la cola para el usuario activo.
 * Usado cuando syncedAlbumIds es vacío (ningún álbum seleccionado).
 */
export async function clearQueue(): Promise<void> {
  getQueueDb().runSync("DELETE FROM queue WHERE user_id IS ?", [activeUserId]);
}
