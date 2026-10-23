import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  checkHashesRequestSchema,
  checkHashesResponseSchema,
  errorSchema,
  MULTIPART_PART_SIZE,
  multipartAbortSchema,
  multipartCompleteSchema,
  multipartInitResponseSchema,
  multipartInitSchema,
  multipartPresignPartsResponseSchema,
  multipartPresignPartsSchema,
  okSchema,
  uploadCompleteResponseSchema,
  uploadInitResponseSchema,
  uploadInitSchema,
} from "@photos/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { media } from "../db/schema";
import type { AppEnv } from "../env";
import { tagMediaItem } from "../lib/ai";
import { geocodeMediaItem } from "../lib/geo";
import { originalKey, previewKey, thumbKey } from "../lib/keys";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  presignPut,
  presignUploadPart,
} from "../lib/s3";
import {
  confirmStorageUsage,
  releaseStorageReservation,
  reserveStorageQuota,
} from "../lib/storage-stats";

/** Grupo de fecha YYYY-MM-DD en UTC derivado del epoch ms de captura. */
const dateGroupOf = (takenAt: number) => new Date(takenAt).toISOString().slice(0, 10);

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
    403: err("Correo no verificado"),
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

const checkHashesRoute = createRoute({
  method: "post",
  path: "/uploads/check-hashes",
  tags: ["uploads"],
  summary: "Comprobar hashes ya respaldados",
  description:
    "Recibe un lote de SHA-256 y devuelve los que ya existen como media 'ready' del usuario (no eliminados). Permite a la cola marcar SYNCED sin generar miniatura ni emitir PUTs prefirmados.",
  request: { body: jsonBody(checkHashesRequestSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: checkHashesResponseSchema } },
      description: "Hashes existentes",
    },
    400: err("Petición inválida"),
    401: err("Sin sesión"),
  },
});

const multipartInitRoute = createRoute({
  method: "post",
  path: "/uploads/multipart/init",
  tags: ["uploads"],
  summary: "Iniciar una subida multipart para archivos grandes",
  description:
    "Registra los metadatos y crea la sesión multipart en R2/S3, devolviendo uploadId y URLs para miniatura y partes.",
  request: { body: jsonBody(multipartInitSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: multipartInitResponseSchema } },
      description: "Duplicado o subida reanudada",
    },
    201: {
      content: { "application/json": { schema: multipartInitResponseSchema } },
      description: "Subida multipart creada",
    },
    400: err("Petición inválida"),
    401: err("Sin sesión"),
    403: err("Correo no verificado"),
    413: err("Archivo demasiado grande o cuota excedida"),
    429: err("Demasiadas solicitudes"),
  },
});

const multipartPresignPartsRoute = createRoute({
  method: "post",
  path: "/uploads/multipart/presign-parts",
  tags: ["uploads"],
  summary: "Obtener URLs prefirmadas para partes multipart",
  request: { body: jsonBody(multipartPresignPartsSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: multipartPresignPartsResponseSchema } },
      description: "URLs de partes",
    },
    401: err("Sin sesión"),
    404: err("Subida no encontrada"),
  },
});

const multipartCompleteRoute = createRoute({
  method: "post",
  path: "/uploads/multipart/complete",
  tags: ["uploads"],
  summary: "Completar una subida multipart",
  request: { body: jsonBody(multipartCompleteSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: uploadCompleteResponseSchema } },
      description: "Subida multipart confirmada",
    },
    401: err("Sin sesión"),
    404: err("Subida no encontrada"),
    409: err("Partes incompletas o error en ensamble"),
  },
});

const multipartAbortRoute = createRoute({
  method: "post",
  path: "/uploads/multipart/abort",
  tags: ["uploads"],
  summary: "Abortar una subida multipart",
  request: { body: jsonBody(multipartAbortSchema) },
  responses: {
    200: {
      content: { "application/json": { schema: okSchema } },
      description: "Subida abortada",
    },
    401: err("Sin sesión"),
    404: err("Subida no encontrada"),
  },
});

export const uploadsApp = new OpenAPIHono<AppEnv>()
  .openapi(checkHashesRoute, async (c) => {
    const user = c.get("user");
    const { sha256 } = c.req.valid("json");

    const db = getDb(c.env.DB);
    const rows = await db
      .select({ id: media.id, sha256: media.sha256 })
      .from(media)
      .where(
        and(
          eq(media.userId, user.id),
          eq(media.status, "ready"),
          isNull(media.deletedAt),
          inArray(media.sha256, sha256),
        ),
      );

    return c.json({ existing: rows }, 200);
  })
  .openapi(initRoute, async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    const graceDays = Number(c.env.EMAIL_VERIFICATION_GRACE_DAYS) || 7;
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    const userCreatedAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
    if (user.emailVerified === false && userCreatedAt > 0 && Date.now() - userCreatedAt > graceMs) {
      return c.json(
        {
          code: "email_unverified",
          error: "email_unverified",
          message: `Debes verificar tu correo electrónico para continuar subiendo archivos (periodo de gracia de ${graceDays} días expirado).`,
        },
        403,
      );
    }

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
        {
          code: "file_too_large",
          error: "file_too_large",
          message: "El archivo supera el máximo permitido (5 GB).",
        },
        413,
      );
    }

    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.sha256, body.sha256)))
      .get();

    if (existing?.status === "ready") {
      if (!existing.deletedAt) {
        return c.json({ status: "duplicate", id: existing.id } as const, 200);
      }
      // Re-subir algo que está en la papelera lo restaura sin re-subir bytes:
      // los objetos R2 ya existen bajo la misma clave (sha256), así que solo
      // se quita el borrado suave. Además evita un segundo init→complete que
      // volvería a contar los bytes en la cuota.
      await db
        .update(media)
        .set({ deletedAt: null, updatedAt: Date.now() })
        .where(eq(media.id, existing.id));
      return c.json({ status: "duplicate", id: existing.id } as const, 200);
    }

    // Reserva atómica de cuota: previene carreras concurrentes donde dos
    // peticiones simultáneas superen los max_bytes.
    const totalBytes = body.fileSize + body.thumbSize + (body.previewSize ?? 0);
    const bytesToReserve = existing?.status === "pending" ? 0 : totalBytes;
    if (bytesToReserve > 0) {
      const ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      if (!ok) {
        return c.json(
          {
            code: "quota_exceeded",
            error: "quota_exceeded",
            message:
              "Has alcanzado tu cuota de almacenamiento. Elimina elementos de la papelera para liberar espacio.",
          },
          413,
        );
      }
    }

    try {
      const tKey = thumbKey(user.id, body.sha256);
      const oKey = originalKey(user.id, body.sha256, body.ext);
      const pKey = body.previewSize ? previewKey(user.id, body.sha256) : null;
      const [thumb, original, preview] = await Promise.all([
        presignPut(c.env, tKey, "image/webp", body.thumbSize),
        presignPut(c.env, oKey, body.mimeType, body.fileSize),
        pKey && body.previewSize
          ? presignPut(c.env, pKey, "image/webp", body.previewSize)
          : Promise.resolve(undefined),
      ]);

      const now = Date.now();
      let isScreenshot = body.isScreenshot ?? false;
      if (!isScreenshot && !body.cameraMake && !body.cameraModel && body.mediaType === "photo") {
        const ratio = Math.max(body.width, body.height) / Math.min(body.width, body.height);
        if (ratio >= 1.95 && ratio <= 2.35) {
          isScreenshot = true;
        }
      }
      const isDocument = body.isDocument ?? false;

      const values = {
        userId: user.id,
        sha256: body.sha256,
        mediaType: body.mediaType,
        mimeType: body.mimeType,
        ext: body.ext,
        takenAt: body.takenAt,
        dateGroup: dateGroupOf(body.takenAt),
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        cameraMake: body.cameraMake ?? null,
        cameraModel: body.cameraModel ?? null,
        lensModel: body.lensModel ?? null,
        focalLength: body.focalLength ?? null,
        fNumber: body.fNumber ?? null,
        iso: body.iso ?? null,
        exposureTime: body.exposureTime ?? null,
        width: body.width,
        height: body.height,
        durationMs: body.durationMs ?? null,
        thumbhash: body.thumbhash,
        r2KeyOriginal: oKey,
        r2KeyThumb: tKey,
        r2KeyPreview: pKey,
        fileSize: body.fileSize,
        thumbSize: body.thumbSize,
        previewSize: body.previewSize ?? null,
        isScreenshot,
        isDocument,
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
        ...(preview ? { preview } : {}),
      } as const;
      if (created) return c.json(payload, 201);
      return c.json(payload, 200);
    } catch (err) {
      if (bytesToReserve > 0) {
        await releaseStorageReservation(db, user.id, bytesToReserve).catch(() => {});
      }
      throw err;
    }
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

    const [tHead, oHead, pHead] = await Promise.all([
      c.env.BUCKET.head(row.r2KeyThumb),
      c.env.BUCKET.head(row.r2KeyOriginal),
      row.r2KeyPreview ? c.env.BUCKET.head(row.r2KeyPreview) : Promise.resolve(null),
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
    if (row.r2KeyPreview && !pHead) {
      return c.json(
        { error: "object_missing", message: "Falta la vista previa en el almacenamiento." },
        409,
      );
    }
    if (
      tHead.size !== row.thumbSize ||
      oHead.size !== row.fileSize ||
      (row.previewSize != null && pHead && pHead.size !== row.previewSize)
    ) {
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
        {
          error: "mime_mismatch",
          message: "El tipo de archivo subido no coincide con el declarado.",
        },
        409,
      );
    }
    if (storedThumbMime && storedThumbMime !== "image/webp") {
      return c.json({ error: "mime_mismatch", message: "La miniatura subida no es WebP." }, 409);
    }

    // Flip atómico pending→ready: si otro /complete ganó la carrera,
    // changes=0 y NO se vuelve a sumar la cuota (respuesta idempotente).
    const res = await db
      .update(media)
      .set({ status: "ready", updatedAt: Date.now() })
      .where(and(eq(media.id, row.id), eq(media.status, "pending")));
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ id: row.id, status: "ready" } as const, 200);
    }
    // Pasa los bytes reservados a usados de forma atómica.
    const totalUsage = row.fileSize + row.thumbSize + (row.previewSize ?? 0);
    await confirmStorageUsage(db, user.id, totalUsage);

    // Análisis visual y etiquetado con IA en segundo plano (no retrasa la respuesta al usuario)
    if (c.env.AI) {
      const backgroundTag = tagMediaItem(c.env, row.id, user.id).catch((err) => {
        console.warn("auto_tag_upload_error", row.id, err);
      });
      c.executionCtx?.waitUntil?.(backgroundTag);
    }

    // Geocodificación inversa si el elemento tiene coordenadas GPS
    if (row.latitude != null && row.longitude != null) {
      const backgroundGeo = geocodeMediaItem(
        c.env,
        row.id,
        user.id,
        row.latitude,
        row.longitude,
      ).catch((err) => {
        console.warn("geocode_upload_error", row.id, err);
      });
      c.executionCtx?.waitUntil?.(backgroundGeo);
    }

    return c.json({ id: row.id, status: "ready" } as const, 200);
  })
  .openapi(multipartInitRoute, async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");

    const graceDays = Number(c.env.EMAIL_VERIFICATION_GRACE_DAYS) || 7;
    const graceMs = graceDays * 24 * 60 * 60 * 1000;
    const userCreatedAt = user.createdAt ? new Date(user.createdAt).getTime() : 0;
    if (user.emailVerified === false && userCreatedAt > 0 && Date.now() - userCreatedAt > graceMs) {
      return c.json(
        {
          code: "email_unverified",
          error: "email_unverified",
          message: `Debes verificar tu correo electrónico para continuar subiendo archivos (periodo de gracia de ${graceDays} días expirado).`,
        },
        403,
      );
    }

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
        {
          code: "file_too_large",
          error: "file_too_large",
          message: "El archivo supera el máximo permitido (5 GB).",
        },
        413,
      );
    }

    const db = getDb(c.env.DB);
    const existing = await db
      .select()
      .from(media)
      .where(and(eq(media.userId, user.id), eq(media.sha256, body.sha256)))
      .get();

    if (existing?.status === "ready") {
      if (!existing.deletedAt) {
        return c.json({ status: "duplicate", id: existing.id } as const, 200);
      }
      await db
        .update(media)
        .set({ deletedAt: null, updatedAt: Date.now() })
        .where(eq(media.id, existing.id));
      return c.json({ status: "duplicate", id: existing.id } as const, 200);
    }

    const totalBytes = body.fileSize + body.thumbSize + (body.previewSize ?? 0);
    const bytesToReserve = existing?.status === "pending" ? 0 : totalBytes;
    if (bytesToReserve > 0) {
      const ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      if (!ok) {
        return c.json(
          {
            code: "quota_exceeded",
            error: "quota_exceeded",
            message:
              "Has alcanzado tu cuota de almacenamiento. Elimina elementos de la papelera para liberar espacio.",
          },
          413,
        );
      }
    }

    try {
      const tKey = thumbKey(user.id, body.sha256);
      const oKey = originalKey(user.id, body.sha256, body.ext);
      const pKey = body.previewSize ? previewKey(user.id, body.sha256) : null;
      const [thumb, preview, uploadId] = await Promise.all([
        presignPut(c.env, tKey, "image/webp", body.thumbSize),
        pKey && body.previewSize
          ? presignPut(c.env, pKey, "image/webp", body.previewSize)
          : Promise.resolve(undefined),
        createMultipartUpload(c.env, oKey, body.mimeType),
      ]);

      const now = Date.now();
      let isScreenshot = body.isScreenshot ?? false;
      if (!isScreenshot && !body.cameraMake && !body.cameraModel && body.mediaType === "photo") {
        const ratio = Math.max(body.width, body.height) / Math.min(body.width, body.height);
        if (ratio >= 1.95 && ratio <= 2.35) {
          isScreenshot = true;
        }
      }
      const isDocument = body.isDocument ?? false;

      const values = {
        userId: user.id,
        sha256: body.sha256,
        mediaType: body.mediaType,
        mimeType: body.mimeType,
        ext: body.ext,
        takenAt: body.takenAt,
        dateGroup: dateGroupOf(body.takenAt),
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        cameraMake: body.cameraMake ?? null,
        cameraModel: body.cameraModel ?? null,
        lensModel: body.lensModel ?? null,
        focalLength: body.focalLength ?? null,
        fNumber: body.fNumber ?? null,
        iso: body.iso ?? null,
        exposureTime: body.exposureTime ?? null,
        width: body.width,
        height: body.height,
        durationMs: body.durationMs ?? null,
        thumbhash: body.thumbhash,
        r2KeyOriginal: oKey,
        r2KeyThumb: tKey,
        r2KeyPreview: pKey,
        fileSize: body.fileSize,
        thumbSize: body.thumbSize,
        previewSize: body.previewSize ?? null,
        isScreenshot,
        isDocument,
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
      const partSize = MULTIPART_PART_SIZE;
      const totalParts = Math.ceil(body.fileSize / partSize);

      const payload = {
        status: "upload",
        id,
        uploadId,
        key: oKey,
        partSize,
        totalParts,
        expiresAt: new Date(now + ttl * 1000).toISOString(),
        thumb,
        ...(preview ? { preview } : {}),
      } as const;

      if (created) return c.json(payload, 201);
      return c.json(payload, 200);
    } catch (err) {
      if (bytesToReserve > 0) {
        await releaseStorageReservation(db, user.id, bytesToReserve).catch(() => {});
      }
      throw err;
    }
  })
  .openapi(multipartPresignPartsRoute, async (c) => {
    const user = c.get("user");
    const { id, uploadId, partNumbers } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const row = await db
      .select({ id: media.id, r2KeyOriginal: media.r2KeyOriginal, status: media.status })
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();

    if (row?.status !== "pending") {
      return c.json({ error: "not_found", message: "Subida no encontrada o ya procesada." }, 404);
    }

    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const url = await presignUploadPart(c.env, row.r2KeyOriginal, uploadId, partNumber);
        return { partNumber, url };
      }),
    );

    return c.json({ parts }, 200);
  })
  .openapi(multipartCompleteRoute, async (c) => {
    const user = c.get("user");
    const { id, uploadId, parts } = c.req.valid("json");
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
      return c.json({ id: row.id, status: "ready" } as const, 200);
    }

    try {
      await completeMultipartUpload(c.env, row.r2KeyOriginal, uploadId, parts);
    } catch {
      return c.json(
        { error: "multipart_complete_failed", message: "Error al completar la subida multipart." },
        409,
      );
    }

    const [tHead, oHead, pHead] = await Promise.all([
      c.env.BUCKET.head(row.r2KeyThumb),
      c.env.BUCKET.head(row.r2KeyOriginal),
      row.r2KeyPreview ? c.env.BUCKET.head(row.r2KeyPreview) : Promise.resolve(null),
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
    if (row.r2KeyPreview && !pHead) {
      return c.json(
        { error: "object_missing", message: "Falta la vista previa en el almacenamiento." },
        409,
      );
    }

    const res = await db
      .update(media)
      .set({ status: "ready", updatedAt: Date.now() })
      .where(and(eq(media.id, row.id), eq(media.status, "pending")));

    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ id: row.id, status: "ready" } as const, 200);
    }

    const totalUsage = row.fileSize + row.thumbSize + (row.previewSize ?? 0);
    await confirmStorageUsage(db, user.id, totalUsage);

    if (c.env.AI) {
      const backgroundTag = tagMediaItem(c.env, row.id, user.id).catch((err) => {
        console.warn("auto_tag_upload_error", row.id, err);
      });
      c.executionCtx?.waitUntil?.(backgroundTag);
    }

    if (row.latitude != null && row.longitude != null) {
      const backgroundGeo = geocodeMediaItem(
        c.env,
        row.id,
        user.id,
        row.latitude,
        row.longitude,
      ).catch((err) => {
        console.warn("geocode_upload_error", row.id, err);
      });
      c.executionCtx?.waitUntil?.(backgroundGeo);
    }

    return c.json({ id: row.id, status: "ready" } as const, 200);
  })
  .openapi(multipartAbortRoute, async (c) => {
    const user = c.get("user");
    const { id, uploadId } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();

    if (!row) {
      return c.json({ error: "not_found", message: "Subida no encontrada." }, 404);
    }

    if (row.status === "pending") {
      await abortMultipartUpload(c.env, row.r2KeyOriginal, uploadId).catch(() => {});
      const total = row.fileSize + row.thumbSize + (row.previewSize ?? 0);
      await releaseStorageReservation(db, user.id, total).catch(() => {});
      await db.delete(media).where(eq(media.id, row.id));
    }

    return c.json({ ok: true } as const, 200);
  });
