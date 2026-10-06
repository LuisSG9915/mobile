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

export const timelineItemSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mediaType: mediaTypeSchema,
  takenAt: z.number(),
  width: z.number(),
  height: z.number(),
  durationMs: z.number().nullable(),
  thumbhash: z.string(),
  thumbUrl: z.string(),
});

export const timelineResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: z.string().nullable(),
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
});

export const okSchema = z.object({ ok: z.literal(true) });

// ---------- tipos ----------

export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type UploadInitInput = z.infer<typeof uploadInitSchema>;
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>;
export type CheckHashesRequest = z.infer<typeof checkHashesRequestSchema>;
export type CheckHashesResponse = z.infer<typeof checkHashesResponseSchema>;
export type TimelineItem = z.infer<typeof timelineItemSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
export type MediaDetail = z.infer<typeof mediaDetailSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type ApiError = z.infer<typeof errorSchema>;
