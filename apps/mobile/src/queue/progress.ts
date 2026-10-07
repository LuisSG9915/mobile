import { useEffect } from "react";
import { useQueueEvents } from "../lib/events";
import { useSyncProgress } from "../lib/store";
import { getQueueItems } from "./db";
import type { QueueItem, QueueState, SyncProgressState, SyncProgressStatus } from "./types";

const TRANSIENT: ReadonlySet<QueueState> = new Set([
  "hashing",
  "thumbnailing",
  "init",
  "uploading_thumb",
  "uploading_original",
  "completing",
]);

const TERMINAL: ReadonlySet<QueueState> = new Set(["done", "duplicate", "failed"]);

/**
 * Proyección de la cola al estado agregado del anillo. `running` lo pasan los
 * procesadores (que conocen su propio flag) para distinguir "syncing" de
 * "paused" cuando aún quedan pendientes pero ningún ítem está en curso.
 */
export function computeSyncProgress(items: QueueItem[], running: boolean): SyncProgressState {
  let totalBytes = 0;
  let bytesUploaded = 0;
  let filesRemaining = 0;
  let failed = 0;
  let currentFileName = "";
  for (const i of items) {
    if (TERMINAL.has(i.state)) {
      if (i.state === "failed") failed++;
    } else {
      filesRemaining++;
    }
    const total = i.bytes_total || 0;
    totalBytes += total;
    bytesUploaded += Math.min(i.bytes_sent || 0, total);
    if (!currentFileName && TRANSIENT.has(i.state)) {
      currentFileName = i.filename ?? i.asset_id;
    }
  }
  const status: SyncProgressStatus =
    running && filesRemaining > 0
      ? "syncing"
      : filesRemaining === 0
        ? failed > 0
          ? "error"
          : items.length > 0
            ? "completed"
            : "idle"
        : failed > 0
          ? "error"
          : "paused";
  return {
    bytesUploaded,
    totalBytes,
    filesTotal: items.length,
    filesRemaining,
    currentFileName,
    status,
  };
}

// Último `running` reportado por el procesador: los ticks externos (encolados,
// reintentos, otra pestaña) republican con ese valor sin importar ./processor
// (evita el ciclo progress ↔ processor y mantiene el módulo ligero/testeable).
let lastRunning = false;

/** Recalcula la proyección y la publica en el store global. */
export function publishSyncProgress(running: boolean): void {
  lastRunning = running;
  useSyncProgress.getState().update(computeSyncProgress(getQueueItems(), running));
}

/**
 * Mantiene el progreso fresco ante cualquier tick de la cola: encolados
 * nuevos, reintentos o escrituras de otra pestaña (BroadcastChannel).
 */
export function useSyncProgressAuto(): void {
  useEffect(() => {
    publishSyncProgress(lastRunning);
    return useQueueEvents.subscribe(() => publishSyncProgress(lastRunning));
  }, []);
}
