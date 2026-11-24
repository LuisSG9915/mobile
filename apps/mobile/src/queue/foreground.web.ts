import type { SyncProgressState } from "./types";

export type ForegroundAction = "pause_requested" | "timeout_reached";

export interface UploadForegroundNativeModule {
  start(title: string, body: string): Promise<boolean>;
  update(title: string, body: string, progress?: number, total?: number): Promise<boolean>;
  stop(): Promise<boolean>;
}

export async function startForegroundUploadService(): Promise<boolean> {
  return false;
}
export async function updateForegroundUploadService(): Promise<boolean> {
  return false;
}
export async function stopForegroundUploadService(): Promise<boolean> {
  return false;
}
export function subscribeForegroundActions(): () => void {
  return () => {};
}
export function __resetForegroundModuleForTests(): void {}

export function startUploadForeground(): void {}
export function updateUploadForeground(_state: SyncProgressState): void {}
export function stopUploadForeground(): void {}
export function onUploadForegroundTimeout(_handler: () => void): () => void {
  return () => {};
}
