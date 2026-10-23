import { MAX_THUMB_BYTES, PREVIEW_MAX_DIMENSION, THUMB_MAX_DIMENSION } from "@photos/shared";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as VideoThumbnails from "expo-video-thumbnails";
import jpeg from "jpeg-js";
import { fromByteArray, toByteArray } from "react-native-quick-base64";
import { rgbaToThumbHash } from "thumbhash";

export type ThumbResult = {
  uri: string;
  bytes: number;
  thumbhash: string; // base64
};

async function frameUriFor(mediaType: "photo" | "video", uri: string): Promise<string> {
  if (mediaType === "photo") return uri;
  const { uri: frame } = await VideoThumbnails.getThumbnailAsync(uri, { time: 500 });
  return frame;
}

async function resizeTo(uri: string, maxDim: number, format: SaveFormat, compress: number) {
  const ctx = ImageManipulator.manipulate(uri);
  // sin dimensiones del asset no podemos preservar aspecto exacto: resize con maxSide
  ctx.resize({ width: maxDim });
  const rendered = await ctx.renderAsync();
  return rendered.saveAsync({ format, compress, base64: format === SaveFormat.JPEG });
}

/**
 * Genera la miniatura WebP (≤50KB, lado mayor 400px) y el ThumbHash base64.
 */
export async function makeThumbAndHash(
  mediaType: "photo" | "video",
  uri: string,
): Promise<ThumbResult> {
  const frame = await frameUriFor(mediaType, uri);

  // ThumbHash: decodificar una versión pequeña a RGBA via JPEG + jpeg-js
  const tiny = await resizeTo(frame, 100, SaveFormat.JPEG, 0.9);
  const hashB64 = await (async () => {
    try {
      if (!tiny.base64) return "";
      const bytes = toByteArray(tiny.base64);
      await new Promise((r) => setTimeout(r, 0));
      const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
      await new Promise((r) => setTimeout(r, 0));
      const hashBytes = rgbaToThumbHash(decoded.width, decoded.height, decoded.data);
      return fromByteArray(hashBytes);
    } catch {
      return "";
    }
  })();
  // El API exige thumbhash min 1: si el cómputo falló (p. ej. frame de video
  // sin decodificar) se usa un placeholder gris neutro en vez de rechazar.
  const thumbhash =
    hashB64 || fromByteArray(rgbaToThumbHash(1, 1, new Uint8Array([128, 128, 128, 255])));

  // Miniatura: WebP ≤ 50KB con un único fallback (evita 5 decodes del original).
  const attempts: [number, number][] = [
    [THUMB_MAX_DIMENSION, 0.65],
    [320, 0.42],
  ];
  let last: { uri: string; bytes: number } | null = null;
  for (const [dim, q] of attempts) {
    const saved = await resizeTo(frame, dim, SaveFormat.WEBP, q);
    const bytes = new File(saved.uri).size ?? 0;
    last = { uri: saved.uri, bytes };
    if (bytes <= MAX_THUMB_BYTES) break;
  }

  if (!last) throw new Error("No se pudo generar la miniatura");

  // mover a un nombre estable en cache/thumbs
  const thumbsDir = new Directory(Paths.cache, "thumbs");
  if (!thumbsDir.exists) thumbsDir.create({ intermediates: true });
  const dest = new File(thumbsDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
  new File(last.uri).move(dest);

  return { uri: dest.uri, bytes: last.bytes, thumbhash };
}

export type PreviewResult = {
  uri: string;
  bytes: number;
};

/**
 * Genera una vista previa intermedia WebP (~1600 px lado mayor) para el visor progresivo.
 */
export async function makePreview(
  mediaType: "photo" | "video",
  uri: string,
): Promise<PreviewResult | null> {
  try {
    const frame = await frameUriFor(mediaType, uri);
    const saved = await resizeTo(frame, PREVIEW_MAX_DIMENSION, SaveFormat.WEBP, 0.75);
    const bytes = new File(saved.uri).size ?? 0;
    if (bytes <= 0) return null;

    const previewsDir = new Directory(Paths.cache, "previews");
    if (!previewsDir.exists) previewsDir.create({ intermediates: true });
    const dest = new File(previewsDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);
    new File(saved.uri).move(dest);

    return { uri: dest.uri, bytes };
  } catch {
    return null;
  }
}
