import { useEffect } from "react";
import { useQueueEvents } from "../lib/events";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export type BackupPassOptions = { forceScan?: boolean };

/**
 * En web no hay biblioteca que escanear (scanLibrary es no-op): solo procesa.
 * `forceScan` existe por paridad de firma con el runner nativo.
 */
export async function runBackupPass(_opts: BackupPassOptions = {}): Promise<void> {
  await scanLibrary();
  useQueueEvents.getState().emit();
  await processQueue();
  useQueueEvents.getState().emit();
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
    const pass = () => {
      void runBackupPass().catch(() => {});
    };
    pass();
    const onVisibility = () => {
      if (document.visibilityState === "visible") pass();
    };
    const onOnline = () => pass();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) pass();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [enabled]);
}
