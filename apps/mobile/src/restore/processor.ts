import type { MediaManifestItem } from "@photos/shared";
import {
  hasRoomFor,
  type RestoreItem,
  type RestoreItemState,
  type RestorePauseReason,
  restoreFilename,
  stateAfterError,
  stateAfterHashMismatch,
} from "./plan";

export type RestoreCounts = Record<RestoreItemState, number>;

export interface RestoreStore {
  enqueue(items: MediaManifestItem[], state?: RestoreItemState): void;
  /** Siguiente ítem en `queued`, o null. */
  next(): RestoreItem | null;
  update(
    remoteId: string,
    patch: Partial<Pick<RestoreItem, "state" | "attempts" | "mismatches" | "lastError">>,
  ): void;
  counts(): RestoreCounts;
  /** Vuelve a `queued` los fallidos/corruptos y los que quedaron a medias. */
  retryFailed(): void;
  clear(): void;
}

export interface RestoreDeps {
  getDownload(remoteId: string): Promise<{ url: string; filename: string }>;
  /** Descarga al caché y devuelve el URI local. */
  download(url: string, localName: string): Promise<string>;
  sha256(uri: string): Promise<string>;
  saveToLibrary(uri: string): Promise<void>;
  deleteFile(uri: string): Promise<void>;
  freeBytes(): Promise<number>;
  networkOk(): Promise<boolean>;
}

export type RestoreOutcome = "done" | "stopped" | RestorePauseReason;

/**
 * Procesa la cola de restauración en serie: descarga → verifica sha256 → guarda en la galería.
 * Se detiene (sin gastar intentos) si no hay red permitida o espacio. Cada ítem termina
 * en done / queued (reintento) / failed / corrupt, así que el bucle siempre termina.
 */
export async function runRestore(
  store: RestoreStore,
  deps: RestoreDeps,
  shouldStop: () => boolean = () => false,
): Promise<RestoreOutcome> {
  while (!shouldStop()) {
    const item = store.next();
    if (!item) return "done";
    if (!(await deps.networkOk())) return "network";
    if (!hasRoomFor(await deps.freeBytes(), item.fileSize)) return "disk";

    store.update(item.remoteId, { state: "downloading" });
    let tmp: string | null = null;
    try {
      const dl = await deps.getDownload(item.remoteId);
      tmp = await deps.download(dl.url, restoreFilename(item));
      store.update(item.remoteId, { state: "verifying" });
      const got = await deps.sha256(tmp);
      if (got.toLowerCase() !== item.sha256.toLowerCase()) {
        const next = stateAfterHashMismatch(item.mismatches);
        store.update(item.remoteId, {
          state: next.state,
          mismatches: next.mismatches,
          lastError: "El archivo descargado no coincide con el original.",
        });
        continue;
      }
      await deps.saveToLibrary(tmp);
      store.update(item.remoteId, { state: "done", lastError: null });
    } catch (e) {
      const next = stateAfterError(item.attempts);
      store.update(item.remoteId, {
        state: next.state,
        attempts: next.attempts,
        lastError: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (tmp) await deps.deleteFile(tmp).catch(() => {});
    }
  }
  return "stopped";
}
