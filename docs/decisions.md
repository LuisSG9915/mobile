# Decisiones de diseño — hardening de procesos (2026-10)

Contexto: auditoría con `scripts/audit-prod.mjs` encontró drift real de
`user_storage_stats` (224 B registrados vs 1.8 GB reales en el usuario
principal), cuota sin enforcement, cola nativa compartida entre cuentas,
sesiones expiradas acumuladas y subidas sin timeout ni cancelación.

Este documento fija los invariantes nuevos y las preguntas abiertas, para que
futuras sesiones no tengan que reconstruir el porqué.

## API

### Cuota atómica y reserva (`/uploads/init` y `/uploads/{id}/complete`)

- Reserva atómica en `/uploads/init`: se ejecuta un `UPDATE user_storage_stats SET reserved_bytes = reserved_bytes + :bytes WHERE (used_bytes + reserved_bytes + :bytes) <= max_bytes`. Si `changes === 0`, se rechaza de inmediato con `413 quota_exceeded`.
- **Condición de carrera eliminada:** ya no existe carrera bajo concurrencia. Múltiples inits paralelos reservan su cuota de forma atómica en SQLite/D1; el que supere el límite es rechazado de inmediato.
- Transición en `/uploads/{id}/complete`: se ejecuta `confirmStorageUsage`, que decrementa atómicamente `reserved_bytes` e incrementa `used_bytes` y `media_count`.
- Liberación de reserva: si `/uploads/init` falla durante el presignado o inserción, libera la reserva en el bloque `catch`. Asimismo, el cron diario (`cron/cleanup.ts`) libera los `reserved_bytes` de los uploads `pending` que hayan expirado o quedado abandonados.
- `used_bytes` cuenta media `ready` **incluyendo papelera** (sigue ocupando R2 hasta la purga física).
- `getUsageBytes` materializa la fila de `user_storage_stats` de forma perezosa (SUM sobre media) si no existe — sana usuarios pre-stats sin backfill.

### `/uploads/{id}/complete`

- Flip atómico: `UPDATE … SET status='ready' WHERE status='pending'`; la
  cuota solo se confirma (`confirmStorageUsage`) si `changes > 0`. Dos completes concurrentes cuentan
  una vez; la respuesta repetida sigue siendo 200 idempotente.
- Si fallara tras el flip (raro), la reconciliación del cron recalcula tanto
  `used_bytes` como `reserved_bytes` en la próxima corrida.

### Restore desde papelera

Re-init de un sha cuyo `ready` está soft-deleted → UPDATE `deleted_at=NULL`
y respuesta `duplicate`. No re-sube bytes ni re-cuenta cuota (los objetos
R2 ya existen bajo la misma clave sha256).

### Papelera acotada y paginación (`GET /trash` y `POST /trash/empty`)

- `GET /trash`: paginación por cursor opaco `(deletedAt, id)` codificado en base64 con límite por página (por defecto 100, máx 200) y `nextCursor`.
- `POST /trash/empty`: acotado a un lote de hasta 250 elementos por invocación (`BATCH_SIZE`), eliminando objetos en R2 en lote (`BUCKET.delete(keys)`) y filas en D1 (`inArray`), descontando la cuota utilizada. Devuelve `{ ok: true, deletedCount, remainingCount, hasMore }`. El cliente itera secuencialmente hasta vaciar toda la papelera sin agotar subrequests ni tiempo de CPU del Worker.

### Cron diario (`0 3 * * *`)

1. Purga `pending` inactivos por `updated_at` > 24 h (no `created_at`: un
   re-init activo refresca `updated_at` y no debe purgarse en pleno vuelo), liberando sus `reserved_bytes` de la cuota.
2. Purga papelera > 30 días: objetos R2 + fila + decremento de cuota solo
   para los que fueron `ready`.
3. Borra `session` y `verification` expiradas (better-auth no las limpia).
4. **Reconcilia `user_storage_stats`**: recalcula desde `media`
   (`status='ready'`, incluye papelera para `used_bytes`, y `status='pending'` para `reserved_bytes`) con SET por usuario y pone a 0 las
   filas de usuarios sin media ni reservas. Auto-corrige drift.
5. **Barrido de huérfanos R2 con cursor persistente**: guarda y lee el cursor en la tabla `system_state` (`r2_orphan_sweep_cursor`). Procesa hasta 5 páginas (5.000 claves) por corrida a partir del cursor guardado y persiste el nuevo cursor (o `null` al llegar al final). Esto asegura que todo el bucket es barrido ciclo tras ciclo sin estancarse en las primeras 5.000 claves.
6. Lotes de 500 filas por pasada, hasta 10 rondas por corrida (límites del
   Worker); `BUCKET.delete` en trozos de 1000 claves.

### Rate limiting

- `AUTH_LIMITER` (binding `ratelimits`, 30 req/60 s por IP
  `cf-connecting-ip`, fallback `"anon"`) como middleware en `index.ts` solo
  para POST a `sign-in`, `sign-up`, `request-password-reset`, `reset-password`.
- NO usar `rateLimit` de better-auth: su storage en memoria vive por
  instancia y `createAuth` corre por request → nunca acumula. Código muerto.
- `UPLOAD_LIMITER` (120/60 s por usuario) sigue en `/uploads/init`.
- En dev/tests los bindings no existen → middleware no-op.

## Cola mobile

### Partición por usuario (SQLite nativo)

- PK compuesta `(user_id, asset_id)`: los ids de MediaLibrary son globales
  del dispositivo; dos cuentas chocarían sin el prefijo de usuario.
- Migración en caliente en `getQueueDb` (rename + rebuild + `INSERT OR
  IGNORE` con `user_id NULL`).
- `initializeQueue(userId)` fija `activeUserId`, adopta filas `NULL`
  (`UPDATE OR IGNORE`) y persiste `kv queue.owner`.
- **Adopción:** las filas legacy sin dueño las hereda el primer login —
  decisión válida en dispositivo monousuario; si el teléfono fue compartido
  antes de este cambio, los pendientes antiguos van al primero que entre.
- `closeQueue` suelta el contexto y **borra `queue.owner`** (cubre logout y
  sesión perdida: sin sesión, procesar quemaría reintentos contra 401).
  Las filas selladas quedan intactas e inertes para otras cuentas.
- Web: misma API sobre IndexedDB; el contexto `{userId, epoch}` ya existía.

### Background headless

La tarea `photos-backup-sync` corre sin sesión React: restaura
`queue.owner` (último usuario con sesión) antes de escanear/procesar.
Sin owner → no-op. Coste aceptado: una ventana transitoria sin sesión puede
hacer que el SO se salte una pasada programada.

### Scan

- Salta extensiones fuera de `ALLOWED_EXTENSIONS` (subirlas con el fallback
  las etiquetaría mal en R2).
- Una transacción por página (200 assets) vía `enqueueAssetsBatch`.
- `last_scan_ts:<userId>` por usuario: el primer scan de un usuario nuevo no
  queda suprimido por el throttle de otro.
- `runBackupPass({ forceScan })`: scan solo si pasaron 15 min o se fuerza;
  `processQueue` sigue corriendo cada 60 s. Botón manual y onboarding usan
  `forceScan: true`.

### Processor (paridad nativo/web)

- `cancelQueue` nativo ahora llama `activeUploadTask.cancelAsync()` (antes
  solo cortaba entre items).
- Watchdog de estancamiento: 90 s sin progreso → abortar y reintentar
  (XHR web y `createUploadTask` nativo).
- `apiFetch` tiene timeout de 30 s vía `Promise.race` (no
  `AbortSignal.timeout`: soporte irregular en Hermes); el `signal` del
  caller sigue pasando al fetch.
- Errores terminales sin quemar reintentos: 400 y 413 → `failed` directo;
  413 además `setBackupPaused(true)` (la alternativa marcaba `failed` toda
  la cola restante; el usuario libera espacio y reanuda).
- 401/403 → reencolar sin consumir intento y cortar la pasada (sesión
  caída; el próximo contexto válido reanuda).
- Errores transientes (red, 5xx, PUT fallido): `bumpAttempt` + backoff
  `BACKOFF_MS`, `failed` al llegar a `MAX_ATTEMPTS` (6 totales, ambos
  processors — ojo: leer `attempts` ANTES de `bumpAttempt`, la fila web es
  referencia viva).
- `recoverInterrupted()` al inicio de cada pasada (kill a mitad de item →
  transitorios vuelven a `queued` con `bytes_sent=0`).
- Al terminar un item se invalidan `timeline`, `stats` y `storage`.

### Recuperación de contraseña (email + deep link)

Flujo better-auth 1.7.7: `POST /api/auth/request-password-reset {email,
redirectTo}` crea `verification` `reset-password:{token}` (expira 1 h) y llama
`sendResetPassword`. El correo lleva `{API}/api/auth/reset-password/{token}?
callbackURL={redirectTo}`; ese GET valida y hace 302 a `callbackURL?token=…` o
`?error=INVALID_TOKEN`. El cliente cierra con `POST /api/auth/reset-password
{newPassword, token}`.

- **Anti-enumeración**: la request responde 200 siempre (incluso con timing
  simulado). La UI muestra confirmación genérica, nunca "correo no existe".
- **`redirectTo` por plataforma** (`mobile/src/auth/reset.ts`): web →
  `{origin}/reset-password`; nativo → `photos:///reset-password`. Ambos pasan
  `originCheck`: `photos://` (sin authority/path) matchea cualquier deep link
  del scheme y los orígenes http(s) se comparan por origin exacto.
- **Transporte**: `apps/api/src/email.ts` — con `RESEND_API_KEY` va por fetch a
  api.resend.com (sin dependencia npm); sin clave, el "envío" se loguea en
  wrangler para desarrollo (copiar el enlace del log). Fallos de envío no
  rompen la request (se loguean); el usuario puede re-pedir el enlace.
- **`revokeSessionsOnPasswordReset: true`**: tras resetear, todas las sesiones
  previas mueren — un dispositivo ajeno pierde acceso.
- Tokens expirados los purga el cron (`verification` ya se limpia).
- Secrets: `RESEND_API_KEY` vía `wrangler secret`; `EMAIL_FROM` como var cuando
  haya dominio verificado (sin dominio, Resend solo envía al email dueño de la
  cuenta).
- En dispositivo físico dev, el enlace del correo lleva `BETTER_AUTH_URL` — con
  localhost solo sirve si el correo se abre en el mismo PC.

## Decisiones de plan adoptadas el 2026-10-29

Tomadas al revisar la auditoría externa (`docs/AUDITORIA_EXTERNA_2026-10-29.md`) y el informe de
subidas en segundo plano; quedan aquí para no re-litigarlas.

1. **S1 empieza por H1.1, no por H1.8.** Primero se cierra la pérdida de datos (multipart que no
   llama a `multipartComplete` en nativo, `uploadId` sin persistir, etags de otra MPU), porque un
   vídeo que no termina de subir es integridad y su medición es prerrequisito de H1.8. La velocidad
   (H1.8) va después, con la línea base ya tomada.
2. **Segundo plano: Fase 0, sin rebuild nativo.** Se aprueba (a) + (b) de `PLAN_MEJORAS` §3.2:
   copy honesto en Android igual a `noteIos`, retirada de `FOREGROUND_SERVICE_DATA_SYNC` huérfano y
   journal de partes con ETags en la cola existente + reconciliación por `HEAD`/`ListParts` al
   arrancar. **No** se construye el módulo `upload-engine` (Fase 1): no existe librería mantenida que
   ahorre el trabajo y el coste son semanas de nativo más dev-client y revisión de Play. Se revisa
   solo si el uso real muestra subidas largas con la app cerrada.
3. **Cuota y almacenamiento: medir antes de tocar límites.** No se baja la cuota por usuario a 5 GB
   ni se mueve nada a Infrequent Access hasta tener el modelo de consumo con datos reales (H2.6).
   Motivo: los 10 GB-mes gratis de R2 se calculan con el **pico diario medio**, así que el margen real
   depende del patrón de subida, no del total almacenado.
4. **Workers Paid ya está activo (5 $/mes).** Por tanto el techo de 10 ms de CPU por invocación, el
   límite de 50 subrequests y la ausencia de Logpush **no aplican**: la referencia operativa son 30 s
   de CPU por defecto (`limits.cpu_ms` configurable), 10.000 subrequests y D1 Paid (25 000 M filas
   leídas + 50 M escritas al mes). No volver a planificar ni a optimizar contra los límites de Free.

## Dónde viven los pendientes operativos

Aquí solo se registran decisiones tomadas: un pendiente dentro de un archivo de decisiones es
trabajo escondido. Los que había se asignaron a su fila del tablero y a `docs/ops/` el 2026-10-29:

- `AUTH_LIMITER` sin desplegar en prod → fila **H1.6** del tablero (junto con headers y Resend).
- Recuperación de cuenta en prod sin `RESEND_API_KEY` ni `EMAIL_FROM` verificado → fila **H1.6**.
- `uso.txt` con credenciales en la raíz → resuelto: archivo eliminado y credenciales desacopladas.

`pnpm check:board` falla si vuelve a aparecer un `- [ ]` en este archivo.
- D1 local: migraciones aplicadas (`0001` y `0002` al día vía `db:migrate:local`).

## No hecho a propósito (alcance aprobado: urgentes + robustez)

- Dedup global entre usuarios: la auditoría midió ~50 MB de ahorro — no
  justifica rediseñar las claves `users/{id}/…`.
- Verificación de email al registro: la infraestructura de correo ya existe
  (`email.ts`), pero `requireEmailVerification` bloquearía el sign-in de los
  usuarios ya registrados en prod con `emailVerified=false`. Activarla exige
  primero marcar verificados los usuarios existentes o un período de gracia.

## Resuelto en el plan de hardening / mejora

- CI automatizado en `.github/workflows/ci.yml` (lint, typecheck, tests api+mobile, selftest pipeline).
- `hasLocalCopy` y `getSyncedLocal`: resuelto eliminando las filas de la cola (`removeQueueItems`) al confirmar el borrado en MediaLibrary.
- `ADMIN_EMAIL` desacoplado del bundle público cliente vía `process.env.EXPO_PUBLIC_ADMIN_EMAIL`.
- WebP en Safari: resuelto con transcodificación WASM (`@jsquash/webp`).
- Escaneo incremental en MediaLibrary: resuelto con filtro `createdAfter` (ventana 24 h) y soporte `forceScan`.
- Borrado en lote en Cron de D1 (`inArray`) y eliminación de OOM en sweep de R2.

## Invariantes de integridad (subida multipart)

- **Una sesión multipart muerta se detecta y se abandona, no se reintenta.** R2 aborta las MPU
  incompletas a los 7 días (`docs/ops/R2_LIFECYCLE.md`) y otro dispositivo puede cerrar la misma
  sesión, así que `uploadId` + `parts` guardados pueden apuntar a algo que ya no existe. Señales
  canónicas: `404 NoSuchUpload` al subir una parte y `409 upload_id_mismatch` al presignar. Ambas
  deben descartar el journal (`clearMultipartState`: `upload_id`/`parts` a NULL, porque `setState` usa
  `coalesce` y no puede vaciarlos) y reabrir **una** sesión limpia; tras dos pasadas el intento falla
  y el reintento externo acota el resto. Motivo: sin este corte el cliente reintenta para siempre una
  sesión imposible y el vídeo nunca sube, que es justo el síntoma que H1.1 debía eliminar.
- **Sin `ETag` de R2 no hay parte válida.** Los dos clientes exigen el header; un ETag inventado
  produce un `multipartComplete` rechazado con `parts_mismatch` y el servidor borra la fila de metadata.
- **16 MiB por parte, 3 en vuelo, lotes de prefirmado de 12.** El tamaño de parte está en
  `packages/shared/src/constants.ts` y lo consumen API (`partSize`/`expectedParts`) y clientes, así que
  no puede divergir. Razones: menos Class A requests (200 MB: 40 → 13 partes), y el TTL de 900 s de
  `presign-parts` deja de ser un problema porque cada lote se sube antes de firmar el siguiente. Coste
  asumido: hasta 3 × 16 MiB de `ArrayBuffer` en memoria (~48 MiB de pico) por subida; con 5 MiB eran
  ~15 MiB y el doble de peticiones. Las partes van ascendentes al completar (R2 lo exige) y el journal
  de `parts` se guarda ya ordenado para que un reinicio no dependa del orden de llegada.


## Compuerta de release (H1.4)

- **Una release exige tag, binario y nota fechada; el workflow no puede pasar sin los tres.** Las
  reglas están en `scripts/lib/release-audit.mjs` (puras, con 15 tests) y no en el YAML, porque el
  diagnóstico de `v1.0.9`/`v1.1.0` es que el gate anterior solo miraba árbol limpio y migraciones:
  pasaba con `[Unreleased]` lleno y con un `eas build` que moría después de gastar el build.
- **`[Unreleased]` debe quedar vacía al etiquetar.** Consecuencia deliberada: un tag cortado desde un
  árbol con notas sin fechar falla el preflight. Alternativa descartada: permitir notas sueltas y
  generarlas al vuelo, que es como `v1.1.0` quedó con 13 bullets que luego se reescribieron.
- **El tag es anotado y apunta a HEAD.** Un tag ligero no lleva mensaje y se puede re-apuntar a otro
  commit; el preflight rechaza ambos casos en local (`--allow-existing` solo audita).
- **La release se verifica por su activo, no por el color del job.** Tras publicar, el workflow
  consulta `gh release view --json assets` y exige un `.apk`; el APK descargado se valida por firma
  ZIP. Motivo: un `curl` a una URL prefirmada caducada devuelve un HTML de 200 bytes que se adjunta
  como si fuera un APK.

## APK sin EAS (H1.4)

- **El APK de release lo compila Gradle, no EAS.** El plan gratuito de EAS está agotado (motivo real
  por el que `v1.0.9` y `v1.1.0` quedaron sin binario, no un fallo de configuración). El workflow
  `release-apk.yml` hace `npx expo prebuild --platform android --clean --no-install` y
  `./gradlew assembleRelease` en `ubuntu-latest` (JDK 17 + Android SDK), sin minutos de EAS. Alternativa
  descartada: `eas build --local`, que exige el toolchain Android en la máquina de quien publica y no es
  reproducible en CI.
- **La firma se inyecta después de prebuild.** `android/` no se versiona (CNG), así que
  `scripts/android-prepare.mjs` añade `signingConfigs.release` y `buildTypes.release.signingConfig` a
  `android/app/build.gradle`, escribe la keystore desde `ANDROID_KEYSTORE_BASE64` y las contraseñas en
  `gradle.properties`. Sin esto el release se firma con la keystore de **debug**: dos builds dejan de
  instalarse uno sobre otro y Obtainium no puede actualizar. Las reglas viven en
  `scripts/lib/android-release.mjs` (10 tests) y se validan con `--dry-run` contra el `build.gradle`
  real que genera prebuild.
- **`versionCode` sale del tag** (`v1.2.3` → `10203`), no del número de ejecución del workflow:
  re-ejecutar un build fallido no debe producir un `versionCode` distinto para la misma versión. Riesgo
  aceptado: el esquema se agota en `v210.0.0`.
- **El build de Gradle necesita `SENTRY_ORG`/`SENTRY_PROJECT` (y desactivar la subida sin token).** El plugin de
  `@sentry/react-native` corre al final del pipeline (`createBundleReleaseJsAndAssets_SentryUpload_*`) y sin org
  aborta con «An organization ID or slug is required», tumbando un APK que ya estaba compilado. Se pasa
  `SENTRY_ORG`/`SENTRY_PROJECT` como variables de repo y `SENTRY_DISABLE_AUTO_UPLOAD=true` cuando no hay
  `SENTRY_AUTH_TOKEN`; los source maps son opcionales, el APK no.
- **Solo se compilan ABIs de teléfono (`arm64-v8a`, `armeabi-v7a`).** Compilar x86/x86_64 duplica el tiempo del job
  y el tamaño del APK, y esos ABIs solo los usan emuladores, que trabajan con dev-client. Se pasa con
  `-PreactNativeArchitectures`.
