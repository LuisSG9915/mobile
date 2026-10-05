import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { errorSchema, TIMELINE_MAX_LIMIT, timelineResponseSchema } from "@photos/shared";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { presignGet } from "../lib/s3";

const timelineRoute = createRoute({
  method: "get",
  path: "/timeline",
  tags: ["timeline"],
  summary: "Timeline paginado del usuario",
  description:
    "Devuelve los elementos 'ready' no eliminados ordenados por fecha de captura descendente. Paginación por cursor (taken_at, id).",
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().positive().max(TIMELINE_MAX_LIMIT).default(60),
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

export const timelineApp = new OpenAPIHono<AppEnv>().openapi(timelineRoute, async (c) => {
  const user = c.get("user");
  const { cursor, limit } = c.req.valid("query");

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
  if (cur) {
    const cond = or(lt(media.takenAt, cur.t), and(eq(media.takenAt, cur.t), lt(media.id, cur.id)));
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
      width: m.width,
      height: m.height,
      durationMs: m.durationMs,
      thumbhash: m.thumbhash,
      thumbUrl: await presignGet(c.env, m.r2KeyThumb),
    })),
  );

  return c.json({ items, nextCursor }, 200);
});
