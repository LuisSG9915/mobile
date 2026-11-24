/** ¿Es una miniatura (imagen) y no un archivo de video? */
export function isThumbUrl(url: string | null | undefined): boolean {
  return Boolean(url?.includes("/thumbs/"));
}

/**
 * Fuente reproducible de un video: el original si es válido; si no (vacío o miniatura),
 * el preview H.264. Devuelve "" cuando no hay nada reproducible todavía.
 */
export function playableVideoUri(
  original: string | null | undefined,
  preview: string | null | undefined,
): string {
  if (original && !isThumbUrl(original)) return original;
  return preview && !isThumbUrl(preview) ? preview : "";
}

/** Orden de fuentes para el reproductor: archivo local primero (sin red), luego preview remoto, luego original. */
export function videoSources(
  uri: string,
  previewUri?: string | null,
): { primary: string; fallback: string | null } {
  const isLocal = uri.startsWith("file://") || uri.startsWith("content://");
  if (isLocal) return { primary: uri, fallback: previewUri || null };
  return { primary: previewUri || uri, fallback: previewUri ? uri : null };
}
