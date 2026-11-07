import type { TimelineItem } from "@photos/shared";

export type CarouselItem = {
  id: string;
  key: string;
  originalUrl?: string | null;
  previewUrl?: string | null;
  thumbUrl: string;
  thumbhash: string;
  mediaType: "photo" | "video";
  width: number;
  height: number;
  durationMs?: number | null;
  takenAt: number;
  dateGroup?: string;
  city?: string | null;
  isFavorite: boolean;
  isScreenshot?: boolean;
  isDocument?: boolean;
  syncStatus: string;
  localUri?: string | null;
  remoteId?: string | null;
  assetId?: string | null;
};
