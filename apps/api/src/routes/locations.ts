import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  locationsQuerySchema,
  locationsResponseSchema,
  placesQuerySchema,
  placesResponseSchema,
} from "@photos/shared";
import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { geocodeMediaItem } from "../lib/geo";
import { presignGet } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const locationsRoute = createRoute({
  method: "get",
  path: "/locations",
  tags: ["locations"],
  summary: "Listar fotos y videos con coordenadas GPS",
  description:
    "Devuelve elementos con ubicación geográfica del usuario ordenados cronológicamente, con soporte opcional de filtro por caja delimitadora o ciudad.",
  request: { query: locationsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: locationsResponseSchema } },
      description: "Puntos geolocalizados",
    },
    400: err("Cursor inválido"),
    401: err("Sin sesión"),
  },
});

const placesRoute = createRoute({
  method: "get",
  path: "/locations/places",
  tags: ["locations"],
  summary: "Listar lugares/ciudades agrupadas del usuario",
  description:
    "Devuelve ciudades y países únicos con cantidad de fotos y miniatura más reciente para explorar lugares estilo Google Fotos.",
  request: { query: placesQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: placesResponseSchema } },
      description: "Lugares únicos",
    },
    401: err("Sin sesión"),
  },
});

const geocodeBatchRoute = createRoute({
  method: "post",
  path: "/locations/geocode-batch",
  tags: ["locations"],
  summary: "Geocodificar fotos pendientes en lote",
  description:
    "Busca elementos con GPS sin nombre de ciudad/país y los traduce mediante geocodificación inversa.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            geocoded: z.number(),
          }),
        },
      },
      description: "Geocodificadas",
    },
    401: err("Sin sesión"),
  },
});

export const locationsApp = new OpenAPIHono<AppEnv>()
  .openapi(locationsRoute, async (c) => {
    const user = c.get("user");
    const { minLat, maxLat, minLng, maxLng, city, filter, cursor, limit } = c.req.valid("query");
    const db = getDb(c.env.DB);

    const conditions = [
      eq(media.userId, user.id),
      eq(media.status, "ready"),
      isNull(media.deletedAt),
      isNotNull(media.latitude),
      isNotNull(media.longitude),
    ];

    if (filter === "photos") conditions.push(eq(media.mediaType, "photo"));
    else if (filter === "videos") conditions.push(eq(media.mediaType, "video"));
    else if (filter === "favorites") conditions.push(eq(media.isFavorite, true));

    if (city) conditions.push(eq(media.city, city));
    if (minLat != null) conditions.push(gte(media.latitude, minLat));
    if (maxLat != null) conditions.push(lte(media.latitude, maxLat));
    if (minLng != null) conditions.push(gte(media.longitude, minLng));
    if (maxLng != null) conditions.push(lte(media.longitude, maxLng));

    let cur: { t: number; id: string } | null = null;
    if (cursor) {
      cur = decodeCursor(cursor);
      if (!cur) {
        return c.json({ error: "bad_request", message: "Cursor inválido" }, 400);
      }
      const curCond = or(
        lt(media.takenAt, cur.t),
        and(eq(media.takenAt, cur.t), lt(media.id, cur.id)),
      );
      if (curCond) conditions.push(curCond);
    }

    const rows = await db
      .select()
      .from(media)
      .where(and(...conditions))
      .orderBy(desc(media.takenAt), desc(media.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor({
            t: pageRows[pageRows.length - 1].takenAt,
            id: pageRows[pageRows.length - 1].id,
          })
        : null;

    const items = await Promise.all(
      pageRows.map(async (row) => ({
        id: row.id,
        // biome-ignore lint/style/noNonNullAssertion: validado por isNotNull en la consulta
        latitude: row.latitude!,
        // biome-ignore lint/style/noNonNullAssertion: validado por isNotNull en la consulta
        longitude: row.longitude!,
        city: row.city ?? null,
        country: row.country ?? null,
        locationName: row.locationName ?? null,
        thumbUrl: await presignGet(c.env, row.r2KeyThumb),
        thumbhash: row.thumbhash,
        mediaType: row.mediaType,
        takenAt: row.takenAt,
        dateGroup: row.dateGroup,
        isFavorite: row.isFavorite ?? false,
        caption: row.caption ?? null,
      })),
    );

    return c.json({ items, totalWithGps: items.length, nextCursor }, 200);
  })
  .openapi(placesRoute, async (c) => {
    const user = c.get("user");
    const { cursor, limit } = c.req.valid("query");
    const db = getDb(c.env.DB);

    let cur: { c: number; city: string; country: string } | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(atob(cursor));
        if (
          typeof decoded.c === "number" &&
          typeof decoded.city === "string" &&
          typeof decoded.country === "string"
        ) {
          cur = decoded;
        }
      } catch {}
    }

    const query = cur
      ? sql`SELECT
              city,
              coalesce(country, '') as country,
              coalesce(location_name, city) as location_name,
              r2_key_thumb,
              thumbhash,
              max(taken_at) as max_taken_at,
              count(*) as count
            FROM media
            WHERE user_id = ${user.id}
              AND status = 'ready'
              AND deleted_at IS NULL
              AND city IS NOT NULL
            GROUP BY city, country
            HAVING (count(*) < ${cur.c})
               OR (count(*) = ${cur.c} AND city > ${cur.city})
               OR (count(*) = ${cur.c} AND city = ${cur.city} AND coalesce(country, '') > ${cur.country})
            ORDER BY count(*) DESC, city ASC, country ASC
            LIMIT ${limit + 1}`
      : sql`SELECT
              city,
              coalesce(country, '') as country,
              coalesce(location_name, city) as location_name,
              r2_key_thumb,
              thumbhash,
              max(taken_at) as max_taken_at,
              count(*) as count
            FROM media
            WHERE user_id = ${user.id}
              AND status = 'ready'
              AND deleted_at IS NULL
              AND city IS NOT NULL
            GROUP BY city, country
            ORDER BY count(*) DESC, city ASC, country ASC
            LIMIT ${limit + 1}`;

    const res = await db.all<{
      city: string;
      country: string;
      location_name: string;
      r2_key_thumb: string;
      thumbhash: string;
      count: number;
    }>(query);

    const hasMore = res.length > limit;
    const page = hasMore ? res.slice(0, limit) : res;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? btoa(
            JSON.stringify({
              c: Number(last.count),
              city: last.city,
              country: last.country ?? "",
            }),
          )
        : null;

    const places = await Promise.all(
      page.map(async (p) => ({
        city: p.city,
        country: p.country,
        locationName: p.location_name,
        count: Number(p.count),
        thumbUrl: await presignGet(c.env, p.r2_key_thumb),
        thumbhash: p.thumbhash,
      })),
    );

    return c.json({ places, nextCursor }, 200);
  })
  .openapi(geocodeBatchRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    const rows = await db
      .select({
        id: media.id,
        latitude: media.latitude,
        longitude: media.longitude,
      })
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          isNotNull(media.latitude),
          isNotNull(media.longitude),
          isNull(media.locationName),
        ),
      )
      .limit(15);

    let geocoded = 0;
    for (const row of rows) {
      if (row.latitude != null && row.longitude != null) {
        const res = await geocodeMediaItem(c.env, row.id, user.id, row.latitude, row.longitude);
        if (res.locationName) geocoded++;
      }
    }

    return c.json({ geocoded }, 200);
  });
