import { useQuery } from "@tanstack/react-query";
import type { SharedValue } from "react-native-reanimated";
import { api } from "../api/client";
import { ThumbPage } from "./ThumbPage";
import { VideoPage } from "./VideoPage";
import type { CarouselItem } from "./viewer-types";
import { ZoomableImage } from "./ZoomableImage";

export function MediaPage({
  item,
  active,
  near,
  onDismiss,
  onDoubleTap,
  onSingleTap,
  onZoomChange,
  backdropOpacity,
  onDownload,
}: {
  item: CarouselItem;
  active: boolean;
  near: boolean;
  onDismiss?: () => void;
  onDoubleTap?: () => void;
  onSingleTap?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  backdropOpacity?: SharedValue<number>;
  onDownload?: () => void;
}) {
  const remoteId =
    item.remoteId ?? (!item.id.startsWith("l-") && !item.id.startsWith("q-") ? item.id : null);
  const detail = useQuery({
    queryKey: ["media", remoteId],
    queryFn: () => (remoteId ? api.mediaDetail(remoteId) : null),
    enabled: Boolean(near && remoteId),
    staleTime: 60_000,
  });
  // La URL del detalle es reciente; la del listado puede haber caducado (403).
  const previewUrl = detail.data?.previewUrl || item.previewUrl;
  const originalUrl =
    item.localUri || detail.data?.originalUrl || item.originalUrl || item.thumbUrl;

  if (item.mediaType === "video") {
    const activeVideoUri = originalUrl && !originalUrl.includes("/thumbs/") ? originalUrl : null;
    const resolvedVideoUri = activeVideoUri || previewUrl;
    return active && resolvedVideoUri ? (
      <VideoPage uri={resolvedVideoUri} previewUri={previewUrl} onDownload={onDownload} />
    ) : (
      <ThumbPage item={item} />
    );
  }
  return originalUrl ? (
    <ZoomableImage
      uri={item.localUri || previewUrl || originalUrl}
      previewUri={previewUrl}
      originalUri={originalUrl}
      thumbhash={item.thumbhash}
      active={active}
      onDismiss={onDismiss}
      onDoubleTap={onDoubleTap}
      onSingleTap={onSingleTap}
      onZoomChange={onZoomChange}
      backdropOpacity={backdropOpacity}
    />
  ) : (
    <ThumbPage item={item} />
  );
}

// ---------- Prefetch de vecinos (Bloque 3) ----------
import { Image } from "expo-image";
import { useEffect } from "react";
import type { HybridGalleryItem } from "../lib/gallery";

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
