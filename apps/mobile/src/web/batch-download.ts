import { downloadZip } from "client-zip";

export type BatchEntry = { url: string; name: string };

const CONCURRENCY = 3;
const ZIP_NAME = "fotos-exportadas.zip";

/**
 * Descarga las entradas en paralelo acotado (3 peticiones simultáneas) y las
 * empaqueta en un ZIP en memoria del navegador. Las respuestas se guardan
 * como Blob — Chrome las respalda en disco, no en RAM, así que lotes grandes
 * no revientan la pestaña.
 */
export async function buildZip(entries: BatchEntry[]): Promise<Blob> {
  if (entries.length === 0) throw new Error("No hay elementos para descargar.");
  const files: File[] = new Array(entries.length);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const i = next++;
      const { url, name } = entries[i];
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`No se pudo descargar ${name} (HTTP ${res.status}).`);
      }
      files[i] = new File([await res.blob()], name);
    }
  };
  const workers = Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker());
  await Promise.all(workers);
  return downloadZip(files).blob();
}

/** Genera el ZIP del lote y dispara su descarga como fotos-exportadas.zip. */
export async function downloadBatch(entries: BatchEntry[]): Promise<void> {
  const blob = await buildZip(entries);
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = ZIP_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(href);
  }
}
