import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect, useState } from "react";

/**
 * Puente con el módulo nativo `VideoThumbnail` (Android), que obtiene una
 * miniatura de vídeo vía ContentResolver.loadThumbnail (rápido, cacheado por
 * el SO) con fallback a MediaMetadataRetriever.
 *
 * En web/iOS o si el módulo no está compilado (dev-client viejo) devuelve
 * null y el caller usa la ruta lenta existente (expo-video-thumbnails).
 */
type VideoThumbnailNativeModule = {
  getThumbnail(uri: string, maxSize: number): Promise<string>;
};

let native: VideoThumbnailNativeModule | null | undefined;

function getNative(): VideoThumbnailNativeModule | null {
  if (native !== undefined) return native;
  try {
    native = requireOptionalNativeModule<VideoThumbnailNativeModule>("VideoThumbnail");
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

/**
 * Hook para obtener (de forma asíncrona y cacheada) la miniatura del sistema
 * de un vídeo local. Devuelve null mientras carga o si no está disponible;
 * el caller debe caer al URI original.
 */
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
