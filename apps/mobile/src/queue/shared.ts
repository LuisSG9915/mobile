import { type AllowedExtension, MIME_BY_EXT, VIDEO_EXTENSIONS } from "@photos/shared";

export const MAX_ATTEMPTS = 6;
/**
 * Partes por prefirmado. El TTL de una URL prefirmada de parte es de 900 s
 * (`apps/api/src/lib/s3.ts`): firmar las 200 partes de un vídeo de 1 GB de golpe
 * hacía caducar las últimas antes de subirlas y el reintento volvía a pedirlas
 * todas. Firmar de 12 en 12 acota la ventana a lo que se sube enseguida.
 */
export const PART_PRESIGN_BATCH_SIZE = 12;

/** Partes multipart en vuelo: más acelera poco y multiplica el pico de memoria. */
export const PART_UPLOAD_CONCURRENCY = 3;

/**
 * Ejecuta `worker` sobre `items` con como máximo `limit` en vuelo. Si una tarea
 * falla deja de lanzar nuevas, espera a las que ya volaban y relanza el primer
 * error: un 404 corta el lote en vez de dejar media docena de partes subiendo
 * inútilmente.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let failure: unknown = null;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length || failure !== null) return;
      try {
        await worker(items[index]);
      } catch (err) {
        failure ??= err;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  if (failure !== null) throw failure;
}
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000];

/**
 * Una fase local (hash, miniatura, compresión, lectura de parte) que excede su
 * presupuesto se trata como fallo reintentable. Sin este techo, una promesa
 * nativa colgada deja `running=true` para siempre y la cola muere en silencio:
 * todos los runBackupPass posteriores no-opean hasta reiniciar la app.
 */
export class PhaseTimeoutError extends Error {
  phase: string;

  constructor(phase: string, ms: number) {
    super(`La fase ${phase} excedió su tiempo límite (${Math.round(ms / 1000)} s).`);
    this.name = "PhaseTimeoutError";
    this.phase = phase;
  }
}

/**
 * `Promise.race` con presupuesto. `onTimeout` corre ANTES de rechazar para que
 * el caller pueda abortar el trabajo nativo subyacente (p. ej. cancelCompression):
 * la carrera libera el hilo JS pero el nativo seguiría quemando CPU sin él.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  phase: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {}
      reject(new PhaseTimeoutError(phase, ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function extFromFilename(filename: string | null, mediaType: string): AllowedExtension {
  const raw = (filename?.split(".").pop() ?? "").toLowerCase();
  const fallback = mediaType === "video" ? "mp4" : "jpg";
  const ext = (raw || fallback) as AllowedExtension;
  return (MIME_BY_EXT as Record<string, string>)[ext] ? ext : (fallback as AllowedExtension);
}

export function extToMediaType(ext: string): "photo" | "video" {
  return VIDEO_EXTENSIONS.includes(ext) ? "video" : "photo";
}
