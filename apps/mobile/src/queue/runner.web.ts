import { useEffect } from "react";
import { useQueueEvents } from "../lib/events";
import { isBackupPaused, retryFailed } from "./db";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export type BackupPassOptions = { forceScan?: boolean; incrementalWindowMs?: number };

/**
 * En web no hay biblioteca que escanear (scanLibrary es no-op): solo procesa.
 * `forceScan` existe por paridad de firma con el runner nativo.
 */
export async function runBackupPass(opts: BackupPassOptions = {}): Promise<void> {
  await scanLibrary(opts);
  useQueueEvents.getState().emit();
  await processQueue();
  useQueueEvents.getState().emit();
}

let webResuming = false;

/**
 * Escucha el evento online en el navegador para reintentar elementos fallidos
 * y reanudar el procesamiento de la cola automáticamente al recuperar la red.
 */
export function initNetworkAutoResume(): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = async () => {
    if (webResuming) return;
    if (isBackupPaused()) return;
    webResuming = true;
    try {
      await retryFailed();
      await runBackupPass({ forceScan: false });
    } catch {
      // Ignorar fallos transitorios
    } finally {
      webResuming = false;
    }
  };

  window.addEventListener("online", onOnline);
  return () => {
    window.removeEventListener("online", onOnline);
  };
}

/**
 * Mantiene la cola viva mientras la pestaña está abierta:
 * al montar, al volver a la pestaña (visibilitychange), al recuperar la red
 * (online) y cada 60 s mientras la pestaña esté visible y con conexión.
 * La exclusión entre pestañas la da el Web Lock dentro de processQueue.
 */
export function useBackupRunner(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const cleanupAutoResume = initNetworkAutoResume();
    const pass = () => {
      void runBackupPass().catch(() => {});
    };
    pass();
    const onVisibility = () => {
      if (document.visibilityState === "visible") pass();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) pass();
    }, 60_000);
    return () => {
      cleanupAutoResume();
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, [enabled]);
}
