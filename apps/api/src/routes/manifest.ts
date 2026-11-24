import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { errorSchema, mediaManifestQuerySchema, mediaManifestResponseSchema } from "@photos/shared";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const manifestRoute = createRoute({
  method: "get",
  path: "/media/manifest",
  tags: ["media"],
  summary: "Manifiesto paginado de originales para restaurar",
  description:
    "Lista los originales 'ready' no eliminados con lo mínimo para restaurarlos (id, sha256, tamaño, extensión). No incluye URLs: se piden por ítem a /media/{id}/download. Paginación por cursor (taken_at, id); filtros opcionales por año y álbum.",
  request: { query: mediaManifestQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: mediaManifestResponseSchema } },
      description: "Página del manifiesto",
    },
    400: err("Cursor inválido"),
    401: err("Sin sesión"),
  },
});

export const manifestApp = new OpenAPIHono<AppEnv>().openapi(manifestRoute, async (c) => {
  const user = c.get("user");
  const { cursor, limit, year, albumId } = c.req.valid("query");

  let cur: { t: number; id: string } | null = null;
  if (cursor) {
    cur = decodeCursor(cursor);
    if (!cur) {
      return c.json(
        { error: "invalid_cursor", message: "El cursor de paginación es inválido." },
        400,
      );
    }
  }

  const conditions = [
    eq(media.userId, user.id),
    eq(media.status, "ready"),
    isNull(media.deletedAt),
  ];
  if (year) conditions.push(sql`substr(${media.dateGroup}, 1, 4) = ${year}`);
  if (albumId) {
    // El álbum debe ser del usuario: evita enumerar medios ajenos con un albumId arbitrario.
    conditions.push(
      sql`${media.id} IN (SELECT am.media_id FROM album_media am JOIN album a ON a.id = am.album_id WHERE am.album_id = ${albumId} AND a.user_id = ${user.id})`,
    );
  }
  if (cur) {
    const curCond = or(
      lt(media.takenAt, cur.t),
      and(eq(media.takenAt, cur.t), lt(media.id, cur.id)),
    );
    if (curCond) conditions.push(curCond);
  }

  const rows = await getDb(c.env.DB)
    .select({
      id: media.id,
      sha256: media.sha256,
      fileSize: media.fileSize,
      ext: media.ext,
      mediaType: media.mediaType,
      takenAt: media.takenAt,
    })
    .from(media)
    .where(and(...conditions))
    .orderBy(desc(media.takenAt), desc(media.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ t: last.takenAt, id: last.id }) : null;
  return c.json({ items, nextCursor }, 200);
});
