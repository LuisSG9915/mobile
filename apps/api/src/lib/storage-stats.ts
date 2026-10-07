import { STORAGE_QUOTA_BYTES } from "@photos/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { userStorageStats } from "../db/schema";

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
