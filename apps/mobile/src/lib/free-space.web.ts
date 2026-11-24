import { removeQueueItems } from "../queue/db";
import { useLibraryEvents, useQueueEvents } from "./events";

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

/**
 * Elimina uno o más items locales de la cola en web (IndexedDB).
 */
export async function deleteLocalAssets(assetIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  if (!uniqueIds.length) return 0;
  await removeQueueItems(uniqueIds);
  useLibraryEvents.getState().emit();
  useQueueEvents.getState().emit();
  return uniqueIds.length;
}

/**
 * Elimina un item local de la cola en web por su asset_id.
 */
export async function deleteLocalAsset(assetId: string): Promise<boolean> {
  const count = await deleteLocalAssets([assetId]);
  return count > 0;
}

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
  const deleteImpl = options.deleteBatchImpl ?? (async () => false);
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
