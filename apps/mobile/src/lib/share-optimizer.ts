import * as FileSystem from "expo-file-system/legacy";
import { type Action, manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { saveDownload as saveDownloadWeb } from "./save-download.web";
import {
  calculateStoriesCrop,
  getPresetConfig,
  type OptimizedMediaResult,
  type OptimizePhotoOptions,
  type SharePreset,
} from "./share-optimizer-calc";

export type { OptimizedMediaResult, OptimizePhotoOptions, SharePreset };

/**
 * Optimiza una foto según el perfil seleccionado (Historias 9:16, Facebook 2048px, WhatsApp HD).
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

  let localSourceUri = uri;
  let tempDownloadUri: string | null = null;

  // En móvil descargamos temporalmente si es una URL remota
  if (Platform.OS !== "web" && (uri.startsWith("http://") || uri.startsWith("https://"))) {
    try {
      tempDownloadUri = `${FileSystem.cacheDirectory}pre_share_${Date.now()}.jpg`;
      const dl = await FileSystem.downloadAsync(uri, tempDownloadUri);
      localSourceUri = dl.uri;
    } catch {
      // Si falla la descarga temporal, intentamos con la URI original
      localSourceUri = uri;
    }
  }

  try {
    const actions: Action[] = [];

    if (preset === "stories") {
      const crop = calculateStoriesCrop(width, height);
      actions.push({
        crop: {
          originX: crop.originX,
          originY: crop.originY,
          width: crop.width,
          height: crop.height,
        },
      });
      // Escalar exactamente a 1080 x 1920
      actions.push({
        resize: {
          width: 1080,
          height: 1920,
        },
      });
    } else if (config.maxDimension) {
      const currentMax = Math.max(width, height);
      if (currentMax > config.maxDimension) {
        if (width >= height) {
          actions.push({ resize: { width: config.maxDimension } });
        } else {
          actions.push({ resize: { height: config.maxDimension } });
        }
      }
    }

    const manipResult = await manipulateAsync(localSourceUri, actions, {
      compress: config.compressQuality,
      format: SaveFormat.JPEG,
    });

    return {
      uri: manipResult.uri,
      width: manipResult.width,
      height: manipResult.height,
      filename: `${config.filenamePrefix}_${Date.now()}.jpg`,
    };
  } finally {
    if (tempDownloadUri && Platform.OS !== "web") {
      await FileSystem.deleteAsync(tempDownloadUri, { idempotent: true }).catch(() => {});
    }
  }
}

/**
 * Guarda la imagen optimizada directamente en el carrete / biblioteca del dispositivo
 * o la descarga en navegador web.
 */
export async function saveOptimizedToGallery(uri: string, filename: string): Promise<void> {
  if (Platform.OS === "web") {
    await saveDownloadWeb(uri, filename);
    return;
  }

  // En nativo guardamos en el carrete usando MediaLibrary
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
 * Comparte el medio mediante la hoja nativa de compartir o Web Share API.
 */
export async function shareOptimizedMedia(
  uri: string,
  title: string,
  messageOrMime?: string,
): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title,
          text:
            messageOrMime?.startsWith("video/") || messageOrMime?.startsWith("image/")
              ? title
              : messageOrMime || title,
          url: uri.startsWith("http") ? uri : undefined,
        });
        return;
      } catch {
        // El usuario canceló o no se soportó
      }
    }
    if (uri.startsWith("http") && navigator.clipboard) {
      await navigator.clipboard.writeText(uri);
    }
    return;
  }

  // En móvil nativo: Si es URL remota, descargamos temporalmente porque Sharing.shareAsync exige URI local
  let localUri = uri;
  let tempUri: string | null = null;

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const isVideo =
      messageOrMime === "video/mp4" ||
      uri.toLowerCase().includes(".mp4") ||
      uri.toLowerCase().includes(".mov");
    const ext = isVideo ? "mp4" : "jpg";
    tempUri = `${FileSystem.cacheDirectory}share_stream_${Date.now()}.${ext}`;
    const dl = await FileSystem.downloadAsync(uri, tempUri);
    localUri = dl.uri;
  }

  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      const isVideo =
        localUri.endsWith(".mp4") || localUri.endsWith(".mov") || messageOrMime === "video/mp4";
      await Sharing.shareAsync(localUri, {
        dialogTitle: title,
        mimeType: isVideo ? "video/mp4" : "image/jpeg",
        UTI: isVideo ? "public.movie" : "public.jpeg",
      });
      return;
    }

    // Fallback a Share estándar si expo-sharing no estuviera disponible
    await Share.share({
      title,
      url: localUri,
    });
  } finally {
    if (tempUri) {
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    }
  }
}
