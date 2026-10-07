import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { adminStorageResponseSchema, errorSchema } from "@photos/shared";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { user, userStorageStats } from "../db/schema";
import type { AppEnv } from "../env";

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

export const adminApp = new OpenAPIHono<AppEnv>().openapi(storageRoute, async (c) => {
  const sessionUser = c.get("user");
  // La barrera real vive aquí: ocultar la entrada en el cliente es solo UX.
  if (sessionUser.email !== c.env.ADMIN_EMAIL) {
    return c.json({ error: "forbidden", message: "Acceso restringido al administrador." }, 403);
  }
  const db = getDb(c.env.DB);
  const usedBytesExpr = sql<number>`coalesce(${userStorageStats.usedBytes}, 0)`;
  const joined = await db
    .select({
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
});
