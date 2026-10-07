import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { errorSchema, STORAGE_QUOTA_BYTES, storageResponseSchema } from "@photos/shared";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { userStorageStats } from "../db/schema";
import type { AppEnv } from "../env";

const storageRoute = createRoute({
  method: "get",
  path: "/user/storage",
  tags: ["user"],
  summary: "Uso de almacenamiento del usuario",
  description:
    "Lectura O(1) desde user_storage_stats (sin SUM sobre media). usedBytes incluye originales, miniaturas y elementos en papelera porque siguen ocupando R2 hasta la purga.",
  responses: {
    200: {
      content: { "application/json": { schema: storageResponseSchema } },
      description: "Uso actual de la cuota",
    },
    401: {
      content: { "application/json": { schema: errorSchema } },
      description: "Sin sesión",
    },
  },
});

export const userApp = new OpenAPIHono<AppEnv>().openapi(storageRoute, async (c) => {
  const user = c.get("user");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(userStorageStats)
    .where(eq(userStorageStats.userId, user.id))
    .get();

  const usedBytes = row?.usedBytes ?? 0;
  const maxBytes = row?.maxBytes ?? STORAGE_QUOTA_BYTES;
  const mediaCount = row?.mediaCount ?? 0;
  const usedPercent =
    maxBytes > 0 ? Math.min(100, Math.round((usedBytes / maxBytes) * 10000) / 100) : 0;

  return c.json({ usedBytes, maxBytes, mediaCount, usedPercent }, 200);
});
