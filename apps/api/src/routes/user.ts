import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  okSchema,
  STORAGE_QUOTA_BYTES,
  storageResponseSchema,
  userAccountDeleteResponseSchema,
  userExportResponseSchema,
  userSessionsResponseSchema,
} from "@photos/shared";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  account,
  album,
  albumMedia,
  media,
  mediaTags,
  session,
  systemState,
  userStorageStats,
  user as userTable,
} from "../db/schema";
import type { AppEnv } from "../env";
import { presignGetDownload } from "../lib/s3";
import { mapInChunks } from "../lib/slices";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const storageRoute = createRoute({
  method: "get",
  path: "/user/storage",
  tags: ["user"],
  summary: "Uso de almacenamiento del usuario",
  description:
    "Lectura O(1) desde user_storage_stats (sin SUM sobre media). usedBytes incluye originales, miniaturas y elementos en papelera porque siguen ocupando R2 hasta la purga.",
  responses: {
    200: {
      content: { "application/json": { schema: storageResponseSchema } },
      description: "Uso actual de la cuota",
    },
    401: err("Sin sesión"),
  },
});

const sessionsRoute = createRoute({
  method: "get",
  path: "/user/sessions",
  tags: ["user"],
  summary: "Listar sesiones activas del usuario",
  description:
    "Devuelve las sesiones activas en Better Auth con IP, agente de usuario y si corresponde a la sesión actual.",
  responses: {
    200: {
      content: { "application/json": { schema: userSessionsResponseSchema } },
      description: "Lista de sesiones activas",
    },
    401: err("Sin sesión"),
  },
});

const revokeSessionRoute = createRoute({
  method: "delete",
  path: "/user/sessions/{id}",
  tags: ["user"],
  summary: "Revocar una sesión activa",
  description: "Elimina la sesión especificada para forzar el cierre de sesión en ese dispositivo.",
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Sesión revocada",
    },
    401: err("Sin sesión"),
    404: err("Sesión no encontrada"),
  },
});

const exportRoute = createRoute({
  method: "get",
  path: "/user/export",
  tags: ["user"],
  summary: "Exportar datos del usuario (GDPR Portabilidad)",
  description:
    "Devuelve todos los metadatos de fotos, álbumes y enlaces de descarga directa de los archivos originales.",
  responses: {
    200: {
      content: { "application/json": { schema: userExportResponseSchema } },
      description: "Exportación completa en JSON",
    },
    401: err("Sin sesión"),
  },
});

const deleteAccountRoute = createRoute({
  method: "delete",
  path: "/user/account",
  tags: ["user"],
  summary: "Eliminar cuenta y todos los datos asociados",
  description:
    "Revoca todas las sesiones, elimina registros de la base de datos y purga todos los objetos de R2.",
  responses: {
    200: {
      content: { "application/json": { schema: userAccountDeleteResponseSchema } },
      description: "Cuenta eliminada",
    },
    401: err("Sin sesión"),
  },
});

export const userApp = new OpenAPIHono<AppEnv>()
  .openapi(storageRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);
    const row = await db
      .select()
      .from(userStorageStats)
      .where(eq(userStorageStats.userId, user.id))
      .get();

    const usedBytes = row?.usedBytes ?? 0;
    const maxBytes = row?.maxBytes ?? STORAGE_QUOTA_BYTES;
    const mediaCount = row?.mediaCount ?? 0;
    const usedPercent =
      maxBytes > 0 ? Math.min(100, Math.round((usedBytes / maxBytes) * 10000) / 100) : 0;

    return c.json({ usedBytes, maxBytes, mediaCount, usedPercent }, 200);
  })
  .openapi(sessionsRoute, async (c) => {
    const user = c.get("user");
    const currentSessionId = c.get("sessionId");
    const db = getDb(c.env.DB);
    const rows = await db
      .select()
      .from(session)
      .where(and(eq(session.userId, user.id), gt(session.expiresAt, new Date())))
      .all();

    const sessions = rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.getTime(),
      expiresAt: s.expiresAt.getTime(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      isCurrent: s.id === currentSessionId,
    }));

    return c.json({ sessions }, 200);
  })
  .openapi(revokeSessionRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const s = await db
      .select()
      .from(session)
      .where(and(eq(session.id, id), eq(session.userId, user.id)))
      .get();

    if (!s) {
      return c.json({ error: "not_found", message: "Sesión no encontrada." }, 404);
    }

    await db.delete(session).where(eq(session.id, id));
    return c.json({ ok: true as const }, 200);
  })
  .openapi(exportRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    const userRow = await db.select().from(userTable).where(eq(userTable.id, user.id)).get();
    const mediaRows = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), isNull(media.deletedAt)))
      .all();

    const mediaWithDownloads = await Promise.all(
      mediaRows.map(async (m) => {
        let tags: string[] = [];
        if (m.tags) {
          try {
            tags = JSON.parse(m.tags);
          } catch {}
        }
        const ext = m.ext || (m.mediaType === "video" ? "mp4" : "jpg");
        const filename = `${m.id}.${ext}`;
        const downloadUrl = await presignGetDownload(c.env, m.r2KeyOriginal, filename);
        return {
          id: m.id,
          sha256: m.sha256,
          mediaType: m.mediaType,
          takenAt: m.takenAt,
          width: m.width,
          height: m.height,
          fileSize: m.fileSize,
          caption: m.caption,
          tags,
          latitude: m.latitude,
          longitude: m.longitude,
          downloadUrl,
        };
      }),
    );

    const albumsRows = await db.select().from(album).where(eq(album.userId, user.id)).all();
    const albumIds = albumsRows.map((a) => a.id);
    // >100 álbumes superan el tope de parámetros de D1: consultar en trozos.
    const albumMediaRows = await mapInChunks(albumIds, (slice) =>
      db.select().from(albumMedia).where(inArray(albumMedia.albumId, slice)).all(),
    );

    const albums = albumsRows.map((a) => ({
      id: a.id,
      title: a.title,
      createdAt: a.createdAt,
      mediaIds: albumMediaRows.filter((am) => am.albumId === a.id).map((am) => am.mediaId),
    }));

    return c.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          createdAt: userRow?.createdAt ? new Date(userRow.createdAt).getTime() : Date.now(),
        },
        exportedAt: new Date().toISOString(),
        mediaCount: mediaWithDownloads.length,
        media: mediaWithDownloads,
        albums,
      },
      200,
    );
  })
  .openapi(deleteAccountRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    // 1. Obtener claves de R2 de todos los medios del usuario (activos y papelera)
    const mediaRows = await db
      .select({
        r2KeyOriginal: media.r2KeyOriginal,
        r2KeyThumb: media.r2KeyThumb,
        r2KeyPreview: media.r2KeyPreview,
      })
      .from(media)
      .where(eq(media.userId, user.id))
      .all();

    const keysToDelete: string[] = [];
    for (const m of mediaRows) {
      if (m.r2KeyThumb) keysToDelete.push(m.r2KeyThumb);
      if (m.r2KeyOriginal) keysToDelete.push(m.r2KeyOriginal);
      if (m.r2KeyPreview) keysToDelete.push(m.r2KeyPreview);
    }

    for (let i = 0; i < keysToDelete.length; i += 1000) {
      await c.env.BUCKET.delete(keysToDelete.slice(i, i + 1000));
    }

    // 2. Intentar listar y borrar hasta 1000 objetos residuales bajo users/{userId}/
    const remaining = await c.env.BUCKET.list({ prefix: `users/${user.id}/`, limit: 1000 });
    if (remaining.objects.length > 0) {
      await c.env.BUCKET.delete(remaining.objects.map((o) => o.key));
    }
    // Si aún quedan objetos, encolar purga en system_state para el cron
    if (remaining.truncated) {
      await db
        .insert(systemState)
        .values({
          key: `purge_user_${user.id}`,
          value: user.id,
          updatedAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: systemState.key,
          set: { updatedAt: Date.now() },
        });
    }

    // 3. Eliminar filas en D1
    await db.delete(session).where(eq(session.userId, user.id));
    await db.delete(mediaTags).where(eq(mediaTags.userId, user.id));
    await db.delete(media).where(eq(media.userId, user.id));
    await db.delete(album).where(eq(album.userId, user.id));
    await db.delete(userStorageStats).where(eq(userStorageStats.userId, user.id));
    await db.delete(account).where(eq(account.userId, user.id));
    await db.delete(userTable).where(eq(userTable.id, user.id));

    return c.json(
      {
        ok: true as const,
        message: "Cuenta y datos eliminados correctamente.",
      },
      200,
    );
  });
