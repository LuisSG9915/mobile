import { saveDownload as saveDownloadWeb } from "./save-download.web";

export type VideoPreset = "stories" | "whatsapp_hd" | "original";

export type OptimizeVideoOptions = {
  uri: string;
  preset: VideoPreset;
  onProgress?: (progress: number) => void;
  /** Solo nativo; en web no hay compresión nativa que cancelar. */
  onCancelId?: (cancellationId: string) => void;
};

export type OptimizedVideoResult = {
  uri: string;
  filename: string;
};

/**
 * En entorno Web devuelve el archivo original preparado para descarga con el nombre del preset.
 */
export async function optimizeVideoForShare(
  options: OptimizeVideoOptions,
): Promise<OptimizedVideoResult> {
  const { uri, preset } = options;
  const prefix =
    preset === "whatsapp_hd"
      ? "whatsapp_720p"
      : preset === "stories"
        ? "historia_1080p"
        : "video_original";
  return {
    uri,
    filename: `${prefix}_${Date.now()}.mp4`,
  };
}

/**
 * En web descarga el archivo con <a> download.
 */
export async function saveOptimizedVideoToGallery(uri: string, filename: string): Promise<void> {
  await saveDownloadWeb(uri, filename);
}

/**
 * En entorno Web, la compresión H.264 nativa no aplica en el cliente.
 */
export async function createVideoPreview(
  _localUri: string,
  _opts?: { onCancelId?: (cancellationId: string) => void },
): Promise<{ uri: string; bytes: number } | null> {
  return null;
}

/** No-op en web: no hay compresor nativo. */
export function cancelVideoCompression(_cancellationId: string): void {}
