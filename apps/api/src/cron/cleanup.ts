import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { Bindings } from "../env";
import { removeStorageUsage } from "../lib/storage-stats";

const BATCH = 500;
const PENDING_TTL_MS = 24 * 3600 * 1000;
const TRASH_TTL_MS = 30 * 24 * 3600 * 1000;

async function deleteObjects(env: Bindings, keys: string[]) {
  // delete() admite hasta 1000 claves por llamada; ignora objetos inexistentes
  for (let i = 0; i < keys.length; i += 1000) {
    await env.BUCKET.delete(keys.slice(i, i + 1000));
  }
}

/**
 * Cron diario:
 * 1. Purga registros "pending" con más de 24 h (subidas abandonadas) y sus objetos R2 si existen.
 * 2. Purga definitiva de la papelera tras 30 días (objetos R2 + fila).
 */
export async function runCleanup(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = Date.now();

  const stalePending = await db
    .select()
    .from(media)
    .where(and(eq(media.status, "pending"), lt(media.createdAt, now - PENDING_TTL_MS)))
    .limit(BATCH);

  if (stalePending.length) {
    await deleteObjects(
      env,
      stalePending.flatMap((m) => [m.r2KeyThumb, m.r2KeyOriginal]),
    );
    for (const m of stalePending) {
      await db.delete(media).where(eq(media.id, m.id));
    }
  }

  const expiredTrash = await db
    .select()
    .from(media)
    .where(and(isNotNull(media.deletedAt), lt(media.deletedAt, now - TRASH_TTL_MS)))
    .limit(BATCH);

  if (expiredTrash.length) {
    await deleteObjects(
      env,
      expiredTrash.flatMap((m) => [m.r2KeyThumb, m.r2KeyOriginal]),
    );
    for (const m of expiredTrash) {
      await db.delete(media).where(eq(media.id, m.id));
      // Solo los 'ready' sumaron cuota al confirmarse la subida; los 'pending'
      // borrados suave nunca llegaron a contarse.
      if (m.status === "ready") {
        await removeStorageUsage(db, m.userId, m.fileSize + m.thumbSize);
      }
    }
  }
}
