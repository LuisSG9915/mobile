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
  /**
   * Recibe el cancellationId nativo apenas arranca la compresión; con él el
   * caller puede abortar vía `Video.cancelCompression(id)` si se agota el
   * presupuesto de tiempo.
   */
  onCancelId?: (cancellationId: string) => void;
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
          getCancellationId: options.onCancelId,
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

/**
 * Genera una versión comprimida MP4 H.264 ligera (~720p / 2 Mbps) para streaming rápido
 * y compatibilidad cruzada en navegadores web sin códec HEVC.
 */
export async function createVideoPreview(
  localUri: string,
  opts?: { onCancelId?: (cancellationId: string) => void },
): Promise<{ uri: string; bytes: number } | null> {
  if (Platform.OS === "web") {
    return null;
  }
  try {
    const res = await optimizeVideoForShare({
      uri: localUri,
      preset: "whatsapp_hd",
      onCancelId: opts?.onCancelId,
    });
    if (res.uri && res.uri !== localUri) {
      const info = await FileSystem.getInfoAsync(res.uri);
      if (info.exists && typeof info.size === "number" && info.size > 0) {
        return { uri: res.uri, bytes: info.size };
      }
    }
  } catch (e) {
    console.warn("createVideoPreview falló, usando original:", e);
  }
  return null;
}

/**
 * Aborta una compresión en curso por su cancellationId (lo entrega
 * `getCancellationId`). Best-effort: si el nativo ya terminó, no hace nada.
 */
export function cancelVideoCompression(cancellationId: string): void {
  try {
    Video.cancelCompression(cancellationId);
  } catch {}
}
