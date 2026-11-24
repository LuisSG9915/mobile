import * as MediaLibrary from "expo-media-library/legacy";
import { api } from "../api/client";
import {
  getLocalAssetIdByRemoteId,
  getQueueItems,
  hasLocalCopySync,
  removeQueueItems,
} from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

/**
 * "Liberar espacio": fotos con respaldo confirmado (done/duplicate con
 * remote_id y sha256 registrado) cuya copia local sigue ocupando espacio
 * en el dispositivo. Opcionalmente filtradas por antigüedad en días.
 */
export function getSyncedLocal(olderThanDays?: number): {
  assetIds: string[];
  totalBytes: number;
  items: { asset_id: string; sha256: string | null; bytes_total: number }[];
} {
  const cutoffMs = olderThanDays != null ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : null;
  const items = getQueueItems().filter(
    (i) =>
      (i.state === "done" || i.state === "duplicate") &&
      i.remote_id != null &&
      i.sha256 != null &&
      i.asset_id &&
      (cutoffMs == null || i.created_at <= cutoffMs),
  );
  return {
    assetIds: items.map((i) => i.asset_id),
    totalBytes: items.reduce((s, i) => s + (i.bytes_total || 0), 0),
    items: items.map((i) => ({
      asset_id: i.asset_id,
      sha256: i.sha256,
      bytes_total: i.bytes_total || 0,
    })),
  };
}

export class RemoteIntegrityError extends Error {
  constructor(message = "No se pudo verificar el respaldo remoto.") {
    super(message);
    this.name = "RemoteIntegrityError";
  }
}

/**
 * Verifica la existencia e integridad remota en R2/D1 mediante el endpoint
 * /uploads/check-hashes antes de borrar cualquier archivo local.
 * Devuelve solo los assetIds cuyos hashes están confirmados en el servidor.
 */
export async function verifyRemoteIntegrity(
  items: { asset_id: string; sha256: string | null }[],
): Promise<string[]> {
  const valid = items.filter((i) => Boolean(i.sha256 && i.asset_id));
  if (!valid.length) return [];
  const hashes = Array.from(new Set(valid.map((i) => i.sha256 as string)));
  const existingSet = new Set<string>();
  const CHUNK_SIZE = 250;
  for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
    const chunk = hashes.slice(i, i + CHUNK_SIZE);
    try {
      const res = await api.checkHashes(chunk);
      for (const e of res.existing) {
        existingSet.add(e.sha256);
      }
    } catch (err) {
      throw new RemoteIntegrityError(
        err instanceof Error ? err.message : "Error al verificar integridad remota",
      );
    }
  }
  return valid.filter((i) => existingSet.has(i.sha256 as string)).map((i) => i.asset_id);
}

/**
 * ¿Queda una copia local del elemento remoto? Cierto si la cola conserva la
 * fila done/duplicate que enlaza el asset del dispositivo con su remote_id.
 * (Si el asset ya se borró del sistema, deleteAssetsAsync devolverá false.)
 */
export function hasLocalCopy(remoteId: string): boolean {
  return hasLocalCopySync(remoteId);
}

/**
 * Elimina uno o más assets locales del dispositivo (por su asset_id de MediaLibrary).
 * También purga los items de la cola si estaban registrados.
 * Devuelve cuántos assets se eliminaron (0 si el usuario cancela o falla).
 */
export async function deleteLocalAssets(assetIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (!uniqueIds.length) return 0;
  const ok = await MediaLibrary.deleteAssetsAsync(uniqueIds);
  if (!ok) return 0;
  await removeQueueItems(uniqueIds);
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return uniqueIds.length;
}

/**
 * Elimina un asset local específico del dispositivo por su asset_id.
 * Devuelve true si se eliminó con éxito, false en caso contrario.
 */
export async function deleteLocalAsset(assetId: string): Promise<boolean> {
  const count = await deleteLocalAssets([assetId]);
  return count > 0;
}

/**
 * Elimina solo la copia local de un elemento ya respaldado; la remota se
 * conserva y la galería lo refleja como REMOTE_ONLY. Devuelve false si no
 * había copia local o el usuario canceló el diálogo del sistema.
 */
export async function deleteLocalCopy(remoteId: string): Promise<boolean> {
  const assetId = getLocalAssetIdByRemoteId(remoteId);
  if (!assetId) return false;
  return deleteLocalAsset(assetId);
}

/**
 * Borra las copias locales de los elementos ya respaldados con verificación
 * de integridad remota obligatoria. Devuelve cuántos assets eliminó MediaLibrary
 * (0 si el usuario cancela el diálogo del sistema o no hay nada que liberar).
 */
export async function freeSyncedSpace(
  olderThanDays?: number,
  verifyIntegrity = true,
): Promise<number> {
  const { items } = getSyncedLocal(olderThanDays);
  if (!items.length) return 0;

  let idsToDelete = items.map((i) => i.asset_id);
  if (verifyIntegrity) {
    idsToDelete = await verifyRemoteIntegrity(items);
  }
  if (!idsToDelete.length) return 0;

  return deleteLocalAssets(idsToDelete);
}

// ---------- Bloque 4: liberador de espacio por lotes seguros ----------

export const DEFAULT_DELETE_BATCH_SIZE = 100;

export interface LocalFreeSpaceCandidate {
  localAssetId: string;
  uri: string;
  filename: string;
  fileSize: number;
  sha256?: string | null;
  remoteId?: string | null;
  queueStatus?: "pending" | "uploading" | "completed" | "failed" | null;
}

export interface CloudConfirmedIndex {
  confirmedLocalAssetIds: ReadonlySet<string>;
  confirmedSha256Set: ReadonlySet<string>;
}

export interface FreeSpacePlan {
  eligibleAssets: LocalFreeSpaceCandidate[];
  totalFreedBytes: number;
  skippedCount: number;
}

export interface FreeSpaceBatchProgress {
  completedBatches: number;
  totalBatches: number;
  deletedCount: number;
  freedBytes: number;
}

export interface ExecuteFreeSpaceOptions {
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FreeSpaceBatchProgress) => void;
  deleteBatchImpl?: (assetIds: string[]) => Promise<boolean>;
}

export interface ExecuteFreeSpaceResult {
  deletedAssetIds: string[];
  deletedCount: number;
  freedBytes: number;
  cancelledByUser: boolean;
}

export function selectVerifiedBackedUpAssets(
  candidates: LocalFreeSpaceCandidate[],
  cloudIndex: CloudConfirmedIndex,
): FreeSpacePlan {
  const eligibleAssets: LocalFreeSpaceCandidate[] = [];
  let totalFreedBytes = 0;
  let skippedCount = 0;
  const seenIds = new Set<string>();

  for (const item of candidates) {
    if (!item.localAssetId || seenIds.has(item.localAssetId)) continue;
    if (
      item.queueStatus === "pending" ||
      item.queueStatus === "uploading" ||
      item.queueStatus === "failed"
    ) {
      skippedCount += 1;
      continue;
    }
    const normalizedSha = item.sha256?.trim().toLowerCase();
    const isConfirmedById =
      Boolean(item.remoteId) || cloudIndex.confirmedLocalAssetIds.has(item.localAssetId);
    const isConfirmedBySha = Boolean(
      normalizedSha &&
        normalizedSha.length === 64 &&
        cloudIndex.confirmedSha256Set.has(normalizedSha),
    );
    if (!isConfirmedById && !isConfirmedBySha) {
      skippedCount += 1;
      continue;
    }
    seenIds.add(item.localAssetId);
    eligibleAssets.push(item);
    totalFreedBytes += Math.max(0, item.fileSize || 0);
  }

  return { eligibleAssets, totalFreedBytes, skippedCount };
}

export function chunkAssetsForDeletion(
  assets: LocalFreeSpaceCandidate[],
  batchSize = DEFAULT_DELETE_BATCH_SIZE,
): LocalFreeSpaceCandidate[][] {
  const safeSize = Math.max(1, Math.min(batchSize, 250));
  const batches: LocalFreeSpaceCandidate[][] = [];
  for (let i = 0; i < assets.length; i += safeSize) {
    batches.push(assets.slice(i, i + safeSize));
  }
  return batches;
}

export async function freeUpSpaceInBatches(
  eligibleAssets: LocalFreeSpaceCandidate[],
  options: ExecuteFreeSpaceOptions = {},
): Promise<ExecuteFreeSpaceResult> {
  const batchSize = options.batchSize ?? DEFAULT_DELETE_BATCH_SIZE;
  const deleteImpl =
    options.deleteBatchImpl ?? ((ids: string[]) => MediaLibrary.deleteAssetsAsync(ids));
  const batches = chunkAssetsForDeletion(eligibleAssets, batchSize);
  const deletedAssetIds: string[] = [];
  let freedBytes = 0;
  let cancelledByUser = false;

  for (let i = 0; i < batches.length; i++) {
    if (options.signal?.aborted) {
      cancelledByUser = true;
      break;
    }
    const batch = batches[i]!;
    const batchIds = batch.map((a) => a.localAssetId);
    let approved = false;
    try {
      approved = await deleteImpl(batchIds);
    } catch {
      approved = false;
    }
    if (!approved) {
      cancelledByUser = true;
      break;
    }
    for (const item of batch) {
      deletedAssetIds.push(item.localAssetId);
      freedBytes += Math.max(0, item.fileSize || 0);
    }
    options.onProgress?.({
      completedBatches: i + 1,
      totalBatches: batches.length,
      deletedCount: deletedAssetIds.length,
      freedBytes,
    });
  }

  return { deletedAssetIds, deletedCount: deletedAssetIds.length, freedBytes, cancelledByUser };
}
