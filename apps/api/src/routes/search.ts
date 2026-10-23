import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  errorSchema,
  searchQuerySchema,
  searchResponseSchema,
  tagsQuerySchema,
  tagsResponseSchema,
} from "@photos/shared";
import { and, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { presignGet } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const searchRoute = createRoute({
  method: "get",
  path: "/search",
  tags: ["search"],
  summary: "Búsqueda y filtros avanzados de contenido",
  description:
    "Busca por texto libre mediante FTS5 (pie de foto, tags, ciudad, país, ubicación, extensión), etiqueta normalizada, tipo (foto/video/favorito), rango de fechas y tamaño de archivo con paginación por cursor.",
  request: { query: searchQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: searchResponseSchema } },
      description: "Resultados de búsqueda",
    },
    400: err("Consulta o cursor inválido"),
    401: err("Sin sesión"),
  },
});

const tagsRoute = createRoute({
  method: "get",
  path: "/tags",
  tags: ["search"],
  summary: "Listar etiquetas de usuario y conteo",
  description: "Devuelve todas las etiquetas únicas del usuario ordenadas por frecuencia de uso.",
  request: { query: tagsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: tagsResponseSchema } },
      description: "Lista de etiquetas",
    },
    400: err("Cursor inválido"),
    401: err("Sin sesión"),
  },
});

export const searchApp = new OpenAPIHono<AppEnv>()
  .openapi(tagsRoute, async (c) => {
    const user = c.get("user");
    const { cursor, limit } = c.req.valid("query");
    const db = getDb(c.env.DB);

    let cur: { c: number; tag: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(atob(cursor));
        if (typeof decoded.c === "number" && typeof decoded.tag === "string") {
          cur = decoded;
        }
      } catch {}
    }

    const query = cur
      ? sql`SELECT tag, count(*) as count
            FROM media_tags
            WHERE user_id = ${user.id}
            GROUP BY tag
            HAVING (count(*) < ${cur.c}) OR (count(*) = ${cur.c} AND tag > ${cur.tag})
            ORDER BY count(*) DESC, tag ASC
            LIMIT ${limit + 1}`
      : sql`SELECT tag, count(*) as count
            FROM media_tags
            WHERE user_id = ${user.id}
            GROUP BY tag
            ORDER BY count(*) DESC, tag ASC
            LIMIT ${limit + 1}`;

    const res = await db.all<{ tag: string; count: number }>(query);
    const hasMore = res.length > limit;
    const page = hasMore ? res.slice(0, limit) : res;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? btoa(JSON.stringify({ c: Number(last.count), tag: last.tag })) : null;

    const tags = page.map((r) => ({ tag: r.tag, count: Number(r.count) }));
    return c.json({ tags, nextCursor }, 200);
  })
  .openapi(searchRoute, async (c) => {
    const user = c.get("user");
    const { q, tag, filter, dateFrom, dateTo, minBytes, maxBytes, cursor, limit } =
      c.req.valid("query");

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

    const db = getDb(c.env.DB);
    const baseConditions = [
      eq(media.userId, user.id),
      eq(media.status, "ready"),
      isNull(media.deletedAt),
    ];

    if (filter === "photos") baseConditions.push(eq(media.mediaType, "photo"));
    else if (filter === "videos") baseConditions.push(eq(media.mediaType, "video"));
    else if (filter === "favorites") baseConditions.push(eq(media.isFavorite, true));
    else if (filter === "screenshots") baseConditions.push(eq(media.isScreenshot, true));
    else if (filter === "documents") baseConditions.push(eq(media.isDocument, true));

    if (dateFrom) baseConditions.push(gte(media.dateGroup, dateFrom));
    if (dateTo) baseConditions.push(lte(media.dateGroup, dateTo));

    if (minBytes != null) baseConditions.push(gte(media.fileSize, minBytes));
    if (maxBytes != null) baseConditions.push(lte(media.fileSize, maxBytes));

    if (tag) {
      baseConditions.push(
        sql`${media.id} IN (SELECT media_id FROM media_tags WHERE user_id = ${user.id} AND tag = ${tag.toLowerCase()})`,
      );
    }

    if (q) {
      const tokens = q
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
        .filter(Boolean);
      if (tokens.length > 0) {
        const ftsMatch = tokens.map((t) => `"${t}"*`).join(" AND ");
        baseConditions.push(
          sql`${media.id} IN (SELECT media_id FROM media_fts WHERE media_fts MATCH ${ftsMatch} AND user_id = ${user.id})`,
        );
      }
    }

    // Solo se cuenta en la primera página (!cur) para evitar COUNT(*) por página
    let totalMatches: number | undefined;
    if (!cur) {
      const countRes = await db
        .select({ count: sql<number>`count(*)` })
        .from(media)
        .where(and(...baseConditions))
        .get();
      totalMatches = countRes?.count ?? 0;
    }

    // Condiciones para paginación
    const pagedConditions = [...baseConditions];
    if (cur) {
      const cursorCond = or(
        lt(media.takenAt, cur.t),
        and(eq(media.takenAt, cur.t), lt(media.id, cur.id)),
      );
      if (cursorCond) {
        pagedConditions.push(cursorCond);
      }
    }

    const rows = await db
      .select()
      .from(media)
      .where(and(...pagedConditions))
      .orderBy(desc(media.takenAt), desc(media.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastItem = pageRows.at(-1);
    const nextCursor =
      hasMore && lastItem ? encodeCursor({ t: lastItem.takenAt, id: lastItem.id }) : null;

    const items = await Promise.all(
      pageRows.map(async (row) => ({
        id: row.id,
        sha256: row.sha256,
        mediaType: row.mediaType,
        takenAt: row.takenAt,
        dateGroup: row.dateGroup,
        city: row.city ?? null,
        width: row.width,
        height: row.height,
        durationMs: row.durationMs,
        isFavorite: row.isFavorite,
        isScreenshot: Boolean(row.isScreenshot),
        isDocument: Boolean(row.isDocument),
        thumbhash: row.thumbhash,
        thumbUrl: await presignGet(c.env, row.r2KeyThumb),
      })),
    );

    return c.json({ items, nextCursor, totalMatches }, 200);
  });
