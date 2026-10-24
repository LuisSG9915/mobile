import { STORAGE_QUOTA_BYTES } from "@photos/shared";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { media, userStorageStats } from "../db/schema";

/**
 * Pasa bytes reservados a usados al confirmarse la subida (/uploads/{id}/complete).
 * Atómico: reduce reservedBytes e incrementa usedBytes y mediaCount.
 */
export async function confirmStorageUsage(db: Db, userId: string, bytes: number): Promise<void> {
  const now = Date.now();
  await db.run(
    sql`UPDATE user_storage_stats
        SET reserved_bytes = max(0, reserved_bytes - ${bytes}),
            used_bytes = used_bytes + ${bytes},
            media_count = media_count + 1,
            updated_at = ${now}
        WHERE user_id = ${userId}`,
  );
}

/**
 * Alias de compatibilidad para sumar uso confirmado de cuota.
 */
export async function addStorageUsage(db: Db, userId: string, bytes: number): Promise<void> {
  return confirmStorageUsage(db, userId, bytes);
}

/**
 * Reserva bytes en la cuota del usuario de forma atómica (/uploads/init).
 * Si (used_bytes + reserved_bytes + bytes) > max_bytes, el WHERE falla y changes === 0,
 * rechazando la reserva para evitar sobrepasar la cuota concurrentemente.
 */
export async function reserveStorageQuota(db: Db, userId: string, bytes: number): Promise<boolean> {
  await getUsageBytes(db, userId);
  const now = Date.now();
  const res = await db.run(
    sql`UPDATE user_storage_stats
        SET reserved_bytes = reserved_bytes + ${bytes},
            updated_at = ${now}
        WHERE user_id = ${userId}
          AND (used_bytes + reserved_bytes + ${bytes}) <= max_bytes`,
  );
  return (res.meta.changes ?? 0) > 0;
}

/**
 * Libera bytes reservados cuando una subida pendiente expira o se cancela.
 */
export async function releaseStorageReservation(
  db: Db,
  userId: string,
  bytes: number,
): Promise<void> {
  const now = Date.now();
  await db.run(
    sql`UPDATE user_storage_stats
        SET reserved_bytes = max(0, reserved_bytes - ${bytes}),
            updated_at = ${now}
        WHERE user_id = ${userId}`,
  );
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
): Promise<{ usedBytes: number; reservedBytes: number; maxBytes: number }> {
  const row = await db
    .select()
    .from(userStorageStats)
    .where(eq(userStorageStats.userId, userId))
    .get();
  if (row) {
    return {
      usedBytes: row.usedBytes,
      reservedBytes: row.reservedBytes,
      maxBytes: row.maxBytes,
    };
  }

  const [aggReady, aggPending] = await Promise.all([
    db
      .select({
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
        cnt: sql<number>`count(*)`,
      })
      .from(media)
      .where(and(eq(media.userId, userId), eq(media.status, "ready")))
      .get(),
    db
      .select({
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
      })
      .from(media)
      .where(and(eq(media.userId, userId), eq(media.status, "pending")))
      .get(),
  ]);

  const usedBytes = aggReady?.bytes ?? 0;
  const reservedBytes = aggPending?.bytes ?? 0;
  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes,
      reservedBytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: aggReady?.cnt ?? 0,
      updatedAt: Date.now(),
    })
    .onConflictDoNothing();
  return { usedBytes, reservedBytes, maxBytes: STORAGE_QUOTA_BYTES };
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
  reservedBytes = 0,
): Promise<void> {
  const now = Date.now();
  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes: bytes,
      reservedBytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: count,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userStorageStats.userId,
      set: { usedBytes: bytes, reservedBytes, mediaCount: count, updatedAt: now },
    });
}

/**
 * Reconciliación rápida de reservas de cuota por usuario individual.
 * 1. Poda subidas 'pending' obsoletas que hayan superado el TTL.
 * 2. Recalcula reserved_bytes sumando únicamente los 'pending' vigentes del usuario.
 * 3. Actualiza reserved_bytes en user_storage_stats sin modificar used_bytes.
 */
export async function reconcileUserReservations(
  db: Db,
  userId: string,
  stalePendingTtlMs = 2 * 3600 * 1000,
): Promise<number> {
  const now = Date.now();
  if (stalePendingTtlMs > 0) {
    const staleThreshold = now - stalePendingTtlMs;
    await db
      .delete(media)
      .where(
        and(
          eq(media.userId, userId),
          eq(media.status, "pending"),
          lt(media.updatedAt, staleThreshold),
        ),
      );
  }

  const aggPending = await db
    .select({
      bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
    })
    .from(media)
    .where(and(eq(media.userId, userId), eq(media.status, "pending")))
    .get();

  const realReservedBytes = aggPending?.bytes ?? 0;

  await db
    .update(userStorageStats)
    .set({ reservedBytes: realReservedBytes, updatedAt: now })
    .where(eq(userStorageStats.userId, userId));

  return realReservedBytes;
}

/**
 * Reconciliación por usuario individual (usada reactivamente ante cuota excedida
 * y por herramientas administrativas de reconciliación).
 * 1. Poda subidas 'pending' obsoletas que hayan superado el TTL.
 * 2. Recalcula used_bytes (media 'ready') y reserved_bytes (media 'pending' vigentes).
 * 3. Actualiza user_storage_stats atómicamente.
 */
export async function reconcileUserStorage(
  db: Db,
  userId: string,
  stalePendingTtlMs = 2 * 3600 * 1000,
): Promise<{ usedBytes: number; reservedBytes: number; maxBytes: number; mediaCount: number }> {
  const now = Date.now();
  if (stalePendingTtlMs > 0) {
    const staleThreshold = now - stalePendingTtlMs;
    await db
      .delete(media)
      .where(
        and(
          eq(media.userId, userId),
          eq(media.status, "pending"),
          lt(media.updatedAt, staleThreshold),
        ),
      );
  }

  const [aggReady, aggPending] = await Promise.all([
    db
      .select({
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
        cnt: sql<number>`count(*)`,
      })
      .from(media)
      .where(and(eq(media.userId, userId), eq(media.status, "ready")))
      .get(),
    db
      .select({
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
      })
      .from(media)
      .where(and(eq(media.userId, userId), eq(media.status, "pending")))
      .get(),
  ]);

  const usedBytes = aggReady?.bytes ?? 0;
  const reservedBytes = aggPending?.bytes ?? 0;
  const count = aggReady?.cnt ?? 0;

  await db
    .insert(userStorageStats)
    .values({
      userId,
      usedBytes,
      reservedBytes,
      maxBytes: STORAGE_QUOTA_BYTES,
      mediaCount: count,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userStorageStats.userId,
      set: { usedBytes, reservedBytes, mediaCount: count, updatedAt: now },
    });

  return { usedBytes, reservedBytes, maxBytes: STORAGE_QUOTA_BYTES, mediaCount: count };
}

/**
 * Reconciliación completa: recalcula user_storage_stats desde media
 * (status='ready', incluye papelera — sigue ocupando R2 hasta la purga) y
 * pone a 0 las filas de usuarios sin media ready. media es la fuente de
 * verdad; esta pasada auto-corrige drift de bugs o histórico.
 */
export async function reconcileStorageStats(db: Db): Promise<number> {
  const [aggReady, aggPending] = await Promise.all([
    db
      .select({
        userId: media.userId,
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
        cnt: sql<number>`count(*)`,
      })
      .from(media)
      .where(eq(media.status, "ready"))
      .groupBy(media.userId),
    db
      .select({
        userId: media.userId,
        bytes: sql<number>`coalesce(sum(${media.fileSize} + ${media.thumbSize} + coalesce(${media.previewSize}, 0)), 0)`,
      })
      .from(media)
      .where(eq(media.status, "pending"))
      .groupBy(media.userId),
  ]);

  const pendingByUser = new Map(aggPending.map((r) => [r.userId, r.bytes]));
  const allUserIds = new Set<string>();

  for (const row of aggReady) {
    allUserIds.add(row.userId);
    const reserved = pendingByUser.get(row.userId) ?? 0;
    await setStorageUsage(db, row.userId, row.bytes, row.cnt, reserved);
  }

  for (const row of aggPending) {
    if (!allUserIds.has(row.userId)) {
      allUserIds.add(row.userId);
      await setStorageUsage(db, row.userId, 0, 0, row.bytes);
    }
  }

  // Poner a 0 las filas de usuarios sin media. `notInArray` con todos los
  // usuarios superaría los 100 parámetros de D1: se leen las filas y se
  // actualizan solo las que sobran (en lotes de 90 ids).
  const statRows = await db.select({ userId: userStorageStats.userId }).from(userStorageStats);
  const staleIds = statRows.map((r) => r.userId).filter((id) => !allUserIds.has(id));
  for (let i = 0; i < staleIds.length; i += 90) {
    const slice = staleIds.slice(i, i + 90);
    await db
      .update(userStorageStats)
      .set({ usedBytes: 0, reservedBytes: 0, mediaCount: 0, updatedAt: Date.now() })
      .where(inArray(userStorageStats.userId, slice));
  }

  return allUserIds.size;
}
