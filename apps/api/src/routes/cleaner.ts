import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  cleanerBurstsResponseSchema,
  cleanerCleanupResponseSchema,
  cleanerCleanupSchema,
  errorSchema,
} from "@photos/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { presignGet } from "../lib/s3";

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const burstsRoute = createRoute({
  method: "get",
  path: "/cleaner/bursts",
  tags: ["cleaner"],
  summary: "Obtener grupos de fotos en ráfaga o similares",
  description:
    "Agrupa fotos tomadas en intervalos muy cortos (<= 3 segundos) para que el usuario pueda conservar la mejor y enviar las demás a la papelera.",
  responses: {
    200: {
      content: { "application/json": { schema: cleanerBurstsResponseSchema } },
      description: "Grupos de fotos similares",
    },
    401: err("Sin sesión"),
  },
});

const cleanupRoute = createRoute({
  method: "post",
  path: "/cleaner/cleanup",
  tags: ["cleaner"],
  summary: "Limpiar fotos de ráfaga seleccionadas (mover a papelera)",
  description:
    "Mueve a la papelera los IDs de fotos indicados en deleteIds, asegurando que no se borre keepId si se especifica.",
  request: {
    body: {
      content: { "application/json": { schema: cleanerCleanupSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: cleanerCleanupResponseSchema } },
      description: "Resultado de la limpieza",
    },
    400: err("Solicitud inválida"),
    401: err("Sin sesión"),
  },
});

export const cleanerApp = new OpenAPIHono<AppEnv>()
  .openapi(burstsRoute, async (c) => {
    const user = c.get("user");
    const db = getDb(c.env.DB);

    const rows = await db
      .select()
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          eq(media.mediaType, "photo"),
        ),
      )
      .orderBy(desc(media.takenAt), desc(media.id))
      .limit(1000);

    const clusters: (typeof rows)[] = [];
    let currentCluster: typeof rows = [];

    for (const row of rows) {
      if (currentCluster.length === 0) {
        currentCluster.push(row);
      } else {
        const prev = currentCluster[currentCluster.length - 1];
        if (Math.abs(prev.takenAt - row.takenAt) <= 3000) {
          currentCluster.push(row);
        } else {
          if (currentCluster.length >= 2) {
            clusters.push(currentCluster);
          }
          currentCluster = [row];
        }
      }
    }
    if (currentCluster.length >= 2) {
      clusters.push(currentCluster);
    }

    const formattedClusters = await Promise.all(
      clusters.map(async (cList) => {
        const first = cList[0];
        const items = await Promise.all(
          cList.map(async (m) => ({
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
          id: `cluster-${first.id}`,
          takenAt: first.takenAt,
          dateGroup: first.dateGroup,
          items,
        };
      }),
    );

    const totalPhotos = formattedClusters.reduce((sum, cl) => sum + cl.items.length, 0);

    return c.json({ clusters: formattedClusters, totalPhotos }, 200);
  })
  .openapi(cleanupRoute, async (c) => {
    const user = c.get("user");
    const { keepId, deleteIds } = c.req.valid("json");

    const toDelete = deleteIds.filter((id) => id !== keepId);
    if (toDelete.length === 0) {
      return c.json({ ok: true as const, trashedCount: 0 }, 200);
    }

    const db = getDb(c.env.DB);
    const now = Date.now();

    await db
      .update(media)
      .set({ deletedAt: now })
      .where(and(eq(media.userId, user.id), inArray(media.id, toDelete), isNull(media.deletedAt)));

    return c.json({ ok: true as const, trashedCount: toDelete.length }, 200);
  });
