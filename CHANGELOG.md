# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
[SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Añadido
- Salto temporal con alcance visible: chip «Desde <mes> · N elementos» con **Ver todas**, modal con el mes activo
  resaltado y entrada «Volver a todas las fotos». El visor conserva el alcance (`before`) al abrir una foto desde
  un mes antiguo, así que el carrusel incluye la foto pulsada.
- `POST /v1/media/presign-batch` con `presignBatchRequestSchema`/`presignBatchResponseSchema` y
  `PRESIGN_BATCH_MAX_KEYS` en `@photos/shared`. Timeline, recuerdos, papelera y álbum paginado firman sus
  miniaturas en un lote en vez de un `presignGet` por elemento. Test unitario en `apps/api/test/presign-batch.test.ts`.
- E2E `jump-month`: siembra fotos con `File.lastModified` mediante el evento `drop`, crea meses fuera de la
  primera página y verifica que saltar a ellos pinta celdas (nunca la cuadrícula en negro).
- APK de release **sin EAS**: el plan gratuito se agotó (causa real de `v1.0.9`/`v1.1.0` sin binario), así que
  `release-apk.yml` compila con `expo prebuild` + `gradlew assembleRelease` en el runner. `scripts/android-prepare.mjs`
  inyecta la firma (`signingConfigs.release`, keystore desde `ANDROID_KEYSTORE_BASE64`) y `versionCode`/`versionName`
  derivados del tag en el `android/` que genera prebuild; las reglas viven en `scripts/lib/android-release.mjs` con 10
  tests. APK compilado en local y verificado (`versionCode=10100`, `versionName=1.1.0`, firmante propio, targetSdk 36).
- Compuerta de release (`pnpm release:check`): el preflight ya no se cree a sí mismo. Las reglas viven en
  `scripts/lib/release-audit.mjs` con 15 tests en `pnpm test:pipeline` y cubren tag SemVer inédito, árbol
  limpio, sección `## [X.Y.Z]` fechada con notas, `[Unreleased]` vacía, tag anotado que apunta a HEAD,
  `APP_VERSION`/`GIT_SHA` en el deploy, disparo del APK con `v*` y migraciones con su `.sql`. Nuevos flags
  `--json` y `--allow-existing`; runbook en [RELEASE.md](docs/ops/RELEASE.md).
- `pnpm check:board`: el tablero se audita solo (`scripts/check-board.mjs` sobre
  `scripts/lib/board-audit.mjs`). Falla si una fila con estado no enlaza su evidencia, si un enlace
  apunta a un archivo inexistente, si una fila `done` lleva trabajo abierto dentro, si una fila
  `in_progress` no declara qué le falta, si un hallazgo «Resuelto» no trae artefacto o si
  `docs/decisions.md` vuelve a guardar un `- [ ]`. Corre en CI y en `pnpm test:all`; 11 tests en
  `pnpm test:pipeline`, uno de ellos contra el tablero real.

### Corregido
- **Tramo 1 (pulido de honestidad)**:
  - P-01: se oculta el enlace público rápido del visor por no existir token real en el backend.
  - P-02: paridad del editor de imagen (`aspectRatioValue` compartido, soporte de 9:16 en web y encolado automático de la edición en nativo).
  - P-03: paginación por cursor en la papelera con `useInfiniteQuery`.
  - P-04: inclusión de `basemaps.cartocdn.com` en el CSP de la web para renderizar teselas del mapa.
  - P-09/P-10/P-11: externalización de textos a `es.ts`, estado accesible (`accessibilityState`) en `Button` y celdas de galería, y eliminación del permiso huérfano `FOREGROUND_SERVICE_DATA_SYNC` en `app.json` (versión 1.1.0).
- El salto de mes solo acotaba los remotos: los assets locales y los pendientes de la cola se colaban en el mes
  elegido (chip «Desde octubre de 2023» con fotos de hoy arriba). `filterToBefore` acota toda la galería híbrida
  al alcance `before`, con 3 tests en `gallery.test.ts`.
- **Galería en negro al saltar de mes**: FlashList 2.0.2 conservaba el offset de la lista anterior al sustituir
  `data` y solo pintaba el header sticky. Ahora la lista se mantiene montada bajo el overlay mientras carga el
  mes y se remonta **solo cuando sus filas ya están disponibles**; `keyExtractor`/`getItemType`/
  `overrideItemLayout`/`renderItem` son estables. Se elimina el `scrollToTop` que llegaba antes de medir.
- El visor abría una foto de un mes antiguo sin carrusel (`foundIndex = -1`) porque consultaba la primera página
  del timeline: el alcance `before` viaja ahora como param y reutiliza la query cacheada.
- El selector de meses no veía un mes nuevo hasta que expiraba su `staleTime`: las subidas completadas
  invalidan `timeline-months` en nativo y web.
- Las pantallas de Respaldo y Ajustes leían la cola en SQLite (`getQueueStats`, `getFailed`, `getSyncedLocal`)
  en cada render, incluidos los ticks de bytes. Ahora se memorizan por tick throttleado; se eliminó la doble
  suscripción de `useSyncProgressAuto` y el banner usa el tick throttleado.
- El comparador de `PhotoCell` dependía de la URL prefirmada completa: al rodar la ventana de 6 h se
  re-renderizaba toda la cuadrícula. Compara solo la presencia de miniatura remota.
- Abrir el visor repetía el escaneo completo de MediaLibrary (hasta 20 000 assets): el listado se reutiliza
  durante 60 s si `libTick` no cambió.
- El build de Gradle fallaba **al final** si `SENTRY_ORG`/`SENTRY_PROJECT` faltaban (tarea
  `:app:createBundleReleaseJsAndAssets_SentryUpload_*`), con un error que parecía de red. El workflow los pasa
  como variables y desactiva la subida (`SENTRY_DISABLE_AUTO_UPLOAD`) cuando no hay `SENTRY_AUTH_TOKEN`.
- El workflow de release ya no puede terminar en verde sin binario: corre el preflight antes del build, hace
  visible el error de EAS (`set -o pipefail` + últimas 40 líneas, subidas como artifact), descarga el APK con
  `curl -f` y comprueba su firma ZIP (un 404 de R2 adjuntaba un HTML de 200 bytes como APK), actualiza la release
  si ya existía (`--clobber`) y falla si el activo publicado no trae `.apk`. Así es como `v1.0.9` y `v1.1.0`
  acabaron etiquetadas y sin APK.
- `scripts/backup-r2.mjs` ya no reporta éxito con errores dentro: cualquier objeto fallido o un listado
  vacío termina en `exit 1` con las claves afectadas listadas, y el archivo a medias se descarta para
  no envenenar el incremental del día siguiente. La regla vive en `scripts/lib/backup-r2-result.mjs`
  con 6 tests en `pnpm test:pipeline`.
- Un vídeo grande ya no se queda atascado para siempre cuando su sesión multipart deja de existir en
  R2 (lifecycle a 7 días, cierre desde otro dispositivo o fila que apunta a otra sesión): un 404 en
  una parte o un 409 al presignar descartan el journal con `clearMultipartState` y reabren **una**
  sesión limpia — en nativo (`apps/mobile/src/queue/processor.ts`) y web
  (`apps/mobile/src/queue/processor.web.ts`). Antes se reintentaba la misma sesión muerta sin fin.
- La subida web de partes exige el `ETag` de R2 (`apps/mobile/src/web/upload.ts`): inventarlo
  producía un finalize rechazado con `parts_mismatch` y la pérdida de la fila de metadata.

### Cambiado
- El respaldo del catálogo D1 vive en un bucket **separado** (`photos-backups`, no `photos-media`):
  un borrado, un token filtrado o un lifecycle mal escrito ya no se lleva fotos y catálogo a la vez.
  El workflow aborta si `BACKUP_BUCKET` apunta al bucket de producción (paso *Guard*).
- `scripts/backup-r2.mjs` verifica la muestra de R2 semanalmente en CI
  (`.github/workflows/backup-r2-verify.yml`), sin descargar el bucket completo.
- Subida de partes multipart sin base64: `apps/mobile/src/queue/upload-part.ts` corta el rango con
  `File.slice()` y lo sube como `ArrayBuffer` con XHR, reportando progreso por byte. Antes cada parte
  de 5 MiB se leía a base64 (+33 %), se reescribía a caché y se subía con `uploadAsync` sin progreso:
  ~1,4 GB de strings y dos copias por byte en un vídeo de 1 GB.
- Partes multipart de 16 MiB (antes 5 MiB) subidas de 3 en 3 y prefirmadas de 12 en 12: un vídeo de
  200 MB pasa de 40 a 13 partes y un 1 GB de 205 a 64, sin URLs firmadas esperando turno hasta
  caducar (TTL 900 s). Los etags se envían ordenados y el progreso suma lo confirmado más lo que
  lleva cada parte en vuelo, sin doble conteo.
- La tarjeta de respaldo muestra velocidad real y tiempo restante (`1,2 MB/s · quedan 3:41`), con una
  ventana móvil de 8 s dentro de `computeSyncProgress` (`apps/mobile/src/queue/progress.ts`): sin
  archivos nuevos, en pausa no inventa velocidad, y si el contador retrocede la ventana se reinicia.

### Pendiente para cierre total de H1
- Etiquetado de release `v1.1.0` en git y generación de APK EAS (`eas build --platform android --profile preview`).
- Ejecución remota del Restore Drill (`docs/ops/RESTORE_DRILL.md`) con credenciales y firma de tiempos.
- Verificación con dominio real en Resend (`RESEND_API_KEY`) y headers en producción.
- E2E multipart-resume con R2 dev cuando se configure `apps/api/.dev.vars`.

## [1.1.0] - 2026-10-24

### Añadido
- Helper `apps/mobile/src/auth/verification.ts` y soporte para `callbackURL` dinámico web (`${origin}/welcome`) y deep link nativo (`photos:///welcome` con `expo-linking`), integrado en `register.tsx`, `backup.tsx` y cubierto en tests de API y Mobile.
- Procedimiento formal de simulacro de recuperación en `docs/ops/RESTORE_DRILL.md` con RPO 24 h / RTO 4 h y consultas de validación en instancia aislada `photos-db-restore`.
- Runner de validación `scripts/gemini-gate.mjs` con modalidades rápida (`--quick`), completa y E2E (`--e2e`).
- Migraciones `0013_public_shriek.sql` (`media.upload_id`) y `0014_robust_patch.sql`
  (`album.share_allow_download`).
- Heartbeat del cron en `system_state.cron_last_run` y workflow `cron-heartbeat.yml` (>26 h o
  `ok=false` → falla y GitHub avisa).
- SLOs (`docs/ops/SLO.md`), runbooks (`docs/ops/INCIDENT_RESPONSE.md`), plantilla de issues y
  `docs/README.md`.
- Spec E2E `apps/mobile/e2e/multipart-resume.spec.ts` (21 MB, corte en presign-parts, recarga,
  `resumed: true`).
- Cabeceras de seguridad de la web (`apps/mobile/public/_headers`: CSP, HSTS, X-Frame-Options,
  Referrer-Policy, Permissions-Policy).
- Endpoint `POST /v1/uploads/multipart/finalize` (antes `.../complete`, oculto por la colisión
  con `/uploads/{id}/complete`): valida partes, tamaño y MIME y limpia objetos/reserva si falla.
- `uploadId` opcional en `/multipart/init`: reanuda la MPU existente (`resumed: true`).
- Tests de reanudación, re-init con tamaño distinto, `size_mismatch` y `mime_mismatch`.

### Cambiado
- El procesador nativo usa `multipartComplete`; el ETag de R2 es obligatorio.
- Re-init de una subida `pending` con otro tamaño → **409** (antes ampliaba la reserva).
- Docs: Plan v2 (`docs/PLAN_MEJORAS.md`), `ROADMAP` y `PLAN_GENERAL` quedan como histórico.

### Release y rollback (H1.4)
- `GET /version` devuelve `version`, `commit` y hora; el deploy inyecta `APP_VERSION`/`GIT_SHA`.
- `pnpm release:check --tag vX.Y.Z`: valida SemVer, árbol limpio, migraciones y changelog antes de etiquetar.
- Workflow **Rollback** (`workflow_dispatch`, entorno `production`) para `wrangler rollback` de API/web y
  restauración de D1 en una base nueva; guía en `docs/ops/ROLLBACK.md`.

### Seguridad (H1.6)
- **IDOR de portada cerrado:** `PATCH /albums/{id}` valida que `coverMediaId` sea una foto del usuario.
- **Enlaces públicos:** nueva ruta `GET /albums/public/{token}` con `SHARE_LIMITER` por IP, tope de 500
  elementos, `allowDownload` (por defecto **false**: el enlace solo devuelve miniaturas/previews) y
  URLs prefirmadas acotadas a la caducidad del enlace. La ruta heredada `/shared/album/{token}` responde 410.
- **Verificación de email:** el 403 `email_unverified` ya no se confunde con sesión caída; pausa el
  respaldo con motivo visible y ofrece reenviar el correo desde la pestaña Respaldo.
- **Smoke de producción sin credenciales en el repo:** usa los secretos `SMOKE_USER_EMAIL` /
  `SMOKE_USER_PASSWORD`; no registra cuentas en prod, limpia el media subido y devuelve exit 2 si no
  está configurado.

### Corregido
- Archivos > 20 MB ya no fallan en `object_missing` en web ni en nativo.
- `check-hashes`, álbumes, exportación y reconciliación consultan en trozos (<100 parámetros de D1).
- `trash/empty` incluye previews, descuenta `previewSize` una vez y solo resta cuota si el lote se borró
  completo (evita doble descuento concurrente); las reservas `pending` se liberan.
- El cron agrega las actualizaciones de cuota por usuario (una query por usuario, no por fila) y pagina
  el aborto de MPUs huérfanas.
- Regla de ciclo de vida R2 documentada (`docs/ops/R2_LIFECYCLE.md`) para abortar MPUs a los 7 días.
- `/uploads/{id}/complete` rechaza filas multipart en vez de devolver 409 sin pista.
