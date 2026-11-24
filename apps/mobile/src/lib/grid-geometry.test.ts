import { describe, expect, it } from "vitest";
import {
  buildTimelineLayoutIndex,
  computeGridMetrics,
  findRowIndexAtOffset,
} from "./grid-geometry";

describe("grid-geometry & FastScrubber index", () => {
  it("localiza la fila exacta mediante búsqueda binaria en O(log N)", () => {
    const metrics = computeGridMetrics(360, 3, 2, 44);
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: `id-${i}`,
      stableKey: `key-${i}`,
      filename: `IMG_${i}.jpg`,
      mediaType: "photo" as const,
      width: 100,
      height: 100,
      durationMs: 0,
      timestamp: Date.UTC(2026, 10, 12, 12, 0, i),
      displayThumbUri: `file:///${i}.jpg`,
      syncState: "synced" as const,
      isFavorite: false,
    }));

    const index = buildTimelineLayoutIndex(items, metrics);
    expect(index.rows).toHaveLength(4);
    expect(findRowIndexAtOffset(index, 10)).toBe(0);
    expect(findRowIndexAtOffset(index, 50)).toBe(1);
    expect(findRowIndexAtOffset(index, index.totalHeight - 5)).toBe(3);
  });
});
