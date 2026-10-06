import * as MediaLibrary from "expo-media-library/legacy";

/** Pide acceso a la biblioteca de medios (solo nativo). */
export async function requestMediaPermissions(): Promise<{ granted: boolean }> {
  return MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
}
