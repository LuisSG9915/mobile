import { STORAGE_QUOTA_BYTES } from "@photos/shared";
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { media, userStorageStats } from "../db/schema";

/**
 * Suma bytes (original + miniatura) y un medio a la cuota del usuario.
 * Upsert atómico: seguro aunque dos /complete corran en paralelo.
 */
export async function addStorageUsage(db: Db, userId: string, bytes: number): Promise<void> {
  const now = Date.now();
  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes: bytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userStorageStats.userId,
      set: {
        usedBytes: sql`${userStorageStats.usedBytes} + ${bytes}`,
        mediaCount: sql`${userStorageStats.mediaCount} + 1`,
        updatedAt: now,
      },
    });
}

/**
 * Resta bytes al purgar definitivamente un medio 'ready'. Se clampea a 0 para
 * tolerar desbalances históricos (filas contadas antes de existir la tabla).
 */
export async function removeStorageUsage(db: Db, userId: string, bytes: number): Promise<void> {
  await db
    .update(userStorageStats)
    .set({
      usedBytes: sql`max(0, ${userStorageStats.usedBytes} - ${bytes})`,
      mediaCount: sql`max(0, ${userStorageStats.mediaCount} - 1)`,
      updatedAt: Date.now(),
    })
    .where(eq(userStorageStats.userId, userId));
}

/**
 * Uso actual del usuario para decisiones (cuota en /uploads/init). Si no hay
 * fila en user_storage_stats (cuentas anteriores al contador), se materializa
 * perezosa con el SUM real sobre media — auto-sana el drift histórico en la
 * primera lectura en vez de esperar a la reconciliación del cron.
 */
export async function getUsageBytes(
  db: Db,
  userId: string,
): Promise<{ usedBytes: number; maxBytes: number }> {
  const row = await db
    .select()
    .from(userStorageStats)
    .where(eq(userStorageStats.userId, userId))
    .get();
  if (row) return { usedBytes: row.usedBytes, maxBytes: row.maxBytes };

  const agg = await db
    .select({
      bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize}), 0)`,
      cnt: sql<number>`count(*)`,
    })
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.status, "ready")))
    .get();
  const usedBytes = agg?.bytes ?? 0;
  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: agg?.cnt ?? 0,
      updatedAt: Date.now(),
    })
    .onConflictDoNothing();
  return { usedBytes, maxBytes: STORAGE_QUOTA_BYTES };
}

/**
 * Reescribe el contador con el valor calculado (SET, no ADD): lo usa la
 * reconciliación del cron para corregir cualquier drift acumulado.
 */
export async function setStorageUsage(
  db: Db,
  userId: string,
  bytes: number,
  count: number,
): Promise<void> {
  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes: bytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: count,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: userStorageStats.userId,
      set: { usedBytes: bytes, mediaCount: count, updatedAt: Date.now() },
    });
}

/**
 * Reconciliación completa: recalcula user_storage_stats desde media
 * (status='ready', incluye papelera — sigue ocupando R2 hasta la purga) y
 * pone a 0 las filas de usuarios sin media ready. media es la fuente de
 * verdad; esta pasada auto-corrige drift de bugs o histórico.
 */
export async function reconcileStorageStats(db: Db): Promise<number> {
  const agg = await db
    .select({
      userId: media.userId,
      bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize}), 0)`,
      cnt: sql<number>`count(*)`,
    })
    .from(media)
    .where(eq(media.status, "ready"))
    .groupBy(media.userId);

  for (const row of agg) {
    await setStorageUsage(db, row.userId, row.bytes, row.cnt);
  }

  const userIds = agg.map((r) => r.userId);
  await db
    .update(userStorageStats)
    .set({ usedBytes: 0, mediaCount: 0, updatedAt: Date.now() })
    .where(userIds.length ? notInArray(userStorageStats.userId, userIds) : undefined);

  return agg.length;
}
