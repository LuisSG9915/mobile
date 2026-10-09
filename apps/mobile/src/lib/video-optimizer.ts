import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import { Platform } from "react-native";
import { Video } from "react-native-compressor";
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
 * Optimiza un video usando aceleración por hardware del teléfono (MediaCodec / VideoToolbox).
 * Si la compresión falla, realiza fallback automático a la fuente para no bloquear al usuario.
 */
export async function optimizeVideoForShare(
  options: OptimizeVideoOptions,
): Promise<OptimizedVideoResult> {
  const { uri, preset, onProgress } = options;

  if (preset === "original") {
    return {
      uri,
      filename: `video_original_${Date.now()}.mp4`,
    };
  }

  let localSourceUri = uri;
  let tempDownloadUri: string | null = null;

  // En móvil descargamos temporalmente si es una URL remota
  if (Platform.OS !== "web" && (uri.startsWith("http://") || uri.startsWith("https://"))) {
    try {
      tempDownloadUri = `${FileSystem.cacheDirectory}pre_video_opt_${Date.now()}.mp4`;
      const dl = await FileSystem.downloadAsync(uri, tempDownloadUri);
      localSourceUri = dl.uri;
    } catch {
      localSourceUri = uri;
    }
  }

  try {
    let maxSize = 1920;
    let bitrate = 9_000_000;
    let filenamePrefix = "historia_1080p";

    if (preset === "whatsapp_hd") {
      maxSize = 1280;
      bitrate = 4_000_000;
      filenamePrefix = "whatsapp_720p";
    }

    try {
      const compressedUri = await Video.compress(
        localSourceUri,
        {
          compressionMethod: "manual",
          maxSize,
          bitrate,
          minimumFileSizeForCompress: 2,
        },
        (progress) => {
          onProgress?.(progress);
        },
      );

      return {
        uri: compressedUri,
        filename: `${filenamePrefix}_${Date.now()}.mp4`,
      };
    } catch (compressErr) {
      console.warn("Fallo al comprimir video, usando archivo fuente:", compressErr);
      return {
        uri: localSourceUri,
        filename: `${filenamePrefix}_${Date.now()}.mp4`,
      };
    }
  } finally {
    if (tempDownloadUri && Platform.OS !== "web") {
      await FileSystem.deleteAsync(tempDownloadUri, { idempotent: true }).catch(() => {});
    }
  }
}

/**
 * Guarda el video optimizado en el carrete / biblioteca del dispositivo o lo descarga en web.
 */
export async function saveOptimizedVideoToGallery(uri: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    await saveDownloadWeb(uri, filename);
    return;
  }

  let localUri = uri;
  let tempUri: string | null = null;

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    tempUri = `${FileSystem.cacheDirectory}${filename}`;
    const dl = await FileSystem.downloadAsync(uri, tempUri);
    localUri = dl.uri;
  }

  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) {
      const requested = await MediaLibrary.requestPermissionsAsync();
      if (!requested.granted) {
        throw new Error("Permiso denegado para guardar en la galería");
      }
    }
    await MediaLibrary.saveToLibraryAsync(localUri);
  } finally {
    if (tempUri) {
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    }
  }
}
