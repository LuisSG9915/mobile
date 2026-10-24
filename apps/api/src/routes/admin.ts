import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  adminReconcileResponseSchema,
  adminStorageResponseSchema,
  errorSchema,
} from "@photos/shared";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { user, userStorageStats } from "../db/schema";
import type { AppEnv } from "../env";
import { reconcileUserStorage } from "../lib/storage-stats";

const storageRoute = createRoute({
  method: "get",
  path: "/admin/storage",
  tags: ["admin"],
  summary: "Uso de R2 por usuario (solo admin)",
  description:
    "Join user ↔ user_storage_stats ordenado por usedBytes desc. Lectura O(1) por fila gracias a los contadores materializados (sin SUM sobre media). Gate: user.email === ADMIN_EMAIL.",
  responses: {
    200: {
      content: { "application/json": { schema: adminStorageResponseSchema } },
      description: "Uso agregado por usuario",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "Sin sesión",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "No administrador",
    },
  },
});

const reconcileRoute = createRoute({
  method: "post",
  path: "/admin/users/{id}/reconcile",
  tags: ["admin"],
  summary: "Reconciliar almacenamiento de un usuario (solo admin)",
  description:
    "Recalcula desde cero used_bytes y reserved_bytes sumando los registros reales de media del usuario y actualiza user_storage_stats.",
  request: {
    params: z.object({
      id: z.string().openapi({ description: "ID del usuario a reconciliar" }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: adminReconcileResponseSchema } },
      description: "Almacenamiento reconciliado correctamente",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "Sin sesión",
    },
    403: {
      content: { "application/json": { schema: errorSchema } },
      description: "No administrador",
    },
    404: {
      content: { "application/json": { schema: errorSchema } },
      description: "Usuario no encontrado",
    },
  },
});

export const adminApp = new OpenAPIHono<AppEnv>()
  .openapi(storageRoute, async (c) => {
    const sessionUser = c.get("user");
    // La barrera real vive aquí: ocultar la entrada en el cliente es solo UX.
    if (sessionUser.email !== c.env.ADMIN_EMAIL) {
      return c.json({ error: "forbidden", message: "Acceso restringido al administrador." }, 403);
    }
    const db = getDb(c.env.DB);
    const usedBytesExpr = sql<number>`coalesce(${userStorageStats.usedBytes}, 0)`;
    const joined = await db
      .select({
        userId: user.id,
        email: user.email,
        usedBytes: usedBytesExpr,
        maxBytes: sql<number>`coalesce(${userStorageStats.maxBytes}, 0)`,
        mediaCount: sql<number>`coalesce(${userStorageStats.mediaCount}, 0)`,
      })
      .from(user)
      .leftJoin(userStorageStats, eq(userStorageStats.userId, user.id))
      .orderBy(desc(usedBytesExpr), user.email);

    const rows = joined.map((r) => ({
      ...r,
      usedPercent:
        r.maxBytes > 0 ? Math.min(100, Math.round((r.usedBytes / r.maxBytes) * 10000) / 100) : 0,
    }));
    return c.json(
      {
        rows,
        totalUsedBytes: rows.reduce((acc, r) => acc + r.usedBytes, 0),
        userCount: rows.length,
      },
      200,
    );
  })
  .openapi(reconcileRoute, async (c) => {
    const sessionUser = c.get("user");
    if (sessionUser.email !== c.env.ADMIN_EMAIL) {
      return c.json({ error: "forbidden", message: "Acceso restringido al administrador." }, 403);
    }
    const { id: targetUserId } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const targetUser = await db.select().from(user).where(eq(user.id, targetUserId)).get();
    if (!targetUser) {
      return c.json({ error: "not_found", message: "Usuario no encontrado." }, 404);
    }

    const prevStats = await db
      .select({
        usedBytes: userStorageStats.usedBytes,
        reservedBytes: userStorageStats.reservedBytes,
      })
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, targetUserId))
      .get();

    const previous = {
      usedBytes: prevStats?.usedBytes ?? 0,
      reservedBytes: prevStats?.reservedBytes ?? 0,
    };

    const current = await reconcileUserStorage(db, targetUserId);

    return c.json(
      {
        ok: true as const,
        userId: targetUserId,
        previous,
        current: {
          usedBytes: current.usedBytes,
          reservedBytes: current.reservedBytes,
        },
        reconciledAt: new Date().toISOString(),
      },
      200,
    );
  });
