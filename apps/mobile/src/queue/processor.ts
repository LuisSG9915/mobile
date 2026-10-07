import { MIME_BY_EXT } from "@photos/shared";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { queryClient } from "../lib/query-client";
import { useSettings } from "../lib/store";
import {
  bumpAttempt,
  finishItem,
  getNextPending,
  getQueueDb,
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
let activeUploadTask: FileSystem.UploadTask | null = null;

function refreshRemoteData() {
  try {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["stats"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["storage"] }).catch(() => {});
  } catch {}
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

async function canUploadNow(): Promise<{ ok: boolean; reason?: "wifi" }> {
  if (!useSettings.getState().wifiOnly) return { ok: true };
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
    useQueueEvents.getState().emit();
    publishSyncProgress(true);
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
      refreshRemoteData();
      useQueueEvents.getState().emit();
      publishSyncProgress(true);
      return;
    }
  } catch {
    // Error de red/servidor: el init de abajo sigue haciendo la dedup.
  }

  await setState(item.asset_id, "thumbnailing");
  const thumb = await makeThumbAndHash(mediaType, localUri);

  await setState(item.asset_id, "init", { sha256 });
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
    safeDelete(thumb.uri);
    refreshRemoteData();
    publishSyncProgress(true);
    return;
  }

  await setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  await uploadFile(init.thumb, thumb.uri);
  safeDelete(thumb.uri);

  await setState(item.asset_id, "uploading_original");
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
      useQueueEvents.getState().emit();
      publishSyncProgress(true);
    }
  });

  await setState(item.asset_id, "completing", { bytes_sent: fileSize });
  await api.completeUpload(init.id);
  await setState(item.asset_id, "done", { remote_id: init.id, bytes_sent: fileSize });
  refreshRemoteData();
  useQueueEvents.getState().emit();
  publishSyncProgress(true);
}

function safeDelete(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
}

export type ProcessOptions = { maxItems?: number; deadlineMs?: number };

export async function processQueue(opts: ProcessOptions = {}): Promise<void> {
  if (running) return;
  running = true;
  cancelled = false;
  let processed = 0;
  try {
    // La app pudo morir a mitad de un item (kill): devolver los estados
    // transitorios a queued con bytes_sent=0 antes de elegir el siguiente.
    await recoverInterrupted().catch(() => {});
    while (true) {
      if (cancelled) break;
      // Pausa persistente: el item en vuelo terminó; no se toma el siguiente.
      if (isBackupPaused()) break;
      if (opts.maxItems !== undefined && processed >= opts.maxItems) break;
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) break;

      const net = await canUploadNow();
      if (!net.ok) break;

      const item = getNextPending();
      if (!item) break;

      try {
        await processItem(item);
        processed++;
      } catch (e) {
        if (cancelled) {
          // Cancelada por el usuario (logout): vuelve a queued sin gastar intento.
          await setState(item.asset_id, "queued").catch(() => {});
          break;
        }
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
        // Sesión caída a mitad de pasada: reintentar quemaría intentos hasta
        // 'failed' contra un 401 que no se arregla solo. Reencolar y cortar.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          await setState(item.asset_id, "queued").catch(() => {});
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
        useQueueEvents.getState().emit();
        publishSyncProgress(true);
      }
    }
  } finally {
    running = false;
    publishSyncProgress(false);
  }
}
