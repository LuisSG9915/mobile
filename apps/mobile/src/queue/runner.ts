import * as MediaLibrary from "expo-media-library/legacy";
import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueueEvents } from "../lib/events";
import { useSettings } from "../lib/store";
import { registerBackupTask } from "./background";
import { getLastScanTs, getQueueStats, isBackupPaused, retryFailed } from "./db";
import { processQueue } from "./processor";
import { scanLibrary } from "./scanner";

export type BackupPassOptions = { forceScan?: boolean; incrementalWindowMs?: number };

/**
 * Mínimo entre escaneos completos de la biblioteca. El scan pagina TODA la
 * biblioteca, así que no puede correr en cada pasada de 60 s: solo al abrir
 * la app / volver a foreground si pasó el intervalo, o a demanda.
 */
const SCAN_MIN_INTERVAL_MS = 15 * 60_000;

/** Subidas simultáneas al minimizar: el SO las continúa con la app suspendida. */
const BACKGROUND_BURST_CONCURRENCY = 3;

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

let wasOffline = false;
let resuming = false;

/**
 * Escucha cambios de conectividad para reanudar la cola automáticamente y
 * reintentar elementos fallidos (status = 'error') cuando se restablece la red.
 * Devuelve una función para limpiar el listener.
 */
export function initNetworkAutoResume(): () => void {
  let disposed = false;
  let subscription: { remove: () => void } | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  void Network.getNetworkStateAsync?.()
    .then((initialState) => {
      if (disposed || !initialState) return;
      wasOffline = !initialState.isConnected || initialState.isInternetReachable === false;
    })
    .catch(() => {});

  const handleStateChange = (state: Network.NetworkState | Network.NetworkStateEvent) => {
    if (disposed) return;
    const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);

    if (!isOnline) {
      wasOffline = true;
      return;
    }

    if (wasOffline && isOnline) {
      wasOffline = false;
      if (resuming) return;
      if (isBackupPaused()) return;

      const { wifiOnly } = useSettings.getState();
      if (
        wifiOnly &&
        state.type !== Network.NetworkStateType.WIFI &&
        state.type !== Network.NetworkStateType.ETHERNET
      ) {
        return;
      }

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        if (disposed || resuming || isBackupPaused()) return;
        resuming = true;
        try {
          await retryFailed();
          await runBackupPass({ forceScan: false });
        } catch {
          // Fallos transitorios ignorados; el ciclo periódico lo reintentará
        } finally {
          resuming = false;
        }
      }, 1000);
    }
  };

  try {
    if (typeof Network.addNetworkStateListener === "function") {
      subscription = Network.addNetworkStateListener((state) => {
        handleStateChange(state);
      });
    }
  } catch {
    // Si addNetworkStateListener no está disponible en este entorno
  }

  return () => {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    subscription?.remove();
  };
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
    let libraryTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanupAutoResume = initNetworkAutoResume();
    // Las pasadas son de mejor esfuerzo: un fallo (scan, red, permisos) no
    // debe propagarse como rechazo no manejado.
    const pass = () => {
      void runBackupPass().catch(() => {});
    };
    // Arranque diferido: deja pintar la primera página del timeline y sus
    // miniaturas antes de competir por CPU/red con el escaneo.
    const startTimer = setTimeout(pass, 2000);

    /**
     * Al minimizar: lanzar ya la ráfaga (sin escanear) para que las sesiones
     * BACKGROUND del SO sigan subiendo aunque el hilo JS quede suspendido.
     */
    const startBackgroundBurst = () => {
      try {
        if (isBackupPaused()) return;
        if (getQueueStats().pending <= 0) return;
        void processQueue({
          prioritizePhotos: true,
          skipBatchPrehash: true,
          concurrency: BACKGROUND_BURST_CONCURRENCY,
        }).catch(() => {});
        void registerBackupTask().catch(() => {});
      } catch {
        // Sin cola disponible: el runner periódico lo reintenta.
      }
    };

    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") pass();
      else if (s === "background") startBackgroundBurst();
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

    return () => {
      disposed = true;
      clearTimeout(startTimer);
      sub.remove();
      clearInterval(interval);
      if (libraryTimer) clearTimeout(libraryTimer);
      librarySub?.remove();
      cleanupAutoResume();
    };
  }, [enabled]);
}
