import { MIME_BY_EXT, MULTIPART_THRESHOLD_BYTES } from "@photos/shared";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { queryClient } from "../lib/query-client";
import { useItemProgress } from "../lib/store";
import { getFile } from "../web/files";
import { sha256File } from "../web/hash";
import { getActiveContext } from "../web/queue-store";
import { makeThumb, makeWebPreview } from "../web/thumb";
import { UploadHttpError, uploadBlob, uploadPartBlob } from "../web/upload";
import {
  bumpAttempt,
  clearMultipartState,
  finishItem,
  getNextPending,
  getQueuedWithoutHash,
  getQueuedWithSha,
  isBackupPaused,
  type QueueItem,
  recoverInterrupted,
  refreshProjection,
  setBackupPaused,
  setItemHash,
  setNeedsEmailVerification,
  setNextRetryAt,
  setState,
} from "./db";
import { publishByteTick, publishSyncProgress } from "./progress";
import {
  BACKOFF_MS,
  extFromFilename,
  extToMediaType,
  MAX_ATTEMPTS,
  mapWithConcurrency,
  PART_PRESIGN_BATCH_SIZE,
  PART_UPLOAD_CONCURRENCY,
} from "./shared";

const CANCELLED_MSG = "Subida cancelada.";

let running = false;
let cancelled = false;
let controller: AbortController | null = null;
const precheckedHashes = new Set<string>();

type MultipartSession = {
  id: string;
  uploadId: string;
  partSize: number;
  totalParts: number;
};

/**
 * La sesión multipart guardada ya no existe en R2 (lifecycle a 7 días, cierre
 * desde otro dispositivo o fila apuntando a otra sesión). Paridad con
 * `processor.ts`: se descarta el journal y se abre una sesión limpia una vez.
 */
class MultipartGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartGoneError";
  }
}

/** Detiene la pasada en curso: aborta las peticiones/XHR en vuelo. */
export function cancelQueue() {
  cancelled = true;
  controller?.abort();
}

export function isRunning() {
  return running;
}

/** En web no hay restricción de Wi-Fi; paridad de API con el procesador nativo. */
export function allowUploadOnCellularOnce(): void {}

function refreshRemoteData() {
  try {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["stats"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["storage"] }).catch(() => {});
  } catch {}
}

/** Cambio estructural de la cola: estado, encolado, borrado o vínculo remoto. */
function emitStructure() {
  useQueueEvents.getState().emit();
  publishSyncProgress(true);
}

/** Tras cada await susceptible de cancelación. */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(CANCELLED_MSG);
}

async function processItem(item: QueueItem, signal: AbortSignal): Promise<void> {
  const file = await getFile(item.asset_id);
  throwIfAborted(signal);
  if (!file) {
    // Sin el archivo en IndexedDB no hay forma de subirlo: reintentar no sirve.
    await setState(item.asset_id, "failed", {
      last_error: "El archivo ya no está disponible. Vuelve a seleccionarlo.",
    });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    emitStructure();
    return;
  }

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
  const mimeType = file.type || MIME_BY_EXT[ext];
  const mediaType = extToMediaType(ext);

  await setState(item.asset_id, "hashing", { bytes_total: file.size });
  emitStructure();
  const sha256 = item.sha256 ?? (await sha256File(file));
  if (!item.sha256) await setItemHash(item.asset_id, sha256, file.size);
  throwIfAborted(signal);

  // Dedup criptográfica temprana: si el API ya tiene este sha256 'ready', la
  // foto queda SYNCED sin generar miniatura ni emitir PUTs. El pre-hasheo por
  // lotes ya lo comprobó para esta pasada.
  if (!precheckedHashes.has(sha256)) {
    try {
      const { existing } = await api.checkHashes([sha256], { signal });
      const hit = existing.find((e) => e.sha256 === sha256);
      if (hit) {
        // Estado terminal + borrado del blob en una sola transacción.
        await finishItem(item.asset_id, "duplicate", {
          sha256,
          remote_id: hit.id,
          bytes_sent: file.size,
        });
        useItemProgress.getState().clearItemProgress(item.asset_id);
        refreshRemoteData();
        emitStructure();
        return;
      }
    } catch {
      // Abort durante la llamada → propagar; error de red → seguir.
      throwIfAborted(signal);
    }
  }

  await setState(item.asset_id, "thumbnailing");
  emitStructure();
  const thumb = await makeThumb(mediaType, file);
  throwIfAborted(signal);
  if (!thumb.thumbhash) throw new Error("No se pudo generar la huella de la miniatura.");

  const preview = await makeWebPreview(mediaType, file);
  throwIfAborted(signal);

  await setState(item.asset_id, "init", { sha256 });
  emitStructure();

  // Subida multipart para archivos grandes (> 20 MB)
  if (file.size > MULTIPART_THRESHOLD_BYTES) {
    const multipartPayload = {
      sha256,
      mediaType,
      mimeType,
      ext,
      fileSize: file.size,
      thumbSize: thumb.bytes,
      previewSize: preview?.bytes,
      takenAt: item.created_at,
      width: thumb.width,
      height: thumb.height,
      durationMs: null,
      thumbhash: thumb.thumbhash,
    };
    const init = await api.multipartInit(
      { ...multipartPayload, uploadId: item.upload_id ?? undefined },
      { signal },
    );
    throwIfAborted(signal);

    if (init.status === "duplicate") {
      await finishItem(item.asset_id, "duplicate", { remote_id: init.id, bytes_sent: file.size });
      useItemProgress.getState().clearItemProgress(item.asset_id);
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
    await uploadBlob(init.thumb, thumb.blob, undefined, signal);
    throwIfAborted(signal);

    if (init.preview && preview) {
      await uploadBlob(init.preview, preview.blob, undefined, signal);
      throwIfAborted(signal);
    }

    await setState(item.asset_id, "uploading_original");
    emitStructure();

    // Partes ya subidas en intentos previos (reanudación)
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

      // Progreso real con varias partes en vuelo (paridad con nativo).
      let completedBytes = done.length * current.partSize;
      const inflightLoaded = new Map<number, number>();
      const publishProgress = () => {
        let sent = completedBytes;
        for (const loaded of inflightLoaded.values()) sent += loaded;
        publishByteTick(item.asset_id, sent, file.size);
      };

      // Prefirmado por lotes (paridad con processor.ts): una URL de parte vive
      // 900 s, así que no se firman 200 de golpe.
      for (let offset = 0; offset < missingPartNumbers.length; offset += PART_PRESIGN_BATCH_SIZE) {
        const batch = missingPartNumbers.slice(offset, offset + PART_PRESIGN_BATCH_SIZE);

        let presignedParts: { partNumber: number; url: string }[];
        try {
          ({ parts: presignedParts } = await api.multipartPresignParts(
            { id: current.id, uploadId: current.uploadId, partNumbers: batch },
            { signal },
          ));
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            throw new MultipartGoneError(err.message);
          }
          throw err;
        }
        throwIfAborted(signal);

        await mapWithConcurrency(presignedParts, PART_UPLOAD_CONCURRENCY, async (part) => {
          throwIfAborted(signal);
          const start = (part.partNumber - 1) * current.partSize;
          const end = Math.min(file.size, start + current.partSize);
          const slice = file.slice(start, end);
          inflightLoaded.set(part.partNumber, 0);

          let etag: string;
          try {
            etag = await uploadPartBlob(
              part.url,
              slice,
              (loaded) => {
                inflightLoaded.set(part.partNumber, loaded);
                publishProgress();
              },
              signal,
            );
          } catch (err) {
            inflightLoaded.delete(part.partNumber);
            // 404 NoSuchUpload: la MPU murió; reintentar la misma sesión no puede
            // funcionar nunca.
            if (err instanceof UploadHttpError && err.status === 404) {
              throw new MultipartGoneError(
                `La sesión multipart ya no existe (parte ${part.partNumber}).`,
              );
            }
            throw err;
          }

          inflightLoaded.delete(part.partNumber);
          completedBytes += end - start;
          done.push({ partNumber: part.partNumber, etag });
          // Journal ordenado: R2 exige las partes ascendentes al completar.
          await setState(item.asset_id, "uploading_original", {
            parts: JSON.stringify([...done].sort((a, b) => a.partNumber - b.partNumber)),
            bytes_sent: completedBytes,
          });
          publishProgress();
        });
      }
    };

    // Dos pasadas como máximo (ver processor.ts): la segunda solo cubre la MPU
    // que dejó de existir entre pasadas.
    for (let attempt = 1; ; attempt++) {
      try {
        await uploadMissingParts(session, completedParts);
        break;
      } catch (err) {
        if (!(err instanceof MultipartGoneError) || attempt >= 2) throw err;
        await clearMultipartState(item.asset_id);
        completedParts = [];
        const restarted = await api.multipartInit({ ...multipartPayload }, { signal });
        if (restarted.status === "duplicate") {
          await finishItem(item.asset_id, "duplicate", {
            remote_id: restarted.id,
            bytes_sent: file.size,
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
    await setState(item.asset_id, "completing", { bytes_sent: file.size });
    emitStructure();
    await api.multipartComplete(
      { id: session.id, uploadId: session.uploadId, parts: completedParts },
      { signal },
    );
    await finishItem(item.asset_id, "done", { remote_id: session.id, bytes_sent: file.size });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    refreshRemoteData();
    emitStructure();
    return;
  }

  // Subida estándar para archivos ≤ 20 MB
  const init = await api.initUpload(
    {
      sha256,
      mediaType,
      mimeType,
      ext,
      fileSize: file.size,
      thumbSize: thumb.bytes,
      previewSize: preview?.bytes,
      takenAt: item.created_at,
      width: thumb.width,
      height: thumb.height,
      durationMs: null,
      thumbhash: thumb.thumbhash,
    },
    { signal },
  );
  throwIfAborted(signal);

  if (init.status === "duplicate") {
    // Estado terminal + borrado del blob en una sola transacción.
    await finishItem(item.asset_id, "duplicate", { remote_id: init.id, bytes_sent: file.size });
    useItemProgress.getState().clearItemProgress(item.asset_id);
    refreshRemoteData();
    emitStructure();
    return;
  }

  await setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  emitStructure();
  await uploadBlob(init.thumb, thumb.blob, undefined, signal);
  throwIfAborted(signal);

  if (init.preview && preview) {
    await uploadBlob(init.preview, preview.blob, undefined, signal);
    throwIfAborted(signal);
  }

  await setState(item.asset_id, "uploading_original");
  emitStructure();
  let lastProgress = 0;
  await uploadBlob(
    init.original,
    file,
    (sent) => {
      const now = Date.now();
      if (now - lastProgress > 500) {
        lastProgress = now;
        void setState(item.asset_id, "uploading_original", { bytes_sent: sent }).catch(() => {});
        publishByteTick(item.asset_id, sent, file.size);
      }
    },
    signal,
  );
  throwIfAborted(signal);

  await setState(item.asset_id, "completing", { bytes_sent: file.size });
  emitStructure();
  await api.completeUpload(init.id, { signal });
  await finishItem(item.asset_id, "done", { remote_id: init.id, bytes_sent: file.size });
  useItemProgress.getState().clearItemProgress(item.asset_id);
  refreshRemoteData();
  emitStructure();
}

export type ProcessOptions = {
  maxItems?: number;
  deadlineMs?: number;
  prioritizePhotos?: boolean;
  /** Paridad con nativo; web procesa secuencial dentro del Web Lock. */
  concurrency?: number;
  /** Saltar el pre-hasheo por lotes (ráfaga de background). */
  skipBatchPrehash?: boolean;
};

/** Pre-hashea hasta 8 items `queued` y deduplica el lote en una sola llamada. */
async function prehashAndDedup(signal: AbortSignal): Promise<void> {
  const items = getQueuedWithoutHash(8);
  if (items.length === 0) return;
  const hashed: { item: QueueItem; sha256: string; fileSize: number }[] = [];
  for (const item of items) {
    try {
      const file = await getFile(item.asset_id);
      if (!file) continue;
      const sha256 = await sha256File(file);
      throwIfAborted(signal);
      await setItemHash(item.asset_id, sha256, file.size);
      precheckedHashes.add(sha256);
      hashed.push({ item, sha256, fileSize: file.size });
    } catch {
      throwIfAborted(signal);
    }
  }
  if (hashed.length === 0) return;
  try {
    const { existing } = await api.checkHashes(
      hashed.map((h) => h.sha256),
      { signal },
    );
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
    throwIfAborted(signal);
  }
}

/** Dedup por lote de items que ya tienen sha (reintentos/pre-hasheados). */
async function preflightDedup(signal: AbortSignal): Promise<void> {
  const items = getQueuedWithSha(10).filter((i) => !i.sha256 || !precheckedHashes.has(i.sha256));
  if (items.length === 0) return;
  try {
    const { existing } = await api.checkHashes(
      items.map((i) => i.sha256).filter((s): s is string => Boolean(s)),
      { signal },
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
    throwIfAborted(signal);
  }
}

/**
 * Una pasada de la cola, con exclusión por pestaña vía Web Locks
 * (`photos.queue.process:<userId>`, ifAvailable): si otra pestaña ya procesa,
 * esta llamada no hace nada. Sin Web Locks el respaldo persistente no puede
 * garantizar exclusión y se rechaza.
 */
export async function processQueue(opts: ProcessOptions = {}): Promise<void> {
  const ctx = getActiveContext();
  if (!ctx) return;
  if (typeof navigator.locks?.request !== "function") {
    throw new Error("Este navegador no admite el respaldo persistente (Web Locks).");
  }
  await navigator.locks.request(
    `photos.queue.process:${ctx.userId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return; // otra pestaña tiene la pasada en curso
      if (running) return;
      running = true;
      cancelled = false;
      precheckedHashes.clear();
      const ctrl = new AbortController();
      controller = ctrl;
      const signal = ctrl.signal;
      let processed = 0;
      // Si el contexto muere a mitad de pasada (epoch invalidado por otra
      // pestaña o logout), las escrituras rechazan y el item queda queued con
      // next_retry_at=0 → getNextPending lo devolvería en bucle. Cortar ahí.
      const seenThisPass = new Set<string>();
      try {
        // La pestaña pudo morir a mitad de un item: devolver los estados
        // transitorios a queued antes de elegir el siguiente pendiente.
        await recoverInterrupted().catch(() => {});
        if (!opts.skipBatchPrehash) {
          await prehashAndDedup(signal);
          await preflightDedup(signal);
        }
        while (true) {
          if (cancelled || signal.aborted) break;
          // Pausa persistente: el item en vuelo terminó; no se toma el siguiente.
          if (isBackupPaused()) break;
          if (opts.maxItems !== undefined && processed >= opts.maxItems) break;
          if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) break;
          // Logout/otro contexto a mitad de pasada: no seguir procesando.
          if (!getActiveContext()) break;
          // Ver lo que encoló otra pestaña entre iteración e iteración.
          await refreshProjection();

          const item = getNextPending({ prioritizePhotos: opts.prioritizePhotos });
          if (!item) break;
          if (seenThisPass.has(item.asset_id)) break;
          seenThisPass.add(item.asset_id);

          try {
            await processItem(item, signal);
            processed++;
            if (processed % 8 === 0) await prehashAndDedup(signal);
          } catch (e) {
            if (cancelled || signal.aborted) {
              // Cancelada por el usuario (logout/cierre): vuelve a queued SIN
              // consumir intento. Si el contexto ya murió, falla y no importa.
              try {
                await setState(item.asset_id, "queued");
              } catch {}
              useItemProgress.getState().clearItemProgress(item.asset_id);
              emitStructure();
              break;
            }
            const message =
              e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
            // Correo sin verificar: no es una sesión caída (ver processor.ts).
            if (e instanceof ApiError && e.status === 403 && e.code === "email_unverified") {
              try {
                await setState(item.asset_id, "queued", { last_error: message });
              } catch {}
              useItemProgress.getState().clearItemProgress(item.asset_id);
              setBackupPaused(true);
              setNeedsEmailVerification(true);
              emitStructure();
              break;
            }
            // Sesión caída a mitad de pasada: reintentar quemaría intentos
            // hasta 'failed' contra un 401 que no se arregla solo. Cortar.
            if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
              try {
                await setState(item.asset_id, "queued");
              } catch {}
              useItemProgress.getState().clearItemProgress(item.asset_id);
              emitStructure();
              break;
            }
            try {
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
                // Leer attempts ANTES de bumpAttempt: la fila proyectada es la
                // misma referencia viva y el bump la muta (doble conteo si no).
                const attempts = item.attempts + 1;
                await bumpAttempt(item.asset_id);
                if (attempts >= MAX_ATTEMPTS) {
                  if (item.remote_id) {
                    try {
                      await api.cancelUpload(item.remote_id, { uploadId: item.upload_id });
                    } catch {}
                  }
                  await setState(item.asset_id, "failed", { last_error: message });
                } else {
                  const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
                  await setNextRetryAt(item.asset_id, Date.now() + wait);
                  await setState(item.asset_id, "queued", { last_error: message });
                }
              }
            } catch {
              // La cola se cerró a mitad de la pasada (logout/cierre): nada que anotar.
            }
            useItemProgress.getState().clearItemProgress(item.asset_id);
            emitStructure();
          }
        }
      } finally {
        running = false;
        precheckedHashes.clear();
        if (controller === ctrl) controller = null;
        publishSyncProgress(false);
      }
    },
  );
}
