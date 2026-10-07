import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------- Better Auth ----------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ---------- Media ----------

export const media = sqliteTable(
  "media",
  {
    id: text("id").primaryKey(), // crypto.randomUUID()
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(), // hex en minúsculas
    mediaType: text("media_type", { enum: ["photo", "video"] }).notNull(),
    mimeType: text("mime_type").notNull(),
    ext: text("ext").notNull(),
    takenAt: integer("taken_at").notNull(), // epoch ms
    // YYYY-MM-DD en UTC derivado de taken_at. El default '' solo existe para
    // permitir el ALTER TABLE sobre filas previas; la app siempre lo escribe.
    dateGroup: text("date_group").notNull().default(""),
    latitude: real("latitude"),
    longitude: real("longitude"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    durationMs: integer("duration_ms"),
    thumbhash: text("thumbhash").notNull(), // base64
    r2KeyOriginal: text("r2_key_original").notNull(),
    r2KeyThumb: text("r2_key_thumb").notNull(),
    fileSize: integer("file_size").notNull(),
    thumbSize: integer("thumb_size").notNull(),
    status: text("status", { enum: ["pending", "ready"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("media_user_sha").on(t.userId, t.sha256),
    index("media_timeline").on(t.userId, t.status, t.deletedAt, t.takenAt, t.id),
    index("idx_media_date_group").on(t.userId, t.dateGroup),
    index("media_status_created").on(t.status, t.createdAt),
    index("media_deleted").on(t.deletedAt),
  ],
);

// ---------- Cuota de almacenamiento ----------

/**
 * Contadores materializados de uso de R2 por usuario. Se actualizan de forma
 * atómica (upsert en /uploads/complete, decremento al purgar la papelera) para
 * responder la cuota en O(1) sin SUM() sobre media. usedBytes incluye original
 * + miniatura y los elementos en papelera (siguen ocupando R2 hasta la purga).
 */
export const userStorageStats = sqliteTable("user_storage_stats", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  usedBytes: integer("used_bytes").notNull().default(0),
  maxBytes: integer("max_bytes").notNull().default(10_737_418_240), // 10 GB
  mediaCount: integer("media_count").notNull().default(0),
  updatedAt: integer("updated_at").notNull(), // epoch ms
});
