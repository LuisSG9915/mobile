import { EventEmitter, requireOptionalNativeModule } from "expo-modules-core";
import { AppState, Platform } from "react-native";
import { useSyncProgress } from "../lib/store";
import { describeUploadNotification } from "./notification-text";
import type { SyncProgressState } from "./types";

/**
 * Puente con el foreground service `dataSync` de Android
 * (`apps/mobile/modules/upload-foreground`).
 */

export type ForegroundAction = "pause_requested" | "timeout_reached";

export interface UploadForegroundNativeModule {
  start(title: string, body: string): Promise<boolean>;
  update(title: string, body: string, progress?: number, total?: number): Promise<boolean>;
  stop(): Promise<boolean>;
}

let cachedModule: UploadForegroundNativeModule | null | undefined;

function getNativeModule(): UploadForegroundNativeModule | null {
  if (Platform.OS !== "android") return null;
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule = requireOptionalNativeModule<UploadForegroundNativeModule>("UploadForeground");
  } catch {
    cachedModule = null;
  }
  return cachedModule ?? null;
}

export async function startForegroundUploadService(title: string, body: string): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return await mod.start(title, body);
  } catch {
    return false;
  }
}

export async function updateForegroundUploadService(
  title: string,
  body: string,
  progress?: number,
  total?: number,
): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return await mod.update(title, body, progress, total);
  } catch {
    return false;
  }
}

export async function stopForegroundUploadService(): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod) return false;
  try {
    return await mod.stop();
  } catch {
    return false;
  }
}

export function subscribeForegroundActions(
  onAction: (action: ForegroundAction) => void,
): () => void {
  const mod = getNativeModule();
  if (!mod) return () => {};
  try {
    const emitter = new EventEmitter(mod as never);
    const subscription = (emitter as any).addListener(
      "onForegroundAction",
      (event: { action?: ForegroundAction }) => {
        if (event?.action) onAction(event.action);
      },
    );
    return () => subscription.remove();
  } catch {
    // Fallback para mocks que exponen addListener directamente
    try {
      if (typeof (mod as any).addListener === "function") {
        const subscription = (mod as any).addListener("onForegroundAction", (event: any) => {
          const action = event?.action ?? event;
          if (action) onAction(action);
        });
        return () => subscription.remove();
      }
    } catch {
      return () => {};
    }
    return () => {};
  }
}

export function __resetForegroundModuleForTests(
  mockModule?: UploadForegroundNativeModule | null,
): void {
  cachedModule = mockModule;
}

// ---------- Compatibilidad con la API previa (startUploadForeground, etc.) ----------

let started = false;
let startToken = 0;
let stopSent = false;
let lastBody = "";
let lastSentAt = 0;
let cooldownUntil = 0;

const UPDATE_INTERVAL_MS = 1_000;
const START_COOLDOWN_MS = 60_000;

export function startUploadForeground(): void {
  const mod = getNativeModule();
  if (!mod || started) return;
  if (Date.now() < cooldownUntil && AppState.currentState !== "active") return;

  const text = describeUploadNotification(useSyncProgress.getState());
  const token = ++startToken;
  started = true;
  stopSent = false;
  lastBody = text.body;
  lastSentAt = Date.now();

  void mod
    .start(text.title, text.body)
    .then(() => mod.update(text.title, text.body, text.percent, 100).catch(() => {}))
    .catch(() => {
      if (token !== startToken) return;
      started = false;
      lastBody = "";
      lastSentAt = 0;
      cooldownUntil = Date.now() + START_COOLDOWN_MS;
    });
}

export function updateUploadForeground(state: SyncProgressState): void {
  if (!started) return;
  const mod = getNativeModule();
  if (!mod) return;
  const now = Date.now();
  if (now - lastSentAt < UPDATE_INTERVAL_MS) return;
  const text = describeUploadNotification(state);
  if (text.body === lastBody) return;
  lastSentAt = now;
  lastBody = text.body;
  void mod.update(text.title, text.body, text.percent, 100).catch(() => {});
}

export function stopUploadForeground(): void {
  const mod = getNativeModule();
  if (!mod || stopSent) return;
  startToken++;
  stopSent = true;
  const wasRunning = started;
  started = false;
  lastBody = "";
  lastSentAt = 0;
  if (!wasRunning) return;
  void mod.stop().catch(() => {});
}

export function onUploadForegroundTimeout(handler: () => void): () => void {
  const mod = getNativeModule();
  if (!mod) return () => {};
  // Compatibilidad con mocks/APIs que exponen addListener("onTimeout").
  try {
    if (typeof (mod as any).addListener === "function") {
      const subscription = (mod as any).addListener("onTimeout", () => {
        handler();
      });
      return () => subscription.remove();
    }
  } catch {
    // continuar
  }
  return subscribeForegroundActions((action) => {
    if (action === "timeout_reached") handler();
  });
}
