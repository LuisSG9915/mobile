import type { SyncProgressState } from "./types";

/**
 * En web no hay foreground service: el respaldo se apoya en Web Locks y en la
 * pestaña abierta (ver `processor.web.ts`). Misma API que `foreground.ts` para
 * que los módulos compartidos no distingan plataforma.
 */
export function startUploadForeground(): void {}

export function updateUploadForeground(_state: SyncProgressState): void {}

export function stopUploadForeground(): void {}

export function onUploadForegroundTimeout(_handler: () => void): () => void {
  return () => {};
}
