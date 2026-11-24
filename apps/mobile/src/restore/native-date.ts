import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface NativeDateModule {
  setDateTaken(assetId: string, mediaType: string, takenAtMs: number): Promise<boolean>;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeDateModule>("UploadForeground")
    : null;

/**
 * Fija la fecha de captura de un asset recién restaurado para que la galería lo coloque
 * en su fecha original. Devuelve false si el módulo nativo no está (build antigua) o falla:
 * la restauración no debe fallar por esto.
 */
export async function setAssetDateTaken(
  assetId: string,
  mediaType: "photo" | "video",
  takenAtMs: number,
): Promise<boolean> {
  if (!native?.setDateTaken) {
    console.warn("[restore] setDateTaken: módulo nativo ausente (¿build antigua?)");
    return false;
  }
  try {
    const ok = await native.setDateTaken(assetId, mediaType, takenAtMs);
    if (!ok)
      console.warn("[restore] setDateTaken: MediaStore no actualizó filas", { assetId, mediaType });
    return ok;
  } catch (e) {
    console.warn("[restore] setDateTaken falló:", e);
    return false;
  }
}
