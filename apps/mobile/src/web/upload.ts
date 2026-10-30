type PresignedTarget = { url: string; headers: Record<string, string> };

const CANCELLED_MSG = "Subida cancelada.";
const STALLED_MSG = "La subida se estancó por falta de red.";
/** Sin progreso en este tiempo = subida estancada → abortar y reintentar. */
const STALL_MS = 90_000;
const WATCHDOG_TICK_MS = 15_000;

/**
 * Fallo HTTP con el status a la vista, para que el caller distinga el 404 de
 * una sesión multipart que ya no existe de un 403 de firma caducada. Sin esto,
 * un PUT a una MPU abortada por el lifecycle de R2 se reintentaba para siempre.
 */
export class UploadHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
  }
}

/**
 * PUT directo a la URL prefirmada de R2 con progreso (XHR, porque fetch no
 * expone progreso de subida). Solo se envía content-type; el navegador calcula
 * content-length y la firma SigV4 sigue siendo válida.
 *
 * `signal` cancela de verdad: si ya viene abortada rechaza sin crear el XHR;
 * si aborta a mitad se llama xhr.abort() y la promesa rechaza con
 * "Subida cancelada.". Además un watchdog aborta si la subida no reporta
 * progreso en STALL_MS — una conexión colgada no puede congelar la cola.
 */
export function uploadBlob(
  target: PresignedTarget,
  blob: Blob,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCELLED_MSG));
      return;
    }
    const xhr = new XMLHttpRequest();
    let lastProgressAt = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > STALL_MS) {
        stalled = true;
        xhr.abort();
      }
    }, WATCHDOG_TICK_MS);
    const onAbortSignal = () => xhr.abort();
    const stopListening = () => {
      clearInterval(watchdog);
      signal?.removeEventListener("abort", onAbortSignal);
    };
    xhr.open("PUT", target.url);
    for (const [key, value] of Object.entries(target.headers)) {
      if (key.toLowerCase() === "content-length") continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (e) => {
      lastProgressAt = Date.now();
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      stopListening();
      if (xhr.status === 200 || xhr.status === 204) resolve();
      else reject(new UploadHttpError(xhr.status, `La subida falló (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => {
      stopListening();
      reject(new Error("Error de red al subir el archivo."));
    };
    xhr.ontimeout = () => {
      stopListening();
      reject(new Error("La subida tardó demasiado."));
    };
    xhr.onabort = () => {
      stopListening();
      reject(new Error(stalled || !signal?.aborted ? STALLED_MSG : CANCELLED_MSG));
    };
    signal?.addEventListener("abort", onAbortSignal);
    xhr.send(blob);
  });
}

/**
 * PUT de una parte individual a su URL prefirmada de S3/R2 multipart.
 * Devuelve el ETag recibido en los encabezados de respuesta de R2.
 */
export function uploadPartBlob(
  url: string,
  blob: Blob,
  onProgress?: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(CANCELLED_MSG));
      return;
    }
    const xhr = new XMLHttpRequest();
    let lastProgressAt = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > STALL_MS) {
        stalled = true;
        xhr.abort();
      }
    }, WATCHDOG_TICK_MS);
    const onAbortSignal = () => xhr.abort();
    const stopListening = () => {
      clearInterval(watchdog);
      signal?.removeEventListener("abort", onAbortSignal);
    };
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      lastProgressAt = Date.now();
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      stopListening();
      if (xhr.status === 200 || xhr.status === 204) {
        const rawEtag = xhr.getResponseHeader("ETag");
        // Sin ETag no se puede ensamblar: inventarlo producía un finalize que R2
        // rechazaba con parts_mismatch y borraba la fila de metadata entera.
        if (!rawEtag) {
          reject(new UploadHttpError(xhr.status, "R2 no devolvió ETag para la parte."));
          return;
        }
        resolve(rawEtag);
      } else {
        reject(
          new UploadHttpError(xhr.status, `La subida de la parte falló (HTTP ${xhr.status}).`),
        );
      }
    };
    xhr.onerror = () => {
      stopListening();
      reject(new Error("Error de red al subir la parte."));
    };
    xhr.ontimeout = () => {
      stopListening();
      reject(new Error("La subida tardó demasiado."));
    };
    xhr.onabort = () => {
      stopListening();
      reject(new Error(stalled || !signal?.aborted ? STALLED_MSG : CANCELLED_MSG));
    };
    signal?.addEventListener("abort", onAbortSignal);
    xhr.send(blob);
  });
}
