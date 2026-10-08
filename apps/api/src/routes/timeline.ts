import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  memoriesResponseSchema,
  TIMELINE_MAX_LIMIT,
  timelineFilterSchema,
  timelineMonthsResponseSchema,
  timelineResponseSchema,
} from "@photos/shared";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { presignGet } from "../lib/s3";

const memoriesRoute = createRoute({
  method: "get",
  path: "/timeline/memories",
  tags: ["timeline"],
  summary: "Recuerdos del día en años anteriores (En este día)",
  description:
    "Devuelve fotos y videos tomados en la misma fecha (mes y día) en años anteriores, agrupados por años atrás ('Hace 1 año', 'Hace 2 años', etc.).",
  request: {
    query: z.object({
      monthDay: z
        .string()
        .regex(/^\d{2}-\d{2}$/, "Formato MM-DD")
        .optional(),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: memoriesResponseSchema } },
      description: "Grupos de recuerdos",
    },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Sin sesión" },
  },
});

const timelineRoute = createRoute({
  method: "get",
  path: "/timeline",
  tags: ["timeline"],
  summary: "Timeline paginado del usuario",
  description:
    "Devuelve los elementos 'ready' no eliminados ordenados por fecha de captura descendente. Paginación por cursor (taken_at, id). El parámetro filter reduce el resultado a fotos, videos o favoritos.",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().positive().max(TIMELINE_MAX_LIMIT).default(60),
      filter: timelineFilterSchema.default("all"),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: timelineResponseSchema } },
      description: "Página del timeline",
    },
    400: {
      content: { "application/json": { schema: errorSchema } },
      description: "Cursor inválido",
    },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Sin sesión" },
  },
});

const monthsRoute = createRoute({
  method: "get",
  path: "/timeline/months",
  tags: ["timeline"],
  summary: "Meses con contenido",
  description:
    "Meses YYYY-MM con al menos un elemento listo y vivo, con su conteo. Barato gracias al índice date_group; sirve para el salto temporal de la galería.",
  responses: {
    200: {
      content: { "application/json": { schema: timelineMonthsResponseSchema } },
      description: "Meses disponibles",
    },
    401: { content: { "application/json": { schema: errorSchema } }, description: "Sin sesión" },
  },
});

export const timelineApp = new OpenAPIHono<AppEnv>()
  .openapi(memoriesRoute, async (c) => {
    const user = c.get("user");
    const { monthDay } = c.req.valid("query");
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const defaultMMDD = `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const targetMMDD = monthDay ?? defaultMMDD;

    const db = getDb(c.env.DB);
    const pattern = `%-${targetMMDD}`;
    const rows = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          sql`${media.dateGroup} LIKE ${pattern}`,
          sql`substr(${media.dateGroup}, 1, 4) < ${currentYear.toString()}`,
        ),
      )
      .orderBy(desc(media.takenAt), desc(media.id));

    const groupsMap = new Map<number, typeof rows>();
    for (const row of rows) {
      const year = parseInt(row.dateGroup.slice(0, 4), 10);
      if (!Number.isNaN(year) && year < currentYear) {
        const list = groupsMap.get(year) ?? [];
        list.push(row);
        groupsMap.set(year, list);
      }
    }

    const memories = await Promise.all(
      Array.from(groupsMap.entries())
        .sort((a, b) => b[0] - a[0])
        .map(async ([year, itemsInYear]) => {
          const yearsAgo = currentYear - year;
          const title = yearsAgo === 1 ? "Hace 1 año" : `Hace ${yearsAgo} años`;
          const date = `${year}-${targetMMDD}`;
          const items = await Promise.all(
            itemsInYear.map(async (m) => ({
              id: m.id,
              sha256: m.sha256,
              mediaType: m.mediaType,
              takenAt: m.takenAt,
              dateGroup: m.dateGroup,
              width: m.width,
              height: m.height,
              durationMs: m.durationMs,
              isFavorite: m.isFavorite,
              isScreenshot: Boolean(m.isScreenshot),
              isDocument: Boolean(m.isDocument),
              thumbhash: m.thumbhash,
              thumbUrl: await presignGet(c.env, m.r2KeyThumb),
            })),
          );
          return {
            id: `memory-${year}-${targetMMDD}`,
            title,
            yearsAgo,
            date,
            items,
          };
        }),
    );

    return c.json({ memories }, 200);
  })
  .openapi(monthsRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const monthExpr = sql<string>`substr(${media.dateGroup}, 1, 7)`;
    const months = await db
      .select({ month: monthExpr, count: sql<number>`count(*)` })
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.status, "ready"), isNull(media.deletedAt)))
      .groupBy(monthExpr)
      .orderBy(desc(monthExpr));
    return c.json({ months }, 200);
  })
  .openapi(timelineRoute, async (c) => {
    const user = c.get("user");
    const { cursor, limit, filter } = c.req.valid("query");

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
    const conditions = [
      eq(media.userId, user.id),
      eq(media.status, "ready"),
      isNull(media.deletedAt),
    ];
    if (filter === "photos") conditions.push(eq(media.mediaType, "photo"));
    else if (filter === "videos") conditions.push(eq(media.mediaType, "video"));
    else if (filter === "favorites") conditions.push(eq(media.isFavorite, true));
    else if (filter === "screenshots") conditions.push(eq(media.isScreenshot, true));
    else if (filter === "documents") conditions.push(eq(media.isDocument, true));
    if (cur) {
      const cond = or(
        lt(media.takenAt, cur.t),
        and(eq(media.takenAt, cur.t), lt(media.id, cur.id)),
      );
      if (cond) conditions.push(cond);
    }

    const rows = await db
      .select()
      .from(media)
      .where(and(...conditions))
      .orderBy(desc(media.takenAt), desc(media.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last ? encodeCursor({ t: last.takenAt, id: last.id }) : null;

    const items = await Promise.all(
      page.map(async (m) => ({
        id: m.id,
        sha256: m.sha256,
        mediaType: m.mediaType,
        takenAt: m.takenAt,
        dateGroup: m.dateGroup,
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        isFavorite: m.isFavorite,
        isScreenshot: Boolean(m.isScreenshot),
        isDocument: Boolean(m.isDocument),
        thumbhash: m.thumbhash,
        thumbUrl: await presignGet(c.env, m.r2KeyThumb),
      })),
    );

    return c.json({ items, nextCursor }, 200);
  });
