import { saveDownload as saveDownloadWeb } from "./save-download.web";
import {
  calculateScaledDimensions,
  calculateStoriesCrop,
  getPresetConfig,
  type OptimizedMediaResult,
  type OptimizePhotoOptions,
  type SharePreset,
} from "./share-optimizer-calc";

export type { OptimizedMediaResult, OptimizePhotoOptions, SharePreset };

/**
 * En web optimiza la imagen usando un Canvas en memoria y exporta un Blob JPEG.
 */
export async function optimizePhotoForShare(
  options: OptimizePhotoOptions,
): Promise<OptimizedMediaResult> {
  const { uri, width, height, preset } = options;
  const config = getPresetConfig(preset);

  if (preset === "original") {
    return {
      uri,
      width,
      height,
      filename: `original_${Date.now()}.jpg`,
    };
  }

  const img = document.createElement("img");
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("No se pudo cargar la imagen para optimización web"));
    img.src = uri;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo obtener el contexto 2D del canvas");
  }

  let finalWidth = width;
  let finalHeight = height;

  if (preset === "stories") {
    const crop = calculateStoriesCrop(img.naturalWidth || width, img.naturalHeight || height);
    canvas.width = 1080;
    canvas.height = 1920;
    finalWidth = 1080;
    finalHeight = 1920;
    ctx.drawImage(img, crop.originX, crop.originY, crop.width, crop.height, 0, 0, 1080, 1920);
  } else {
    const scaled = calculateScaledDimensions(
      img.naturalWidth || width,
      img.naturalHeight || height,
      config.maxDimension,
    );
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    finalWidth = scaled.width;
    finalHeight = scaled.height;
    ctx.drawImage(img, 0, 0, scaled.width, scaled.height);
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Fallo al exportar blob"))),
      "image/jpeg",
      config.compressQuality,
    );
  });

  const blobUrl = URL.createObjectURL(blob);
  return {
    uri: blobUrl,
    width: finalWidth,
    height: finalHeight,
    filename: `${config.filenamePrefix}_${Date.now()}.jpg`,
  };
}

/**
 * En web descarga el archivo optimizado con la etiqueta <a> de descarga.
 */
export async function saveOptimizedToGallery(uri: string, filename: string): Promise<void> {
  await saveDownloadWeb(uri, filename);
}

/**
 * En web intenta usar Web Share API o copia el enlace al portapapeles.
 */
export async function shareOptimizedMedia(
  uri: string,
  title: string,
  message?: string,
): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({
        title,
        text: message || title,
        url: uri.startsWith("http") ? uri : undefined,
      });
      return;
    } catch {
      // Usuario canceló la hoja de compartir
    }
  }

  if (uri.startsWith("http") && navigator.clipboard) {
    await navigator.clipboard.writeText(uri);
  }
}
