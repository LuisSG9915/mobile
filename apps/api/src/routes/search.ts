import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  errorSchema,
  searchQuerySchema,
  searchResponseSchema,
  tagsResponseSchema,
} from "@photos/shared";
import { and, desc, eq, gte, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { presignGet } from "../lib/s3";
import { parseTags } from "./media";

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
    "Busca por texto libre (pie de foto, tags, extensión), etiqueta específica, tipo (foto/video/favorito), rango de fechas y tamaño de archivo con paginación por cursor.",
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
  responses: {
    200: {
      content: { "application/json": { schema: tagsResponseSchema } },
      description: "Lista de etiquetas",
    },
    401: err("Sin sesión"),
  },
});

export const searchApp = new OpenAPIHono<AppEnv>()
  .openapi(tagsRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    const rows = await db
      .select({ tags: media.tags })
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          isNotNull(media.tags),
        ),
      );

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of parseTags(row.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    const tags = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return c.json({ tags }, 200);
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
      baseConditions.push(like(media.tags, `%"${tag}"%`));
    }

    if (q) {
      const pattern = `%${q.toLowerCase()}%`;
      const textMatch = or(
        sql`lower(${media.caption}) like ${pattern}`,
        sql`lower(${media.tags}) like ${pattern}`,
        sql`lower(${media.city}) like ${pattern}`,
        sql`lower(${media.country}) like ${pattern}`,
        sql`lower(${media.locationName}) like ${pattern}`,
        sql`lower(${media.ext}) like ${pattern}`,
      );
      if (textMatch) {
        baseConditions.push(textMatch);
      }
    }

    // Conteo total de coincidencias antes de aplicar cursor
    const countRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(media)
      .where(and(...baseConditions))
      .get();
    const totalMatches = countRes?.count ?? 0;

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
