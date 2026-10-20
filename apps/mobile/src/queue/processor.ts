import { MIME_BY_EXT } from "@photos/shared";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { queryClient } from "../lib/query-client";
import { useItemProgress, useSettings } from "../lib/store";
import {
  bumpAttempt,
  finishItem,
  getNextPending,
  getQueueDb,
  getQueuedWithSha,
  isBackupPaused,
  type QueueItem,
  recoverInterrupted,
  setBackupPaused,
  setNextRetryAt,
  setState,
} from "./db";
import { sha256File } from "./hash";
import { publishSyncProgress } from "./progress";
import { BACKOFF_MS, extFromFilename, extToMediaType, MAX_ATTEMPTS } from "./shared";
import { makeThumbAndHash } from "./thumb";

let running = false;
let cancelled = false;
let forceCellular = false;
let activeUploadTask: FileSystem.UploadTask | null = null;

let refreshPending = false;

function invalidateRemoteData() {
  try {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["stats"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["storage"] }).catch(() => {});
  } catch {}
}

/**
 * En background no hay UI que refrescar: se acumula y se invalida una sola vez
 * al cerrar la pasada, en vez de hacerlo por cada archivo.
 */
function refreshRemoteData() {
  if (AppState.currentState !== "active") {
    refreshPending = true;
    return;
  }
  invalidateRemoteData();
}

function flushRemoteData() {
  if (!refreshPending) return;
  refreshPending = false;
  invalidateRemoteData();
}

/** Cambio estructural de la cola: estado, encolado, borrado o vínculo remoto. */
function emitStructure() {
  useQueueEvents.getState().emit();
  publishSyncProgress(true);
}

/**
 * Corta la pasada y cancela la subida HTTP en vuelo (paridad con el AbortController
 * de web). Sin esto el UploadTask seguía subiendo en background hasta terminar.
 */
export function cancelQueue() {
  cancelled = true;
  void activeUploadTask?.cancelAsync().catch(() => {});
}

export function isRunning() {
  return running;
}

/** "Subir ahora": permite una pasada por datos móviles sin cambiar el ajuste. */
export function allowUploadOnCellularOnce(): void {
  forceCellular = true;
}

async function canUploadNow(): Promise<{ ok: boolean; reason?: "wifi" }> {
  if (!useSettings.getState().wifiOnly || forceCellular) return { ok: true };
  const net = await Network.getNetworkStateAsync();
  const type = net.type;
  if (type === Network.NetworkStateType.WIFI || type === Network.NetworkStateType.ETHERNET) {
    return { ok: true };
  }
  return { ok: false, reason: "wifi" };
}

function parseExifDate(exif: Record<string, unknown> | null | undefined): number | null {
  if (!exif) return null;
  const raw =
    (exif.DateTimeOriginal as string | undefined) ??
    (exif["{TIFF}"] as Record<string, unknown> | undefined)?.DateTimeOriginal ??
    (exif["{Exif}"] as Record<string, unknown> | undefined)?.DateTimeOriginal;
  if (typeof raw !== "string") return null;
  // Formato EXIF: "YYYY:MM:DD HH:MM:SS"
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

/** Sin progreso en este tiempo = subida estancada → abortar y reintentar. */
const STALL_MS = 90_000;
const WATCHDOG_TICK_MS = 15_000;

async function uploadFile(
  target: { url: string; headers: Record<string, string> },
  fileUri: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  // Presigned PUT: enviar exactamente el content-type firmado; el OS pone content-length.
  const headers = { ...target.headers };
  delete headers["content-length"]; // el upload task lo calcula y debe coincidir
  let lastEventAt = Date.now();
  const task = FileSystem.createUploadTask(
    target.url,
    fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      headers,
    },
    (p) => {
      lastEventAt = Date.now();
      onProgress?.(p.totalBytesSent, p.totalBytesExpectedToSend);
    },
  );
  activeUploadTask = task;
  // Watchdog: una conexión colgada sin eventos no puede congelar la cola.
  const watchdog = setInterval(() => {
    if (Date.now() - lastEventAt > STALL_MS) void task.cancelAsync().catch(() => {});
  }, WATCHDOG_TICK_MS);
  try {
    const res = await task.uploadAsync();
    if (!res || (res.status !== 200 && res.status !== 204)) {
      throw new Error(`La subida falló (HTTP ${res?.status}).`);
    }
  } finally {
    clearInterval(watchdog);
    if (activeUploadTask === task) activeUploadTask = null;
  }
}

async function processItem(item: QueueItem): Promise<void> {
  const db = getQueueDb();

  const info = await MediaLibrary.getAssetInfoAsync(item.asset_id, {
    shouldDownloadFromNetwork: true,
  });
  const localUri = info.localUri ?? item.uri;
  const file = new File(localUri);
  const fileSize = file.size ?? 0;
  // Extensión real del archivo: si no está soportada (RAW, AVIF…) el fallback
  // de extFromFilename la etiquetaría como jpg/mp4 en R2 — mejor fallar claro.
  const rawExt = (item.filename?.split(".").pop() ?? "").toLowerCase();
  if (rawExt && !(rawExt in MIME_BY_EXT)) {
    await setState(item.asset_id, "failed", {
      last_error: `Formato no admitido (.${rawExt}).`,
    });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    emitStructure();
    return;
  }
  const ext = extFromFilename(item.filename, item.media_type);
  const mimeType = MIME_BY_EXT[ext];
  const mediaType = extToMediaType(ext);
  // Filas encoladas con created_at=0 (assets sin EXIF) también necesitan
  // un takenAt válido: el API exige entero positivo.
  const takenAt =
    parseExifDate(info.exif as Record<string, unknown> | null) ??
    (item.created_at > 0 ? item.created_at : Date.now());
  const lat = info.location?.latitude ?? null;
  const lon = info.location?.longitude ?? null;
  const width = info.width || 1;
  const height = info.height || 1;
  const durationMs = item.media_type === "video" ? Math.round((info.duration ?? 0) * 1000) : null;

  await setState(item.asset_id, "hashing", { bytes_total: fileSize });
  emitStructure();
  const sha256 = await sha256File(localUri);

  // Dedup criptográfica temprana: si el API ya tiene este sha256 'ready', la
  // foto queda SYNCED sin generar miniatura ni emitir PUTs prefirmados. Si la
  // llamada falla (sin red), se sigue el flujo normal: /init deduplica igual.
  try {
    const { existing } = await api.checkHashes([sha256]);
    const hit = existing.find((e) => e.sha256 === sha256);
    if (hit) {
      await finishItem(item.asset_id, "duplicate", {
        sha256,
        remote_id: hit.id,
        bytes_sent: fileSize,
      });
      useItemProgress.getState().clearItemProgress(item.asset_id);
      refreshRemoteData();
      emitStructure();
      return;
    }
  } catch {
    // Error de red/servidor: el init de abajo sigue haciendo la dedup.
  }

  await setState(item.asset_id, "thumbnailing");
  emitStructure();
  const thumb = await makeThumbAndHash(mediaType, localUri);

  await setState(item.asset_id, "init", { sha256 });
  emitStructure();
  const init = await api.initUpload({
    sha256,
    mediaType,
    mimeType,
    ext,
    fileSize,
    thumbSize: thumb.bytes,
    takenAt,
    latitude: lat,
    longitude: lon,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    durationMs,
    thumbhash: thumb.thumbhash,
  });

  if (init.status === "duplicate") {
    await setState(item.asset_id, "duplicate", { remote_id: init.id, bytes_sent: fileSize });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    safeDelete(thumb.uri);
    refreshRemoteData();
    emitStructure();
    return;
  }

  await setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  emitStructure();
  await uploadFile(init.thumb, thumb.uri);
  safeDelete(thumb.uri);

  await setState(item.asset_id, "uploading_original");
  emitStructure();
  const fileUri = file.uri;
  let lastProgress = 0;
  await uploadFile(init.original, fileUri, (sent) => {
    const now = Date.now();
    if (now - lastProgress > 500) {
      lastProgress = now;
      db.runSync("UPDATE queue SET bytes_sent = ? WHERE asset_id = ? AND user_id IS ?", [
        sent,
        item.asset_id,
        item.user_id ?? null,
      ]);
      useItemProgress.getState().setItemProgress(item.asset_id, fileSize > 0 ? sent / fileSize : 0);
      publishSyncProgress(true);
    }
  });

  await setState(item.asset_id, "completing", { bytes_sent: fileSize });
  emitStructure();
  await api.completeUpload(init.id);
  await setState(item.asset_id, "done", { remote_id: init.id, bytes_sent: fileSize });
  useItemProgress.getState().clearItemProgress(item.asset_id);
  refreshRemoteData();
  emitStructure();
}

function safeDelete(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
}

export type ProcessOptions = {
  maxItems?: number;
  deadlineMs?: number;
  prioritizePhotos?: boolean;
};

/** Dedup por lote de items que ya tienen sha (reintentos/pre-hasheados). */
async function preflightDedup(): Promise<void> {
  const items = getQueuedWithSha(10);
  if (items.length === 0) return;
  try {
    const { existing } = await api.checkHashes(
      items.map((i) => i.sha256).filter((s): s is string => Boolean(s)),
    );
    if (existing.length === 0) return;
    const bySha = new Map(existing.map((e) => [e.sha256, e.id]));
    for (const item of items) {
      const remoteId = item.sha256 ? bySha.get(item.sha256) : undefined;
      if (!remoteId || !item.sha256) continue;
      await finishItem(item.asset_id, "duplicate", {
        sha256: item.sha256,
        remote_id: remoteId,
        bytes_sent: item.bytes_total,
      });
      useItemProgress.getState().clearItemProgress(item.asset_id);
    }
    refreshRemoteData();
    emitStructure();
  } catch {
    // Sin red el flujo normal de /init sigue deduplicando.
  }
}

export async function processQueue(opts: ProcessOptions = {}): Promise<void> {
  if (running) return;
  running = true;
  cancelled = false;
  let processed = 0;
  try {
    // La app pudo morir a mitad de un item (kill): devolver los estados
    // transitorios a queued con bytes_sent=0 antes de elegir el siguiente.
    await recoverInterrupted().catch(() => {});
    await preflightDedup();
    while (true) {
      if (cancelled) break;
      // Pausa persistente: el item en vuelo terminó; no se toma el siguiente.
      if (isBackupPaused()) break;
      if (opts.maxItems !== undefined && processed >= opts.maxItems) break;
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) break;

      const net = await canUploadNow();
      if (!net.ok) break;

      const synced = useSettings.getState().syncedAlbumIds;
      if (Array.isArray(synced) && synced.length === 0) break;

      const item = getNextPending({ prioritizePhotos: opts.prioritizePhotos });
      if (!item) break;

      try {
        await processItem(item);
        processed++;
      } catch (e) {
        if (cancelled) {
          // Cancelada por el usuario (logout): vuelve a queued sin gastar intento.
          await setState(item.asset_id, "queued").catch(() => {});
          useItemProgress.getState().clearItemProgress(item.asset_id);
          emitStructure();
          break;
        }
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        // Sesión caída a mitad de pasada: reintentar quemaría intentos hasta
        // 'failed' contra un 401 que no se arregla solo. Reencolar y cortar.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          await setState(item.asset_id, "queued").catch(() => {});
          useItemProgress.getState().clearItemProgress(item.asset_id);
          emitStructure();
          break;
        }
        // 4xx definitivos no arreglan solos reintentando: failed directo.
        // 413 quota_exceeded además pausa el respaldo para no quemar intentos
        // en el resto de la cola — el usuario libera espacio y reanuda.
        if (e instanceof ApiError && e.status === 413) {
          await setState(item.asset_id, "failed", { last_error: message });
          setBackupPaused(true);
        } else if (e instanceof ApiError && e.status === 400) {
          await setState(item.asset_id, "failed", { last_error: message });
        } else {
          const db = getQueueDb();
          const row = db.getFirstSync<{ attempts: number }>(
            "SELECT attempts FROM queue WHERE asset_id = ? AND user_id IS ?",
            [item.asset_id, item.user_id ?? null],
          );
          const attempts = (row?.attempts ?? item.attempts) + 1;
          await bumpAttempt(item.asset_id);
          if (attempts >= MAX_ATTEMPTS) {
            await setState(item.asset_id, "failed", { last_error: message });
          } else {
            const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
            await setNextRetryAt(item.asset_id, Date.now() + wait);
            await setState(item.asset_id, "queued", { last_error: message });
          }
        }
        useItemProgress.getState().clearItemProgress(item.asset_id);
        emitStructure();
      }
    }
  } finally {
    running = false;
    forceCellular = false;
    flushRemoteData();
    publishSyncProgress(false);
  }
}
