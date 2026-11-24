import { File, FileMode } from "expo-file-system";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import QuickCrypto from "react-native-quick-crypto";

interface NativeHashModule {
  sha256File(fileUri: string): Promise<string>;
}

const nativeHasher =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativeHashModule>("UploadForeground")
    : null;

/**
 * SHA-256 en streaming. Usa el módulo nativo `UploadForeground.sha256File`
 * (buffer de 64 KB) cuando está disponible y cae al fallback JS en streaming
 * con el mismo tamaño de buffer. Devuelve hex en minúsculas.
 */
export async function sha256File(uri: string): Promise<string> {
  if (nativeHasher?.sha256File) {
    try {
      const hash = await nativeHasher.sha256File(uri);
      if (hash && hash.length === 64) {
        return hash.toLowerCase();
      }
    } catch (err) {
      console.warn("[queue/hash] Falló sha256File nativo, usando fallback JS:", err);
    }
  }

  const file = new File(uri);
  const size = file.size ?? 0;
  const hash = QuickCrypto.createHash("sha256");
  const handle = file.open(FileMode.ReadOnly);
  try {
    const BUFFER_SIZE = 64 * 1024;
    while ((handle.offset ?? 0) < size) {
      const bytes = handle.readBytes(BUFFER_SIZE);
      if (!bytes.byteLength) break;
      hash.update(bytes);
      // ceder el hilo entre chunks para no bloquear la UI
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    handle.close();
  }
  return hash.digest("hex");
}

export async function computeFileSha256(fileUri: string): Promise<string> {
  return sha256File(fileUri);
}
