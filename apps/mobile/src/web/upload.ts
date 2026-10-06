type PresignedTarget = { url: string; headers: Record<string, string> };

const CANCELLED_MSG = "Subida cancelada.";

/**
 * PUT directo a la URL prefirmada de R2 con progreso (XHR, porque fetch no
 * expone progreso de subida). Solo se envía content-type; el navegador calcula
 * content-length y la firma SigV4 sigue siendo válida.
 *
 * `signal` cancela de verdad: si ya viene abortada rechaza sin crear el XHR;
 * si aborta a mitad se llama xhr.abort() y la promesa rechaza con
 * "Subida cancelada.". El listener se retira en todos los finales.
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
    const onAbortSignal = () => xhr.abort();
    const stopListening = () => signal?.removeEventListener("abort", onAbortSignal);
    xhr.open("PUT", target.url);
    for (const [key, value] of Object.entries(target.headers)) {
      if (key.toLowerCase() === "content-length") continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      stopListening();
      if (xhr.status === 200 || xhr.status === 204) resolve();
      else reject(new Error(`La subida falló (HTTP ${xhr.status}).`));
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
      reject(new Error(CANCELLED_MSG));
    };
    signal?.addEventListener("abort", onAbortSignal);
    xhr.send(blob);
  });
}
