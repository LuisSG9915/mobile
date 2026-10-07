import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueueEvents } from "../lib/events";
import { getLastScanTs } from "./db";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export type BackupPassOptions = { forceScan?: boolean };

/**
 * Mínimo entre escaneos completos de la biblioteca. El scan pagina TODA la
 * biblioteca, así que no puede correr en cada pasada de 60 s: solo al abrir
 * la app / volver a foreground si pasó el intervalo, o a demanda.
 */
const SCAN_MIN_INTERVAL_MS = 15 * 60_000;

/**
 * Escanea la biblioteca (si toca por cadencia o se fuerza) y procesa la cola
 * una vez. processQueue es barato con cola vacía — el throttle es para el scan.
 */
export async function runBackupPass(opts: BackupPassOptions = {}): Promise<void> {
  if (opts.forceScan || Date.now() - getLastScanTs() > SCAN_MIN_INTERVAL_MS) {
    await scanLibrary();
  }
  useQueueEvents.getState().emit();
  await processQueue();
  useQueueEvents.getState().emit();
}

/**
 * Mantiene la cola viva mientras la app está en primer plano:
 * al abrir la app, al volver del background y cada 60 s.
 */
export function useBackupRunner(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    // Las pasadas son de mejor esfuerzo: un fallo (scan, red, permisos) no
    // debe propagarse como rechazo no manejado.
    const pass = () => {
      void runBackupPass().catch(() => {});
    };
    pass();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") pass();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") pass();
    }, 60_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [enabled]);
}
