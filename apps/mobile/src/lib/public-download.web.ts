import type { PublicAlbumItem } from "@photos/shared";
import { downloadBatch } from "../web/batch-download";

/**
 * En web los elementos públicos se descargan en lote y se empaquetan como
 * un ZIP en el navegador con client-zip, usando las URLs prefirmadas de descarga.
 */
export async function downloadPublicAlbum(
  albumTitle: string,
  items: PublicAlbumItem[],
): Promise<void> {
  const safeName = (albumTitle || "album").trim().replace(/[^a-zA-Z0-9_\-\u00C0-\u017F\s]/g, "");
  const baseName = safeName.replace(/\s+/g, "_") || "album";

  const entries = items.map((item, index) => {
    const ext = item.mediaType === "video" ? "mp4" : "jpg";
    const filename = `${baseName}_${String(index + 1).padStart(3, "0")}_${item.id.slice(0, 8)}.${ext}`;
    return {
      url: item.downloadUrl || item.originalUrl,
      name: filename,
    };
  });

  await downloadBatch(entries, `${baseName}.zip`);
}
