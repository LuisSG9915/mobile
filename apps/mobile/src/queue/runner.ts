import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueueEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import { getLastScanTs, isBackupPaused } from "./db";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export type BackupPassOptions = { forceScan?: boolean; incrementalWindowMs?: number };

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
  if (
    opts.forceScan ||
    opts.incrementalWindowMs !== undefined ||
    Date.now() - getLastScanTs() > SCAN_MIN_INTERVAL_MS
  ) {
    await scanLibrary({
      forceScan: opts.forceScan,
      incrementalWindowMs: opts.incrementalWindowMs,
    });
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
    let disposed = false;
    let librarySub: { remove: () => void } | null = null;
    let networkSub: { remove: () => void } | null = null;
    let libraryTimer: ReturnType<typeof setTimeout> | null = null;
    let networkTimer: ReturnType<typeof setTimeout> | null = null;
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

    // Foto nueva en el carrete: micro-escaneo incremental con debounce.
    void (async () => {
      try {
        const perm = await MediaLibrary.getPermissionsAsync(false, ["photo", "video"]);
        if (!perm.granted || disposed) return;
        librarySub = MediaLibrary.addListener(() => {
          if (disposed) return;
          if (libraryTimer) clearTimeout(libraryTimer);
          libraryTimer = setTimeout(() => {
            libraryTimer = null;
            void runBackupPass({ incrementalWindowMs: 60_000 }).catch(() => {});
          }, 2500);
        });
      } catch {
        // Sin permisos o listener no disponible: queda el escaneo periódico.
      }
    })();

    // Al recuperar red/Wi-Fi, reanudar sin esperar al timer de 60 s.
    try {
      networkSub = Network.addNetworkStateListener((state) => {
        if (disposed || !state.isConnected || state.isInternetReachable === false) return;
        const { wifiOnly } = useSettings.getState();
        if (
          wifiOnly &&
          state.type !== Network.NetworkStateType.WIFI &&
          state.type !== Network.NetworkStateType.ETHERNET
        ) {
          return;
        }
        if (isBackupPaused()) return;
        if (networkTimer) clearTimeout(networkTimer);
        networkTimer = setTimeout(() => {
          networkTimer = null;
          pass();
        }, 1000);
      });
    } catch {
      // Sin listener de red: el runner periódico sigue cubriendo el caso.
    }

    return () => {
      disposed = true;
      sub.remove();
      clearInterval(interval);
      if (libraryTimer) clearTimeout(libraryTimer);
      if (networkTimer) clearTimeout(networkTimer);
      librarySub?.remove();
      networkSub?.remove();
    };
  }, [enabled]);
}
