import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueueEvents } from "../lib/events";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

/** Escanea la biblioteca y procesa la cola una vez. */
export async function runBackupPass(): Promise<void> {
  await scanLibrary();
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
    void runBackupPass();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void runBackupPass();
    });
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void runBackupPass();
    }, 60_000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [enabled]);
}
