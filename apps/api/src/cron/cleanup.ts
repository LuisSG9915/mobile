import { and, eq, inArray, isNotNull, like, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { media, session, systemState, verification } from "../db/schema";
import type { Bindings } from "../env";
import { abortStaleMultipartUploads } from "../lib/s3";
import {
  reconcileStorageStats,
  releaseStorageReservation,
  removeStorageUsage,
} from "../lib/storage-stats";

const BATCH = 500;
const MAX_ROUNDS = 10; // tope de lotes por corrida (límites del Worker)
const PENDING_TTL_MS = 24 * 3600 * 1000;
const TRASH_TTL_MS = 30 * 24 * 3600 * 1000;
// Un objeto sin fila en media solo es huérfano si lleva >24 h: las subidas
// legítimas completan en minutos y la fila puede llegar después del PUT.
const ORPHAN_MIN_AGE_MS = 24 * 3600 * 1000;
const ORPHAN_PAGE_LIMIT = 5; // hasta 5 páginas (5000 objetos) por ejecución con cursor persistente

async function deleteObjects(env: Bindings, keys: string[]) {
  // delete() admite hasta 1000 claves por llamada; ignora objetos inexistentes
  for (let i = 0; i < keys.length; i += 1000) {
    await env.BUCKET.delete(keys.slice(i, i + 1000));
  }
}

/**
 * Cron diario:
 * 1. Purga registros "pending" inactivos >24 h (por updated_at, no created_at:
 *    un re-init reciente no debe purgarse en pleno vuelo), sus objetos R2 y
 *    libera los bytes que tenían reservados en la cuota.
 * 2. Purga definitiva de la papelera tras 30 días (objetos R2 + fila + cuota).
 * 3. Purga sesiones y verificaciones expiradas (better-auth no las limpia).
 * 4. Reconcilia user_storage_stats contra media (auto-corrige drift).
 * 5. Barre objetos R2 huérfanos con cursor persistente en system_state.
 */
/**
 * Latido del cron en `system_state.cron_last_run`: permite alertar si el cron
 * deja de correr (docs/ops/SLO.md). `finishedAt`/`ok` solo se escriben al
 * terminar; si el Worker muere a mitad, el latido conserva el último inicio.
 */
async function writeCronHeartbeat(
  db: ReturnType<typeof getDb>,
  status: { ok: boolean; finishedAt: number | null; error?: string },
): Promise<void> {
  try {
    const current = await db
      .select()
      .from(systemState)
      .where(eq(systemState.key, "cron_last_run"))
      .get();
    let startedAt = Date.now();
    if (current?.value) {
      try {
        startedAt = (JSON.parse(current.value) as { startedAt?: number }).startedAt ?? startedAt;
      } catch {}
    }
    await db
      .insert(systemState)
      .values({
        key: "cron_last_run",
        value: JSON.stringify({ ...status, startedAt }),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: systemState.key,
        set: { value: JSON.stringify({ ...status, startedAt }), updatedAt: Date.now() },
      });
  } catch (err) {
    console.error("cron_heartbeat_error", err);
  }
}

export async function runCleanup(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const now = Date.now();
  await writeCronHeartbeat(db, { ok: false, finishedAt: null });

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stalePending = await db
      .select()
      .from(media)
      .where(and(eq(media.status, "pending"), lt(media.updatedAt, now - PENDING_TTL_MS)))
      .limit(BATCH);
    if (!stalePending.length) break;
    await deleteObjects(
      env,
      stalePending.flatMap(
        (m) => [m.r2KeyThumb, m.r2KeyOriginal, m.r2KeyPreview].filter(Boolean) as string[],
      ),
    );
    const pendingIds = stalePending.map((m) => m.id);
    await db.delete(media).where(inArray(media.id, pendingIds));
    for (const m of stalePending) {
      await releaseStorageReservation(
        db,
        m.userId,
        m.fileSize + m.thumbSize + (m.previewSize ?? 0),
      );
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
      expiredTrash.flatMap(
        (m) => [m.r2KeyThumb, m.r2KeyOriginal, m.r2KeyPreview].filter(Boolean) as string[],
      ),
    );
    const trashIds = expiredTrash.map((m) => m.id);
    await db.delete(media).where(inArray(media.id, trashIds));
    for (const m of expiredTrash) {
      // Solo los 'ready' sumaron cuota al confirmarse la subida; los 'pending'
      // borrados suave nunca llegaron a contarse.
      if (m.status === "ready") {
        await removeStorageUsage(db, m.userId, m.fileSize + m.thumbSize + (m.previewSize ?? 0));
      }
    }
  }

  // Sesiones/verificaciones caducadas: tablas de better-auth sin TTL propio.
  await db.delete(session).where(lt(session.expiresAt, new Date(now)));
  await db.delete(verification).where(lt(verification.expiresAt, new Date(now)));

  // Purgar prefijos de usuarios con cuenta eliminada pendientes
  const userPurges = await db
    .select()
    .from(systemState)
    .where(like(systemState.key, "purge_user_%"))
    .limit(5);

  for (const purge of userPurges) {
    const targetUserId = purge.value;
    if (!targetUserId) {
      await db.delete(systemState).where(eq(systemState.key, purge.key));
      continue;
    }
    const listed = await env.BUCKET.list({ prefix: `users/${targetUserId}/`, limit: 1000 });
    if (listed.objects.length > 0) {
      await deleteObjects(
        env,
        listed.objects.map((o) => o.key),
      );
    }
    if (!listed.truncated) {
      await db.delete(systemState).where(eq(systemState.key, purge.key));
    }
  }

  await reconcileStorageStats(db);
  await sweepOrphanObjects(env, db, now);
  try {
    await abortStaleMultipartUploads(env);
  } catch (err) {
    console.error("Error al purgar subidas multipart incompletas:", err);
  }
  await writeCronHeartbeat(db, { ok: true, finishedAt: Date.now() });
}

/**
 * Lista el bucket bajo users/ y borra objetos sin fila en media cuyo upload
 * supera las 24 h (PUTs que llegaron tras purgar la fila, subidas abortadas
 * a mitad, etc.). Procesa hasta ORPHAN_PAGE_LIMIT páginas (5.000 objetos)
 * por ejecución persistiendo el cursor en system_state para garantizar que
 * sucesivas ejecuciones recorran todo el bucket sin atascarse al inicio.
 */
async function sweepOrphanObjects(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  now: number,
): Promise<void> {
  const cursorRow = await db
    .select()
    .from(systemState)
    .where(eq(systemState.key, "r2_orphan_sweep_cursor"))
    .get();
  let cursor: string | undefined = cursorRow?.value || undefined;

  const orphans: string[] = [];
  let pageCount = 0;
  let nextCursor: string | null = null;

  while (pageCount < ORPHAN_PAGE_LIMIT) {
    const page = await env.BUCKET.list({ prefix: "users/", limit: 1000, cursor });
    pageCount++;

    const candidates = page.objects.filter(
      (obj) => now - obj.uploaded.getTime() > ORPHAN_MIN_AGE_MS,
    );

    // Valida existencia en D1 en trozos de 30 para respetar el límite de 100 variables (3 * 30 = 90)
    for (let i = 0; i < candidates.length; i += 30) {
      const chunk = candidates.slice(i, i + 30);
      const chunkKeys = chunk.map((c) => c.key);
      const rows = await db
        .select({
          thumb: media.r2KeyThumb,
          original: media.r2KeyOriginal,
          preview: media.r2KeyPreview,
        })
        .from(media)
        .where(
          or(
            inArray(media.r2KeyThumb, chunkKeys),
            inArray(media.r2KeyOriginal, chunkKeys),
            inArray(media.r2KeyPreview, chunkKeys),
          ),
        );
      const known = new Set<string>();
      for (const r of rows) {
        known.add(r.thumb);
        known.add(r.original);
        if (r.preview) known.add(r.preview);
      }
      for (const c of chunk) {
        if (!known.has(c.key)) orphans.push(c.key);
      }
    }

    if (page.truncated && page.cursor) {
      cursor = page.cursor;
      nextCursor = page.cursor;
    } else {
      nextCursor = null;
      break;
    }
  }

  // Persistir el cursor para la próxima ejecución (o null si se alcanzó el fin del bucket)
  await db
    .insert(systemState)
    .values({ key: "r2_orphan_sweep_cursor", value: nextCursor, updatedAt: now })
    .onConflictDoUpdate({
      target: systemState.key,
      set: { value: nextCursor, updatedAt: now },
    });

  if (orphans.length) await deleteObjects(env, orphans);
}
