import { ALLOWED_EXTENSIONS, VIDEO_EXTENSIONS } from "@photos/shared";
import { enqueueAsset } from "../queue/db";
import * as store from "./queue-store";

/**
 * Caché en memoria assetId -> File de los archivos de ESTA sesión. No es la
 * fuente de verdad: los bytes viven en IndexedDB (queue-store.ts) y este mapa
 * solo evita reconstruir File al seleccionar/leer. Se limpia al cerrar la cola
 * (closeQueue -> closeQueueDb) para no filar archivos entre usuarios.
 */
const cache = new Map<string, File>();

store.onQueueClose(() => cache.clear());

/**
 * Devuelve el File del asset: primero la caché de sesión, si no lo reconstruye
 * desde IndexedDB (`new File([data], name, {type, lastModified})`).
 */
export async function getFile(assetId: string): Promise<File | undefined> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const ctx = store.getActiveContext();
  if (!ctx) return undefined;
  const row = await store.loadFile(ctx.userId, assetId);
  if (!row) return undefined;
  const file = new File([row.data], row.name, { type: row.type, lastModified: row.lastModified });
  cache.set(assetId, file);
  return file;
}

export type PickResult = { added: number; failed: number; skipped: number };

/**
 * Abre el selector de archivos y encola lo elegido de forma SECUENCIAL (un
 * arrayBuffer a la vez, para no duplicar la RAM con N buffers). Cada archivo
 * válido queda persistido en IndexedDB junto a su fila de cola.
 * Devuelve {added, failed}; si todo falló lanza Error con mensaje en español.
 */
export function pickAndEnqueue(): Promise<PickResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,video/*";
    const finish = (result: PickResult) => {
      input.remove();
      if (result.added === 0 && result.failed > 0 && result.skipped === 0) {
        reject(
          new Error(
            "No se pudieron guardar los archivos para respaldar. Libera espacio e inténtalo de nuevo.",
          ),
        );
        return;
      }
      resolve(result);
    };
    input.addEventListener("change", () => {
      const procesar = async (): Promise<PickResult> => {
        let added = 0;
        let failed = 0;
        let skipped = 0;
        for (const f of Array.from(input.files ?? [])) {
          const ext = (f.name.split(".").pop() ?? "").toLowerCase();
          if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
            skipped++;
            continue;
          }
          const id = `web-${crypto.randomUUID()}`;
          try {
            await enqueueAsset(
              {
                id,
                uri: id,
                filename: f.name,
                mediaType: VIDEO_EXTENSIONS.includes(ext) ? "video" : "photo",
                creationTime: f.lastModified || Date.now(),
              },
              f,
            );
            cache.set(id, f);
            added++;
          } catch {
            failed++;
          }
        }
        return { added, failed, skipped };
      };
      // Si el procesamiento entero explota, cuenta como fallo global.
      procesar().then(finish, () => finish({ added: 0, failed: 1, skipped: 0 }));
    });
    input.addEventListener("cancel", () => finish({ added: 0, failed: 0, skipped: 0 }));
    input.click();
  });
}
