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
 * En entorno Web devuelve el archivo original o una copia para descarga.
 */
export async function optimizeVideoForShare(
  options: OptimizeVideoOptions,
): Promise<OptimizedVideoResult> {
  const { uri } = options;
  return {
    uri,
    filename: `video_opt_${Date.now()}.mp4`,
  };
}

/**
 * En web descarga el archivo con <a> download.
 */
export async function saveOptimizedVideoToGallery(uri: string, filename: string): Promise<void> {
  await saveDownloadWeb(uri, filename);
}
