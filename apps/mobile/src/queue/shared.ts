import { type AllowedExtension, MIME_BY_EXT, VIDEO_EXTENSIONS } from "@photos/shared";

export const MAX_ATTEMPTS = 6;
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000];

export function extFromFilename(filename: string | null, mediaType: string): AllowedExtension {
  const raw = (filename?.split(".").pop() ?? "").toLowerCase();
  const fallback = mediaType === "video" ? "mp4" : "jpg";
  const ext = (raw || fallback) as AllowedExtension;
  return (MIME_BY_EXT as Record<string, string>)[ext] ? ext : (fallback as AllowedExtension);
}

export function extToMediaType(ext: string): "photo" | "video" {
  return VIDEO_EXTENSIONS.includes(ext) ? "video" : "photo";
}
