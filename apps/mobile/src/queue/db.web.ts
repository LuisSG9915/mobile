import { useQueueEvents } from "../lib/events";
import * as store from "../web/queue-store";
import type { QueueItem, QueueState, QueueStats } from "./types";

export type { QueueItem, QueueState, QueueStats } from "./types";

/**
 * Cola de respaldo en web: IndexedDB (src/web/queue-store.ts) es la fuente de
 * verdad — metadatos en `items` y los bytes del archivo en `files`, para que la
 * cola sobreviva a una recarga. `queue` es solo una proyección en memoria de
 * los metadatos para que los getters sigan siendo síncronos; se actualiza
 * únicamente tras el commit de cada transacción (transaction.oncomplete).
 *
 * Las escrituras se encadenan en `writeChain` para que el orden de proyección
 * sea determinista (las transacciones IndexedDB sobre las mismas stores ya se
 * ordenan entre sí). Los mutadores son async, misma firma que db.ts nativo.
 */

type Row = QueueItem & { next_retry_at: number };

const queue = new Map<string, Row>();
const KV_PREFIX = "photos.kv.";
let writeChain: Promise<void> = Promise.resolve();
let initFor: { userId: string; promise: Promise<void> } | null = null;
let bc: BroadcastChannel | null = null;

const CONTEXT_ERROR = "El contexto de la cola ya no es válido.";

const PENDING_STATES: QueueState[] = [
  "queued",
  "hashing",
  "thumbnailing",
  "init",
  "uploading_thumb",
  "uploading_original",
  "completing",
];

/** Estados a mitad de procesamiento: si la pestaña muere ahí, la cola reanuda. */
const TRANSIENT_STATES: QueueState[] = PENDING_STATES.filter((s) => s !== "queued");

/** Encadena una escritura: se ejecuta tras la anterior, falle o no. */
function chained<T>(job: () => Promise<T>): Promise<T> {
  const p = writeChain.then(job);
  writeChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}

/**
 * Envuelve un mutador: captura el contexto activo EN EL MOMENTO DE LA LLAMADA
 * y, al ejecutarse (tras las escrituras previas encadenadas), exige que siga
 * siendo el mismo {userId, epoch} — una escritura tardía de un contexto viejo
 * se rechaza en vez de colarse en la cola de otro usuario. Si al llamarse aún
 * no había contexto (initializeQueue en curso, encadenado antes), se usa el
 * contexto vivo al ejecutar: la escritura iba destinada a ese usuario.
 */
function mutation<T>(job: (ctx: store.QueueContext) => Promise<T>): Promise<T> {
  const expected = store.getActiveContext();
  return chained(async () => {
    const live = store.getActiveContext();
    const ctx = expected ?? live;
    if (!ctx || !live || live.userId !== ctx.userId || live.epoch !== ctx.epoch) {
      throw new Error(CONTEXT_ERROR);
    }
    const result = await job(live);
    // Aviso a las demás pestañas del mismo usuario: BroadcastChannel no se
    // recibe a sí mismo, así que no hay eco ni bucle de refresco.
    try {
      bc?.postMessage({ type: "queue", userId: live.userId });
    } catch {}
    return result;
  });
}

/** Quita los campos solo-IDB (userId, assetId) y proyecta en el Map in-place. */
function applyRow(row: store.QueueRow): void {
  const { userId: _userId, assetId: _assetId, ...data } = row;
  const prev = queue.get(data.asset_id);
  if (prev) Object.assign(prev, data);
  else queue.set(data.asset_id, data);
}

type StateExtra = Partial<
  Pick<QueueItem, "sha256" | "remote_id" | "last_error" | "bytes_total" | "bytes_sent">
>;

/** Misma semántica que el UPDATE con coalesce de db.ts. */
function applyState(row: store.QueueRow, state: QueueState, extra: StateExtra): store.QueueRow {
  row.state = state;
  if (extra.sha256 != null) row.sha256 = extra.sha256;
  if (extra.remote_id != null) row.remote_id = extra.remote_id;
  row.last_error = extra.last_error ?? null;
  if (extra.bytes_total != null) row.bytes_total = extra.bytes_total;
  if (extra.bytes_sent != null) row.bytes_sent = extra.bytes_sent;
  row.updated_at = Date.now();
  return row;
}

/**
 * Canal entre pestañas del mismo origen: cada mutación publica
 * {type:"queue", userId} y las otras pestañas refrescan su proyección si el
 * mensaje es de SU usuario. Sin BroadcastChannel (p. ej. happy-dom) es noop.
 */
function openChannel(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    bc?.close();
    const channel = new BroadcastChannel("photos.queue");
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; userId?: string } | null;
      const ctx = store.getActiveContext();
      if (ctx && msg?.type === "queue" && msg.userId === ctx.userId) {
        void refreshProjection();
      }
    };
    bc = channel;
  } catch {
    bc = null;
  }
}

/**
 * Abre IndexedDB, fija el contexto activo (crea/incrementa el epoch de la
 * cuenta) e hidrata la proyección con los items del usuario. Idempotente para
 * el mismo userId; al cambiar de usuario se vacía la proyección antes de
 * hidratar la nueva.
 */
/** Misma convención que db.ts: último usuario con sesión, en kv. */
const OWNER_KEY = "queue.owner";

export function initializeQueue(userId: string): Promise<void> {
  if (store.getActiveContext()?.userId === userId) return Promise.resolve();
  if (initFor?.userId === userId) return initFor.promise;
  const promise = chained(async () => {
    await store.openQueueDb();
    const epoch = await store.createOrBumpEpoch(userId);
    const rows = await store.loadItems(userId);
    // Vaciar la proyección antes de hidratar los items del nuevo usuario.
    queue.clear();
    for (const row of rows) applyRow(row);
    store.setActiveContext({ userId, epoch });
    kvSet(OWNER_KEY, userId);
    openChannel();
    useQueueEvents.getState().emit();
  });
  initFor = { userId, promise };
  // Si la apertura falla no dejar el rechazo cacheado: permitir reintentar.
  promise.catch(() => {
    if (initFor?.promise === promise) initFor = null;
  });
  return promise;
}

/** Usuario al que pertenece la cola (paridad con db.ts; en web no hay headless). */
export function getQueueOwner(): string | null {
  return kvGet(OWNER_KEY);
}

/** Drena las escrituras pendientes, suelta el contexto y cierra IndexedDB. */
export async function closeQueue(): Promise<void> {
  initFor = null;
  await writeChain;
  store.setActiveContext(null);
  queue.clear();
  bc?.close();
  bc = null;
  store.closeQueueDb();
  try {
    localStorage.removeItem(KV_PREFIX + OWNER_KEY);
  } catch {}
}

/**
 * Recuperación tras recarga/cierre: cualquier item que quedó en un estado
 * transitorio vuelve a `queued` con bytes_sent=0 (la pasada lo reinicia desde
 * el hash; la subida de blobs es idempotente por sha256). Conserva attempts,
 * next_retry_at, sha256 y remote_id.
 */
export function recoverInterrupted(): Promise<void> {
  return mutation(async (ctx) => {
    const updated = await store.updateUserItems(ctx.userId, (row) =>
      TRANSIENT_STATES.includes(row.state)
        ? { ...row, state: "queued" as const, bytes_sent: 0, updated_at: Date.now() }
        : null,
    );
    for (const row of updated) applyRow(row);
  });
}

/**
 * Relee los items del contexto activo desde IndexedDB y reconstruye la
 * proyección. Es lo que ve a esta pestaña lo que encoló otra. Encadenada con
 * las escrituras para que el orden sea determinista; sin contexto no toca
 * nada (la proyección ya quedó vacía al cerrar).
 */
export function refreshProjection(): Promise<void> {
  return chained(async () => {
    const ctx = store.getActiveContext();
    if (!ctx) return;
    const rows = await store.loadItems(ctx.userId);
    // Reconstrucción in-place: borrar las filas que ya no existen y volcar el
    // resto con applyRow, que hace Object.assign sobre el objeto ya mapeado.
    // Así las referencias vivas que retienen los callers (p. ej. la fila que
    // processQueue tiene entre manos) ven los cambios en vez de quedar
    // desconectadas como le pasaría a un Map reconstruido con clear().
    const alive = new Set(rows.map((r) => r.asset_id));
    for (const key of [...queue.keys()]) {
      if (!alive.has(key)) queue.delete(key);
    }
    for (const row of rows) applyRow(row);
    useQueueEvents.getState().emit();
  });
}

export function getQueueDb(): never {
  throw new Error("SQLite no está disponible en web.");
}

export function kvGet(key: string): string | null {
  try {
    return localStorage.getItem(KV_PREFIX + key);
  } catch {
    return null;
  }
}

export function kvSet(key: string, value: string): void {
  try {
    localStorage.setItem(KV_PREFIX + key, value);
  } catch {}
}

const PAUSE_KEY = "backup.paused";

/**
 * Pausa persistente del respaldo: vive en `kv` (localStorage), así que
 * sobrevive a recargas y cierres de pestaña y la comparten todas las pestañas
 * del navegador. Nunca se limpia sola — solo "Reanudar" la quita.
 */
export function isBackupPaused(): boolean {
  return kvGet(PAUSE_KEY) === "1";
}

export function setBackupPaused(paused: boolean): void {
  kvSet(PAUSE_KEY, paused ? "1" : "0");
}

/** Último escaneo por usuario, como en db.ts (en web el scanner es no-op). */
export function getLastScanTs(): number {
  const uid = store.getActiveContext()?.userId ?? "anon";
  return Number(kvGet(`last_scan_ts:${uid}`) ?? "0");
}

export function setLastScanTs(ts: number): void {
  const uid = store.getActiveContext()?.userId ?? "anon";
  kvSet(`last_scan_ts:${uid}`, String(ts));
}

export type EnqueueInput = {
  id: string;
  uri: string;
  filename?: string | null;
  mediaType: "photo" | "video";
  creationTime: number;
};

export function enqueueAsset(asset: EnqueueInput, file?: File): Promise<void> {
  return mutation(async (ctx) => {
    if (queue.has(asset.id)) return;
    const row: store.QueueRow = {
      userId: ctx.userId,
      assetId: asset.id,
      asset_id: asset.id,
      uri: asset.uri,
      filename: asset.filename ?? null,
      media_type: asset.mediaType,
      created_at: asset.creationTime,
      state: "queued",
      sha256: null,
      remote_id: null,
      attempts: 0,
      last_error: null,
      bytes_total: 0,
      bytes_sent: 0,
      next_retry_at: 0,
      updated_at: Date.now(),
    };
    const payload = file
      ? {
          data: await file.arrayBuffer(),
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        }
      : null;
    // Fila + archivo en UNA transacción: si el archivo no cabe (cuota) no
    // queda una fila huérfana encolada.
    await store.saveItemWithFile(row, payload);
    applyRow(row);
  });
}

/**
 * Paridad con db.ts (batch en una transacción SQLite). El scanner web es
 * no-op, así que aquí basta un bucle secuencial — nadie lo llama con miles
 * de items.
 */
export async function enqueueAssetsBatch(assets: EnqueueInput[]): Promise<void> {
  for (const asset of assets) await enqueueAsset(asset);
}

export function setState(
  assetId: string,
  state: QueueState,
  extra: StateExtra = {},
): Promise<void> {
  return mutation(async (ctx) => {
    const updated = await store.updateItem(ctx.userId, assetId, (row) =>
      applyState(row, state, extra),
    );
    if (updated) applyRow(updated);
  });
}

/**
 * Marca el estado terminal y borra el blob del asset en UNA transacción.
 * Reemplaza el patrón setState + forgetFile en el processor web.
 */
export function finishItem(
  assetId: string,
  state: "done" | "duplicate",
  extra: StateExtra = {},
): Promise<void> {
  return mutation(async (ctx) => {
    const updated = await store.updateItem(
      ctx.userId,
      assetId,
      (row) => applyState(row, state, extra),
      { deleteFile: true },
    );
    if (updated) applyRow(updated);
  });
}

export function bumpAttempt(assetId: string): Promise<void> {
  return mutation(async (ctx) => {
    const updated = await store.updateItem(ctx.userId, assetId, (row) => {
      row.attempts += 1;
      return row;
    });
    if (updated) applyRow(updated);
  });
}

export function setNextRetryAt(assetId: string, at: number): Promise<void> {
  return mutation(async (ctx) => {
    const updated = await store.updateItem(ctx.userId, assetId, (row) => {
      row.next_retry_at = at;
      return row;
    });
    if (updated) applyRow(updated);
  });
}

export function getNextPending(): QueueItem | null {
  const now = Date.now();
  let best: Row | null = null;
  for (const row of queue.values()) {
    if (!PENDING_STATES.includes(row.state) || row.next_retry_at > now) continue;
    if (!best || row.created_at < best.created_at) best = row;
  }
  return best;
}

export function getPendingItems(limit = 100): QueueItem[] {
  return [...queue.values()]
    .filter((r) => r.state !== "done" && r.state !== "duplicate")
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);
}

export function getQueueItems(limit = 2000): QueueItem[] {
  return [...queue.values()].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

export function getFailed(limit = 50): QueueItem[] {
  return [...queue.values()]
    .filter((r) => r.state === "failed")
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, limit);
}

export function retryFailed(): Promise<void> {
  return mutation(async (ctx) => {
    const now = Date.now();
    const updated = await store.updateUserItems(ctx.userId, (row) =>
      row.state === "failed"
        ? {
            ...row,
            state: "queued",
            attempts: 0,
            last_error: null,
            bytes_sent: 0,
            // retry manual = inmediato, sin esperar el backoff
            next_retry_at: 0,
            updated_at: now,
          }
        : null,
    );
    for (const row of updated) applyRow(row);
  });
}

export function getQueueStats(): QueueStats {
  let done = 0;
  let pending = 0;
  let failed = 0;
  for (const row of queue.values()) {
    if (row.state === "done" || row.state === "duplicate") done++;
    else if (row.state === "failed") failed++;
    else pending++;
  }
  return { total: queue.size, done, pending, failed };
}

/**
 * Elimina items de la cola por asset_id (paridad con db.ts).
 */
export async function removeQueueItems(assetIds: string[]): Promise<void> {
  if (!assetIds.length) return;
  const ctx = store.getActiveContext();
  if (!ctx) return;
  await mutation(async (c) => {
    for (const id of assetIds) {
      queue.delete(id);
      await store.deleteFile(c.userId, id).catch(() => {});
    }
  });
}
