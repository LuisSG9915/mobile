import { z } from "zod";
import {
  ALLOWED_EXTENSIONS,
  MAX_THUMB_BYTES,
  SYNC_STATUSES,
  TIMELINE_MAX_LIMIT,
} from "./constants";

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
  code: z.string().optional(),
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
  previewSize: z.number().int().positive().optional(),
  takenAt: z.number().int().positive(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationMs: z.number().int().positive().nullable().optional(),
  thumbhash: z.string().min(1).max(512),
  cameraMake: z.string().trim().max(100).nullable().optional(),
  cameraModel: z.string().trim().max(100).nullable().optional(),
  lensModel: z.string().trim().max(100).nullable().optional(),
  focalLength: z.number().nullable().optional(),
  fNumber: z.number().nullable().optional(),
  iso: z.number().int().nullable().optional(),
  exposureTime: z.string().trim().max(50).nullable().optional(),
  isScreenshot: z.boolean().optional(),
  isDocument: z.boolean().optional(),
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
    preview: presignedTargetSchema.optional(),
    original: presignedTargetSchema,
  }),
]);

export const uploadCompleteResponseSchema = z.object({
  id: z.string(),
  status: z.literal("ready"),
});

export const uploadCancelBodySchema = z
  .object({
    uploadId: z.string().optional(),
  })
  .optional();

export type UploadCancelInput = z.infer<typeof uploadCancelBodySchema>;

export const uploadCancelResponseSchema = z.object({
  ok: z.literal(true),
  releasedBytes: z.number().int().nonnegative(),
});

export type UploadCancelResponse = z.infer<typeof uploadCancelResponseSchema>;

// ---------- uploads multipart ----------

export const multipartInitSchema = uploadInitSchema.extend({
  /** Si se envía y coincide con la MPU guardada, se reanuda en vez de crear otra. */
  uploadId: z.string().optional(),
});

export const multipartInitResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("duplicate"), id: z.string() }),
  z.object({
    status: z.literal("upload"),
    id: z.string(),
    uploadId: z.string(),
    /** true si se reutiliza la MPU y los etags previos del cliente. */
    resumed: z.boolean().optional(),
    key: z.string(),
    partSize: z.number().int().positive(),
    totalParts: z.number().int().positive(),
    expiresAt: z.string(),
    thumb: presignedTargetSchema,
    preview: presignedTargetSchema.optional(),
  }),
]);

export const multipartPresignPartsSchema = z.object({
  id: z.string(),
  uploadId: z.string(),
  partNumbers: z.array(z.number().int().positive()).min(1).max(1000),
});

export const multipartPresignPartItemSchema = z.object({
  partNumber: z.number().int().positive(),
  url: z.string(),
});

export const multipartPresignPartsResponseSchema = z.object({
  parts: z.array(multipartPresignPartItemSchema),
});

export const multipartPartInputSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
});

export const multipartCompleteSchema = z.object({
  id: z.string(),
  uploadId: z.string(),
  parts: z.array(multipartPartInputSchema).min(1),
});

export const multipartAbortSchema = z.object({
  id: z.string(),
  uploadId: z.string(),
});

export const checkHashesRequestSchema = z.object({
  sha256: z.array(sha256Hex).min(1).max(500),
});

export const checkHashesResponseSchema = z.object({
  /** Solo los hashes que ya existen como media 'ready' del usuario. */
  existing: z.array(z.object({ sha256: sha256Hex, id: z.string() })),
});

// ---------- timeline ----------

export const timelineFilterSchema = z.enum([
  "all",
  "photos",
  "videos",
  "favorites",
  "screenshots",
  "documents",
]);

export const timelineItemSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mediaType: mediaTypeSchema,
  takenAt: z.number(),
  /** Grupo de fecha YYYY-MM-DD (UTC) para agrupar el timeline. */
  dateGroup: z.string(),
  /** Ciudad predominante derivada del GPS (opcional según el endpoint). */
  city: z.string().nullable().optional(),
  width: z.number(),
  height: z.number(),
  durationMs: z.number().nullable(),
  isFavorite: z.boolean(),
  isScreenshot: z.boolean().default(false),
  isDocument: z.boolean().default(false),
  thumbhash: z.string(),
  thumbUrl: z.string(),
  previewUrl: z.string().nullable().optional(),
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
  nextCursor: z.string().nullable(),
});

export const emptyTrashResponseSchema = z.object({
  ok: z.literal(true),
  deletedCount: z.number(),
  remainingCount: z.number().optional(),
  hasMore: z.boolean().optional(),
});

export const timelineMonthSchema = z.object({
  /** Mes YYYY-MM (UTC) derivado de date_group. */
  month: z.string(),
  count: z.number(),
});

export const timelineMonthsResponseSchema = z.object({
  months: z.array(timelineMonthSchema),
});

export const timelineQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(TIMELINE_MAX_LIMIT).default(60),
  filter: timelineFilterSchema.default("all"),
  before: z.string().optional(),
});
export type TimelineQueryInput = z.infer<typeof timelineQuerySchema>;

export const memoryGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  yearsAgo: z.number(),
  date: z.string(),
  items: z.array(timelineItemSchema),
});

export const memoriesResponseSchema = z.object({
  memories: z.array(memoryGroupSchema),
  nextCursor: z.string().nullable().optional(),
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
  cameraMake: z.string().nullable().default(null),
  cameraModel: z.string().nullable().default(null),
  lensModel: z.string().nullable().default(null),
  focalLength: z.number().nullable().default(null),
  fNumber: z.number().nullable().default(null),
  iso: z.number().nullable().default(null),
  exposureTime: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  locationName: z.string().nullable().default(null),
  caption: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  createdAt: z.number(),
  deletedAt: z.number().nullable(),
  originalUrl: z.string(),
});

export const updateMediaSchema = z.object({
  caption: z.string().trim().max(1000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
});

export const autoTagResponseSchema = z.object({
  id: z.string(),
  tags: z.array(z.string()),
});
export type AutoTagResponse = z.infer<typeof autoTagResponseSchema>;

export const autoTagBatchResponseSchema = z.object({
  processed: z.number(),
  items: z.array(autoTagResponseSchema),
});
export type AutoTagBatchResponse = z.infer<typeof autoTagBatchResponseSchema>;

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

// ---------- admin ----------

export const adminStorageRowSchema = z.object({
  userId: z.string().optional(),
  email: z.string(),
  usedBytes: z.number(),
  maxBytes: z.number(),
  mediaCount: z.number(),
  /** Porcentaje de cuota usado, 0-100 con 2 decimales. */
  usedPercent: z.number(),
});

export const adminStorageResponseSchema = z.object({
  rows: z.array(adminStorageRowSchema),
  totalUsedBytes: z.number(),
  userCount: z.number(),
});

export const adminReconcileResponseSchema = z.object({
  ok: z.boolean(),
  userId: z.string(),
  previous: z.object({
    usedBytes: z.number(),
    reservedBytes: z.number(),
  }),
  current: z.object({
    usedBytes: z.number(),
    reservedBytes: z.number(),
  }),
  reconciledAt: z.string(),
});

// ---------- álbumes ----------

export const createAlbumSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "El título no puede estar vacío")
    .max(100, "Máximo 100 caracteres"),
  mediaIds: z.array(z.string()).optional(),
});

export const updateAlbumSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  coverMediaId: z.string().nullable().optional(),
});

export const addAlbumMediaSchema = z.object({
  mediaIds: z.array(z.string()).min(1, "Debes seleccionar al menos un elemento").max(500),
});

export const albumItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  coverMediaId: z.string().nullable(),
  coverThumbUrl: z.string().nullable(),
  coverThumbhash: z.string().nullable(),
  mediaCount: z.number(),
  isShared: z.boolean(),
  shareToken: z.string().nullable(),
  shareExpiresAt: z.number().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const albumListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type AlbumListQueryInput = z.infer<typeof albumListQuerySchema>;

export const albumDetailQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(60),
});
export type AlbumDetailQueryInput = z.infer<typeof albumDetailQuerySchema>;

export const albumListResponseSchema = z.object({
  albums: z.array(albumItemSchema),
  nextCursor: z.string().nullable().optional(),
});

export const albumDetailResponseSchema = albumItemSchema.extend({
  items: z.array(timelineItemSchema),
  nextCursor: z.string().nullable().optional(),
});

export const shareAlbumRequestSchema = z.object({
  expiresIn: z.enum(["24h", "7d", "30d", "never"]).optional(),
  /** Si coincide con el enlace vigente, no se rota el token. */
  token: z.string().optional(),
  /** Permite descargar originales desde el enlace público (por defecto false). */
  allowDownload: z.boolean().optional(),
});

export const shareAlbumResponseSchema = z.object({
  shareToken: z.string(),
  shareUrl: z.string(),
  expiresAt: z.number().nullable().optional(),
  allowDownload: z.boolean(),
});

export const publicAlbumItemSchema = z.object({
  id: z.string(),
  mediaType: mediaTypeSchema,
  width: z.number(),
  height: z.number(),
  takenAt: z.number(),
  durationMs: z.number().nullable(),
  thumbhash: z.string(),
  thumbUrl: z.string(),
  /**
   * Solo si el dueño activó `allowDownload`: URL prefirmada del "original".
   * Sin ella, el visor público usa preview/original y muestra solo miniaturas.
   */
  originalUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
});

export const publicAlbumResponseSchema = z.object({
  title: z.string(),
  mediaCount: z.number(),
  createdAt: z.number(),
  expiresAt: z.number().nullable().optional(),
  allowDownload: z.boolean(),
  items: z.array(publicAlbumItemSchema),
});

// ---------- búsqueda y filtros avanzados ----------

export const searchFilterSchema = z.enum([
  "all",
  "photos",
  "videos",
  "favorites",
  "screenshots",
  "documents",
]);

// ---------- limpiador de ráfagas / fotos similares ----------

export const burstClusterSchema = z.object({
  id: z.string(),
  takenAt: z.number(),
  dateGroup: z.string(),
  items: z.array(timelineItemSchema),
});

export const cleanerBurstsResponseSchema = z.object({
  clusters: z.array(burstClusterSchema),
  totalPhotos: z.number(),
});

export const cleanerCleanupSchema = z.object({
  keepId: z.string().optional(),
  deleteIds: z.array(z.string()).min(1),
});

export const cleanerCleanupResponseSchema = z.object({
  ok: z.literal(true),
  trashedCount: z.number(),
});

export type BurstCluster = z.infer<typeof burstClusterSchema>;
export type CleanerBurstsResponse = z.infer<typeof cleanerBurstsResponseSchema>;
export type CleanerCleanupInput = z.infer<typeof cleanerCleanupSchema>;
export type CleanerCleanupResponse = z.infer<typeof cleanerCleanupResponseSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  filter: searchFilterSchema.optional().default("all"),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD")
    .optional(),
  minBytes: z.coerce.number().int().nonnegative().optional(),
  maxBytes: z.coerce.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(60),
});

export const searchResponseSchema = z.object({
  items: z.array(timelineItemSchema),
  nextCursor: z.string().nullable(),
  totalMatches: z.number().optional(),
});

export const tagCountSchema = z.object({
  tag: z.string(),
  count: z.number(),
});

export const tagsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type TagsQueryInput = z.infer<typeof tagsQuerySchema>;

export const tagsResponseSchema = z.object({
  tags: z.array(tagCountSchema),
  nextCursor: z.string().nullable().optional(),
});

// ---------- ubicaciones y mapa ----------

export const locationItemSchema = z.object({
  id: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  city: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  locationName: z.string().nullable().default(null),
  thumbUrl: z.string(),
  thumbhash: z.string(),
  mediaType: mediaTypeSchema,
  takenAt: z.number(),
  dateGroup: z.string(),
  isFavorite: z.boolean().default(false),
  caption: z.string().nullable().default(null),
});

export const locationsQuerySchema = z.object({
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
  city: z.string().trim().optional(),
  filter: searchFilterSchema.optional().default("all"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200),
});

export const locationsResponseSchema = z.object({
  items: z.array(locationItemSchema),
  totalWithGps: z.number().optional(),
  nextCursor: z.string().nullable().optional(),
});

export const placeItemSchema = z.object({
  city: z.string(),
  country: z.string(),
  locationName: z.string(),
  count: z.number(),
  thumbUrl: z.string().nullable(),
  thumbhash: z.string().nullable(),
});

export const placesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type PlacesQueryInput = z.infer<typeof placesQuerySchema>;

export const placesResponseSchema = z.object({
  places: z.array(placeItemSchema),
  nextCursor: z.string().nullable().optional(),
});

export type PlaceItem = z.infer<typeof placeItemSchema>;
export type PlacesResponse = z.infer<typeof placesResponseSchema>;

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
export type MemoryGroup = z.infer<typeof memoryGroupSchema>;
export type MemoriesResponse = z.infer<typeof memoriesResponseSchema>;
export type FavoriteResponse = z.infer<typeof favoriteResponseSchema>;
export type TrashItem = z.infer<typeof trashItemSchema>;
export type TrashResponse = z.infer<typeof trashResponseSchema>;
export type EmptyTrashResponse = z.infer<typeof emptyTrashResponseSchema>;
export type MediaDetail = z.infer<typeof mediaDetailSchema>;
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;
export type Stats = z.infer<typeof statsSchema>;
export type StorageResponse = z.infer<typeof storageResponseSchema>;
export type DownloadResponse = z.infer<typeof downloadResponseSchema>;
export type AdminStorageRow = z.infer<typeof adminStorageRowSchema>;
export type AdminStorageResponse = z.infer<typeof adminStorageResponseSchema>;
export type AdminReconcileResponse = z.infer<typeof adminReconcileResponseSchema>;
export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;
export type AddAlbumMediaInput = z.infer<typeof addAlbumMediaSchema>;
export type AlbumItem = z.infer<typeof albumItemSchema>;
export type AlbumListResponse = z.infer<typeof albumListResponseSchema>;
export type AlbumDetailResponse = z.infer<typeof albumDetailResponseSchema>;
export type ShareAlbumResponse = z.infer<typeof shareAlbumResponseSchema>;
export type PublicAlbumItem = z.infer<typeof publicAlbumItemSchema>;
export type PublicAlbumResponse = z.infer<typeof publicAlbumResponseSchema>;
export type SearchFilter = z.infer<typeof searchFilterSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type TagCount = z.infer<typeof tagCountSchema>;
export type TagsResponse = z.infer<typeof tagsResponseSchema>;
export type LocationItem = z.infer<typeof locationItemSchema>;
export type LocationsQuery = z.infer<typeof locationsQuerySchema>;
export type LocationsResponse = z.infer<typeof locationsResponseSchema>;
export type ApiError = z.infer<typeof errorSchema>;
export type MultipartInitInput = z.infer<typeof multipartInitSchema>;
export type MultipartInitResponse = z.infer<typeof multipartInitResponseSchema>;
export type MultipartPresignPartsInput = z.infer<typeof multipartPresignPartsSchema>;
export type MultipartPresignPartsResponse = z.infer<typeof multipartPresignPartsResponseSchema>;
export type MultipartPartInput = z.infer<typeof multipartPartInputSchema>;
export type MultipartCompleteInput = z.infer<typeof multipartCompleteSchema>;
export type MultipartAbortInput = z.infer<typeof multipartAbortSchema>;
export type ShareAlbumRequest = z.infer<typeof shareAlbumRequestSchema>;

// ---------- gestión de sesiones, exportación y borrado de cuenta ----------

export const userSessionItemSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  isCurrent: z.boolean(),
});

export const userSessionsResponseSchema = z.object({
  sessions: z.array(userSessionItemSchema),
});

export const userExportMediaItemSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  mediaType: mediaTypeSchema,
  takenAt: z.number(),
  width: z.number(),
  height: z.number(),
  fileSize: z.number(),
  caption: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  downloadUrl: z.string(),
});

export const userExportAlbumItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  mediaIds: z.array(z.string()),
});

export const userExportResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    createdAt: z.number(),
  }),
  exportedAt: z.string(),
  mediaCount: z.number(),
  media: z.array(userExportMediaItemSchema),
  albums: z.array(userExportAlbumItemSchema),
});

export const userAccountDeleteResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});

export type UserSessionItem = z.infer<typeof userSessionItemSchema>;
export type UserSessionsResponse = z.infer<typeof userSessionsResponseSchema>;
export type UserExportMediaItem = z.infer<typeof userExportMediaItemSchema>;
export type UserExportAlbumItem = z.infer<typeof userExportAlbumItemSchema>;
export type UserExportResponse = z.infer<typeof userExportResponseSchema>;
export type UserAccountDeleteResponse = z.infer<typeof userAccountDeleteResponseSchema>;
