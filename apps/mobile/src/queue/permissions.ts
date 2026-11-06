import * as MediaLibrary from "expo-media-library/legacy";
import { PermissionsAndroid, Platform } from "react-native";

/** Pide acceso a la biblioteca de medios (solo nativo). */
export async function requestMediaPermissions(): Promise<{ granted: boolean }> {
  return MediaLibrary.requestPermissionsAsync(false, ["photo", "video"]);
}

/**
 * Android 13+: sin POST_NOTIFICATIONS la notificación del foreground service
 * no aparece en la bandeja (el servicio sigue vivo, visible solo en el
 * Administrador de tareas). No es requisito para subir, así que un "no" no
 * bloquea el respaldo.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (Number(Platform.Version) < 33) return true;
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    if (await PermissionsAndroid.check(permission)) return true;
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
