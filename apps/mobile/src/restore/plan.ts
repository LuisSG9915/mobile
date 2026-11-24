import type { MediaManifestItem } from "@photos/shared";

export type RestoreItemState =
  | "queued"
  | "downloading"
  | "verifying"
  | "done"
  | "skipped_local"
  | "failed"
  | "corrupt";

export type RestorePauseReason = "user" | "network" | "disk";

export type RestoreItem = {
  remoteId: string;
  sha256: string;
  fileSize: number;
  ext: string;
  mediaType: "photo" | "video";
  takenAt: number;
  state: RestoreItemState;
  attempts: number;
  /** Veces que el hash descargado no coincidió con el esperado. */
  mismatches: number;
  lastError: string | null;
};

/** Margen sobre el espacio libre: coexisten el temporal en caché y la copia en MediaStore. */
export const DISK_MARGIN_BYTES = 50 * 1024 * 1024;
/** Reintentos por ítem antes de marcarlo `failed` (errores de red/servidor). */
export const MAX_RESTORE_ATTEMPTS = 3;
/** Un hash distinto se reintenta una vez; si persiste, el original está corrupto. */
export const MAX_CORRUPT_RETRIES = 1;

/** Separa lo que ya está en el teléfono (mismo sha256) de lo que hay que descargar; deduplica el propio manifiesto. */
export function planRestore(
  manifest: MediaManifestItem[],
  localShas: ReadonlySet<string>,
): { toRestore: MediaManifestItem[]; skipped: MediaManifestItem[] } {
  const seen = new Set<string>();
  const toRestore: MediaManifestItem[] = [];
  const skipped: MediaManifestItem[] = [];
  for (const item of manifest) {
    if (localShas.has(item.sha256) || seen.has(item.sha256)) {
      skipped.push(item);
      continue;
    }
    seen.add(item.sha256);
    toRestore.push(item);
  }
  return { toRestore, skipped };
}

export function totalBytes(items: ReadonlyArray<{ fileSize: number }>): number {
  return items.reduce((sum, i) => sum + i.fileSize, 0);
}

/** Espacio mínimo para un ítem: temporal + copia final + margen. */
export function bytesNeededFor(fileSize: number): number {
  return fileSize * 2 + DISK_MARGIN_BYTES;
}

export function hasRoomFor(freeBytes: number, fileSize: number): boolean {
  return freeBytes >= bytesNeededFor(fileSize);
}

/** Estado tras un error transitorio: reintenta hasta MAX_RESTORE_ATTEMPTS y luego `failed`. */
export function stateAfterError(attemptsSoFar: number): {
  state: RestoreItemState;
  attempts: number;
} {
  const attempts = attemptsSoFar + 1;
  return { state: attempts >= MAX_RESTORE_ATTEMPTS ? "failed" : "queued", attempts };
}

/** Estado tras un hash que no coincide: un reintento y luego `corrupt`. */
export function stateAfterHashMismatch(mismatchesSoFar: number): {
  state: RestoreItemState;
  mismatches: number;
} {
  const mismatches = mismatchesSoFar + 1;
  return { state: mismatches > MAX_CORRUPT_RETRIES ? "corrupt" : "queued", mismatches };
}

/** Nombre de archivo local seguro a partir del sha (evita colisiones y caracteres raros). */
export function restoreFilename(item: Pick<RestoreItem, "sha256" | "ext">): string {
  const ext = item.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `restore-${item.sha256.slice(0, 16)}.${ext}`;
}
