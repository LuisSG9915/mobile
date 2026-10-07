# Fase 1: Optimización D1, Deduplicación SHA-256 y Cuotas

## 🎯 Objetivo
Prevenir lecturas masivas en D1 al cargar el timeline, evitar subir duplicados a R2 y registrar cuotas de almacenamiento de forma atómica.

## 📂 Archivos a Modificar / Crear
1. `apps/api/src/db/schema.ts`
2. `packages/shared/src/schemas.ts`
3. `apps/api/src/routes/uploads.ts`
4. `apps/api/src/routes/user.ts` (o ruta equivalente de perfil)
5. `apps/api/test/uploads.test.ts`

## 🛠️ Especificaciones Técnicas

### 1. Modificaciones en `apps/api/src/db/schema.ts`
- Agregar a la tabla `media`:
  - `dateGroup`: `text('date_group').notNull()` (formato `YYYY-MM-DD`).
  - `thumbhash`: `text('thumbhash')` (cadena nullable de hasta 64 chars).
  - `sha256`: `text('sha256').notNull()`.
- Agregar índices:
  - `uniqueIndex('idx_media_user_sha256').on(table.userId, table.sha256)`
  - `index('idx_media_date_group').on(table.userId, table.dateGroup)`
- Crear la tabla `userStorageStats`:
  ```typescript
  export const userStorageStats = sqliteTable('user_storage_stats', {
    userId: text('user_id').primaryKey(),
    usedBytes: integer('used_bytes').default(0).notNull(),
    maxBytes: integer('max_bytes').default(10737418240).notNull(), // 10 GB
    mediaCount: integer('media_count').default(0).notNull(),
    updatedAt: integer('updated_at').notNull(),
  });