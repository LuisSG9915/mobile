# Diseño F2 (Restaurar) y F3 (Verificar biblioteca)

Origen: [PROPUESTA_PRODUCTO §5.A](../PROPUESTA_PRODUCTO_2026-11.md) y [PLAN_PULIDO](../PLAN_PULIDO_2026-11.md).
Informe del arquitecto; lo marcado **sin verificar** no se leyó en el código y se comprueba antes de implementar.
Recomendación: **F3 primero** (cierra P-07: hoy `verifyRemoteIntegrity` no toca R2).

## Qué se reutiliza
- `GET /v1/media/{id}/download` (`routes/media.ts`) → URL prefirmada por ítem; pedirla en cada intento, no guardarla (expira).
- Patrón HEAD + tamaño (`size_mismatch`, `routes/uploads.ts`) y `sweepOrphanObjects` (`cron/cleanup.ts`, `BUCKET.list` de 1000 con cursor).
- `mapInChunks` / `IN_ARRAY_CHUNK=50` (`api/src/lib/slices.ts`).
- Móvil: `lib/save-download.ts` (descarga a caché → MediaStore), `queue/hash.ts` `sha256File`, `hasLocalCopySync`, `getLocalAssetIdsByRemoteIds`.
- No sirve: `GET /v1/user/export` firma todo en un `Promise.all` sin paginar; `check-hashes` solo consulta D1.

## F3 — Verificar mi biblioteca
**API** (`apps/api/src/routes/integrity.ts`, montar en `index.ts`):
- `POST /v1/user/integrity/scan {cursor?, mode:"full"|"sample"}`: 1 `BUCKET.list({prefix:"users/{uid}/originals/", limit:1000, cursor})` + consulta D1 por rango de `r2_key_original` (sin `IN`). Cruza en memoria: falta en R2, tamaño distinto, sobrante. `sample` = ~40 `BUCKET.head`.
- `GET /v1/user/integrity` → último informe `{checkedAt,total,missing[],sizeMismatch[],bytes}`, guardado en `system_state` (`integrity_{uid}`).
- Esquemas zod en `packages/shared`.

**Móvil:** `app/integrity.tsx` + Card en Ajustes ("Última verificación hace X"). Barra por páginas; resultado "Todo en orden" o lista. "Re-subir desde este teléfono" si hay copia local.

## F2 — Restaurar en este teléfono (solo nativo; web ya tiene ZIP)
**API:** `GET /v1/media/manifest?cursor&limit<=200&year?&albumId?` con cursor `(taken_at,id)` como `/timeline`. Devuelve `{id,sha256,fileSize,ext,mediaType,takenAt}` sin URLs.

**Móvil:**
- `restore/plan.ts` (lógica pura: dedupe por sha, espacio, estados), `restore/store.ts`, `restore/processor.ts`, `app/restore.tsx`.
- Tabla hermana `restore_queue(user_id, remote_id PK, sha256, file_size, state, attempts, last_error, next_retry_at, local_asset_id, updated_at)`. **Desviación de la propuesta** ("misma tabla"): la PK de `queue` es `(user_id, asset_id)`, `uri` es NOT NULL y varias funciones (`getNextPending`, `getQueueStats`, `pruneQueueExcept`, `recoverInterrupted`, `retryFailed`) tomarían esas filas.
- Al terminar cada descarga, insertar en `queue` una fila `duplicate` con `remote_id` y `sha256` para que el scanner no re-suba. Requiere el id del asset (`createAssetAsync`; **sin verificar** en Expo 57).

**Flujo:** 1) alcance (todo / año / álbum), 2) resumen (N, tamaño, espacio libre, "Solo Wi-Fi" por defecto), 3) progreso con Pausar/Reanudar y fallidos con Reintentar.
- Estados por ítem: `queued`, `downloading`, `verifying`, `done`, `skipped_local`, `failed`, `corrupt`.
- Estados globales: `paused_user`, `paused_network`, `paused_disk` (libre < 2×`fileSize` + margen), `done`.
- Cada ítem: descargar a temporal → `sha256File` → si no coincide 1 reintento, luego `corrupt` → guardar y borrar temporal. Reanudar reinicia el archivo (rango de bytes fuera del MVP).
- Teléfono nuevo: la cola está vacía; decidir entre escanear/hashear la galería antes de planificar o aceptar duplicados en el MVP.

## Límites
- D1: 100 parámetros (rango de claves o `mapInChunks`); consultas/subrequests por invocación según plan Workers (**sin verificar**): 1 list + 1–2 queries + 1 upsert por request.
- Android: MediaStore vía `MediaLibrary`, sin SAF. API de espacio libre en `expo-file-system` (**sin verificar**: `Paths.availableDiskSpace` o similar). Segundo plano fuera del MVP.
- **Sin verificar:** esquema `album_media`, índice sobre `r2_key_original`.

## Tests
- API `integrity.test.ts`: >100 filas, original borrado → faltante, tamaño alterado, cursor multipágina, aislamiento entre usuarios, papelera excluida. `manifest.test.ts`: paginación estable, filtros, sin URLs.
- Móvil `restore/plan.test.ts`: dedupe, `paused_disk`, transiciones, reanudar tras matar la app sin duplicar, hash distinto → `corrupt`.
- Manual Android: restaurar 100 fotos en dispositivo limpio.
- Nota: los tests de la API no corren en este Mac (`workerd` sin binario; `node_modules` de Windows).

## Orden (commits pequeños)
1. `feat(shared)` esquemas integrity/manifest.
2. `feat(api)` scan + informe, con tests.
3. `feat(mobile)` `integrity.tsx` + Card en Ajustes.
4. `fix(mobile)` "Liberar espacio" usa F3 en muestreo antes de borrar (cierra P-07).
5. `feat(api)` manifest con tests.
6. `feat(mobile)` `restore/plan.ts` + tests.
7. `feat(mobile)` `restore_queue` + store.
8. `feat(mobile)` processor (descarga, sha, `createAssetAsync`, fila `duplicate`).
9. `feat(mobile)` wizard `restore.tsx` + Card + textos en `es.ts`.
10. Drill manual y entrada en `docs/testing/PLAN_PRUEBAS.md`.

## Estado y límites conocidos (2026-11-24)
- F3 desplegada y verificada en producción ("Todo en orden"). F2 probada en el LMR-L29: descarga, verificación de hash y guardado en `DCIM/` funcionan; pausa/reanuda también.
- **Fecha de captura:** los archivos se guardan como `restore-<sha16>.<ext>`. Las fotos sin EXIF quedan con `datetaken` vacío y la galería puede mostrarlas con la fecha de hoy; los videos y fotos con EXIF conservan la suya.
- `setDateTaken` (Kotlin, `upload-foreground`) existe pero `ContentResolver.update` devuelve 0 filas en Android 12 incluso para filas propias; **no tiene efecto**. Causa sin investigar. Alternativas: capturar la excepción y probar solo `DATE_TAKEN`, o fijar el mtime del archivo antes de `createAssetAsync` (ambas exigen recompilar el dev-client).
- Restauración solo en primer plano. Sin filtro por álbum en la pantalla (la API sí lo admite).
