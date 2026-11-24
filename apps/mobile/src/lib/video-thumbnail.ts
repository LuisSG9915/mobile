import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

export interface VideoThumbnailOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  timeMs?: number;
}

export interface VideoThumbnailResult {
  uri: string;
  width: number;
  height: number;
  durationMs: number;
  rotation: number;
}

interface NativeVideoThumbnailModule {
  generate(videoUri: string, options?: VideoThumbnailOptions): Promise<VideoThumbnailResult>;
  getThumbnail(uri: string, maxSize: number): Promise<string>;
}

const nativeVideoThumbnail =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeVideoThumbnailModule>("VideoThumbnail")
    : null;

export async function generateVideoThumbnail(
  videoUri: string,
  options: VideoThumbnailOptions = {},
): Promise<VideoThumbnailResult | null> {
  const normalizedOptions: VideoThumbnailOptions = {
    maxWidth: options.maxWidth ?? 512,
    maxHeight: options.maxHeight ?? 512,
    quality: options.quality ?? 80,
    timeMs: options.timeMs,
  };

  if (nativeVideoThumbnail) {
    try {
      return await nativeVideoThumbnail.generate(videoUri, normalizedOptions);
    } catch (err) {
      console.warn("[video-thumbnail] Falló el módulo nativo, intentando fallback:", err);
    }
  }

  return null;
}

// ---------- Compatibilidad con la API previa ----------
type LegacyNativeModule = { getThumbnail(uri: string, maxSize: number): Promise<string> };

let native: LegacyNativeModule | null | undefined;

function getNative(): LegacyNativeModule | null {
  if (native !== undefined) return native;
  try {
    native = requireOptionalNativeModule<LegacyNativeModule>("VideoThumbnail");
  } catch {
    native = null;
  }
  return native;
}

const MAX_CACHE_SIZE = 200;
const cache = new Map<string, string>();

function cacheSet(key: string, value: string): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export async function getSystemVideoThumbnail(uri: string, maxSize = 400): Promise<string | null> {
  const mod = getNative();
  if (!mod) return null;
  const key = `${uri}|${maxSize}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const path = await mod.getThumbnail(uri, maxSize);
    const result = path ? `file://${path}` : null;
    if (result) cacheSet(key, result);
    return result;
  } catch {
    return null;
  }
}

export function hasSystemVideoThumbnail(): boolean {
  return getNative() !== null;
}

export function useSystemVideoThumbnail(uri: string | null | undefined): string | null {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    void getSystemVideoThumbnail(uri).then((res) => {
      if (!cancelled && res) setThumb(res);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return thumb;
}
