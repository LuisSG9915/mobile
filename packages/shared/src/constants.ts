export const ALLOWED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "heic",
  "heif",
  "gif",
  "mp4",
  "mov",
  "m4v",
] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const MIME_BY_EXT: Record<AllowedExtension, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

export const VIDEO_EXTENSIONS: readonly string[] = ["mp4", "mov", "m4v"];

/** Tamaño máximo de la miniatura (50 KB) */
export const MAX_THUMB_BYTES = 50 * 1024;
/** Lado mayor de la miniatura en px */
export const THUMB_MAX_DIMENSION = 400;
/** TTL de las URLs prefirmadas de subida (15 min) */
export const PRESIGN_PUT_TTL_SECONDS = 900;
/** Ventana de redondeo para URLs de lectura cacheables (6 h) */
export const PRESIGN_GET_WINDOW_SECONDS = 6 * 3600;
/** TTL efectivo de las URLs prefirmadas de lectura (12 h) */
export const PRESIGN_GET_TTL_SECONDS = 12 * 3600;
/** Máximo de items por página del timeline */
export const TIMELINE_MAX_LIMIT = 200;
/** Días que un elemento permanece en la papelera */
export const TRASH_RETENTION_DAYS = 30;
