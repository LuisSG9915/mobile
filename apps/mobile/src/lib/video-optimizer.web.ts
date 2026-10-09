import { saveDownload as saveDownloadWeb } from "./save-download.web";

export type VideoPreset = "stories" | "whatsapp_hd" | "original";

export type OptimizeVideoOptions = {
  uri: string;
  preset: VideoPreset;
  onProgress?: (progress: number) => void;
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
