/**
 * En web no hay camera roll que liberar: los File elegidos se borran de
 * IndexedDB en la misma transacción que marca el item done/duplicate.
 */
export function getSyncedLocal(): { assetIds: string[]; totalBytes: number } {
  return { assetIds: [], totalBytes: 0 };
}

export async function freeSyncedSpace(): Promise<number> {
  return 0;
}

export function hasLocalCopy(_remoteId: string): boolean {
  return false;
}

export async function deleteLocalCopy(_remoteId: string): Promise<boolean> {
  return false;
}
