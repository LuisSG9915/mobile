import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { errorSchema, publicAlbumResponseSchema } from "@photos/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { album, albumMedia, media } from "../db/schema";
import type { AppEnv } from "../env";
import { presignGet, presignGetDownload } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const tokenParam = z.object({ token: z.string().min(1) });

const getSharedAlbumRoute = createRoute({
  method: "get",
  path: "/shared/album/{token}",
  tags: ["shared"],
  summary: "Ver álbum compartido públicamente",
  description:
    "Permite consultar el contenido y miniaturas de un álbum mediante su token de compartir, sin requerir autenticación.",
  request: { params: tokenParam },
  responses: {
    200: {
      content: { "application/json": { schema: publicAlbumResponseSchema } },
      description: "Contenido del álbum compartido",
    },
    404: err("Álbum compartido no encontrado o revocado"),
  },
});

export const sharedApp = new OpenAPIHono<AppEnv>().openapi(getSharedAlbumRoute, async (c) => {
  const { token } = c.req.valid("param");
  const db = getDb(c.env.DB);

  const a = await db.select().from(album).where(eq(album.shareToken, token)).get();

  if (!a) {
    return c.json(
      {
        error: "not_found",
        message: "El álbum compartido no existe o el enlace ha sido revocado.",
      },
      404,
    );
  }

  const rows = await db
    .select({ media })
    .from(albumMedia)
    .innerJoin(media, eq(albumMedia.mediaId, media.id))
    .where(and(eq(albumMedia.albumId, a.id), isNull(media.deletedAt)))
    .orderBy(desc(albumMedia.addedAt));

  const items = await Promise.all(
    rows.map(async ({ media: m }) => ({
      id: m.id,
      mediaType: m.mediaType,
      width: m.width,
      height: m.height,
      takenAt: m.takenAt,
      durationMs: m.durationMs,
      thumbhash: m.thumbhash,
      thumbUrl: await presignGet(c.env, m.r2KeyThumb),
      originalUrl: await presignGet(c.env, m.r2KeyOriginal),
      downloadUrl: await presignGetDownload(c.env, m.r2KeyOriginal, `${m.id}.${m.ext}`),
    })),
  );

  return c.json(
    {
      title: a.title,
      mediaCount: items.length,
      createdAt: a.createdAt,
      items,
    },
    200,
  );
});
