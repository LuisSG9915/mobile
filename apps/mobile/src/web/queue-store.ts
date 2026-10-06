import type { QueueItem } from "../queue/types";

/**
 * Wrapper mínimo sobre IndexedDB nativo (sin librerías). BD "photos.queue" v1:
 *
 * - items:    keyPath ["userId","assetId"], índice byUser(userId).
 *             QueueItem + next_retry_at + userId (metadatos de la cola).
 * - files:    keyPath ["userId","assetId"], índice byUser(userId).
 *             { userId, assetId, data: ArrayBuffer, name, type, lastModified }.
 *             Se guarda ArrayBuffer (no File/Blob): es cloneable en todos los
 *             navegadores y compatible con fake-indexeddb en tests.
 * - accounts: keyPath userId. { userId, epoch }. El epoch invalida escrituras
 *             tardías: cada escritura re-lee la cuenta dentro de la MISMA
 *             transacción y aborta si el epoch ya no es el del contexto activo.
 */

// assetId duplica asset_id: el keyPath ["userId","assetId"] necesita el campo
// en camelCase mientras QueueItem conserva el snake_case del esquema SQLite.
export type QueueRow = QueueItem & {
  userId: string;
  assetId: string;
  next_retry_at: number;
};

export type FileRow = {
  userId: string;
  assetId: string;
  data: ArrayBuffer;
  name: string;
  type: string;
  lastModified: number;
};

/** Payload del archivo tal como lo pasa el caller (las claves las pone el store). */
export type FilePayload = Pick<FileRow, "data" | "name" | "type" | "lastModified">;

type AccountRow = { userId: string; epoch: number };

export type QueueContext = { userId: string; epoch: number };

const DB_NAME = "photos.queue";
const DB_VERSION = 1;

const CONTEXT_ERROR = "El contexto de la cola ya no es válido.";

let dbPromise: Promise<IDBDatabase> | null = null;
let activeContext: QueueContext | null = null;
const closeListeners = new Set<() => void>();

function mapError(e: unknown): Error {
  // No depender de `instanceof DOMException`: los errores de IndexedDB pueden
  // venir de otro realm (o de fake-indexeddb en tests) con identidad distinta.
  const name = (e as { name?: string } | null | undefined)?.name ?? "";
  switch (name) {
    case "QuotaExceededError":
      return new Error("No hay espacio suficiente en el dispositivo para guardar los archivos.");
    case "SecurityError":
      return new Error("El navegador bloqueó el acceso al almacenamiento local.");
    case "AbortError":
      return new Error(CONTEXT_ERROR);
    default:
      if (e instanceof Error && name === "Error") return e;
      return new Error("No se pudo acceder al almacenamiento local del navegador.");
  }
}

/** Promesa sobre un IDBRequest. Los errores se traducen a mensajes en español. */
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(mapError(request.error));
  });
}

/** Resuelve cuando la transacción hace commit; rechaza si aborta. */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(mapError(tx.error));
    tx.onerror = () => {}; // el error concreto llega por tx.onabort
  });
}

export function openQueueDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(mapError(e));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("items")) {
        const items = db.createObjectStore("items", { keyPath: ["userId", "assetId"] });
        items.createIndex("byUser", "userId");
      }
      if (!db.objectStoreNames.contains("files")) {
        const files = db.createObjectStore("files", { keyPath: ["userId", "assetId"] });
        files.createIndex("byUser", "userId");
      }
      if (!db.objectStoreNames.contains("accounts")) {
        db.createObjectStore("accounts", { keyPath: "userId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Si otra pestaña pide una versión nueva, soltar la conexión para no
      // bloquear su upgrade.
      db.onversionchange = () => {
        db.close();
        if (dbPromise === p) dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(mapError(request.error));
    request.onblocked = () =>
      reject(
        new Error(
          "El almacenamiento local está bloqueado por otra pestaña. Ciérrala e inténtalo de nuevo.",
        ),
      );
  });
  dbPromise = p;
  // Si la apertura falla, permitir reintentos en la próxima llamada.
  p.catch(() => {
    if (dbPromise === p) dbPromise = null;
  });
  return p;
}

/** Cierra la conexión IDB y avisa a los listeners (p. ej. caché de File). */
export function closeQueueDb(): void {
  const p = dbPromise;
  dbPromise = null;
  if (p)
    p.then(
      (db) => db.close(),
      () => {},
    );
  for (const cb of closeListeners) {
    try {
      cb();
    } catch {}
  }
}

/** Registra un callback a ejecutar al cerrar la cola (closeQueueDb). */
export function onQueueClose(cb: () => void): void {
  closeListeners.add(cb);
}

/** Contexto activo {userId, epoch}: lo fija db.web.ts en initializeQueue. */
export function setActiveContext(ctx: QueueContext | null): void {
  activeContext = ctx;
}

export function getActiveContext(): QueueContext | null {
  return activeContext;
}

function requireContext(userId: string): QueueContext {
  const ctx = activeContext;
  if (!ctx || ctx.userId !== userId) throw new Error(CONTEXT_ERROR);
  return ctx;
}

/**
 * Valida dentro de la transacción que la cuenta del usuario sigue en el epoch
 * del contexto activo. Si falta el registro o difiere, aborta con CONTEXT_ERROR.
 */
async function checkAccountEpoch(tx: IDBTransaction, ctx: QueueContext): Promise<void> {
  const account = await req<AccountRow | undefined>(tx.objectStore("accounts").get(ctx.userId));
  if (!account || account.epoch !== ctx.epoch) throw new Error(CONTEXT_ERROR);
}

/**
 * Ejecuta fn dentro de una transacción readwrite sobre las stores dadas y
 * resuelve tras el commit. Si fn lanza, aborta la transacción.
 */
async function inWriteTx<T>(stores: string[], fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openQueueDb();
  const tx = db.transaction(stores, "readwrite");
  const done = txDone(tx);
  done.catch(() => {}); // evita unhandled rejection si fn rechaza primero
  try {
    const result = await fn(tx);
    await done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    throw e;
  }
}

/** Metadatos de todos los items de un usuario (sin blobs). */
export async function loadItems(userId: string): Promise<QueueRow[]> {
  const db = await openQueueDb();
  const tx = db.transaction("items", "readonly");
  return req<QueueRow[]>(tx.objectStore("items").index("byUser").getAll(userId));
}

/**
 * Inserta la fila de cola y (si viene) el archivo en UNA transacción
 * items+files+accounts. Valida el epoch del contexto activo: si el archivo
 * falla (cuota, etc.) tampoco queda fila encolada.
 */
export async function saveItemWithFile(row: QueueRow, file: FilePayload | null): Promise<void> {
  await inWriteTx(["items", "files", "accounts"], async (tx) => {
    const ctx = requireContext(row.userId);
    await checkAccountEpoch(tx, ctx);
    try {
      tx.objectStore("items").put(row);
      if (file) {
        tx.objectStore("files").put({
          ...file,
          userId: row.userId,
          assetId: row.asset_id,
        });
      }
    } catch (e) {
      // put() puede lanzar en sincrónico (p. ej. quota): abortar la tx.
      try {
        tx.abort();
      } catch {}
      throw mapError(e);
    }
  });
}

/**
 * Lee, muta y regraba un item en una transacción items+accounts (valida epoch).
 * opts.deleteFile borra además el blob en la misma tx (items+files+accounts),
 * para que el estado terminal y la limpieza del archivo sean atómicos.
 * Devuelve la fila resultante, o null si el item no existe.
 */
export async function updateItem(
  userId: string,
  assetId: string,
  mutator: (row: QueueRow) => QueueRow | null,
  opts: { deleteFile?: boolean } = {},
): Promise<QueueRow | null> {
  const stores = opts.deleteFile ? ["items", "files", "accounts"] : ["items", "accounts"];
  return inWriteTx(stores, async (tx) => {
    const ctx = requireContext(userId);
    await checkAccountEpoch(tx, ctx);
    const itemsStore = tx.objectStore("items");
    const row = await req<QueueRow | undefined>(itemsStore.get([userId, assetId]));
    if (opts.deleteFile) tx.objectStore("files").delete([userId, assetId]);
    if (!row) return null;
    const next = mutator(row);
    if (!next) return row;
    itemsStore.put(next);
    return next;
  });
}

/** Aplica el mutador a todos los items del usuario en una sola transacción. */
export async function updateUserItems(
  userId: string,
  mutator: (row: QueueRow) => QueueRow | null,
): Promise<QueueRow[]> {
  return inWriteTx(["items", "accounts"], async (tx) => {
    const ctx = requireContext(userId);
    await checkAccountEpoch(tx, ctx);
    const itemsStore = tx.objectStore("items");
    const rows = await req<QueueRow[]>(itemsStore.index("byUser").getAll(userId));
    const updated: QueueRow[] = [];
    for (const row of rows) {
      const next = mutator(row);
      if (next) {
        itemsStore.put(next);
        updated.push(next);
      }
    }
    return updated;
  });
}

/** Devuelve el registro del archivo (bytes + metadatos) o undefined. */
export async function loadFile(userId: string, assetId: string): Promise<FileRow | undefined> {
  const db = await openQueueDb();
  const tx = db.transaction("files", "readonly");
  return req<FileRow | undefined>(tx.objectStore("files").get([userId, assetId]));
}

/** Borra el blob de un asset (valida epoch como toda escritura). */
export async function deleteFile(userId: string, assetId: string): Promise<void> {
  await inWriteTx(["files", "accounts"], async (tx) => {
    const ctx = requireContext(userId);
    await checkAccountEpoch(tx, ctx);
    tx.objectStore("files").delete([userId, assetId]);
  });
}

/**
 * Borra items, files y la cuenta de un usuario en UNA transacción. No valida
 * contexto: sirve para limpiar restos de cualquier usuario (logout, etc.).
 */
export async function wipeUserQueue(userId: string): Promise<void> {
  const db = await openQueueDb();
  const tx = db.transaction(["items", "files", "accounts"], "readwrite");
  const done = txDone(tx);
  done.catch(() => {});
  try {
    const itemsStore = tx.objectStore("items");
    const filesStore = tx.objectStore("files");
    const itemKeys = await req<IDBValidKey[]>(itemsStore.index("byUser").getAllKeys(userId));
    for (const key of itemKeys) itemsStore.delete(key);
    const fileKeys = await req<IDBValidKey[]>(filesStore.index("byUser").getAllKeys(userId));
    for (const key of fileKeys) filesStore.delete(key);
    tx.objectStore("accounts").delete(userId);
    await done;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    throw e;
  }
}

/** Crea la cuenta con epoch 1 o incrementa el existente. Devuelve el epoch. */
export async function createOrBumpEpoch(userId: string): Promise<number> {
  const db = await openQueueDb();
  const tx = db.transaction("accounts", "readwrite");
  const done = txDone(tx);
  done.catch(() => {});
  try {
    const accountsStore = tx.objectStore("accounts");
    const account = await req<AccountRow | undefined>(accountsStore.get(userId));
    const epoch = (account?.epoch ?? 0) + 1;
    accountsStore.put({ userId, epoch });
    await done;
    return epoch;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    throw e;
  }
}
