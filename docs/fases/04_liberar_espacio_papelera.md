# Fase 4: Liberar Espacio y Papelera con Purga a 30 Días

## 🎯 Objetivo

Permitir al usuario recuperar almacenamiento local de las fotos ya respaldadas en la nube, y darle una **papelera** donde los elementos eliminados sobreviven 30 días antes de la purga definitiva que libera la cuota en R2.

## 📂 Archivos a Modificar / Crear

1. `apps/mobile/src/lib/free-space.ts` y `free-space.web.ts`
2. `apps/mobile/src/app/(tabs)/settings.tsx`
3. `apps/mobile/src/app/trash.tsx`
4. `apps/mobile/src/lib/use-hybrid-gallery.ts`
5. `apps/api/src/routes/media.ts` (`DELETE /media/{id}`, `POST /media/{id}/restore`, `GET /trash`)
6. `apps/api/src/cron/cleanup.ts`
7. `apps/api/src/lib/storage-stats.ts`
8. `packages/shared/src/constants.ts` (`TRASH_RETENTION_DAYS = 30`) y `schemas.ts` (`TrashItem`, `trashResponseSchema`)

## 🛠️ Especificaciones Técnicas

### 1. Algoritmo en `free-space.ts`

1. Listar activos locales mediante `MediaLibrary.getAssetsAsync`.
2. Para cada archivo local, consultar su estado en la base de datos local de sincronización.
3. Filtrar aquellos donde `status === 'synced'` y el `sha256` exista confirmado en la nube.
4. Sumar el tamaño de dichos archivos (`recoverableBytes`).
5. `executeFreeUpSpace()`:
   - Llamar `MediaLibrary.deleteAssetsAsync(assetIds)`.
   - Marcar el registro local como `remote_only: true`: la galería no lo borra del timeline, pasa a pedir la miniatura a R2/CDN.
   - En web (`free-space.web.ts`): no-op informativo (el navegador no administra el carrete).

### 2. Interfaz en `settings.tsx`

- Card destacada **Liberar espacio del teléfono**.
- Texto: *"Tienes {formatBytes(recoverableBytes)} respaldados en la nube que puedes borrar de tu teléfono de forma segura."*
- Botón `Liberar espacio` con diálogo de confirmación nativo antes de ejecutar.

### 3. Papelera (soft-delete + restore + purga)

- `DELETE /v1/media/{id}` hace **soft-delete**: `deletedAt = now()`. El timeline filtra con `isNull(media.deletedAt)`; la cuota **no** se descuenta (el objeto sigue ocupando R2).
- `GET /v1/trash` devuelve los elementos en papelera ordenados por `deletedAt` desc; la pantalla `trash.tsx` muestra los días restantes (`TRASH_RETENTION_DAYS - días transcurridos`, mínimo 1).
- `POST /v1/media/{id}/restore` pone `deletedAt = null` y el elemento reaparece en el timeline.
- Purga definitiva en el cron `runCleanup` (`apps/api/src/cron/cleanup.ts`):
  - Borra objetos R2 (`r2KeyOriginal` + `r2KeyThumb`, en lotes de 1000) y la fila cuando `deletedAt > TRASH_TTL_MS` (30 días).
  - Decrementa `userStorageStats` con `removeStorageUsage` **solo** para `status === 'ready'` (los `pending` nunca sumaron cuota).
  - El mismo cron purga registros `pending` con más de 24 h (subidas abandonadas).

## 🧪 Verificación Local

- `free-space.test.ts`: lista de 5 assets (3 sincronizados, 2 pendientes) → solo los 3 sincronizados se envían a eliminación.
- Tests API con Miniflare: `delete → trash → restore` y que `usedBytes` **no** baje al tirar a papelera pero sí tras la purga del cron.
