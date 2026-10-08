import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { errorSchema, locationsQuerySchema, locationsResponseSchema } from "@photos/shared";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
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
    "Devuelve elementos con ubicación geográfica del usuario ordenados cronológicamente, con soporte opcional de filtro por caja delimitadora (bounding box).",
  request: { query: locationsQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: locationsResponseSchema } },
      description: "Puntos geolocalizados",
    },
    401: err("Sin sesión"),
  },
});

export const locationsApp = new OpenAPIHono<AppEnv>().openapi(locationsRoute, async (c) => {
  const user = c.get("user");
  const { minLat, maxLat, minLng, maxLng, filter } = c.req.valid("query");
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

  if (minLat != null) conditions.push(gte(media.latitude, minLat));
  if (maxLat != null) conditions.push(lte(media.latitude, maxLat));
  if (minLng != null) conditions.push(gte(media.longitude, minLng));
  if (maxLng != null) conditions.push(lte(media.longitude, maxLng));

  const rows = await db
    .select()
    .from(media)
    .where(and(...conditions))
    .orderBy(desc(media.takenAt))
    .limit(1000);

  const items = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      // biome-ignore lint/style/noNonNullAssertion: validado por isNotNull en la consulta
      latitude: row.latitude!,
      // biome-ignore lint/style/noNonNullAssertion: validado por isNotNull en la consulta
      longitude: row.longitude!,
      thumbUrl: await presignGet(c.env, row.r2KeyThumb),
      thumbhash: row.thumbhash,
      mediaType: row.mediaType,
      takenAt: row.takenAt,
      dateGroup: row.dateGroup,
      caption: row.caption ?? null,
    })),
  );

  return c.json({ items, totalWithGps: items.length }, 200);
});
