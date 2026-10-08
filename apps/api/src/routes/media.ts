import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  autoTagBatchResponseSchema,
  autoTagResponseSchema,
  downloadResponseSchema,
  emptyTrashResponseSchema,
  errorSchema,
  favoriteResponseSchema,
  mediaDetailSchema,
  okSchema,
  STORAGE_QUOTA_BYTES,
  statsSchema,
  trashResponseSchema,
  updateMediaSchema,
} from "@photos/shared";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { tagMediaItem } from "../lib/ai";
import { presignGet, presignGetDownload } from "../lib/s3";
import { removeStorageUsage } from "../lib/storage-stats";

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

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

const patchMediaRoute = createRoute({
  method: "patch",
  path: "/media/{id}",
  tags: ["media"],
  summary: "Actualizar metadatos del elemento (pie de foto / etiquetas)",
  request: {
    params: idParam,
    body: {
      content: { "application/json": { schema: updateMediaSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: mediaDetailSchema } },
      description: "Actualizado",
    },
    400: err("Entrada inválida"),
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const autoTagRoute = createRoute({
  method: "post",
  path: "/media/{id}/auto-tag",
  tags: ["media"],
  summary: "Generar etiquetas con IA para un elemento",
  description:
    "Analiza la miniatura del elemento con Workers AI y añade etiquetas descriptivas automáticamente.",
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: autoTagResponseSchema } },
      description: "Etiquetas generadas",
    },
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const autoTagBatchRoute = createRoute({
  method: "post",
  path: "/media/auto-tag-batch",
  tags: ["media"],
  summary: "Generar etiquetas con IA en lote para fotos sin etiquetas",
  description:
    "Analiza hasta 15 elementos listos sin etiquetas previas y les asigna etiquetas automáticas.",
  responses: {
    200: {
      content: { "application/json": { schema: autoTagBatchResponseSchema } },
      description: "Lote procesado",
    },
    401: err("Sin sesión"),
  },
});

const downloadRoute = createRoute({
  method: "get",
  path: "/media/{id}/download",
  tags: ["media"],
  summary: "Descargar el original",
  description:
    "Devuelve una URL prefirmada GET cuya respuesta llega con Content-Disposition: attachment y nombre de archivo legible (el original nunca pasa por el Worker).",
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: downloadResponseSchema } },
      description: "URL de descarga",
    },
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

const favoriteRoute = createRoute({
  method: "post",
  path: "/media/{id}/favorite",
  tags: ["media"],
  summary: "Alternar favorito",
  description: "Conmuta is_favorite del elemento; la respuesta trae el estado nuevo.",
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: favoriteResponseSchema } },
      description: "Nuevo estado de favorito",
    },
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

const emptyTrashRoute = createRoute({
  method: "post",
  path: "/trash/empty",
  tags: ["media"],
  summary: "Vaciar la papelera (purga permanente inmediata)",
  description:
    "Elimina definitivamente todos los elementos en la papelera del usuario, borrando sus objetos de R2 y liberando su cuota de almacenamiento.",
  responses: {
    200: {
      content: { "application/json": { schema: emptyTrashResponseSchema } },
      description: "Papelera vaciada",
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
        dateGroup: row.dateGroup,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        isFavorite: row.isFavorite,
        thumbhash: row.thumbhash,
        thumbUrl,
        mimeType: row.mimeType,
        ext: row.ext,
        fileSize: row.fileSize,
        latitude: row.latitude,
        longitude: row.longitude,
        cameraMake: row.cameraMake ?? null,
        cameraModel: row.cameraModel ?? null,
        lensModel: row.lensModel ?? null,
        focalLength: row.focalLength ?? null,
        fNumber: row.fNumber ?? null,
        iso: row.iso ?? null,
        exposureTime: row.exposureTime ?? null,
        caption: row.caption ?? null,
        tags: parseTags(row.tags),
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
        originalUrl,
      },
      200,
    );
  })
  .openapi(patchMediaRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (row?.status !== "ready" || row.deletedAt != null) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }

    const updates: Partial<{ caption: string | null; tags: string; updatedAt: number }> = {
      updatedAt: Date.now(),
    };
    if (body.caption !== undefined) {
      updates.caption = body.caption;
    }
    if (body.tags !== undefined) {
      const cleanTags = Array.from(new Set(body.tags.map((t) => t.trim()).filter(Boolean)));
      updates.tags = JSON.stringify(cleanTags);
    }

    await db.update(media).set(updates).where(eq(media.id, id));

    const updatedRow = await db.select().from(media).where(eq(media.id, id)).get();
    if (!updatedRow) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }

    const [thumbUrl, originalUrl] = await Promise.all([
      presignGet(c.env, updatedRow.r2KeyThumb),
      presignGet(c.env, updatedRow.r2KeyOriginal),
    ]);

    return c.json(
      {
        id: updatedRow.id,
        sha256: updatedRow.sha256,
        mediaType: updatedRow.mediaType,
        takenAt: updatedRow.takenAt,
        dateGroup: updatedRow.dateGroup,
        width: updatedRow.width,
        height: updatedRow.height,
        durationMs: updatedRow.durationMs,
        isFavorite: updatedRow.isFavorite,
        thumbhash: updatedRow.thumbhash,
        thumbUrl,
        mimeType: updatedRow.mimeType,
        ext: updatedRow.ext,
        fileSize: updatedRow.fileSize,
        latitude: updatedRow.latitude,
        longitude: updatedRow.longitude,
        cameraMake: updatedRow.cameraMake ?? null,
        cameraModel: updatedRow.cameraModel ?? null,
        lensModel: updatedRow.lensModel ?? null,
        focalLength: updatedRow.focalLength ?? null,
        fNumber: updatedRow.fNumber ?? null,
        iso: updatedRow.iso ?? null,
        exposureTime: updatedRow.exposureTime ?? null,
        caption: updatedRow.caption ?? null,
        tags: parseTags(updatedRow.tags),
        createdAt: updatedRow.createdAt,
        deletedAt: updatedRow.deletedAt,
        originalUrl,
      },
      200,
    );
  })
  .openapi(autoTagRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const row = await db
      .select({ id: media.id, status: media.status, deletedAt: media.deletedAt })
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (row?.status !== "ready" || row.deletedAt != null) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    const tags = await tagMediaItem(c.env, id, user.id);
    return c.json({ id, tags }, 200);
  })
  .openapi(autoTagBatchRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const rows = await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          or(isNull(media.tags), eq(media.tags, "[]")),
        ),
      )
      .limit(15);
    const items: Array<{ id: string; tags: string[] }> = [];
    for (const r of rows) {
      const tags = await tagMediaItem(c.env, r.id, user.id);
      items.push({ id: r.id, tags });
    }
    return c.json({ processed: items.length, items }, 200);
  })
  .openapi(downloadRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (row?.status !== "ready" || row.deletedAt) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    // No hay columna de nombre original: se deriva uno legible y único.
    const prefix = row.mediaType === "video" ? "VID" : "IMG";
    const filename = `${prefix}-${row.sha256.slice(0, 16)}.${row.ext}`;
    const url = await presignGetDownload(c.env, row.r2KeyOriginal, filename);
    return c.json({ url, filename }, 200);
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
  .openapi(favoriteRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);
    const row = await db
      .select({ id: media.id, isFavorite: media.isFavorite })
      .from(media)
      .where(
        and(
          eq(media.id, id),
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
        ),
      )
      .get();
    if (!row) {
      return c.json({ error: "not_found", message: "Elemento no encontrado." }, 404);
    }
    const isFavorite = !row.isFavorite;
    await db.update(media).set({ isFavorite, updatedAt: Date.now() }).where(eq(media.id, row.id));
    return c.json({ id: row.id, isFavorite }, 200);
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
        dateGroup: m.dateGroup,
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        isFavorite: m.isFavorite,
        thumbhash: m.thumbhash,
        thumbUrl: await presignGet(c.env, m.r2KeyThumb),
        deletedAt: m.deletedAt ?? 0,
      })),
    );
    return c.json({ items, nextCursor: null }, 200);
  })
  .openapi(emptyTrashRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const trashItems = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), isNotNull(media.deletedAt)));

    if (trashItems.length === 0) {
      return c.json({ ok: true as const, deletedCount: 0 }, 200);
    }

    const keys = trashItems.flatMap((m) => [m.r2KeyThumb, m.r2KeyOriginal]);
    for (let i = 0; i < keys.length; i += 1000) {
      await c.env.BUCKET.delete(keys.slice(i, i + 1000));
    }

    const ids = trashItems.map((m) => m.id);
    for (let i = 0; i < ids.length; i += 500) {
      await db.delete(media).where(inArray(media.id, ids.slice(i, i + 500)));
    }

    for (const m of trashItems) {
      if (m.status === "ready") {
        await removeStorageUsage(db, m.userId, m.fileSize + m.thumbSize);
      }
    }

    return c.json({ ok: true as const, deletedCount: trashItems.length }, 200);
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
        quotaBytes: STORAGE_QUOTA_BYTES,
      },
      200,
    );
  });
