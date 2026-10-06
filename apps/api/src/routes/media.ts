import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  mediaDetailSchema,
  okSchema,
  statsSchema,
  trashResponseSchema,
} from "@photos/shared";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { presignGet } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const idParam = z.object({ id: z.string() });

const detailRoute = createRoute({
  method: "get",
  path: "/media/{id}",
  tags: ["media"],
  summary: "Detalle de un elemento",
  request: { params: idParam },
  responses: {
    200: { content: { "application/json": { schema: mediaDetailSchema } }, description: "Detalle" },
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/media/{id}",
  tags: ["media"],
  summary: "Mover a la papelera (borrado suave)",
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Movido a la papelera",
    },
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  path: "/media/{id}/restore",
  tags: ["media"],
  summary: "Restaurar desde la papelera",
  request: { params: idParam },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "Restaurado" },
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const trashRoute = createRoute({
  method: "get",
  path: "/trash",
  tags: ["media"],
  summary: "Elementos en la papelera",
  description:
    "Elementos con borrado suave, ordenados por fecha de borrado. Se purgan definitivamente a los 30 días.",
  responses: {
    200: {
      content: { "application/json": { schema: trashResponseSchema } },
      description: "Elementos en papelera",
    },
    401: err("Sin sesión"),
  },
});

const statsRoute = createRoute({
  method: "get",
  path: "/stats",
  tags: ["media"],
  summary: "Estadísticas del respaldo",
  responses: {
    200: { content: { "application/json": { schema: statsSchema } }, description: "Estadísticas" },
    401: err("Sin sesión"),
  },
});

export const mediaApp = new OpenAPIHono<AppEnv>()
  .openapi(detailRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (row?.status !== "ready") {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    const [thumbUrl, originalUrl] = await Promise.all([
      presignGet(c.env, row.r2KeyThumb),
      presignGet(c.env, row.r2KeyOriginal),
    ]);
    return c.json(
      {
        id: row.id,
        sha256: row.sha256,
        mediaType: row.mediaType,
        takenAt: row.takenAt,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        thumbhash: row.thumbhash,
        thumbUrl,
        mimeType: row.mimeType,
        ext: row.ext,
        fileSize: row.fileSize,
        latitude: row.latitude,
        longitude: row.longitude,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        originalUrl,
      },
      200,
    );
  })
  .openapi(deleteRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const res = await db
      .update(media)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(media.id, id), eq(media.userId, user.id), isNull(media.deletedAt)));
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    return c.json({ ok: true } as const, 200);
  })
  .openapi(restoreRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const res = await db
      .update(media)
      .set({ deletedAt: null, updatedAt: Date.now() })
      .where(and(eq(media.id, id), eq(media.userId, user.id)));
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    return c.json({ ok: true } as const, 200);
  })
  .openapi(trashRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.status, "ready"), isNotNull(media.deletedAt)))
      .orderBy(desc(media.deletedAt))
      .limit(500);
    const items = await Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        sha256: m.sha256,
        mediaType: m.mediaType,
        takenAt: m.takenAt,
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        thumbhash: m.thumbhash,
        thumbUrl: await presignGet(c.env, m.r2KeyThumb),
        deletedAt: m.deletedAt ?? 0,
      })),
    );
    return c.json({ items, nextCursor: null }, 200);
  })
  .openapi(statsRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const row = await db
      .select({
        count: sql<number>`count(*)`,
        totalBytes: sql<number>`coalesce(sum(${media.fileSize}), 0)`,
        lastUploadAt: sql<number | null>`max(${media.createdAt})`,
      })
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.status, "ready"), isNull(media.deletedAt)))
      .get();
    return c.json(
      {
        count: row?.count ?? 0,
        totalBytes: row?.totalBytes ?? 0,
        lastUploadAt: row?.lastUploadAt ?? null,
      },
      200,
    );
  });
