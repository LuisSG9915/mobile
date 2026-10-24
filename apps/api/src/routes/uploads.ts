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
  uploadCancelBodySchema,
  uploadCancelResponseSchema,
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
import { mapInChunks } from "../lib/slices";
import {
  confirmStorageUsage,
  reconcileUserReservations,
  releaseStorageReservation,
  reserveStorageQuota,
} from "../lib/storage-stats";
import { recordApiMetric } from "../lib/telemetry";

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
    409: err("El tamaño del archivo cambió respecto de la subida pendiente"),
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

const cancelRoute = createRoute({
  method: "post",
  path: "/uploads/{id}/cancel",
  tags: ["uploads"],
  summary: "Cancelar una subida pendiente y liberar bytes reservados",
  description:
    "Libera la reserva en la cuota de almacenamiento y limpia la subida pendiente de forma idempotente.",
  request: {
    params: z.object({ id: z.string().openapi({ description: "ID de la subida / medio" }) }),
    body: {
      content: { "application/json": { schema: uploadCancelBodySchema } },
      required: false,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: uploadCancelResponseSchema } },
      description: "Subida cancelada o ya finalizada (idempotente)",
    },
    401: err("Sin sesión"),
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
    409: err("El tamaño del archivo cambió respecto de la subida pendiente"),
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
    409: err("La sesión multipart no coincide"),
  },
});

const multipartCompleteRoute = createRoute({
  method: "post",
  path: "/uploads/multipart/finalize",
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
    // D1 admitía 100 valores por consulta: con lotes mayores el request fallaba
    // (y el cliente lo trataba como "no existe" en "Liberar espacio").
    const rows = await mapInChunks(sha256, (slice) =>
      db
        .select({ id: media.id, sha256: media.sha256 })
        .from(media)
        .where(
          and(
            eq(media.userId, user.id),
            eq(media.status, "ready"),
            isNull(media.deletedAt),
            inArray(media.sha256, slice),
          ),
        ),
    );

    return c.json({ existing: rows }, 200);
  })
  .openapi(initRoute, async (c) => {
    const initStart = performance.now();
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
      recordApiMetric(c.env, "upload.init", {
        userId: user.id,
        durationMs: performance.now() - initStart,
        bytes: body.fileSize,
        status: "413",
      });
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
        recordApiMetric(c.env, "upload.init", {
          userId: user.id,
          durationMs: performance.now() - initStart,
          bytes: body.fileSize,
          status: "200",
        });
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
      recordApiMetric(c.env, "upload.init", {
        userId: user.id,
        durationMs: performance.now() - initStart,
        bytes: body.fileSize,
        status: "200",
      });
      return c.json({ status: "duplicate", id: existing.id } as const, 200);
    }

    // Reserva atómica de cuota: previene carreras concurrentes donde dos
    // peticiones simultáneas superen los max_bytes.
    const totalBytes = body.fileSize + body.thumbSize + (body.previewSize ?? 0);
    const existingTotal = existing
      ? existing.fileSize + existing.thumbSize + (existing.previewSize ?? 0)
      : 0;
    if (existing?.status === "pending" && totalBytes !== existingTotal) {
      return c.json(
        {
          code: "upload_size_changed",
          error: "upload_size_changed",
          message: "El archivo cambió de tamaño; cancela la subida y vuelve a empezar.",
        },
        409,
      );
    }
    const bytesToReserve = existing?.status === "pending" ? 0 : totalBytes;
    if (bytesToReserve > 0) {
      let ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      if (!ok) {
        // Reconciliación reactiva ante cuota excedida: purga reservas obsoletas y recalcula el uso real
        await reconcileUserReservations(db, user.id);
        ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      }
      if (!ok) {
        recordApiMetric(c.env, "upload.init", {
          userId: user.id,
          durationMs: performance.now() - initStart,
          bytes: body.fileSize,
          status: "413",
        });
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
      const pKey = body.previewSize ? previewKey(user.id, body.sha256, body.mediaType) : null;
      const pMime = body.mediaType === "video" ? "video/mp4" : "image/webp";
      if (existing?.uploadId) {
        await abortMultipartUpload(c.env, existing.r2KeyOriginal, existing.uploadId).catch(
          () => {},
        );
      }
      const [thumb, original, preview] = await Promise.all([
        presignPut(c.env, tKey, "image/webp", body.thumbSize),
        presignPut(c.env, oKey, body.mimeType, body.fileSize),
        pKey && body.previewSize
          ? presignPut(c.env, pKey, pMime, body.previewSize)
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
        uploadId: null,
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
      if (created) {
        recordApiMetric(c.env, "upload.init", {
          userId: user.id,
          durationMs: performance.now() - initStart,
          bytes: body.fileSize,
          status: "201",
        });
        return c.json(payload, 201);
      }
      recordApiMetric(c.env, "upload.init", {
        userId: user.id,
        durationMs: performance.now() - initStart,
        bytes: body.fileSize,
        status: "200",
      });
      return c.json(payload, 200);
    } catch (err) {
      if (bytesToReserve > 0) {
        await releaseStorageReservation(db, user.id, bytesToReserve).catch(() => {});
      }
      throw err;
    }
  })
  .openapi(completeRoute, async (c) => {
    const completeStart = performance.now();
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();
    if (!row) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "404",
        type: "single",
      });
      return c.json({ error: "not_found", message: "Subida no encontrada." }, 404);
    }
    if (row.uploadId) {
      return c.json(
        {
          error: "multipart_pending",
          message: "La subida es multipart; usa /uploads/multipart/finalize.",
        },
        409,
      );
    }
    if (row.status === "ready") {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        bytes: row.fileSize,
        status: "200",
        type: "single",
      });
      return c.json({ id: row.id, status: "ready" } as const, 200); // idempotente
    }

    const [tHead, oHead, pHead] = await Promise.all([
      c.env.BUCKET.head(row.r2KeyThumb),
      c.env.BUCKET.head(row.r2KeyOriginal),
      row.r2KeyPreview ? c.env.BUCKET.head(row.r2KeyPreview) : Promise.resolve(null),
    ]);
    if (!tHead) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
      return c.json(
        { error: "object_missing", message: "Falta la miniatura en el almacenamiento." },
        409,
      );
    }
    if (!oHead) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
      return c.json(
        { error: "object_missing", message: "Falta el archivo original en el almacenamiento." },
        409,
      );
    }
    if (row.r2KeyPreview && !pHead) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
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
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
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
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
      return c.json(
        {
          error: "mime_mismatch",
          message: "El tipo de archivo subido no coincide con el declarado.",
        },
        409,
      );
    }
    if (storedThumbMime && storedThumbMime !== "image/webp") {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        status: "409",
        type: "single",
      });
      return c.json({ error: "mime_mismatch", message: "La miniatura subida no es WebP." }, 409);
    }

    // Flip atómico pending→ready: si otro /complete ganó la carrera,
    // changes=0 y NO se vuelve a sumar la cuota (respuesta idempotente).
    const res = await db
      .update(media)
      .set({ status: "ready", uploadId: null, updatedAt: Date.now() })
      .where(and(eq(media.id, row.id), eq(media.status, "pending")));
    if ((res.meta.changes ?? 0) === 0) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - completeStart,
        bytes: row.fileSize,
        status: "200",
        type: "single",
      });
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

    recordApiMetric(c.env, "upload.complete", {
      userId: user.id,
      durationMs: performance.now() - completeStart,
      bytes: row.fileSize,
      status: "200",
      type: "single",
    });
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
    const existingTotal = existing
      ? existing.fileSize + existing.thumbSize + (existing.previewSize ?? 0)
      : 0;
    // Un re-init no puede cambiar el tamaño: la reserva ya está hecha con el
    // tamaño anterior y ampliarla sin reservar sería un bypass de cuota.
    if (existing?.status === "pending" && totalBytes !== existingTotal) {
      return c.json(
        {
          code: "upload_size_changed",
          error: "upload_size_changed",
          message: "El archivo cambió de tamaño; cancela la subida y vuelve a empezar.",
        },
        409,
      );
    }

    const bytesToReserve = existing?.status === "pending" ? 0 : totalBytes;
    if (bytesToReserve > 0) {
      let ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      if (!ok) {
        // Reconciliación reactiva ante cuota excedida: purga reservas obsoletas y recalcula el uso real
        await reconcileUserReservations(db, user.id);
        ok = await reserveStorageQuota(db, user.id, bytesToReserve);
      }
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

    let uploadId = existing?.status === "pending" ? existing.uploadId : null;
    let createdUploadId: string | null = null;
    let rowId: string | null = existing?.id ?? null;
    let rowCreated = false;

    try {
      const tKey = existing?.r2KeyThumb ?? thumbKey(user.id, body.sha256);
      const oKey = existing?.r2KeyOriginal ?? originalKey(user.id, body.sha256, body.ext);
      const pKey = body.previewSize
        ? (existing?.r2KeyPreview ?? previewKey(user.id, body.sha256, body.mediaType))
        : null;
      const pMime = body.mediaType === "video" ? "video/mp4" : "image/webp";

      // Reanudar solo si el cliente conserva la misma MPU. Si no, se aborta la
      // anterior (sus partes quedarían huérfanas) y se crea una limpia.
      const canResume = Boolean(
        existing?.status === "pending" && uploadId && body.uploadId === uploadId,
      );
      if (!canResume) {
        const oldUploadId = existing?.status === "pending" ? uploadId : null;
        uploadId = await createMultipartUpload(c.env, oKey, body.mimeType);
        createdUploadId = uploadId;
        if (oldUploadId && oldUploadId !== uploadId) {
          await abortMultipartUpload(c.env, oKey, oldUploadId).catch(() => {});
        }
      }
      if (!uploadId) throw new Error("No se pudo iniciar la subida multipart");

      const [thumb, preview] = await Promise.all([
        presignPut(c.env, tKey, "image/webp", body.thumbSize),
        pKey && body.previewSize
          ? presignPut(c.env, pKey, pMime, body.previewSize)
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
        uploadId,
        isScreenshot,
        isDocument,
        status: "pending" as const,
        updatedAt: now,
        deletedAt: null,
      };

      if (existing) {
        rowId = existing.id;
        await db.update(media).set(values).where(eq(media.id, rowId));
      } else {
        rowId = crypto.randomUUID();
        rowCreated = true;
        await db.insert(media).values({ ...values, id: rowId, createdAt: now });
      }

      const ttl = Number(c.env.PRESIGN_TTL_SECONDS) || 900;
      const partSize = MULTIPART_PART_SIZE;
      const totalParts = Math.ceil(body.fileSize / partSize);

      const payload = {
        status: "upload",
        id: rowId,
        uploadId,
        resumed: canResume,
        key: oKey,
        partSize,
        totalParts,
        expiresAt: new Date(now + ttl * 1000).toISOString(),
        thumb,
        ...(preview ? { preview } : {}),
      } as const;

      if (rowCreated) return c.json(payload, 201);
      return c.json(payload, 200);
    } catch (err) {
      if (bytesToReserve > 0) {
        await releaseStorageReservation(db, user.id, bytesToReserve).catch(() => {});
      }
      if (createdUploadId) {
        await abortMultipartUpload(
          c.env,
          existing?.r2KeyOriginal ?? originalKey(user.id, body.sha256, body.ext),
          createdUploadId,
        ).catch(() => {});
      }
      if (rowCreated && rowId) {
        await db
          .delete(media)
          .where(eq(media.id, rowId))
          .catch(() => {});
      } else if (createdUploadId && rowId) {
        // La fila existente apuntaba a una MPU que acabamos de abortar.
        await db
          .update(media)
          .set({ uploadId: null })
          .where(eq(media.id, rowId))
          .catch(() => {});
      }
      throw err;
    }
  })
  .openapi(multipartPresignPartsRoute, async (c) => {
    const user = c.get("user");
    const { id, uploadId, partNumbers } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const row = await db
      .select({
        id: media.id,
        r2KeyOriginal: media.r2KeyOriginal,
        status: media.status,
        uploadId: media.uploadId,
      })
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();

    if (row?.status !== "pending") {
      return c.json({ error: "not_found", message: "Subida no encontrada o ya procesada." }, 404);
    }
    if (row.uploadId && row.uploadId !== uploadId) {
      return c.json(
        {
          error: "upload_id_mismatch",
          message: "La sesión multipart no coincide con la subida pendiente.",
        },
        409,
      );
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
    const mpStart = performance.now();
    const user = c.get("user");
    const { id, uploadId, parts } = c.req.valid("json");
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();

    if (!row) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - mpStart,
        status: "404",
        type: "multipart",
      });
      return c.json({ error: "not_found", message: "Subida no encontrada." }, 404);
    }
    if (row.status === "ready") {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - mpStart,
        bytes: row.fileSize,
        status: "200",
        type: "multipart",
      });
      return c.json({ id: row.id, status: "ready" } as const, 200);
    }

    if (row.uploadId && row.uploadId !== uploadId) {
      return c.json(
        {
          error: "upload_id_mismatch",
          message: "La sesión multipart no coincide con la subida pendiente.",
        },
        409,
      );
    }

    const expectedParts = Math.ceil(row.fileSize / MULTIPART_PART_SIZE);
    if (parts.length !== expectedParts) {
      await abortMultipartUpload(c.env, row.r2KeyOriginal, uploadId).catch(() => {});
      const keys = [row.r2KeyThumb, row.r2KeyOriginal, row.r2KeyPreview].filter(
        Boolean,
      ) as string[];
      await c.env.BUCKET.delete(keys).catch(() => {});
      await releaseStorageReservation(
        db,
        user.id,
        row.fileSize + row.thumbSize + (row.previewSize ?? 0),
      ).catch(() => {});
      await db
        .delete(media)
        .where(eq(media.id, row.id))
        .catch(() => {});
      return c.json(
        {
          error: "parts_mismatch",
          message: `Se esperaban ${expectedParts} partes y llegaron ${parts.length}.`,
        },
        409,
      );
    }

    // Limpieza común ante un ensamblado inválido: no dejar objetos ni reservas
    // colgando y permitir que el cliente reinicie desde /multipart/init.
    const discard = async () => {
      const keys = [row.r2KeyThumb, row.r2KeyOriginal, row.r2KeyPreview].filter(
        Boolean,
      ) as string[];
      await c.env.BUCKET.delete(keys).catch(() => {});
      await abortMultipartUpload(c.env, row.r2KeyOriginal, uploadId).catch(() => {});
      await releaseStorageReservation(
        db,
        user.id,
        row.fileSize + row.thumbSize + (row.previewSize ?? 0),
      ).catch(() => {});
      await db
        .delete(media)
        .where(eq(media.id, row.id))
        .catch(() => {});
    };

    try {
      await completeMultipartUpload(c.env, row.r2KeyOriginal, uploadId, parts);
    } catch {
      // Si R2 ya ensambló y el Worker murió antes de D1, el reintento debe
      // poder cerrar la fila en vez de fallar para siempre con NoSuchUpload.
      const existingObject = await c.env.BUCKET.head(row.r2KeyOriginal);
      if (!existingObject || existingObject.size !== row.fileSize) {
        recordApiMetric(c.env, "upload.complete", {
          userId: user.id,
          durationMs: performance.now() - mpStart,
          status: "409",
          type: "multipart",
        });
        return c.json(
          {
            error: "multipart_complete_failed",
            message: "Error al completar la subida multipart.",
          },
          409,
        );
      }
    }

    const [tHead, oHead, pHead] = await Promise.all([
      c.env.BUCKET.head(row.r2KeyThumb),
      c.env.BUCKET.head(row.r2KeyOriginal),
      row.r2KeyPreview ? c.env.BUCKET.head(row.r2KeyPreview) : Promise.resolve(null),
    ]);

    if (!tHead || !oHead || (row.r2KeyPreview && !pHead)) {
      await discard();
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - mpStart,
        status: "409",
        type: "multipart",
      });
      return c.json(
        { error: "object_missing", message: "Faltan objetos de la subida en el almacenamiento." },
        409,
      );
    }

    const badSize =
      tHead.size !== row.thumbSize ||
      oHead.size !== row.fileSize ||
      (row.previewSize != null && pHead?.size !== row.previewSize);
    const storedMime = oHead.httpMetadata?.contentType;
    const storedThumbMime = tHead.httpMetadata?.contentType;
    const storedPreviewMime = pHead?.httpMetadata?.contentType;
    const expectedPreviewMime = row.mediaType === "video" ? "video/mp4" : "image/webp";
    const badMime =
      (storedMime != null && storedMime !== row.mimeType) ||
      (storedThumbMime != null && storedThumbMime !== "image/webp") ||
      (storedPreviewMime != null && storedPreviewMime !== expectedPreviewMime);

    if (badSize || badMime) {
      await discard();
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - mpStart,
        status: "409",
        type: "multipart",
      });
      return c.json(
        {
          error: badSize ? "size_mismatch" : "mime_mismatch",
          message: "El contenido subido no coincide con lo declarado.",
        },
        409,
      );
    }

    const res = await db
      .update(media)
      .set({ status: "ready", uploadId: null, updatedAt: Date.now() })
      .where(and(eq(media.id, row.id), eq(media.status, "pending")));

    if ((res.meta.changes ?? 0) === 0) {
      recordApiMetric(c.env, "upload.complete", {
        userId: user.id,
        durationMs: performance.now() - mpStart,
        bytes: row.fileSize,
        status: "200",
        type: "multipart",
      });
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

    recordApiMetric(c.env, "upload.complete", {
      userId: user.id,
      durationMs: performance.now() - mpStart,
      bytes: row.fileSize,
      status: "200",
      type: "multipart",
    });
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
  })
  .openapi(cancelRoute, async (c) => {
    const cancelStart = performance.now();
    const user = c.get("user");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json") as { uploadId?: string } | undefined;
    const db = getDb(c.env.DB);

    const row = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.userId, user.id)))
      .get();

    if (!row || row.status === "ready") {
      recordApiMetric(c.env, "upload.cancel", {
        userId: user.id,
        durationMs: performance.now() - cancelStart,
        bytes: 0,
        status: "200",
      });
      return c.json({ ok: true as const, releasedBytes: 0 }, 200);
    }

    if (row.status === "pending") {
      if (body?.uploadId) {
        await abortMultipartUpload(c.env, row.r2KeyOriginal, body.uploadId).catch(() => {});
      }
      const total = row.fileSize + row.thumbSize + (row.previewSize ?? 0);
      await releaseStorageReservation(db, user.id, total).catch(() => {});
      await db.delete(media).where(eq(media.id, row.id));
      recordApiMetric(c.env, "upload.cancel", {
        userId: user.id,
        durationMs: performance.now() - cancelStart,
        bytes: total,
        status: "200",
      });
      return c.json({ ok: true as const, releasedBytes: total }, 200);
    }

    recordApiMetric(c.env, "upload.cancel", {
      userId: user.id,
      durationMs: performance.now() - cancelStart,
      bytes: 0,
      status: "200",
    });
    return c.json({ ok: true as const, releasedBytes: 0 }, 200);
  });
