import { Image } from "expo-image";
import { useEffect } from "react";
import type { HybridGalleryItem } from "./gallery";

export function useNeighborMediaPrefetch(items: HybridGalleryItem[], activeIndex: number): void {
  useEffect(() => {
    if (activeIndex < 0 || items.length === 0) return;
    const neighbors = [items[activeIndex - 1], items[activeIndex + 1]];
    const urlsToPrefetch: string[] = [];
    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      if (neighbor.displayThumbUri?.startsWith("file://")) continue;
      const remoteTarget = neighbor.fallbackRemoteThumbUri || neighbor.displayThumbUri;
      if (remoteTarget && remoteTarget.startsWith("http")) urlsToPrefetch.push(remoteTarget);
    }
    if (urlsToPrefetch.length > 0) {
      void Image.prefetch(urlsToPrefetch, "memory-disk");
    }
  }, [activeIndex, items]);
}
