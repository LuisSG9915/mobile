import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  errorSchema,
  uploadCompleteResponseSchema,
  uploadInitResponseSchema,
  uploadInitSchema,
} from "@photos/shared";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { originalKey, thumbKey } from "../lib/keys";
import { presignPut } from "../lib/s3";

const jsonBody = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});

const err = (description: string) => ({
  content: { "application/json": { schema: errorSchema } },
  description,
});

const initRoute = createRoute({
  method: "post",
  path: "/uploads/init",
  tags: ["uploads"],
  summary: "Iniciar una subida",
  description:
    "Registra los metadatos del archivo y devuelve URLs prefirmadas para subir la miniatura y el original directamente a R2. Si el archivo ya existe (mismo SHA-256), devuelve status 'duplicate'.",
  request: { body: jsonBody(uploadInitSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: uploadInitResponseSchema } },
      description: "Duplicado o subida reanudada",
    },
    201: {
      content: { "application/json": { schema: uploadInitResponseSchema } },
      description: "Subida creada",
    },
    400: err("Petición inválida"),
    401: err("Sin sesión"),
    413: err("Archivo demasiado grande"),
    429: err("Demasiadas solicitudes"),
  },
});

const completeRoute = createRoute({
  method: "post",
  path: "/uploads/{id}/complete",
  tags: ["uploads"],
  summary: "Confirmar una subida",
  description:
    "Verifica que ambos objetos existen en R2 con el tamaño esperado y marca el registro como 'ready'.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      content: { "application/json": { schema: uploadCompleteResponseSchema } },
      description: "Subida confirmada",
    },
    401: err("Sin sesión"),
    404: err("Subida no encontrada"),
    409: err("Objetos incompletos en R2"),
  },
});

export const uploadsApp = new OpenAPIHono<AppEnv>()
  .openapi(initRoute, async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    if (c.env.UPLOAD_LIMITER) {
      const { success } = await c.env.UPLOAD_LIMITER.limit({ key: user.id });
      if (!success) {
        return c.json(
          { error: "rate_limited", message: "Demasiadas solicitudes. Espera un minuto." },
          429,
        );
      }
    }

    const maxBytes = Number(c.env.MAX_ORIGINAL_BYTES) || 5_368_709_120;
    if (body.fileSize > maxBytes) {
      return c.json(
        { error: "file_too_large", message: "El archivo supera el máximo permitido (5 GB)." },
        413,
      );
    }

    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.sha256, body.sha256)))
      .get();

    if (existing?.status === "ready" && !existing.deletedAt) {
      return c.json({ status: "duplicate", id: existing.id } as const, 200);
    }

    const tKey = thumbKey(user.id, body.sha256);
    const oKey = originalKey(user.id, body.sha256, body.ext);
    const [thumb, original] = await Promise.all([
      presignPut(c.env, tKey, "image/webp", body.thumbSize),
      presignPut(c.env, oKey, body.mimeType, body.fileSize),
    ]);

    const now = Date.now();
    const values = {
      userId: user.id,
      sha256: body.sha256,
      mediaType: body.mediaType,
      mimeType: body.mimeType,
      ext: body.ext,
      takenAt: body.takenAt,
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      width: body.width,
      height: body.height,
      durationMs: body.durationMs ?? null,
      thumbhash: body.thumbhash,
      r2KeyOriginal: oKey,
      r2KeyThumb: tKey,
      fileSize: body.fileSize,
      thumbSize: body.thumbSize,
      status: "pending" as const,
      updatedAt: now,
      deletedAt: null,
    };

    let id: string;
    let created = false;
    if (existing) {
      id = existing.id;
      await db.update(media).set(values).where(eq(media.id, id));
    } else {
      id = crypto.randomUUID();
      created = true;
      await db.insert(media).values({ ...values, id, createdAt: now });
    }

    const ttl = Number(c.env.PRESIGN_TTL_SECONDS) || 900;
    const payload = {
      status: "upload",
      id,
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      thumb,
      original,
    } as const;
    if (created) return c.json(payload, 201);
    return c.json(payload, 200);
  })
  .openapi(completeRoute, async (c) => {
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (!row) {
      return c.json({ error: "not_found", message: "Subida no encontrada." }, 404);
    }
    if (row.status === "ready") {
      return c.json({ id: row.id, status: "ready" } as const, 200); // idempotente
    }

    const [tHead, oHead] = await Promise.all([
      c.env.BUCKET.head(row.r2KeyThumb),
      c.env.BUCKET.head(row.r2KeyOriginal),
    ]);
    if (!tHead) {
      return c.json(
        { error: "object_missing", message: "Falta la miniatura en el almacenamiento." },
        409,
      );
    }
    if (!oHead) {
      return c.json(
        { error: "object_missing", message: "Falta el archivo original en el almacenamiento." },
        409,
      );
    }
    if (tHead.size !== row.thumbSize || oHead.size !== row.fileSize) {
      return c.json(
        { error: "size_mismatch", message: "El tamaño subido no coincide con el declarado." },
        409,
      );
    }
    // El content-type no queda cubierto por la firma SigV4: se verifica aquí
    // contra lo que realmente se almacenó en R2.
    const storedMime = oHead.httpMetadata?.contentType;
    const storedThumbMime = tHead.httpMetadata?.contentType;
    if (storedMime && storedMime !== row.mimeType) {
      return c.json(
        { error: "mime_mismatch", message: "El tipo de archivo subido no coincide con el declarado." },
        409,
      );
    }
    if (storedThumbMime && storedThumbMime !== "image/webp") {
      return c.json(
        { error: "mime_mismatch", message: "La miniatura subida no es WebP." },
        409,
      );
    }

    await db
      .update(media)
      .set({ status: "ready", updatedAt: Date.now() })
      .where(eq(media.id, row.id));
    return c.json({ id: row.id, status: "ready" } as const, 200);
  });
