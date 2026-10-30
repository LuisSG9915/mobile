/**
 * PUT de UNA parte multipart en nativo, sin base64.
 *
 * Antes cada parte de 5 MiB se leía con `readAsStringAsync(base64)` (×1.33 de
 * tamaño), se escribía a caché y se subía con `uploadAsync`: dos copias por byte,
 * ~1.4 GB de strings para un vídeo de 1 GB y cero progreso. Aquí se corta el
 * archivo con `File.slice()` (Blob perezoso), se pasa a `ArrayBuffer` una sola
 * vez y se sube con XHR, que sí reporta `upload.onprogress` por byte.
 *
 * Mismo contrato que `web/upload.ts#uploadPartBlob`: ETag obligatorio, 404 se
 * propaga con status para que el processor distinga "sesión muerta" de un fallo
 * de red.
 */

import { withDeadline } from "./shared";

const CANCELLED_MSG = "Subida cancelada.";
const STALLED_MSG = "La subida de la parte se estancó por falta de red.";
/** Sin progreso en este tiempo = subida estancada → abortar y reintentar. */
const STALL_MS = 90_000;
const WATCHDOG_TICK_MS = 15_000;

export class PartUploadError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PartUploadError";
    this.status = status;
  }
}

export type UploadPartInput = {
  url: string;
  /** Rango del archivo original: `new File(uri).slice(start, end)`. */
  blob: Blob;
  headers?: Record<string, string>;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
};

export async function uploadPartBlob({
  url,
  blob,
  headers,
  onProgress,
  signal,
}: UploadPartInput): Promise<{ etag: string }> {
  if (signal?.aborted) throw new Error(CANCELLED_MSG);

  // Una sola copia en memoria por parte (5 MiB hoy, 16 MiB con U2).
  // Deadline: una lectura colgada (archivo corrupto, proveedor roto) sin techo
  // congelaba la cola entera — la señal de aborto no alcanza a arrayBuffer().
  const body = await withDeadline(blob.arrayBuffer(), 120_000, "leer-parte");
  // El signal puede abortarse mientras se materializa el rango.
  if (signal?.aborted) throw new Error(CANCELLED_MSG);

  return new Promise<{ etag: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let lastProgressAt = Date.now();

    const cleanup = () => {
      clearInterval(watchdog);
      signal?.removeEventListener("abort", onAbortSignal);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onAbortSignal = () => {
      try {
        xhr.abort();
      } catch {}
    };

    const watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > STALL_MS) {
        try {
          xhr.abort();
        } catch {}
      }
    }, WATCHDOG_TICK_MS);

    signal?.addEventListener("abort", onAbortSignal);

    xhr.open("PUT", url);
    // El prefirmado de UploadPart no firma headers: se envían los que dé el
    // servidor y nunca content-length (lo calcula el runtime).
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (key.toLowerCase() !== "content-length") xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (event: ProgressEvent) => {
      lastProgressAt = Date.now();
      onProgress?.(event.loaded, event.total || body.byteLength);
    };

    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status === 200 || xhr.status === 204) {
        if (!etag) {
          // Sin ETag no se puede ensamblar: inventarlo produce un finalize
          // rechazado con parts_mismatch y el servidor borra la fila.
          finish(() =>
            reject(new PartUploadError(xhr.status, "R2 no devolvió ETag para la parte.")),
          );
          return;
        }
        finish(() => resolve({ etag }));
        return;
      }
      finish(() =>
        reject(
          new PartUploadError(xhr.status, `La subida de la parte falló (HTTP ${xhr.status}).`),
        ),
      );
    };
    xhr.onerror = () => finish(() => reject(new Error("La subida de la parte falló por red.")));
    xhr.ontimeout = () => finish(() => reject(new Error(STALLED_MSG)));
    xhr.onabort = () =>
      finish(() => reject(new Error(signal?.aborted ? CANCELLED_MSG : STALLED_MSG)));

    xhr.send(body);
  });
}
