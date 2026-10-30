import { useEffect } from "react";
import { useQueueEvents } from "../lib/events";
import { useItemProgress, useSyncProgress } from "../lib/store";
import { getActiveItem, getQueueItems } from "./db";
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
 * Ventana móvil de velocidad: muestras de (tiempo, bytes) de los últimos
 * `RATE_WINDOW_MS`. Da MB/s y ETA sin estado duplicado ni archivo nuevo, y se
 * reinicia sola si el contador retrocede (nueva pasada, borrado de la cola).
 */
const RATE_WINDOW_MS = 8_000;
let rateSamples: { at: number; bytesUploaded: number }[] = [];

/** Solo para tests: olvida la ventana entre casos. */
export function resetRateWindow(): void {
  rateSamples = [];
}

function movingRate(bytesUploaded: number, at: number): number {
  const last = rateSamples[rateSamples.length - 1];
  if (last && bytesUploaded < last.bytesUploaded) rateSamples = [];
  rateSamples.push({ at, bytesUploaded });
  const cutoff = at - RATE_WINDOW_MS;
  while (rateSamples.length > 2 && rateSamples[0].at < cutoff) rateSamples.shift();
  const first = rateSamples[0];
  const spanSeconds = (at - first.at) / 1000;
  if (rateSamples.length < 2 || spanSeconds <= 0) return 0;
  const delta = bytesUploaded - first.bytesUploaded;
  if (delta <= 0) return 0;
  return delta / spanSeconds;
}

/**
 * Proyección de la cola al estado agregado del anillo. `running` lo pasan los
 * procesadores (que conocen su propio flag) para distinguir "syncing" de
 * "paused" cuando aún quedan pendientes pero ningún ítem está en curso.
 */
export function computeSyncProgress(
  items: QueueItem[],
  running: boolean,
  at: number = Date.now(),
  activeItem?: QueueItem | null,
): SyncProgressState {
  let totalBytes = 0;
  let bytesUploaded = 0;
  let filesRemaining = 0;
  let failed = 0;
  let currentFileName = "";
  let currentPhase: QueueState | null = null;
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
      currentPhase = i.state;
    }
  }
  // El item en curso puede quedar fuera de la ventana de `items` (colas
  // grandes): si lo reporta el procesador, tiene prioridad.
  if (activeItem && TRANSIENT.has(activeItem.state)) {
    currentFileName = activeItem.filename ?? activeItem.asset_id;
    currentPhase = activeItem.state;
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
  // Velocidad y ETA solo mientras hay algo en vuelo: en pausa la ventana
  // envejecería y mostraría una velocidad que ya no existe.
  const syncing = status === "syncing";
  const bytesPerSecond = syncing ? movingRate(bytesUploaded, at) : 0;
  const remainingBytes = Math.max(0, totalBytes - bytesUploaded);
  const etaSeconds =
    syncing && bytesPerSecond > 0 && remainingBytes > 0
      ? Math.ceil(remainingBytes / bytesPerSecond)
      : null;

  return {
    bytesUploaded,
    totalBytes,
    filesTotal: items.length,
    filesRemaining,
    currentFileName,
    currentPhase,
    bytesPerSecond,
    etaSeconds,
    status,
  };
}

// Último `running` reportado por el procesador: los ticks externos (encolados,
// reintentos, otra pestaña) republican con ese valor sin importar ./processor
// (evita el ciclo progress ↔ processor y mantiene el módulo ligero/testeable).
let lastRunning = false;

/** Bytes ya contabilizados por asset en el último snapshot estructural. */
const sentByAsset = new Map<string, number>();

/** Recalcula la proyección y la publica en el store global. */
export function publishSyncProgress(running: boolean): void {
  lastRunning = running;
  const items = getQueueItems();
  useSyncProgress
    .getState()
    .update(computeSyncProgress(items, running, undefined, getActiveItem()));
  sentByAsset.clear();
  for (const item of items) {
    sentByAsset.set(item.asset_id, Math.min(item.bytes_sent || 0, item.bytes_total || 0));
  }
}

/**
 * Tick de bytes (cada ~500 ms): actualiza solo el delta del asset activo, sin
 * leer la cola de SQLite. El snapshot completo se recalcula en los cambios
 * estructurales vía publishSyncProgress.
 */
export function publishByteTick(assetId: string, bytesSent: number, bytesTotal: number): void {
  const total = Math.max(0, bytesTotal);
  const sent = Math.max(0, Math.min(bytesSent, total || Number.MAX_SAFE_INTEGER));
  const prev = sentByAsset.get(assetId) ?? 0;
  const delta = Math.max(0, sent - prev);
  sentByAsset.set(assetId, sent);
  useItemProgress.getState().setItemProgress(assetId, total > 0 ? sent / total : 0);
  if (delta <= 0) return;

  const current = useSyncProgress.getState();
  const bytesUploaded = Math.min(current.totalBytes, current.bytesUploaded + delta);
  // El tick de bytes no recalcula la cola, pero sí la velocidad: sin esto la
  // ETA solo se movería en los cambios estructurales.
  const bytesPerSecond = current.status === "syncing" ? movingRate(bytesUploaded, Date.now()) : 0;
  const remainingBytes = Math.max(0, current.totalBytes - bytesUploaded);
  useSyncProgress.getState().update({
    ...current,
    bytesUploaded,
    bytesPerSecond,
    etaSeconds:
      current.status === "syncing" && bytesPerSecond > 0 && remainingBytes > 0
        ? Math.ceil(remainingBytes / bytesPerSecond)
        : null,
  });
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
