import { MAX_THUMB_BYTES, THUMB_MAX_DIMENSION } from "@photos/shared";
import { rgbaToThumbHash } from "thumbhash";

export type WebThumb = {
  blob: Blob;
  bytes: number;
  thumbhash: string; // base64
  width: number;
  height: number;
};

// Misma escalera que el nativo: degradar calidad/dimensión hasta ≤50KB.
const ATTEMPTS: [number, number][] = [
  [THUMB_MAX_DIMENSION, 0.7],
  [THUMB_MAX_DIMENSION, 0.55],
  [THUMB_MAX_DIMENSION, 0.4],
  [320, 0.5],
  [320, 0.35],
];

const DECODE_ERROR = "Este navegador no puede leer el formato del archivo.";

type Frame = { source: CanvasImageSource; width: number; height: number };

async function frameForPhoto(file: File): Promise<Frame> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(DECODE_ERROR);
  });
  return { source: bitmap, width: bitmap.width, height: bitmap.height };
}

function frameForVideo(file: File): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error(DECODE_ERROR));
    };
    video.onerror = fail;
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const frame = { source: video, width: video.videoWidth, height: video.videoHeight };
      URL.revokeObjectURL(url);
      resolve(frame);
    };
    video.src = url;
  });
}

function drawScaled(frame: Frame, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(frame.width, frame.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(frame.width * scale));
  canvas.height = Math.max(1, Math.round(frame.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(DECODE_ERROR);
  ctx.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

let wasmInitPromise: Promise<void> | null = null;

async function ensureWasmInitialized(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      let wasmBuffer: ArrayBuffer | null = null;
      // 1. Intentar el asset estático local (servido en /webp_enc.wasm vía Expo web public/)
      try {
        const res = await fetch("/webp_enc.wasm");
        if (res.ok) wasmBuffer = await res.arrayBuffer();
      } catch {}

      // 2. Fallback a CDN público si el archivo local no resolvió
      if (!wasmBuffer) {
        try {
          const cdnRes = await fetch(
            "https://unpkg.com/@jsquash/webp@1.5.0/codec/enc/webp_enc.wasm",
          );
          if (cdnRes.ok) wasmBuffer = await cdnRes.arrayBuffer();
        } catch {}
      }

      if (!wasmBuffer) {
        throw new Error("No se pudo cargar el codificador WebP para este navegador.");
      }

      const { init } = await import("@jsquash/webp/encode.js");
      await init({ wasmBinary: wasmBuffer });
    })();
  }
  return wasmInitPromise;
}

async function encodeWebpFallback(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(DECODE_ERROR);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await ensureWasmInitialized();
  const { default: encode } = await import("@jsquash/webp/encode.js");
  const buffer = await encode(imageData, { quality: Math.round(quality * 100) });
  return new Blob([buffer], { type: "image/webp" });
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const nativeBlob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/webp", quality);
    } catch {
      resolve(null);
    }
  });

  if (nativeBlob && nativeBlob.type === "image/webp") {
    return nativeBlob;
  }

  // Safari / WebKit o navegadores que devuelven PNG en vez de WebP en canvas:
  return encodeWebpFallback(canvas, quality);
}

function thumbhashFrom(frame: Frame): string {
  const canvas = drawScaled(frame, 100);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bytes = rgbaToThumbHash(width, height, data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Genera la miniatura WebP (≤50KB, lado mayor 400px), el ThumbHash base64 y
 * las dimensiones del archivo. Lanza Error con mensaje en español.
 */
export async function makeThumb(mediaType: "photo" | "video", file: File): Promise<WebThumb> {
  const frame = mediaType === "video" ? await frameForVideo(file) : await frameForPhoto(file);

  const thumbhash = thumbhashFrom(frame);

  let last: Blob | null = null;
  for (const [dim, quality] of ATTEMPTS) {
    const blob = await canvasToBlob(drawScaled(frame, dim), quality);
    last = blob;
    if (blob.size <= MAX_THUMB_BYTES) break;
  }
  if (!last) throw new Error("No se pudo generar la miniatura");

  return {
    blob: last,
    bytes: last.size,
    thumbhash,
    width: Math.max(1, Math.round(frame.width)),
    height: Math.max(1, Math.round(frame.height)),
  };
}
