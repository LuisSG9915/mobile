import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { media, session, verification } from "../db/schema";
import type { Bindings } from "../env";
import { reconcileStorageStats, removeStorageUsage } from "../lib/storage-stats";

const BATCH = 500;
const MAX_ROUNDS = 10; // tope de lotes por corrida (límites del Worker)
const PENDING_TTL_MS = 24 * 3600 * 1000;
const TRASH_TTL_MS = 30 * 24 * 3600 * 1000;
// Un objeto sin fila en media solo es huérfano si lleva >24 h: las subidas
// legítimas completan en minutos y la fila puede llegar después del PUT.
const ORPHAN_MIN_AGE_MS = 24 * 3600 * 1000;
const ORPHAN_SCAN_LIMIT = 5000;

async function deleteObjects(env: Bindings, keys: string[]) {
  // delete() admite hasta 1000 claves por llamada; ignora objetos inexistentes
  for (let i = 0; i < keys.length; i += 1000) {
    await env.BUCKET.delete(keys.slice(i, i + 1000));
  }
}

/**
 * Cron diario:
 * 1. Purga registros "pending" inactivos >24 h (por updated_at, no created_at:
 *    un re-init reciente no debe purgarse en pleno vuelo) y sus objetos R2.
 * 2. Purga definitiva de la papelera tras 30 días (objetos R2 + fila + cuota).
 * 3. Purga sesiones y verificaciones expiradas (better-auth no las limpia).
 * 4. Reconcilia user_storage_stats contra media (auto-corrige drift).
 * 5. Barre objetos R2 huérfanos (sin fila en media) con más de 24 h.
 */
export async function runCleanup(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = Date.now();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stalePending = await db
      .select()
      .from(media)
      .where(and(eq(media.status, "pending"), lt(media.updatedAt, now - PENDING_TTL_MS)))
      .limit(BATCH);
    if (!stalePending.length) break;
    await deleteObjects(
      env,
      stalePending.flatMap((m) => [m.r2KeyThumb, m.r2KeyOriginal]),
    );
    for (const m of stalePending) {
      await db.delete(media).where(eq(media.id, m.id));
    }
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const expiredTrash = await db
      .select()
      .from(media)
      .where(and(isNotNull(media.deletedAt), lt(media.deletedAt, now - TRASH_TTL_MS)))
      .limit(BATCH);
    if (!expiredTrash.length) break;
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

  // Sesiones/verificaciones caducadas: tablas de better-auth sin TTL propio.
  await db.delete(session).where(lt(session.expiresAt, new Date(now)));
  await db.delete(verification).where(lt(verification.expiresAt, new Date(now)));

  await reconcileStorageStats(db);
  await sweepOrphanObjects(env, db, now);
}

/** Claves de R2 que tienen fila en media (thumb + original). */
async function knownKeys(db: ReturnType<typeof getDb>): Promise<Set<string>> {
  const rows = await db
    .select({ thumb: media.r2KeyThumb, original: media.r2KeyOriginal })
    .from(media);
  const keys = new Set<string>();
  for (const r of rows) {
    keys.add(r.thumb);
    keys.add(r.original);
  }
  return keys;
}

/**
 * Lista el bucket bajo users/ y borra objetos sin fila en media cuyo upload
 * supera las 24 h (PUTs que llegaron tras purgar la fila, subidas abortadas
 * a mitad, etc.). Acotado a ORPHAN_SCAN_LIMIT claves por corrida.
 */
async function sweepOrphanObjects(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  now: number,
): Promise<void> {
  const known = await knownKeys(db);
  const orphans: string[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await env.BUCKET.list({ prefix: "users/", limit: 1000, cursor });
    for (const obj of page.objects) {
      if (++scanned > ORPHAN_SCAN_LIMIT) break;
      if (!known.has(obj.key) && now - obj.uploaded.getTime() > ORPHAN_MIN_AGE_MS) {
        orphans.push(obj.key);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor && scanned <= ORPHAN_SCAN_LIMIT);
  if (orphans.length) await deleteObjects(env, orphans);
}
