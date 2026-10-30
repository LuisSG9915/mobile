import { MIME_BY_EXT, MULTIPART_THRESHOLD_BYTES } from "@photos/shared";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { AppState } from "react-native";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { queryClient } from "../lib/query-client";
import { useItemProgress, useSettings } from "../lib/store";
import { cancelVideoCompression, createVideoPreview } from "../lib/video-optimizer";
import {
  bumpAttempt,
  clearMultipartState,
  finishItem,
  getNextPending,
  getQueueDb,
  getQueuedWithoutHash,
  getQueuedWithSha,
  isBackupPaused,
  type QueueItem,
  recoverInterrupted,
  setBackupPaused,
  setItemHash,
  setNeedsEmailVerification,
  setNextRetryAt,
  setState,
} from "./db";
import { sha256File } from "./hash";
import { publishByteTick, publishSyncProgress } from "./progress";
import {
  BACKOFF_MS,
  extFromFilename,
  extToMediaType,
  MAX_ATTEMPTS,
  mapWithConcurrency,
  PART_PRESIGN_BATCH_SIZE,
  PART_UPLOAD_CONCURRENCY,
  withDeadline,
} from "./shared";
import { makePreview, makeThumbAndHash, type ThumbResult } from "./thumb";
import { PartUploadError, uploadPartBlob } from "./upload-part";

let running = false;
let cancelled = false;
let forceCellular = false;
const activeUploadTasks = new Set<FileSystem.UploadTask>();
/** PUT de parte en vuelo: `cancelQueue` los aborta igual que los UploadTask. */
const activePartControllers = new Set<AbortController>();
const precheckedHashes = new Set<string>();
const thumbCache = new Map<string, ThumbResult>();
const THUMB_CACHE_MAX = 2;

type MultipartSession = {
  id: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
};

/**
 * La sesión multipart guardada ya no existe en R2: el lifecycle aborta las MPU
 * incompletas a los 7 días, otro dispositivo puede cerrarla y una fila puede
 * apuntar a una sesión distinta. Sus partes no se pueden reutilizar, así que el
 * journal se descarta y se abre una sesión limpia (una sola vez).
 */
class MultipartGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartGoneError";
  }
}

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
  for (const task of activeUploadTasks) void task.cancelAsync().catch(() => {});
  for (const controller of activePartControllers) controller.abort();
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

/**
 * Videos >2 GB: el preview H.264 costaría decenas de minutos de MediaCodec en
 * gama media y el item parece congelado. El original sube igual; el visor usa
 * la miniatura o el original como fallback.
 */
const VIDEO_PREVIEW_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Hash SHA-256: mínimo 4 min + ~8 MB/s de margen por tamaño (eMMC lento). */
const HASH_MIN_DEADLINE_MS = 240_000;
/** Miniatura y preview de foto: cualquier cosa >4 min está rota, no lenta. */
const THUMB_DEADLINE_MS = 240_000;
/** Compresión ~1.5× la duración real del video en CPU débil; mínimo 5 min. */
const PREVIEW_MIN_DEADLINE_MS = 300_000;
const PREVIEW_DEADLINE_RATIO = 1.5;
/** Lectura de metadatos del asset (puede intentar descarga de red): 3 min. */
const ASSET_INFO_DEADLINE_MS = 180_000;

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
  activeUploadTasks.add(task);
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
    activeUploadTasks.delete(task);
  }
}

async function processItem(item: QueueItem, allowLookahead = true): Promise<void> {
  const db = getQueueDb();

  const info = await withDeadline(
    MediaLibrary.getAssetInfoAsync(item.asset_id, {
      shouldDownloadFromNetwork: true,
    }),
    ASSET_INFO_DEADLINE_MS,
    "leer-info",
  );
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
  const sha256 =
    item.sha256 ??
    (await withDeadline(
      sha256File(localUri),
      Math.max(HASH_MIN_DEADLINE_MS, fileSize / 8192),
      "hash",
    ));
  if (!item.sha256) await setItemHash(item.asset_id, sha256, fileSize);

  // Dedup criptográfica temprana: si el API ya tiene este sha256 'ready', la
  // foto queda SYNCED sin generar miniatura ni emitir PUTs prefirmados. El
  // pre-hasheo por lotes ya lo comprobó para esta pasada.
  if (!precheckedHashes.has(sha256)) {
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
  }

  await setState(item.asset_id, "thumbnailing");
  emitStructure();
  const cachedThumb = thumbCache.get(item.asset_id);
  const thumb =
    cachedThumb ??
    (await withDeadline(makeThumbAndHash(mediaType, localUri), THUMB_DEADLINE_MS, "miniatura"));
  if (cachedThumb) thumbCache.delete(item.asset_id);

  let preview: { uri: string; bytes: number } | null = null;
  if (mediaType === "video") {
    if (fileSize <= VIDEO_PREVIEW_MAX_BYTES) {
      let cancelId: string | null = null;
      preview = await withDeadline(
        createVideoPreview(localUri, {
          onCancelId: (id) => {
            cancelId = id;
          },
        }),
        Math.max(PREVIEW_MIN_DEADLINE_MS, (durationMs ?? 0) * PREVIEW_DEADLINE_RATIO),
        "preview-video",
        () => {
          if (cancelId) cancelVideoCompression(cancelId);
        },
      ).catch(() => null);
    }
    // Sin fallback a makePreview en video: el API firma el preview como
    // video/mp4 y un WebP subido ahí queda como objeto ilegible.
  } else {
    preview = await withDeadline(makePreview(mediaType, localUri), THUMB_DEADLINE_MS, "preview");
  }

  await setState(item.asset_id, "init", { sha256 });
  emitStructure();

  // Subida multipart reanudable para archivos > 20 MB
  if (fileSize > MULTIPART_THRESHOLD_BYTES) {
    const multipartPayload = {
      sha256,
      mediaType,
      mimeType,
      ext,
      fileSize,
      thumbSize: thumb.bytes,
      previewSize: preview?.bytes,
      takenAt,
      latitude: lat,
      longitude: lon,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      durationMs,
      thumbhash: thumb.thumbhash,
    };
    const init = await api.multipartInit({
      ...multipartPayload,
      uploadId: item.upload_id ?? undefined,
    });

    if (init.status === "duplicate") {
      await setState(item.asset_id, "duplicate", { remote_id: init.id, bytes_sent: fileSize });
      useItemProgress.getState().clearItemProgress(item.asset_id);
      safeDelete(thumb.uri);
      if (preview) safeDelete(preview.uri);
      refreshRemoteData();
      emitStructure();
      return;
    }

    const canResume = init.resumed === true;
    await setState(item.asset_id, "uploading_thumb", {
      remote_id: init.id,
      upload_id: init.uploadId,
      ...(canResume ? {} : { parts: "[]" }),
    });
    emitStructure();
    await uploadFile(init.thumb, thumb.uri);
    safeDelete(thumb.uri);

    if (init.preview && preview) {
      await uploadFile(init.preview, preview.uri);
      safeDelete(preview.uri);
    }

    await setState(item.asset_id, "uploading_original");
    emitStructure();

    let completedParts: { partNumber: number; etag: string }[] = [];
    if (canResume) {
      try {
        if (item.parts) completedParts = JSON.parse(item.parts);
      } catch {}
    }

    let session: MultipartSession = {
      id: init.id,
      uploadId: init.uploadId,
      partSize: init.partSize,
      totalParts: init.totalParts,
    };

    const uploadMissingParts = async (
      current: MultipartSession,
      done: { partNumber: number; etag: string }[],
    ): Promise<void> => {
      const doneMap = new Map(done.map((p) => [p.partNumber, p.etag]));
      const missingPartNumbers: number[] = [];
      for (let p = 1; p <= current.totalParts; p++) {
        if (!doneMap.has(p)) missingPartNumbers.push(p);
      }
      if (missingPartNumbers.length === 0) return;

      // Progreso real con varias partes en vuelo: lo confirmado + lo que cada
      // parte lleva enviado (sin contar dos veces el mismo byte).
      let completedBytes = done.length * current.partSize;
      const inflightLoaded = new Map<number, number>();
      const publishProgress = () => {
        let sent = completedBytes;
        for (const loaded of inflightLoaded.values()) sent += loaded;
        publishByteTick(item.asset_id, sent, fileSize);
      };

      // Prefirmado por lotes: cada lote se sube antes de firmar el siguiente, así
      // ninguna URL caduca en vuelo (ver PART_PRESIGN_BATCH_SIZE).
      for (let offset = 0; offset < missingPartNumbers.length; offset += PART_PRESIGN_BATCH_SIZE) {
        const batch = missingPartNumbers.slice(offset, offset + PART_PRESIGN_BATCH_SIZE);

        let presignedParts: { partNumber: number; url: string }[];
        try {
          ({ parts: presignedParts } = await api.multipartPresignParts({
            id: current.id,
            uploadId: current.uploadId,
            partNumbers: batch,
          }));
        } catch (err) {
          // 409 upload_id_mismatch: la fila apunta a otra MPU → la guardada murió.
          if (err instanceof ApiError && err.status === 409) {
            throw new MultipartGoneError(err.message);
          }
          throw err;
        }

        await mapWithConcurrency(presignedParts, PART_UPLOAD_CONCURRENCY, async (part) => {
          if (cancelled) throw new Error("Subida cancelada.");
          const start = (part.partNumber - 1) * current.partSize;
          const end = Math.min(fileSize, start + current.partSize);
          const partLength = end - start;

          // Rango perezoso del original: ni base64 (+33%) ni archivo temporal, y
          // el PUT reporta progreso por byte (antes saltaba por parte entera).
          const partController = new AbortController();
          activePartControllers.add(partController);
          inflightLoaded.set(part.partNumber, 0);

          try {
            const { etag } = await uploadPartBlob({
              url: part.url,
              blob: new File(localUri).slice(start, end),
              signal: partController.signal,
              onProgress: (sent) => {
                inflightLoaded.set(part.partNumber, sent);
                publishProgress();
              },
            });
            inflightLoaded.delete(part.partNumber);
            completedBytes += partLength;
            done.push({ partNumber: part.partNumber, etag });
            // Journal ordenado: R2 exige las partes ascendentes al completar.
            await setState(item.asset_id, "uploading_original", {
              parts: JSON.stringify([...done].sort((a, b) => a.partNumber - b.partNumber)),
              bytes_sent: completedBytes,
            });
            publishProgress();
          } catch (err) {
            inflightLoaded.delete(part.partNumber);
            // 404 NoSuchUpload: la MPU ya no existe. Reintentar con la misma
            // sesión no puede funcionar nunca; el caller reinicia con una limpia.
            if (err instanceof PartUploadError && err.status === 404) {
              throw new MultipartGoneError(
                `La sesión multipart ya no existe (parte ${part.partNumber}).`,
              );
            }
            throw err;
          } finally {
            activePartControllers.delete(partController);
          }
        });
      }
    };

    // Dos pasadas como máximo: la segunda solo existe para el caso "la MPU
    // guardada murió". Un tercer intento convertiría un fallo permanente en un
    // bucle de red que nunca sube el vídeo.
    for (let attempt = 1; ; attempt++) {
      try {
        await uploadMissingParts(session, completedParts);
        break;
      } catch (err) {
        if (!(err instanceof MultipartGoneError) || attempt >= 2) throw err;
        await clearMultipartState(item.asset_id);
        completedParts = [];
        const restarted = await api.multipartInit({ ...multipartPayload });
        if (restarted.status === "duplicate") {
          await finishItem(item.asset_id, "duplicate", {
            remote_id: restarted.id,
            bytes_sent: fileSize,
          });
          useItemProgress.getState().clearItemProgress(item.asset_id);
          refreshRemoteData();
          emitStructure();
          return;
        }
        session = {
          id: restarted.id,
          uploadId: restarted.uploadId,
          partSize: restarted.partSize,
          totalParts: restarted.totalParts,
        };
        await setState(item.asset_id, "uploading_original", {
          remote_id: session.id,
          upload_id: session.uploadId,
          parts: "[]",
          bytes_sent: 0,
        });
        emitStructure();
      }
    }

    completedParts.sort((a, b) => a.partNumber - b.partNumber);
    await setState(item.asset_id, "completing", { bytes_sent: fileSize });
    emitStructure();
    await api.multipartComplete({
      id: session.id,
      uploadId: session.uploadId,
      parts: completedParts,
    });
    await setState(item.asset_id, "done", { remote_id: session.id, bytes_sent: fileSize });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    refreshRemoteData();
    emitStructure();
    return;
  }

  // Subida estándar para archivos ≤ 20 MB
  const init = await api.initUpload({
    sha256,
    mediaType,
    mimeType,
    ext,
    fileSize,
    thumbSize: thumb.bytes,
    previewSize: preview?.bytes,
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
    if (preview) safeDelete(preview.uri);
    refreshRemoteData();
    emitStructure();
    return;
  }

  await setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  emitStructure();
  await uploadFile(init.thumb, thumb.uri);
  safeDelete(thumb.uri);

  if (init.preview && preview) {
    await uploadFile(init.preview, preview.uri);
    safeDelete(preview.uri);
  }

  await setState(item.asset_id, "uploading_original");
  emitStructure();
  if (allowLookahead) void prepareNextThumb(item.asset_id);
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
      publishByteTick(item.asset_id, sent, fileSize);
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

function clearThumbCache() {
  for (const thumb of thumbCache.values()) safeDelete(thumb.uri);
  thumbCache.clear();
}

/**
 * Lookahead: mientras el original actual viaja a R2, prepara la miniatura del
 * siguiente item `queued` para que su turno no espere CPU.
 */
async function prepareNextThumb(currentAssetId: string): Promise<void> {
  if (thumbCache.size >= THUMB_CACHE_MAX) return;
  const next = getNextPending({ prioritizePhotos: true, excludeAssetId: currentAssetId });
  if (next?.media_type !== "photo" || thumbCache.has(next.asset_id)) return;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(next.asset_id, {
      shouldDownloadFromNetwork: true,
    });
    const thumb = await makeThumbAndHash("photo", info.localUri ?? next.uri);
    if (thumbCache.size >= THUMB_CACHE_MAX) {
      safeDelete(thumb.uri);
      return;
    }
    thumbCache.set(next.asset_id, thumb);
  } catch {
    // Si falla, el item lo generará en su propio turno.
  }
}

export type ProcessOptions = {
  maxItems?: number;
  deadlineMs?: number;
  prioritizePhotos?: boolean;
  /** Subidas simultáneas; 1 = secuencial (comportamiento histórico). */
  concurrency?: number;
  /** Background: saltar el pre-hasheo por lotes para no agotar el deadline. */
  skipBatchPrehash?: boolean;
};

const MAX_CONCURRENCY = 4;

/** Pre-hashea hasta 8 items `queued` y deduplica el lote en una sola llamada. */
async function prehashAndDedup(): Promise<void> {
  const items = getQueuedWithoutHash(8);
  if (items.length === 0) return;
  const hashed: { item: QueueItem; sha256: string; fileSize: number }[] = [];
  for (const item of items) {
    try {
      const info = await withDeadline(
        MediaLibrary.getAssetInfoAsync(item.asset_id, {
          shouldDownloadFromNetwork: true,
        }),
        ASSET_INFO_DEADLINE_MS,
        "prehash:leer-info",
      );
      const uri = info.localUri ?? item.uri;
      const fileSize = new File(uri).size ?? 0;
      // El pre-hash de un archivo grande tarda minutos: marcar `hashing` para
      // que la UI muestre el item y su fase en vez de parecer congelada.
      await setState(item.asset_id, "hashing", { bytes_total: fileSize }).catch(() => {});
      emitStructure();
      const sha256 = await withDeadline(
        sha256File(uri),
        Math.max(HASH_MIN_DEADLINE_MS, fileSize / 8192),
        "prehash:hash",
      );
      await setItemHash(item.asset_id, sha256, fileSize);
      // Con el sha ya persistido vuelve a queued: el flujo normal lo toma con
      // item.sha256 y evita re-hashear (la dedup por lote decide abajo).
      await setState(item.asset_id, "queued").catch(() => {});
      precheckedHashes.add(sha256);
      hashed.push({ item, sha256, fileSize });
    } catch {
      await setState(item.asset_id, "queued").catch(() => {});
      // El item se procesará individualmente y reportará su error.
    }
  }
  if (hashed.length === 0) return;
  try {
    const { existing } = await api.checkHashes(hashed.map((h) => h.sha256));
    if (existing.length === 0) return;
    const bySha = new Map(existing.map((e) => [e.sha256, e.id]));
    for (const h of hashed) {
      const remoteId = bySha.get(h.sha256);
      if (!remoteId) continue;
      await finishItem(h.item.asset_id, "duplicate", {
        sha256: h.sha256,
        remote_id: remoteId,
        bytes_sent: h.fileSize,
      });
      useItemProgress.getState().clearItemProgress(h.item.asset_id);
    }
    refreshRemoteData();
    emitStructure();
  } catch {
    // Sin red el flujo normal de /init sigue deduplicando.
  }
}

/** Dedup por lote de items que ya tienen sha (reintentos/pre-hasheados). */
async function preflightDedup(): Promise<void> {
  const items = getQueuedWithSha(10).filter((i) => !i.sha256 || !precheckedHashes.has(i.sha256));
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
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(opts.concurrency ?? 1)));
  const inFlight = new Set<string>();
  let videosInFlight = 0;
  precheckedHashes.clear();
  try {
    // La app pudo morir a mitad de un item (kill): devolver los estados
    // transitorios a queued con bytes_sent=0 antes de elegir el siguiente.
    await recoverInterrupted().catch(() => {});
    if (!opts.skipBatchPrehash) {
      await prehashAndDedup();
      await preflightDedup();
    }

    const deadlinePassed = () => opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs;
    const shouldStop = () =>
      cancelled ||
      isBackupPaused() ||
      (opts.maxItems !== undefined && processed >= opts.maxItems) ||
      deadlinePassed();

    /** Devuelve true cuando la pasada debe cortarse (cancelación/sesión caída). */
    const handleFailure = async (item: QueueItem, e: unknown): Promise<boolean> => {
      if (cancelled) {
        // Cancelada por el usuario (logout): vuelve a queued sin gastar intento.
        await setState(item.asset_id, "queued").catch(() => {});
        useItemProgress.getState().clearItemProgress(item.asset_id);
        emitStructure();
        return true;
      }
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      // Correo sin verificar: no es una sesión caída. Pausar con el motivo
      // visible para que el usuario pueda reenviar la verificación en vez de
      // ver la cola detenida sin explicación.
      if (e instanceof ApiError && e.status === 403 && e.code === "email_unverified") {
        await setState(item.asset_id, "queued", { last_error: message }).catch(() => {});
        useItemProgress.getState().clearItemProgress(item.asset_id);
        setBackupPaused(true);
        setNeedsEmailVerification(true);
        emitStructure();
        return true;
      }
      // Sesión caída a mitad de pasada: reintentar quemaría intentos hasta
      // 'failed' contra un 401 que no se arregla solo. Reencolar y cortar.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await setState(item.asset_id, "queued").catch(() => {});
        useItemProgress.getState().clearItemProgress(item.asset_id);
        emitStructure();
        return true;
      }
      // 4xx definitivos no arreglan solos reintentando: failed directo.
      // 413 file_too_large: falla únicamente ese ítem y la cola continúa.
      // 413 quota_exceeded: además pausa el respaldo global para no quemar intentos.
      if (e instanceof ApiError && e.status === 413) {
        if (e.code === "file_too_large") {
          await setState(item.asset_id, "failed", { last_error: "file_too_large" });
        } else {
          await setState(item.asset_id, "failed", { last_error: message });
          setBackupPaused(true);
        }
      } else if (e instanceof ApiError && e.status === 400) {
        if (item.remote_id) {
          try {
            await api.cancelUpload(item.remote_id, { uploadId: item.upload_id });
          } catch {}
        }
        await setState(item.asset_id, "failed", { last_error: message });
      } else {
        const db = getQueueDb();
        const row = db.getFirstSync<{ attempts: number; remote_id?: string; upload_id?: string }>(
          "SELECT attempts, remote_id, upload_id FROM queue WHERE asset_id = ? AND user_id IS ?",
          [item.asset_id, item.user_id ?? null],
        );
        const attempts = (row?.attempts ?? item.attempts) + 1;
        await bumpAttempt(item.asset_id);
        if (attempts >= MAX_ATTEMPTS) {
          const remoteId = row?.remote_id ?? item.remote_id;
          if (remoteId) {
            try {
              await api.cancelUpload(remoteId, { uploadId: row?.upload_id ?? item.upload_id });
            } catch {}
          }
          await setState(item.asset_id, "failed", { last_error: message });
        } else {
          const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
          await setNextRetryAt(item.asset_id, Date.now() + wait);
          await setState(item.asset_id, "queued", { last_error: message });
        }
      }
      useItemProgress.getState().clearItemProgress(item.asset_id);
      emitStructure();
      return false;
    };

    const worker = async (): Promise<void> => {
      while (!shouldStop()) {
        const net = await canUploadNow();
        if (!net.ok) return;

        const synced = useSettings.getState().syncedAlbumIds;
        if (Array.isArray(synced) && synced.length === 0) return;

        const item = getNextPending({
          prioritizePhotos: opts.prioritizePhotos,
          excludeAssetIds: [...inFlight],
        });
        if (!item) return;

        inFlight.add(item.asset_id);
        let reservedVideo = false;
        try {
          // Un video a la vez: su miniatura y buffer pesan mucho más.
          if (item.media_type === "video") {
            while (videosInFlight > 0 && !cancelled && !deadlinePassed()) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            if (videosInFlight > 0) return;
            videosInFlight++;
            reservedVideo = true;
          }
          await processItem(item, concurrency === 1);
          processed++;
          if (concurrency === 1 && processed % 8 === 0) await prehashAndDedup();
        } catch (e) {
          if (await handleFailure(item, e)) return;
        } finally {
          if (reservedVideo) videosInFlight--;
          inFlight.delete(item.asset_id);
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    running = false;
    forceCellular = false;
    precheckedHashes.clear();
    clearThumbCache();
    flushRemoteData();
    publishSyncProgress(false);
  }
}
