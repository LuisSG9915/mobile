import { captureMessage } from "../lib/telemetry";

/**
 * Eventos de telemetría de la cola, PII-safe: nunca incluyen user id, nombres
 * de archivo ni rutas. Los campos se restringen a fase, intentos, backoff, bucket
 * de tamaño, tipo de red y flag de background.
 */
export type QueueEventName =
  | "queue.pass.start"
  | "queue.pass.done"
  | "queue.item.fail"
  | "queue.stall.watchdog"
  | "queue.foreground.start_failed"
  | "queue.foreground.timeout_reached"
  | "queue.background.failed"
  | "queue.auth.required";

export type QueueEventFields = {
  phase?: string;
  attempts?: number;
  backoffMs?: number;
  sizeBucket?: "<1MB" | "1-10MB" | "10-100MB" | ">100MB";
  networkType?: string;
  background?: boolean;
  status?: number | null;
  code?: string | null;
  idleMs?: number;
  thresholdMs?: number;
  pendingCount?: number;
  osVersion?: string | null;
};

export function recordQueueEvent(name: QueueEventName, fields: QueueEventFields = {}): void {
  // Log estructurado local (siempre, para medición Phase 0).
  console.info(`[queue-event] ${name}`, fields);
  // Envío remoto solo si hay DSN configurado; nunca lanza.
  try {
    captureMessage(`queue:${name}`, "info");
  } catch {
    // no-op: la telemetría no debe romper la cola.
  }
}
