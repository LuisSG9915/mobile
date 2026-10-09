import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";

/**
 * Descarga el original a caché y lo guarda en el carrete del dispositivo.
 * Lanza Error si falla la descarga o el guardado (p. ej. sin permiso de
 * escritura en la biblioteca); el archivo temporal se limpia siempre.
 */
export async function saveDownload(url: string, filename: string): Promise<void> {
  const target = `${FileSystem.cacheDirectory}${filename}`;
  const { uri } = await FileSystem.downloadAsync(url, target);
  try {
    const perm = await MediaLibrary.getPermissionsAsync();
    if (!perm.granted) {
      const requested = await MediaLibrary.requestPermissionsAsync();
      if (!requested.granted) {
        throw new Error("Permiso denegado para guardar en la galería");
      }
    }
    await MediaLibrary.saveToLibraryAsync(uri);
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
