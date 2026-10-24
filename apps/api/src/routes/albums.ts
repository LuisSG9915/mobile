import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  addAlbumMediaSchema,
  albumDetailQuerySchema,
  albumDetailResponseSchema,
  albumListQuerySchema,
  albumListResponseSchema,
  createAlbumSchema,
  errorSchema,
  okSchema,
  PRESIGN_GET_TTL_SECONDS,
  publicAlbumResponseSchema,
  shareAlbumRequestSchema,
  shareAlbumResponseSchema,
  updateAlbumSchema,
} from "@photos/shared";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { album, albumMedia, media } from "../db/schema";
import { type AppEnv, webOrigins } from "../env";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { presignGet, presignGetDownload, presignGetWithTtl } from "../lib/s3";
import { mapInChunks } from "../lib/slices";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

/** Tope de elementos en un enlace público: evita amplificar N×3 prefirmas por request. */
const PUBLIC_ALBUM_MAX_ITEMS = 500;

/**
 * Enlace público de un álbum. Vive en /albums/public/{token} (no en /shared/)
 * para poder aplicar el rate limit por IP de `SHARE_LIMITER`.
 */
const getPublicAlbumRoute = createRoute({
  method: "get",
  path: "/albums/public/{token}",
  tags: ["albums"],
  summary: "Ver álbum compartido públicamente",
  description:
    "Devuelve el contenido del álbum con URLs prefirmadas, sin autenticación. Solo incluye originales si el dueño activó allowDownload.",
  request: { params: z.object({ token: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: publicAlbumResponseSchema } },
      description: "Contenido del álbum compartido",
    },
    404: err("Álbum compartido no encontrado"),
    410: err("Enlace caducado o revocado"),
    413: err("Álbum demasiado grande para un enlace público"),
    429: err("Demasiadas solicitudes"),
  },
});

const idParam = z.object({ id: z.string() });
const mediaIdParam = z.object({ id: z.string(), mediaId: z.string() });

const listAlbumsRoute = createRoute({
  method: "get",
  path: "/albums",
  tags: ["albums"],
  summary: "Listar álbumes del usuario",
  description: "Devuelve todos los álbumes del usuario con miniatura de portada y conteo de fotos.",
  request: { query: albumListQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: albumListResponseSchema } },
      description: "Lista de álbumes",
    },
    400: err("Cursor inválido"),
    401: err("Sin sesión"),
  },
});

const createAlbumRoute = createRoute({
  method: "post",
  path: "/albums",
  tags: ["albums"],
  summary: "Crear un nuevo álbum",
  description: "Crea un álbum y opcionalmente asocia una lista inicial de fotos.",
  request: {
    body: { content: { "application/json": { schema: createAlbumSchema } } },
  },
  responses: {
    201: {
      content: { "application/json": { schema: albumDetailResponseSchema } },
      description: "Álbum creado",
    },
    400: err("Datos inválidos"),
    401: err("Sin sesión"),
  },
});

const getAlbumRoute = createRoute({
  method: "get",
  path: "/albums/{id}",
  tags: ["albums"],
  summary: "Detalle y fotos de un álbum",
  request: { params: idParam, query: albumDetailQuerySchema },
  responses: {
    200: {
      content: { "application/json": { schema: albumDetailResponseSchema } },
      description: "Detalle del álbum",
    },
    400: err("Cursor inválido"),
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

const updateAlbumRoute = createRoute({
  method: "patch",
  path: "/albums/{id}",
  tags: ["albums"],
  summary: "Modificar título o portada de un álbum",
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateAlbumSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: albumDetailResponseSchema } },
      description: "Álbum actualizado",
    },
    400: err("La portada debe ser una foto del usuario"),
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

const deleteAlbumRoute = createRoute({
  method: "delete",
  path: "/albums/{id}",
  tags: ["albums"],
  summary: "Eliminar un álbum",
  description: "Elimina el álbum. Las fotos asociadas permanecen en la nube.",
  request: { params: idParam },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "Álbum eliminado" },
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

const addMediaRoute = createRoute({
  method: "post",
  path: "/albums/{id}/media",
  tags: ["albums"],
  summary: "Añadir fotos a un álbum",
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: addAlbumMediaSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Elementos añadidos",
    },
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

const removeMediaRoute = createRoute({
  method: "delete",
  path: "/albums/{id}/media/{mediaId}",
  tags: ["albums"],
  summary: "Quitar una foto de un álbum",
  request: { params: mediaIdParam },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Elemento eliminado del álbum",
    },
    401: err("Sin sesión"),
    404: err("No encontrado"),
  },
});

const shareAlbumRoute = createRoute({
  method: "post",
  path: "/albums/{id}/share",
  tags: ["albums"],
  summary: "Generar o consultar enlace público para compartir",
  request: {
    params: idParam,
    body: {
      content: { "application/json": { schema: shareAlbumRequestSchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: shareAlbumResponseSchema } },
      description: "Enlace generado",
    },
    400: err("Parámetros de enlace inválidos"),
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

const unshareAlbumRoute = createRoute({
  method: "delete",
  path: "/albums/{id}/share",
  tags: ["albums"],
  summary: "Revocar enlace público para compartir",
  request: { params: idParam },
  responses: {
    200: { content: { "application/json": { schema: okSchema } }, description: "Enlace revocado" },
    401: err("Sin sesión"),
    404: err("Álbum no encontrado"),
  },
});

export const albumsApp = new OpenAPIHono<AppEnv>()
  .openapi(listAlbumsRoute, async (c) => {
    const user = c.get("user");
    const { cursor, limit } = c.req.valid("query");
    const db = getDb(c.env.DB);

    let cur: { t: number; id: string } | null = null;
    if (cursor) {
      cur = decodeCursor(cursor);
      if (!cur) {
        return c.json({ error: "bad_request", message: "Cursor inválido" }, 400);
      }
    }

    const conditions = [eq(album.userId, user.id)];
    if (cur) {
      const curCond = or(
        lt(album.updatedAt, cur.t),
        and(eq(album.updatedAt, cur.t), lt(album.id, cur.id)),
      );
      if (curCond) conditions.push(curCond);
    }

    const albumsList = await db
      .select({
        id: album.id,
        title: album.title,
        coverMediaId: album.coverMediaId,
        shareToken: album.shareToken,
        createdAt: album.createdAt,
        updatedAt: album.updatedAt,
        mediaCount: sql<number>`count(${albumMedia.mediaId})`,
      })
      .from(album)
      .leftJoin(albumMedia, eq(album.id, albumMedia.albumId))
      .where(and(...conditions))
      .groupBy(album.id)
      .orderBy(desc(album.updatedAt), desc(album.id))
      .limit(limit + 1);

    const hasMore = albumsList.length > limit;
    const pageAlbums = hasMore ? albumsList.slice(0, limit) : albumsList;
    const nextCursor =
      hasMore && pageAlbums.length > 0
        ? encodeCursor({
            t: pageAlbums[pageAlbums.length - 1].updatedAt,
            id: pageAlbums[pageAlbums.length - 1].id,
          })
        : null;

    const result = await Promise.all(
      pageAlbums.map(async (a) => {
        let coverThumbUrl: string | null = null;
        let coverThumbhash: string | null = null;

        // Si tiene coverMediaId, buscarlo; si no, buscar la primera foto del álbum
        let coverItem = null;
        if (a.coverMediaId) {
          coverItem = await db
            .select()
            .from(media)
            .where(and(eq(media.id, a.coverMediaId), isNull(media.deletedAt)))
            .get();
        }
        if (!coverItem) {
          const firstMedia = await db
            .select({ media })
            .from(albumMedia)
            .innerJoin(media, eq(albumMedia.mediaId, media.id))
            .where(and(eq(albumMedia.albumId, a.id), isNull(media.deletedAt)))
            .orderBy(desc(albumMedia.addedAt))
            .limit(1)
            .get();
          coverItem = firstMedia?.media ?? null;
        }

        if (coverItem) {
          coverThumbUrl = await presignGet(c.env, coverItem.r2KeyThumb);
          coverThumbhash = coverItem.thumbhash;
        }

        return {
          id: a.id,
          title: a.title,
          coverMediaId: a.coverMediaId,
          coverThumbUrl,
          coverThumbhash,
          mediaCount: Number(a.mediaCount ?? 0),
          isShared: Boolean(a.shareToken),
          shareToken: a.shareToken,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        };
      }),
    );

    return c.json({ albums: result, nextCursor }, 200);
  })
  .openapi(createAlbumRoute, async (c) => {
    const user = c.get("user");
    const { title, mediaIds } = c.req.valid("json");
    const db = getDb(c.env.DB);
    const now = Date.now();
    const id = crypto.randomUUID();

    let coverId: string | null = null;
    const validMediaIds: string[] = [];

    if (mediaIds && mediaIds.length > 0) {
      const userMedia = await mapInChunks(mediaIds, (slice) =>
        db
          .select({ id: media.id })
          .from(media)
          .where(and(eq(media.userId, user.id), inArray(media.id, slice), isNull(media.deletedAt))),
      );
      const allowedSet = new Set(userMedia.map((m) => m.id));
      for (const mId of mediaIds) {
        if (allowedSet.has(mId)) validMediaIds.push(mId);
      }
      coverId = validMediaIds[0] ?? null;
    }

    await db.insert(album).values({
      id,
      userId: user.id,
      title,
      coverMediaId: coverId,
      createdAt: now,
      updatedAt: now,
    });

    if (validMediaIds.length > 0) {
      for (const mId of validMediaIds) {
        await db.run(
          sql`INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (${id}, ${mId}, ${now})`,
        );
      }
    }

    // Obtener detalle completo
    const rows = await db
      .select({ media })
      .from(albumMedia)
      .innerJoin(media, eq(albumMedia.mediaId, media.id))
      .where(and(eq(albumMedia.albumId, id), isNull(media.deletedAt)))
      .orderBy(desc(albumMedia.addedAt));

    const items = await Promise.all(
      rows.map(async ({ media: m }) => ({
        id: m.id,
        sha256: m.sha256,
        mediaType: m.mediaType,
        takenAt: m.takenAt,
        dateGroup: m.dateGroup,
        city: m.city ?? null,
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

    const coverItem = rows[0]?.media ?? null;

    return c.json(
      {
        id,
        title,
        coverMediaId: coverId,
        coverThumbUrl: coverItem ? await presignGet(c.env, coverItem.r2KeyThumb) : null,
        coverThumbhash: coverItem?.thumbhash ?? null,
        mediaCount: items.length,
        isShared: false,
        shareToken: null,
        createdAt: now,
        updatedAt: now,
        items,
      },
      201,
    );
  })
  .openapi(getAlbumRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { cursor, limit } = c.req.valid("query");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    let cur: { t: number; id: string } | null = null;
    if (cursor) {
      cur = decodeCursor(cursor);
      if (!cur) {
        return c.json({ error: "bad_request", message: "Cursor inválido" }, 400);
      }
    }

    const conditions = [eq(albumMedia.albumId, id), isNull(media.deletedAt)];
    if (cur) {
      const curCond = or(
        lt(albumMedia.addedAt, cur.t),
        and(eq(albumMedia.addedAt, cur.t), lt(albumMedia.mediaId, cur.id)),
      );
      if (curCond) conditions.push(curCond);
    }

    const rows = await db
      .select({ media, addedAt: albumMedia.addedAt })
      .from(albumMedia)
      .innerJoin(media, eq(albumMedia.mediaId, media.id))
      .where(and(...conditions))
      .orderBy(desc(albumMedia.addedAt), desc(albumMedia.mediaId))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor({
            t: pageRows[pageRows.length - 1].addedAt,
            id: pageRows[pageRows.length - 1].media.id,
          })
        : null;

    const items = await Promise.all(
      pageRows.map(async ({ media: m }) => ({
        id: m.id,
        sha256: m.sha256,
        mediaType: m.mediaType,
        takenAt: m.takenAt,
        dateGroup: m.dateGroup,
        city: m.city ?? null,
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

    const totalCountRes = await db
      .select({ count: sql<number>`count(*)` })
      .from(albumMedia)
      .innerJoin(media, eq(albumMedia.mediaId, media.id))
      .where(and(eq(albumMedia.albumId, id), isNull(media.deletedAt)))
      .get();
    const mediaCount = Number(totalCountRes?.count ?? 0);

    let coverThumbUrl: string | null = null;
    let coverThumbhash: string | null = null;
    let coverItem = null;
    if (a.coverMediaId) {
      coverItem = await db
        .select()
        .from(media)
        .where(and(eq(media.id, a.coverMediaId), isNull(media.deletedAt)))
        .get();
    }
    if (!coverItem) {
      const firstMedia = await db
        .select({ media })
        .from(albumMedia)
        .innerJoin(media, eq(albumMedia.mediaId, media.id))
        .where(and(eq(albumMedia.albumId, a.id), isNull(media.deletedAt)))
        .orderBy(desc(albumMedia.addedAt))
        .limit(1)
        .get();
      coverItem = firstMedia?.media ?? null;
    }
    if (coverItem) {
      coverThumbUrl = await presignGet(c.env, coverItem.r2KeyThumb);
      coverThumbhash = coverItem.thumbhash;
    }

    return c.json(
      {
        id: a.id,
        title: a.title,
        coverMediaId: a.coverMediaId,
        coverThumbUrl,
        coverThumbhash,
        mediaCount,
        isShared: Boolean(a.shareToken),
        shareToken: a.shareToken,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        items,
        nextCursor,
      },
      200,
    );
  })
  .openapi(updateAlbumRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { title, coverMediaId } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    const updates: Partial<typeof album.$inferInsert> = { updatedAt: Date.now() };
    if (title !== undefined) updates.title = title;
    if (coverMediaId !== undefined) {
      if (coverMediaId !== null) {
        // IDOR: sin esta comprobación se podía usar como portada una foto ajena
        // (y recibir su URL prefirmada) si se conocía el id.
        const owned = await db
          .select({ id: media.id })
          .from(media)
          .where(
            and(eq(media.id, coverMediaId), eq(media.userId, user.id), isNull(media.deletedAt)),
          )
          .get();
        if (!owned) {
          return c.json(
            { error: "bad_request", message: "La portada debe ser una foto tuya." },
            400,
          );
        }
      }
      updates.coverMediaId = coverMediaId;
    }

    await db.update(album).set(updates).where(eq(album.id, id));

    const updated = await db.select().from(album).where(eq(album.id, id)).get();
    if (!updated) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    const rows = await db
      .select({ media })
      .from(albumMedia)
      .innerJoin(media, eq(albumMedia.mediaId, media.id))
      .where(and(eq(albumMedia.albumId, id), isNull(media.deletedAt)))
      .orderBy(desc(albumMedia.addedAt));

    const items = await Promise.all(
      rows.map(async ({ media: m }) => ({
        id: m.id,
        sha256: m.sha256,
        mediaType: m.mediaType,
        takenAt: m.takenAt,
        dateGroup: m.dateGroup,
        city: m.city ?? null,
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

    let coverThumbUrl: string | null = null;
    let coverThumbhash: string | null = null;
    const cover =
      rows.find((r) => r.media.id === updated.coverMediaId)?.media ?? rows[0]?.media ?? null;
    if (cover) {
      coverThumbUrl = await presignGet(c.env, cover.r2KeyThumb);
      coverThumbhash = cover.thumbhash;
    }

    return c.json(
      {
        id: updated.id,
        title: updated.title,
        coverMediaId: updated.coverMediaId,
        coverThumbUrl,
        coverThumbhash,
        mediaCount: items.length,
        isShared: Boolean(updated.shareToken),
        shareToken: updated.shareToken,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        items,
      },
      200,
    );
  })
  .openapi(deleteAlbumRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    await db.delete(album).where(eq(album.id, id));
    return c.json({ ok: true as const }, 200);
  })
  .openapi(addMediaRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const { mediaIds } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    // Filtrar que sean medios legítimos del usuario
    const userMedia = await mapInChunks(mediaIds, (slice) =>
      db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.userId, user.id), inArray(media.id, slice), isNull(media.deletedAt))),
    );

    const now = Date.now();
    for (const m of userMedia) {
      await db.run(
        sql`INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (${id}, ${m.id}, ${now})`,
      );
    }

    await db.update(album).set({ updatedAt: now }).where(eq(album.id, id));

    return c.json({ ok: true as const }, 200);
  })
  .openapi(removeMediaRoute, async (c) => {
    const user = c.get("user");
    const { id, mediaId } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    await db
      .delete(albumMedia)
      .where(and(eq(albumMedia.albumId, id), eq(albumMedia.mediaId, mediaId)));

    if (a.coverMediaId === mediaId) {
      await db
        .update(album)
        .set({ coverMediaId: null, updatedAt: Date.now() })
        .where(eq(album.id, id));
    }

    return c.json({ ok: true as const }, 200);
  })
  .openapi(shareAlbumRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    const parsed = shareAlbumRequestSchema.safeParse(c.req.valid("json") ?? {});
    if (!parsed.success) {
      return c.json({ error: "bad_request", message: "Parámetros de enlace inválidos." }, 400);
    }
    const body = parsed.data;

    const now = Date.now();
    let shareExpiresAt: number | null = a.shareExpiresAt ?? null;
    // Un enlace caducado nunca debe reutilizarse aunque el cliente no mande body.
    if (a.shareRevokedAt != null || (a.shareExpiresAt != null && a.shareExpiresAt <= now)) {
      shareExpiresAt = now + 7 * 24 * 3600 * 1000;
    }
    if (body.expiresIn) {
      if (body.expiresIn === "24h") shareExpiresAt = now + 24 * 3600 * 1000;
      else if (body.expiresIn === "7d") shareExpiresAt = now + 7 * 24 * 3600 * 1000;
      else if (body.expiresIn === "30d") shareExpiresAt = now + 30 * 24 * 3600 * 1000;
      else if (body.expiresIn === "never") shareExpiresAt = null;
    }

    const allowDownload = body.allowDownload ?? a.shareAllowDownload;

    let shareToken = a.shareToken;
    if (
      !shareToken ||
      a.shareRevokedAt != null ||
      (a.shareExpiresAt != null && a.shareExpiresAt <= now) ||
      // Pedir la rotación explícitamente con otro token devuelve uno nuevo.
      (body.token != null && body.token !== a.shareToken)
    ) {
      shareToken = crypto.randomUUID().replace(/-/g, "");
    }

    await db
      .update(album)
      .set({
        shareToken,
        shareExpiresAt,
        shareAllowDownload: allowDownload,
        shareRevokedAt: null,
        updatedAt: now,
      })
      .where(eq(album.id, id));

    const origins = webOrigins(c.env);
    let origin = origins[0] ?? "https://photos-web.luis-sg9915.workers.dev";
    const reqOrigin = c.req.header("origin") || c.req.header("referer");
    if (reqOrigin) {
      try {
        const u = new URL(reqOrigin);
        origin = u.origin;
      } catch {}
    }
    const shareUrl = `${origin}/shared/album/${shareToken}`;

    return c.json({ shareToken, shareUrl, expiresAt: shareExpiresAt, allowDownload }, 200);
  })
  .openapi(unshareAlbumRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
      return c.json({ error: "not_found", message: "Álbum no encontrado." }, 404);
    }

    await db
      .update(album)
      .set({ shareToken: null, shareRevokedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(album.id, id));
    return c.json({ ok: true as const }, 200);
  })
  .openapi(getPublicAlbumRoute, async (c) => {
    const { token } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const a = await db.select().from(album).where(eq(album.shareToken, token)).get();
    const now = Date.now();

    if (!a?.shareToken) {
      return c.json(
        {
          error: "not_found",
          message: "El álbum compartido no existe o la dirección no es válida.",
        },
        404,
      );
    }
    if (a.shareRevokedAt != null || (a.shareExpiresAt != null && a.shareExpiresAt <= now)) {
      return c.json(
        { error: "expired", message: "Este enlace compartido ha caducado o ha sido revocado." },
        410,
      );
    }

    const rows = await db
      .select({ media })
      .from(albumMedia)
      .innerJoin(media, eq(albumMedia.mediaId, media.id))
      .where(and(eq(albumMedia.albumId, a.id), isNull(media.deletedAt)))
      .orderBy(desc(albumMedia.addedAt));

    if (rows.length > PUBLIC_ALBUM_MAX_ITEMS) {
      return c.json(
        {
          error: "album_too_large",
          message: "Este álbum tiene demasiados elementos para un enlace público.",
        },
        413,
      );
    }

    // Las URLs de un enlace no deben sobrevivir a su caducidad.
    const maxTtl = a.shareExpiresAt
      ? Math.min(PRESIGN_GET_TTL_SECONDS, Math.max(60, Math.floor((a.shareExpiresAt - now) / 1000)))
      : undefined;

    const items = await Promise.all(
      rows.map(async ({ media: m }) => {
        const thumbUrl = await presignGetWithTtl(c.env, m.r2KeyThumb, maxTtl);
        const preview = m.r2KeyPreview
          ? await presignGetWithTtl(c.env, m.r2KeyPreview, maxTtl)
          : null;
        if (!a.shareAllowDownload) {
          // Solo miniaturas y previews: el enlace no expone el original.
          return {
            id: m.id,
            mediaType: m.mediaType,
            width: m.width,
            height: m.height,
            takenAt: m.takenAt,
            durationMs: m.durationMs,
            thumbhash: m.thumbhash,
            thumbUrl,
          };
        }
        const originalUrl = await presignGetWithTtl(c.env, m.r2KeyOriginal, maxTtl);
        const downloadUrl = await presignGetDownload(
          c.env,
          m.r2KeyOriginal,
          `${m.id}.${m.ext}`,
          maxTtl,
        );
        return {
          id: m.id,
          mediaType: m.mediaType,
          width: m.width,
          height: m.height,
          takenAt: m.takenAt,
          durationMs: m.durationMs,
          thumbhash: m.thumbhash,
          thumbUrl,
          ...(preview ? { originalUrl: preview } : { originalUrl }),
          downloadUrl,
        };
      }),
    );

    return c.json(
      {
        title: a.title,
        mediaCount: items.length,
        createdAt: a.createdAt,
        expiresAt: a.shareExpiresAt ?? null,
        allowDownload: a.shareAllowDownload,
        items,
      },
      200,
    );
  });
