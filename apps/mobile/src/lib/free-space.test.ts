import { describe, expect, it, vi } from "vitest";
import { freeUpSpaceInBatches, selectVerifiedBackedUpAssets } from "./free-space";

describe("free-space safety & batching", () => {
  const validSha = "a".repeat(64);

  it("excluye archivos pendientes, subiendo o sin confirmación en la nube", () => {
    const plan = selectVerifiedBackedUpAssets(
      [
        {
          localAssetId: "synced-1",
          uri: "file:///1.jpg",
          filename: "1.jpg",
          fileSize: 1000,
          sha256: validSha,
          queueStatus: "completed",
        },
        {
          localAssetId: "still-uploading",
          uri: "file:///2.jpg",
          filename: "2.jpg",
          fileSize: 2000,
          sha256: validSha,
          queueStatus: "uploading",
        },
        {
          localAssetId: "not-in-cloud",
          uri: "file:///3.jpg",
          filename: "3.jpg",
          fileSize: 3000,
          sha256: "b".repeat(64),
          queueStatus: null,
        },
      ],
      {
        confirmedLocalAssetIds: new Set(),
        confirmedSha256Set: new Set([validSha]),
      },
    );

    expect(plan.eligibleAssets.map((a) => a.localAssetId)).toEqual(["synced-1"]);
    expect(plan.totalFreedBytes).toBe(1000);
    expect(plan.skippedCount).toBe(2);
  });

  it("divide en lotes y se detiene de inmediato si el usuario rechaza un lote en Android", async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({
      localAssetId: `id-${i}`,
      uri: `file:///${i}.jpg`,
      filename: `${i}.jpg`,
      fileSize: 100,
      remoteId: `rem-${i}`,
    }));

    const deleteMock = vi
      .fn<(ids: string[]) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const res = await freeUpSpaceInBatches(items, {
      batchSize: 100,
      deleteBatchImpl: deleteMock,
    });

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(res.deletedCount).toBe(100);
    expect(res.freedBytes).toBe(10000);
    expect(res.cancelledByUser).toBe(true);
  });
});
