import { describe, expect, it } from "vitest";
import { mergeHybridGallery } from "./gallery";

describe("mergeHybridGallery zero-flicker", () => {
  it("conserva el mismo stableKey y displayThumbUri local cuando el item pasa a synced", () => {
    const localAsset = {
      localAssetId: "media-lib-101",
      uri: "file:///storage/emulated/0/DCIM/IMG_101.jpg",
      filename: "IMG_101.jpg",
      mediaType: "photo" as const,
      width: 4000,
      height: 3000,
      durationMs: 0,
      creationTime: 1762900000000,
      sha256: "abc123sha",
    };

    const beforeSync = mergeHybridGallery([{ ...localAsset, queueStatus: "uploading" }], []);
    const afterSync = mergeHybridGallery(
      [{ ...localAsset, queueStatus: "completed" }],
      [
        {
          id: "remote-uuid-999",
          localAssetId: "media-lib-101",
          sha256: "abc123sha",
          filename: "IMG_101.jpg",
          mediaType: "photo",
          width: 4000,
          height: 3000,
          takenAt: 1762900000000,
          thumbUrl: "https://cdn.example.com/thumbs/999.webp",
        },
      ],
    );

    expect(beforeSync).toHaveLength(1);
    expect(afterSync).toHaveLength(1);
    expect(afterSync[0]!.stableKey).toBe(beforeSync[0]!.stableKey);
    expect(afterSync[0]!.displayThumbUri).toBe(localAsset.uri);
    expect(afterSync[0]!.syncState).toBe("synced");
    expect(afterSync[0]!.remoteId).toBe("remote-uuid-999");
  });
});
