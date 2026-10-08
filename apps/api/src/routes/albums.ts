import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  addAlbumMediaSchema,
  albumDetailResponseSchema,
  albumListResponseSchema,
  createAlbumSchema,
  errorSchema,
  okSchema,
  shareAlbumResponseSchema,
  updateAlbumSchema,
} from "@photos/shared";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { album, albumMedia, media } from "../db/schema";
import { type AppEnv, webOrigins } from "../env";
import { presignGet } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const idParam = z.object({ id: z.string() });
const mediaIdParam = z.object({ id: z.string(), mediaId: z.string() });

const listAlbumsRoute = createRoute({
  method: "get",
  path: "/albums",
  tags: ["albums"],
  summary: "Listar álbumes del usuario",
  description: "Devuelve todos los álbumes del usuario con miniatura de portada y conteo de fotos.",
  responses: {
    200: {
      content: { "application/json": { schema: albumListResponseSchema } },
      description: "Lista de álbumes",
    },
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
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: albumDetailResponseSchema } },
      description: "Detalle del álbum",
    },
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
  request: { params: idParam },
  responses: {
    200: {
      content: { "application/json": { schema: shareAlbumResponseSchema } },
      description: "Enlace generado",
    },
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
    const db = getDb(c.env.DB);

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
      .where(eq(album.userId, user.id))
      .groupBy(album.id)
      .orderBy(desc(album.updatedAt));

    const result = await Promise.all(
      albumsList.map(async (a) => {
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

    return c.json({ albums: result }, 200);
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
      const userMedia = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(eq(media.userId, user.id), inArray(media.id, mediaIds), isNull(media.deletedAt)),
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
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        isFavorite: m.isFavorite,
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
    const db = getDb(c.env.DB);

    const a = await db
      .select()
      .from(album)
      .where(and(eq(album.id, id), eq(album.userId, user.id)))
      .get();

    if (!a) {
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
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        isFavorite: m.isFavorite,
        thumbhash: m.thumbhash,
        thumbUrl: await presignGet(c.env, m.r2KeyThumb),
      })),
    );

    let coverThumbUrl: string | null = null;
    let coverThumbhash: string | null = null;
    const cover = rows.find((r) => r.media.id === a.coverMediaId)?.media ?? rows[0]?.media ?? null;
    if (cover) {
      coverThumbUrl = await presignGet(c.env, cover.r2KeyThumb);
      coverThumbhash = cover.thumbhash;
    }

    return c.json(
      {
        id: a.id,
        title: a.title,
        coverMediaId: a.coverMediaId,
        coverThumbUrl,
        coverThumbhash,
        mediaCount: items.length,
        isShared: Boolean(a.shareToken),
        shareToken: a.shareToken,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        items,
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
    if (coverMediaId !== undefined) updates.coverMediaId = coverMediaId;

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
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        isFavorite: m.isFavorite,
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
    const userMedia = await db
      .select({ id: media.id })
      .from(media)
      .where(and(eq(media.userId, user.id), inArray(media.id, mediaIds), isNull(media.deletedAt)));

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

    let shareToken = a.shareToken;
    if (!shareToken) {
      shareToken = crypto.randomUUID().replace(/-/g, "");
      await db.update(album).set({ shareToken, updatedAt: Date.now() }).where(eq(album.id, id));
    }

    const origins = webOrigins(c.env);
    const origin = origins[0] ?? "https://photos-web.luis-sg9915.workers.dev";
    const shareUrl = `${origin}/shared/album/${shareToken}`;

    return c.json({ shareToken, shareUrl }, 200);
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

    await db.update(album).set({ shareToken: null, updatedAt: Date.now() }).where(eq(album.id, id));
    return c.json({ ok: true as const }, 200);
  });
