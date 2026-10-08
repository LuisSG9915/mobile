import type { PublicAlbumItem } from "@photos/shared";
import { saveDownload } from "./save-download";

/**
 * En nativo los elementos públicos se descargan uno a uno al carrete / almacenamiento.
 */
export async function downloadPublicAlbum(
  albumTitle: string,
  items: PublicAlbumItem[],
): Promise<void> {
  const safeName = (albumTitle || "album").trim().replace(/[^a-zA-Z0-9_\-\u00C0-\u017F\s]/g, "");
  const baseName = safeName.replace(/\s+/g, "_") || "album";

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const ext = item.mediaType === "video" ? "mp4" : "jpg";
    const filename = `${baseName}_${String(index + 1).padStart(3, "0")}_${item.id.slice(0, 8)}.${ext}`;
    await saveDownload(item.downloadUrl || item.originalUrl, filename);
  }
}
