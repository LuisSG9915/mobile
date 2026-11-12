import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { systemState } from "../db/schema";

/**
 * Tope diario de elementos etiquetados con IA por usuario. Cada elemento puede
 * consumir una inferencia multimodal (LLaVA) más un fallback (ResNet), así que
 * el contador acota el gasto de Workers AI por cuenta y por día.
 */
export const AI_DAILY_LIMIT_DEFAULT = 200;

/** Prefijo de las claves de `system_state`; el cron purga las antiguas. */
export const AI_USAGE_KEY_PREFIX = "ai_usage:";

export function aiDailyLimit(env: { AI_DAILY_LIMIT?: string }): number {
  const parsed = Number(env.AI_DAILY_LIMIT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : AI_DAILY_LIMIT_DEFAULT;
}

/** Clave por usuario y día UTC: el contador se reinicia solo al cambiar la fecha. */
export function aiUsageKey(userId: string, now = new Date()): string {
  return `${AI_USAGE_KEY_PREFIX}${userId}:${now.toISOString().slice(0, 10)}`;
}

async function readUsage(db: Db, key: string): Promise<number> {
  const row = await db
    .select({ value: systemState.value })
    .from(systemState)
    .where(eq(systemState.key, key))
    .get();
  const used = Number(row?.value ?? "0");
  return Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
}

export type AiQuotaGrant = {
  /** Elementos autorizados (puede ser menor que lo pedido o 0 si no queda cuota). */
  granted: number;
  used: number;
  limit: number;
};

/**
 * Consume cuota de IA de forma atómica y devuelve cuántos elementos se pueden
 * procesar. Nunca concede más de lo que queda: el batch recorta su lote a
 * `granted` en vez de fallar entero cuando solo queda un hueco.
 */
export async function consumeAiQuota(
  db: Db,
  userId: string,
  requested: number,
  limit: number,
): Promise<AiQuotaGrant> {
  const key = aiUsageKey(userId);
  const used = await readUsage(db, key);
  const granted = Math.max(0, Math.min(Math.floor(requested), limit - used));
  if (granted === 0) return { granted: 0, used, limit };

  const now = Date.now();
  // El WHERE del upsert es la barrera real: dos requests concurrentes no pueden
  // superar `limit` aunque ambas hayan leído el mismo `used`.
  const res = await db.run(
    sql`INSERT INTO system_state (key, value, updated_at)
        VALUES (${key}, ${String(granted)}, ${now})
        ON CONFLICT(key) DO UPDATE
          SET value = CAST(value AS INTEGER) + ${granted},
              updated_at = ${now}
          WHERE CAST(value AS INTEGER) + ${granted} <= ${limit}`,
  );
  if ((res.meta.changes ?? 0) === 0) {
    return { granted: 0, used: await readUsage(db, key), limit };
  }
  return { granted, used: used + granted, limit };
}
