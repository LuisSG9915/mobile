import { MIME_BY_EXT } from "@photos/shared";
import { ApiError, api } from "../api/client";
import { useQueueEvents } from "../lib/events";
import { queryClient } from "../lib/query-client";
import { getFile } from "../web/files";
import { sha256File } from "../web/hash";
import { getActiveContext } from "../web/queue-store";
import { makeThumb } from "../web/thumb";
import { uploadBlob } from "../web/upload";
import {
  bumpAttempt,
  finishItem,
  getNextPending,
  isBackupPaused,
  type QueueItem,
  recoverInterrupted,
  refreshProjection,
  setNextRetryAt,
  setState,
} from "./db";
import { publishSyncProgress } from "./progress";
import { BACKOFF_MS, extFromFilename, extToMediaType, MAX_ATTEMPTS } from "./shared";

const CANCELLED_MSG = "Subida cancelada.";

let running = false;
let cancelled = false;
let controller: AbortController | null = null;

/** Detiene la pasada en curso: aborta las peticiones/XHR en vuelo. */
export function cancelQueue() {
  cancelled = true;
  controller?.abort();
}

export function isRunning() {
  return running;
}

function refreshRemoteData() {
  try {
    void queryClient.invalidateQueries({ queryKey: ["timeline"] }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: ["stats"] }).catch(() => {});
  } catch {}
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
    return;
  }

  const ext = extFromFilename(item.filename, item.media_type);
  const mimeType = file.type || MIME_BY_EXT[ext];
  const mediaType = extToMediaType(ext);

  await setState(item.asset_id, "hashing", { bytes_total: file.size });
  const sha256 = await sha256File(file);
  throwIfAborted(signal);

  // Dedup criptográfica temprana: si el API ya tiene este sha256 'ready', la
  // foto queda SYNCED sin generar miniatura ni emitir PUTs. Si la llamada
  // falla (abort → propagar; red → seguir), /init deduplica igual.
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
      refreshRemoteData();
      publishSyncProgress(true);
      return;
    }
  } catch {
    // Abort durante la llamada → propagar; error de red → seguir.
    throwIfAborted(signal);
  }

  await setState(item.asset_id, "thumbnailing");
  const thumb = await makeThumb(mediaType, file);
  throwIfAborted(signal);
  if (!thumb.thumbhash) throw new Error("No se pudo generar la huella de la miniatura.");

  await setState(item.asset_id, "init", { sha256 });
  const init = await api.initUpload(
    {
      sha256,
      mediaType,
      mimeType,
      ext,
      fileSize: file.size,
      thumbSize: thumb.bytes,
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
    refreshRemoteData();
    publishSyncProgress(true);
    return;
  }

  await setState(item.asset_id, "uploading_thumb", { remote_id: init.id });
  await uploadBlob(init.thumb, thumb.blob, undefined, signal);
  throwIfAborted(signal);

  await setState(item.asset_id, "uploading_original");
  let lastProgress = 0;
  await uploadBlob(
    init.original,
    file,
    (sent) => {
      const now = Date.now();
      if (now - lastProgress > 500) {
        lastProgress = now;
        void setState(item.asset_id, "uploading_original", { bytes_sent: sent }).catch(() => {});
        useQueueEvents.getState().emit();
        publishSyncProgress(true);
      }
    },
    signal,
  );
  throwIfAborted(signal);

  await setState(item.asset_id, "completing", { bytes_sent: file.size });
  await api.completeUpload(init.id, { signal });
  await finishItem(item.asset_id, "done", { remote_id: init.id, bytes_sent: file.size });
  refreshRemoteData();
  useQueueEvents.getState().emit();
  publishSyncProgress(true);
}

export type ProcessOptions = { maxItems?: number; deadlineMs?: number };

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

          const item = getNextPending();
          if (!item) break;
          if (seenThisPass.has(item.asset_id)) break;
          seenThisPass.add(item.asset_id);

          try {
            await processItem(item, signal);
            processed++;
          } catch (e) {
            if (cancelled || signal.aborted) {
              // Cancelada por el usuario (logout/cierre): vuelve a queued SIN
              // consumir intento. Si el contexto ya murió, falla y no importa.
              try {
                await setState(item.asset_id, "queued");
              } catch {}
              break;
            }
            const message =
              e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
            try {
              await bumpAttempt(item.asset_id);
              if (item.attempts >= MAX_ATTEMPTS) {
                await setState(item.asset_id, "failed", { last_error: message });
              } else {
                const wait = BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)];
                await setNextRetryAt(item.asset_id, Date.now() + wait);
                await setState(item.asset_id, "queued", { last_error: message });
              }
            } catch {
              // La cola se cerró a mitad de la pasada (logout/cierre): nada que anotar.
            }
            useQueueEvents.getState().emit();
            publishSyncProgress(true);
          }
        }
      } finally {
        running = false;
        if (controller === ctrl) controller = null;
        publishSyncProgress(false);
      }
    },
  );
}
