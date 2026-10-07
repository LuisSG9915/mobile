import { z } from "zod";
import { ALLOWED_EXTENSIONS, MAX_THUMB_BYTES, SYNC_STATUSES } from "./constants";

export const sha256Hex = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "SHA-256 inválido (se espera hex en minúsculas)");

export const mediaTypeSchema = z.enum(["photo", "video"]);

export const syncStatusSchema = z.enum(SYNC_STATUSES);

export const extSchema = z
  .string()
  .toLowerCase()
  .refine((e) => (ALLOWED_EXTENSIONS as readonly string[]).includes(e), {
    message: "Extensión no permitida",
  });

export const errorSchema = z.object({
  error: z.string(),
  message: z.string(),
});

// ---------- uploads ----------

export const uploadInitSchema = z.object({
  sha256: sha256Hex,
  mediaType: mediaTypeSchema,
  mimeType: z.string().min(1),
  ext: extSchema,
  fileSize: z.number().int().positive(),
  thumbSize: z
    .number()
    .int()
    .positive()
    .max(MAX_THUMB_BYTES, "La miniatura no puede pesar más de 50 KB"),
  takenAt: z.number().int().positive(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable().optional(),
  thumbhash: z.string().min(1).max(512),
});

export const presignedTargetSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()),
});

export const uploadInitResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("duplicate"), id: z.string() }),
  z.object({
    status: z.literal("upload"),
    id: z.string(),
    expiresAt: z.string(),
    thumb: presignedTargetSchema,
    original: presignedTargetSchema,
  }),
]);

export const uploadCompleteResponseSchema = z.object({
  id: z.string(),
  status: z.literal("ready"),
});

export const checkHashesRequestSchema = z.object({
  sha256: z.array(sha256Hex).min(1).max(500),
});

export const checkHashesResponseSchema = z.object({
  /** Solo los hashes que ya existen como media 'ready' del usuario. */
  existing: z.array(z.object({ sha256: sha256Hex, id: z.string() })),
});

// ---------- timeline ----------

export const timelineFilterSchema = z.enum(["all", "photos", "videos", "favorites"]);

export const timelineItemSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mediaType: mediaTypeSchema,
  takenAt: z.number(),
  /** Grupo de fecha YYYY-MM-DD (UTC) para agrupar el timeline. */
  dateGroup: z.string(),
  width: z.number(),
  height: z.number(),
  durationMs: z.number().nullable(),
  isFavorite: z.boolean(),
  thumbhash: z.string(),
  thumbUrl: z.string(),
});

export const timelineResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: z.string().nullable(),
});

export const trashItemSchema = timelineItemSchema.extend({
  /** Ms epoch del borrado suave; la UI calcula los días que quedan para la purga. */
  deletedAt: z.number(),
});

export const trashResponseSchema = z.object({
  items: z.array(trashItemSchema),
  nextCursor: z.null(),
});

export const timelineMonthSchema = z.object({
  /** Mes YYYY-MM (UTC) derivado de date_group. */
  month: z.string(),
  count: z.number(),
});

export const timelineMonthsResponseSchema = z.object({
  months: z.array(timelineMonthSchema),
});

export const favoriteResponseSchema = z.object({
  id: z.string(),
  isFavorite: z.boolean(),
});

// ---------- media ----------

export const mediaDetailSchema = timelineItemSchema.extend({
  mimeType: z.string(),
  ext: z.string(),
  fileSize: z.number(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  createdAt: z.number(),
  deletedAt: z.number().nullable(),
  originalUrl: z.string(),
});

export const statsSchema = z.object({
  count: z.number(),
  totalBytes: z.number(),
  lastUploadAt: z.number().nullable(),
  quotaBytes: z.number(),
});

// ---------- user ----------

export const storageResponseSchema = z.object({
  /** Bytes en R2 (originales + miniaturas), incluye la papelera. */
  usedBytes: z.number(),
  maxBytes: z.number(),
  mediaCount: z.number(),
  /** Porcentaje de cuota usado, 0-100 con 2 decimales. */
  usedPercent: z.number(),
});

export const downloadResponseSchema = z.object({
  /** URL prefirmada GET con Content-Disposition: attachment. */
  url: z.string(),
  filename: z.string(),
});

export const okSchema = z.object({ ok: z.literal(true) });

// ---------- tipos ----------

export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type UploadInitInput = z.infer<typeof uploadInitSchema>;
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>;
export type CheckHashesRequest = z.infer<typeof checkHashesRequestSchema>;
export type CheckHashesResponse = z.infer<typeof checkHashesResponseSchema>;
export type TimelineFilter = z.infer<typeof timelineFilterSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
export type TimelineMonth = z.infer<typeof timelineMonthSchema>;
export type TimelineMonthsResponse = z.infer<typeof timelineMonthsResponseSchema>;
export type FavoriteResponse = z.infer<typeof favoriteResponseSchema>;
export type TrashItem = z.infer<typeof trashItemSchema>;
export type TrashResponse = z.infer<typeof trashResponseSchema>;
export type MediaDetail = z.infer<typeof mediaDetailSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type StorageResponse = z.infer<typeof storageResponseSchema>;
export type DownloadResponse = z.infer<typeof downloadResponseSchema>;
export type ApiError = z.infer<typeof errorSchema>;
