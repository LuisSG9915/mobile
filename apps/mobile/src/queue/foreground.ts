import { requireOptionalNativeModule } from "expo-modules-core";
import { AppState } from "react-native";
import { t } from "../i18n/es";
import { useSyncProgress } from "../lib/store";
import { describeUploadNotification } from "./notification-text";
import type { SyncProgressState } from "./types";

/**
 * Puente con el foreground service `dataSync` de Android
 * (`apps/mobile/modules/upload-foreground`).
 *
 * El servicio no sube nada: mantiene vivo el proceso (y la CPU despierta)
 * mientras `processQueue` sigue trabajando con la app minimizada. Se arranca
 * desde primer plano, cuando la cola empieza a subir, y se para cuando la
 * pasada termina. En iOS/web no existe y todo es no-op.
 */

type UploadForegroundNativeModule = {
  start(
    title: string,
    body: string,
    percent: number,
    timeoutTitle: string,
    timeoutBody: string,
  ): Promise<void>;
  update(title: string, body: string, percent: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  addListener(event: "onTimeout", listener: () => void): { remove(): void };
};

let native: UploadForegroundNativeModule | null | undefined;

function getNative(): UploadForegroundNativeModule | null {
  if (native !== undefined) return native;
  try {
    native = requireOptionalNativeModule<UploadForegroundNativeModule>("UploadForeground");
  } catch {
    native = null;
  }
  return native;
}

let started = false;
let startToken = 0;
/** Evita mandar dos `stopService` seguidos mientras el estado nativo se propaga. */
let stopSent = false;
let lastBody = "";
let lastSentAt = 0;
/** Rechazo por arrancar en segundo plano: no reintentar en bucle. */
let cooldownUntil = 0;

const UPDATE_INTERVAL_MS = 1_000;
const START_COOLDOWN_MS = 60_000;

/** Arranca el servicio si hay trabajo; idempotente. */
export function startUploadForeground(): void {
  const mod = getNative();
  if (!mod || started) return;
  // Un rechazo en segundo plano no debe impedir el arranque al volver a primer
  // plano: ahí el SO sí permite iniciar el servicio.
  if (Date.now() < cooldownUntil && AppState.currentState !== "active") return;

  const text = describeUploadNotification(useSyncProgress.getState());
  const token = ++startToken;
  started = true;
  stopSent = false;
  lastBody = text.body;
  lastSentAt = Date.now();

  void mod
    .start(
      text.title,
      text.body,
      text.percent,
      t.backup.notificationTimeoutTitle,
      t.backup.notificationTimeoutBody,
    )
    .catch(() => {
      // Un stop posterior ya invalidó este arranque: no pisar el cooldown.
      if (token !== startToken) return;
      started = false;
      lastBody = "";
      lastSentAt = 0;
      cooldownUntil = Date.now() + START_COOLDOWN_MS;
    });
}

/** Refresca la notificación (throttle a 1/s, como exige el sistema). */
export function updateUploadForeground(state: SyncProgressState): void {
  if (!started) return;
  const mod = getNative();
  if (!mod) return;
  const now = Date.now();
  if (now - lastSentAt < UPDATE_INTERVAL_MS) return;
  const text = describeUploadNotification(state);
  if (text.body === lastBody) return;
  lastSentAt = now;
  lastBody = text.body;
  void mod.update(text.title, text.body, text.percent).catch(() => {});
}

/** Para el servicio; idempotente y sin esperar a la promesa. */
export function stopUploadForeground(): void {
  const mod = getNative();
  if (!mod || stopSent) return;
  startToken++;
  stopSent = true;
  const wasRunning = started || isNativeRunning(mod);
  started = false;
  lastBody = "";
  lastSentAt = 0;
  if (!wasRunning) return;
  void mod.stop().catch(() => {});
}

/**
 * Android 15+ agotó el cupo de `dataSync` y el sistema exige parar. Devuelve
 * la función para desuscribirse.
 */
export function onUploadForegroundTimeout(handler: () => void): () => void {
  const mod = getNative();
  if (!mod) return () => {};
  try {
    const subscription = mod.addListener("onTimeout", () => {
      startToken++;
      started = false;
      stopSent = true;
      lastBody = "";
      lastSentAt = 0;
      handler();
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

function isNativeRunning(mod: UploadForegroundNativeModule): boolean {
  try {
    return mod.isRunning();
  } catch {
    return false;
  }
}
