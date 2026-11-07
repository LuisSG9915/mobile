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
  const previewUrl = item.previewUrl || detail.data?.previewUrl;
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
