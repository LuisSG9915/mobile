import { api } from "../api/client";
import { saveDownload } from "./save-download";

/**
 * Descarga los originales indicados al carrete, uno a uno (nativo).
 * La variante web empaqueta todo en un ZIP (download-many.web.ts).
 */
export async function downloadMany(remoteIds: string[], _zipName?: string): Promise<number> {
  for (const id of remoteIds) {
    const d = await api.downloadMedia(id);
    await saveDownload(d.url, d.filename);
  }
  return remoteIds.length;
}
