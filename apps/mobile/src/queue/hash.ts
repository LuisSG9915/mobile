import { File } from "expo-file-system";
import QuickCrypto from "react-native-quick-crypto";

const CHUNK = 4 * 1024 * 1024; // 4 MB

/**
 * SHA-256 en streaming (nunca carga el archivo completo en memoria).
 * Devuelve hex en minúsculas.
 */
export async function sha256File(uri: string): Promise<string> {
  const file = new File(uri);
  const size = file.size ?? 0;
  const hash = QuickCrypto.createHash("sha256");
  const handle = file.open();
  try {
    while ((handle.offset ?? 0) < size) {
      const bytes = handle.readBytes(CHUNK);
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
