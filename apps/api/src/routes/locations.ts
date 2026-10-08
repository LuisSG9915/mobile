import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  locationsQuerySchema,
  locationsResponseSchema,
  placesResponseSchema,
} from "@photos/shared";
import { and, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
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
    const { minLat, maxLat, minLng, maxLng, city, filter } = c.req.valid("query");
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

    return c.json({ items, totalWithGps: items.length }, 200);
  })
  .openapi(placesRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    const rows = await db
      .select({
        city: media.city,
        country: media.country,
        locationName: media.locationName,
        r2KeyThumb: media.r2KeyThumb,
        thumbhash: media.thumbhash,
      })
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          isNotNull(media.city),
        ),
      )
      .orderBy(desc(media.takenAt));

    const placesMap = new Map<
      string,
      {
        city: string;
        country: string;
        locationName: string;
        count: number;
        r2KeyThumb: string;
        thumbhash: string;
      }
    >();

    for (const r of rows) {
      if (!r.city) continue;
      const key = `${r.city.toLowerCase()}__${(r.country ?? "").toLowerCase()}`;
      const existing = placesMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        placesMap.set(key, {
          city: r.city,
          country: r.country ?? "",
          locationName: r.locationName ?? r.city,
          count: 1,
          r2KeyThumb: r.r2KeyThumb,
          thumbhash: r.thumbhash,
        });
      }
    }

    const places = await Promise.all(
      Array.from(placesMap.values())
        .sort((a, b) => b.count - a.count)
        .map(async (p) => ({
          city: p.city,
          country: p.country,
          locationName: p.locationName,
          count: p.count,
          thumbUrl: await presignGet(c.env, p.r2KeyThumb),
          thumbhash: p.thumbhash,
        })),
    );

    return c.json({ places }, 200);
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
