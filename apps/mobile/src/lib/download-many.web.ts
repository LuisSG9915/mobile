import { api } from "../api/client";
import { downloadBatch } from "../web/batch-download";

/**
 * En web los originales se descargan en lote y se empaquetan como
 * fotos-exportadas.zip (misma API que la variante nativa).
 */
export async function downloadMany(remoteIds: string[]): Promise<number> {
  const entries = await Promise.all(
    remoteIds.map(async (id) => {
      const d = await api.downloadMedia(id);
      return { url: d.url, name: d.filename };
    }),
  );
  await downloadBatch(entries);
  return remoteIds.length;
}
