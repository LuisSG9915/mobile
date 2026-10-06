import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const CHUNK = 4 * 1024 * 1024; // 4 MB

/**
 * SHA-256 incremental sobre un File (hex en minúsculas).
 * crypto.subtle.digest no es incremental, así que se trocea para no cargar
 * archivos grandes completos en memoria.
 */
export async function sha256File(file: Blob): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
    hash.update(bytes);
    // ceder el hilo entre chunks para no bloquear la UI
    await new Promise((r) => setTimeout(r, 0));
  }
  return bytesToHex(hash.digest());
}
