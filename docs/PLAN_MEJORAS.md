# Plan de trabajo v2 — Confianza, operación y producto

> **Este archivo (`docs/PLAN_MEJORAS.md`) ES el Plan v2.** No existe un `PLAN_V2.md` separado.
> La versión base está en el commit `ea855dd`; las correcciones de esta sesión (I-07/I-08, 15/15,
> Semana, decisiones) siguen sin commitear. Un ZIP de `HEAD` verá la versión base, no esta.
>
> **Estado:** H1 en curso (2026-10-23). Este documento sustituye la lista lineal de etapas 0–5.
> **Regla de oro:** ningún `[x]` sin evidencia enlazada; ningún feature nuevo hasta cerrar H1.
> **Referencias:** [Investigación de huecos](INVESTIGACION_HUECOS_PLAN.md) ·
> [Revisión de cobertura](REVISION_COBERTURA_PLAN.md) · [Decisiones](decisions.md).

---

## 0. Qué cambia

El plan anterior era una lista de **construcción** en 6 etapas. Funcionó para implementar la base,
pero mezclaba construir, entregar y operar, y terminó marcando `[x]` sin que el sistema lo demostrara.

Este plan separa tres preguntas:

1. **H1 — ¿Es verdad y es seguro?** Cerrar P0, tener evidencia, publicar y poder restaurar.
2. **H2 — ¿Se puede operar?** SLOs, alertas, staging, calidad nativa, coste y capacidad.
3. **H3 — ¿Se puede usar y sostener?** Onboarding, accesibilidad, shares, plataforma y documentación.

Las etapas 0–5 pasan a **histórico** (sección 1.3). No se borran: se corrigen sus estados y se
enlazan a evidencia.

---

## 1. Estado real (2026-10-23)

### 1.1 Lo construido y validado

- Worker sin binarios, R2 prefirmado, D1, cola nativa SQLite y web IndexedDB.
- Dedup SHA-256 por usuario, cuota atómica para altas nuevas, papelera 30 días, reconciliación.
- Timeline paginado, FTS5, previews WebP, álbumes, shares, mapa, recuerdos.
- Sesiones revocables, borrado de cuenta, export de metadatos, recuperación de contraseña.
- 376 tests unitarios/integración (144 API + 232 mobile) + 31 de pipeline; lint y typecheck verdes.
- Migraciones sincronizadas: `_journal` **15/15** (0000–0014) con snapshots 0011–0014; `db:generate` responde
  “No schema changes”.

### 1.2 Estado de los hallazgos (P0/P1)

| ID | Hallazgo | Estado | Evidencia actual |
| :--- | :--- | :---: | :--- |
| I-01 | Multipart nativo no completa archivos > 20 MB | **Resuelto (unit)** | [`processor.ts`](../apps/mobile/src/queue/processor.ts) llama `multipartComplete`; [test nativo >20 MB](../apps/mobile/src/queue/processor.test.ts) |
| I-02 | `multipart/finalize` no valida tamaño/MIME | **Resuelto (unit)** | [validación de size/MIME](../apps/api/src/routes/uploads.ts) + [tests de ensamblado](../apps/api/test/uploads.test.ts) |
| I-03 | “Reanudación” crea MPU nueva y reusa etags viejos | **En progreso** | [`upload_id` persistido](../apps/mobile/src/queue/db.ts) y `uploadId` reutilizado; [reanudación y MPU muerta](../apps/mobile/src/queue/processor.test.ts); falta prueba E2E kill/resume |
| I-04 | Cadena de migraciones | **Resuelto** | [snapshots 15/15](../apps/api/migrations/meta) (0013/0014 incluidos); `db:generate` sin cambios |
| I-05 | Re-init `pending` no re-reserva cuota | **Resuelto (unit)** | [cambio de tamaño → 409](../apps/api/test/uploads.test.ts) |
| I-06 | Límite D1 de 100 parámetros | **Resuelto (unit)** | [lote de 300 hashes](../apps/api/test/albums.test.ts#L419); trozos de 50 en check-hashes/álbumes/export y reconcile |
| I-07 | Cron supera 1.000 queries | **Resuelto (unit)** | [cuota agregada por usuario](../apps/api/src/cron/cleanup.ts) + [batching por usuario](../apps/api/test/cron-heartbeat.test.ts); falta estrés remoto de 1.200 filas (H2.5) |
| I-08 | `trash/empty` omite previews y puede descontar dos veces | **Resuelto (unit)** | [preview incluida y descuento solo por lote completo](../apps/api/test/media.test.ts) |
| I-09 | Shares públicos sin paginación/rate limit/originales | **Resuelto (unit)** | [tope 500, `SHARE_LIMITER`, `allowDownload=false`](../apps/api/test/albums.test.ts) |
| I-10 | IDOR `coverMediaId` | **Resuelto (unit)** | [propiedad validada en `PATCH /albums/{id}`](../apps/api/test/albums.test.ts#L409) |
| I-11 | Verificación de email sin salida | **En progreso** | 403 reencola con motivo; callbackURL implementado en web/nativo ([verification.ts](../apps/mobile/src/auth/verification.ts), tests en [verification.test.ts](../apps/mobile/src/auth/verification.test.ts) y [auth.test.ts](../apps/api/test/auth.test.ts)); falta prueba con Resend real |
| I-12 | Cola nativa topada en 2.000 | **Abierto P1** | `db.ts:362` |
| I-13 | Web: archivo entero en IndexedDB; visor descarga original | **Abierto P1** | `db.web.ts:298`; `media/[id].tsx:1321-1325` |
| I-14 | Álbum/papelera/salto sin paginar en UI | **Abierto P1** | `use-hybrid-gallery.ts:102-106`; `trash.tsx:15` |
| I-15 | Release/CD sin tag, staging ni rollback | **Abierto P1** | último tag `v1.0.9`; deploy en push |
| I-16 | Backups manuales, mismo bucket, sin restore drill | **En progreso** | respaldo D1 en bucket propio con *Guard* ([backup-d1.yml](../.github/workflows/backup-d1.yml)) + verificación semanal ([backup-r2-verify.yml](../.github/workflows/backup-r2-verify.yml)); RPO/RTO en [RESTORE_DRILL.md](ops/RESTORE_DRILL.md); falta ejecución remota con secrets |
| I-17 | Sin heartbeat ni alertas | **En progreso** | `cron_last_run` + [cron-heartbeat.yml](../.github/workflows/cron-heartbeat.yml); faltan alertas 5xx/drift y prueba en prod |
| I-18 | Plan sobredeclara estado | **Resuelto (unit)** | [auditor del tablero](../scripts/check-board.mjs) + [sus tests](../scripts/board-audit.test.mjs): fila con estado → enlace existente, `done` sin pendientes dentro, `in_progress` declara su brecha |

Los IDs remiten a [INVESTIGACION_HUECOS_PLAN.md](INVESTIGACION_HUECOS_PLAN.md). H1 ataca
I-01…I-05, I-07, I-08, I-10, I-11 e I-15…I-17. H2 valida en remoto I-06/I-09 y cierra I-12…I-14 e I-18.

### 1.3 Histórico de las etapas 0–5

| Etapa | Qué se construyó | Qué falta / veredicto |
| :--- | :--- | :--- |
| 0 | Invalidación única, distinción 413, docs y cifras | `decisions.md` sigue con pendientes; checklist operativo no cerrado → **parcial** |
| 1 | Cuota atómica, sweep con cursor, papelera paginada, backups D1 | Bypass por multipart/re-init; previews en `trash/empty`; restore no probado → **parcial** |
| 2 | Paginación, FTS5, `before`, previews | Sin benchmarks; UI de álbum/papelera/salto; límites D1 → **parcial** |
| 3 | Multipart, preview, cola, galería | Nativo y `finalize` corregidos; falta E2E kill/resume; web `ArrayBuffer`; cola 2.000; sin desglose de cuota → **parcial** |
| 4 | Sesiones, borrado, export, shares, email, admin | Export JSON, no ZIP; shares sin flag/rate; email sin reenvío; IDOR portada → **parcial** |
| 5 | E2E, CI/CD, backup D1, checklist nativo | Sin tag/staging/rollback; smoke opcional; sin cobertura; heartbeat añadido en H1.7 → **no cumple** |

---

## 2. Reglas del plan

1. **Fuente única.** Este documento es el tablero vigente. `ROADMAP.md` y `PLAN_GENERAL.md` quedan
   como histórico y llevan un banner que apunta aquí.
2. **Evidencia primero.** Un `[x]` debe enlazar commit, test, workflow, captura o informe. Sin enlace,
   el estado es `todo` o `in_progress`, nunca `done`.
3. **Estados claros.** `todo` / `in_progress` / `blocked` / `done`; `blocked` exige motivo y dueño.
4. **P0 primero.** Un P0 abierto bloquea cualquier feature nueva. No se abre H3 con H1 abierto.
5. **Resultado, no tarea.** Cada fila dice qué cambia para el usuario o el sistema, no solo qué archivo
   se toca.
6. **Dueño y fecha.** Cada trabajo tiene un responsable y una semana objetivo; si no, no entra.
7. **Riesgo y rollback.** Migraciones/cron/deploy llevan plan de reversa y backup previo.
8. **DoD por horizonte.** H1 no cierra sin sus pruebas, release y restore; H2 sin SLO/alertas/staging;
   H3 sin UX/a11y/documentación.
9. **Revisión semanal.** Viernes: actualizar estados, evidencias, riesgos y siguiente foco.
10. **No “100%”.** Solo se declara al cerrar un horizonte con evidencia reproducible.

**Owner y fechas:** en este plan el owner es Luis; las semanas son relativas al inicio de H1 y se
revisan cada viernes. H2/H3 permanecen en `todo` hasta cerrar H1.

---

## 3. H1 — Verdad y confianza (semanas 1–3)

**Objetivo:** que el plan no mienta y que el respaldo no pierda datos.
**Salida:** P0 cerrados, release `v1.1.0`, restore drill, seguridad mínima y heartbeat.
**Calendario (owner: Luis):** H1.1–H1.2 → S1; H1.3–H1.5 → S2; H1.6–H1.7 → S3.

**Foco y decisiones tomadas (2026-10-29, razonadas en [decisions.md](decisions.md)):** S1 se dedica a
**H1.1** — un vídeo que no termina de subir es integridad, y su medición es la línea base de H1.8. H1.8
pasa a S2. Segundo plano = Fase 0 de §3.2 (sin módulo nativo). Cuota y almacenamiento se deciden en
H2.6 con datos reales. La cuenta está en **Workers Paid**, así que los límites de Free no son el
marco de referencia.

| ID | Resultado | Trabajo | Evidencia de cierre | Semana | Estado |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **H1.1** | Vídeos > 20 MB se respaldan y se reanudan | Llamar `multipartComplete` en nativo; persistir `uploadId` en D1; no reusar etags de otra MPU; resolver la colisión de ruta; **ciclo de vida R2 para abortar MPUs incompletas a 7 días (`docs/ops/R2_LIFECYCLE.md`) + `abortStaleMultipartUploads` paginado**; spec E2E `multipart-resume`; **recuperar de sesión muerta**: 404 en una parte o 409 al presignar → descartar journal (`clearMultipartState`) y reabrir UNA sesión limpia en nativo y web | [processor.test.ts](../apps/mobile/src/queue/processor.test.ts) (reanudación, 404 en parte, 409 en presign, corte tras dos pasadas); test API de reanudación; **falta**: E2E con R2 dev (bloqueado por entorno en `test-results/gemini-blockers.md`) y prueba de MPU huérfana | S1 | `in_progress` |
| **H1.2** | La cuota no se puede saltar | Validar `head().size`/MIME/partes en `multipart/finalize`; re-init con tamaño distinto → 409; **incluye I-08**: `trash/empty` borra previews, descuenta `previewSize` y solo resta cuota si el lote se borró completo | [uploads.test.ts](../apps/api/test/uploads.test.ts) (reanudación, size, MIME) y [media.test.ts](../apps/api/test/media.test.ts) (preview) | S1 | `done` |
| **H1.3** | El plan es verificable | [`check-board.mjs`](../scripts/check-board.mjs) sobre [`board-audit.mjs`](../scripts/lib/board-audit.mjs): cada fila con estado enlaza algo que existe, `done` no lleva trabajo abierto dentro, `in_progress` declara su brecha, el estado pertenece al vocabulario y un hallazgo «Resuelto» trae artefacto; `decisions.md` sin `- [ ]`; banners ya presentes en [ROADMAP.md](../ROADMAP.md) y [PLAN_GENERAL.md](PLAN_GENERAL.md) | `pnpm check:board` en CI y en `test:all`; [11 tests del auditor](../scripts/board-audit.test.mjs) — incluido el tablero real — en `test:pipeline` | S2 | `done` |
| **H1.4** | Hay una release real | `/version` con `APP_VERSION`/`GIT_SHA`; deploy inyecta los vars; `CHANGELOG.md`; `pnpm release:check` (tag SemVer, árbol limpio, migraciones, changelog); workflow **Rollback** + `docs/ops/ROLLBACK.md` | Compuerta en [`release-audit.mjs`](../scripts/lib/release-audit.mjs) (7 reglas, 15 tests) y APK **sin EAS**: `release-apk.yml` hace `expo prebuild` + `gradlew assembleRelease` con firma y `versionCode` inyectados por [`android-prepare.mjs`](../scripts/android-prepare.mjs) (10 tests). APK compilado y verificado: `versionCode=10100/versionName=1.1.0`, firmante propio (`apksigner verify`), targetSdk 36. Runbook en [RELEASE.md](ops/RELEASE.md). `/version` y el rollback ya estaban en `ea855dd`. **Falta publicar**: subir la keystore a los secretos y re-ejecutar el workflow para que la release `v1.1.0` tenga su `.apk` | S2 | `in_progress` |
| **H1.5** | Se puede restaurar | Restore D1 + R2 a entorno nuevo, RPO/RTO documentados; backup D1 fuera del bucket de producción; `backup-r2` falla con errores; runbook en `docs/ops/INCIDENT_RESPONSE.md` | **Hecho (2026-10-29):** respaldo D1 en bucket propio `photos-backups` con *Guard* que aborta si apunta a `photos-media` ([backup-d1.yml](../.github/workflows/backup-d1.yml)); `backup-r2.mjs` sale con `exit 1` ante cualquier objeto fallido o bucket vacío (regla + 6 tests en [backup-r2-result.test.mjs](../scripts/backup-r2-result.test.mjs), en `test:pipeline`) y verificación semanal por workflow ([backup-r2-verify.yml](../.github/workflows/backup-r2-verify.yml)); RPO/RTO separados catálogo/binarios en [RESTORE_DRILL.md](ops/RESTORE_DRILL.md) y declaración SEV-1 con reloj en [INCIDENT_RESPONSE.md](ops/INCIDENT_RESPONSE.md). **Falta**: ejecución remota del drill con secrets y firma del log | S2 | `in_progress` |
| **H1.6** | Seguridad mínima | IDOR cerrado; álbum público limitado (500), `SHARE_LIMITER`, `allowDownload=false` por defecto, URLs acotadas; CSP/HSTS web; reenvío de verificación **con `callbackURL` a la app/web**; smoke sin credenciales en repo | Tests en [verification.test.ts](../apps/mobile/src/auth/verification.test.ts) y [auth.test.ts](../apps/api/test/auth.test.ts); 3 tests shares/IDOR; **falta**: `AUTH_LIMITER` desplegado, secreto de Resend con dominio verificado y headers en prod | S3 | `in_progress` |
| **H1.7** | Un fallo avisa | `cron_last_run` + workflow `cron-heartbeat.yml`; **incluye I-07**: cuota agregada por usuario en el cron (hecho); SLO en `docs/ops/SLO.md` | Heartbeat y batching testeados en [cron-heartbeat.test.ts](../apps/api/test/cron-heartbeat.test.ts); workflow validado estáticamente; **falta**: prueba de alerta en prod (requiere secrets) | S3 | `in_progress` |
| **H1.8** | Subir un vídeo tarda lo que tarda la red, y el progreso es por byte | Quitar base64 del camino multipart (**U1 ✅**); partes de 16 MiB con 3 en vuelo (**U2 ✅**); prefirmar por lotes (**U3 ✅**); MB/s y ETA dentro de la proyección existente (**U4 ✅**). Detalle y criterios en §3.1 | Código y tests de U1–U4 cerrados: parte en `ArrayBuffer` sin base64 ([`upload-part.ts`](../apps/mobile/src/queue/upload-part.ts)), pool de 3 con partes de 16 MiB y prefirmado por lotes de 12 ([`shared.ts`](../apps/mobile/src/queue/shared.ts), [`processor.ts`](../apps/mobile/src/queue/processor.ts)), velocidad y ETA en la ventana móvil de [`progress.ts`](../apps/mobile/src/queue/progress.ts). **Falta**: medición antes/después con 100 MB y 500 MB en Wi-Fi y LTE anotada en [findings.json](testing/findings.json) — requisito para cerrar la fila | S2 | `in_progress` |
| **H1.9** | La app no promete lo que el SO no da | Fase 0 de §3.2 («no perder nada», sin rebuild): retirar `FOREGROUND_SERVICE_DATA_SYNC` de [app.json](../apps/mobile/app.json) (declarado, sin servicio que lo use); nota de Android igual a `noteIos` en [es.ts](../apps/mobile/src/i18n/es.ts); journal de partes con ETags en la cola existente + reconciliación por `HEAD`/`ListParts` al arrancar; decisión y coste de la Fase 1 (`upload-engine` nativo) escritos en [decisions.md](decisions.md) | `app.json` sin permisos huérfanos; matar la app a mitad de una subida multipart y verificar que al reabrir solo sube lo que falta; decisión de Fase 1 ya escrita en `decisions.md` (2026-10-29) | S2–S3 | `todo` |

**DoD de H1:** `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm test:pipeline` verdes; los tests
nuevos fallan en el código viejo y pasan en el nuevo; `v1.1.0` publicado; restore drill firmado; 0 P0
y 0 hallazgos altos de seguridad abiertos.

### 3.1 Detalle de H1.8 — el coste real de subir un vídeo

Hoy la ruta multipart (>20 MB) hace, **por cada parte de 5 MiB**: leer el rango como string base64,
reescribirlo a caché y subirlo con `uploadAsync` sin progreso ni sesión
([processor.ts:310-330](../apps/mobile/src/queue/processor.ts)). Un vídeo de 1 GB son ~205
iteraciones: ~1,4 GB de strings base64 y dos copias por byte, en serie. Ese es el cuello de botella
—no el `sessionType`, que en iOS ya vale `BACKGROUND` por defecto y en Android se ignora
(`expo-file-system/build/legacy/FileSystem.types.d.ts:85-89`)—.

| # | Cambio | Esf. | Criterio de cierre |
| :--- | :--- | :---: | :--- |
| **U1** ✅ | `file.slice(start,end).arrayBuffer()` + PUT con `XMLHttpRequest` y `upload.onprogress` en vez de base64 ([upload-part.ts](../apps/mobile/src/queue/upload-part.ts)), con el mismo contrato que el navegador ([upload.ts:44](../apps/mobile/src/web/upload.ts)): ETag obligatorio, 404 con `status` para distinguir sesión muerta | S | **Cumplido (2026-10-29):** `readAsStringAsync`/`writeAsStringAsync` fuera del camino multipart; progreso por byte vía `publishByteTick`; [upload-part.test.ts](../apps/mobile/src/queue/upload-part.test.ts) cubre body `ArrayBuffer`, ETag ausente, 404 y abort a mitad. Falta la medición real en dispositivo (100 MB/500 MB) |
| **U2** ✅ | `MULTIPART_PART_SIZE` 5 → 16 MiB ([constants.ts:40](../packages/shared/src/constants.ts)): 200 MB pasan de 40 a 13 partes; 1 GB de 205 a 64. Tres partes en vuelo con `mapWithConcurrency` ([shared.ts](../apps/mobile/src/queue/shared.ts)), progreso sumando lo confirmado + lo que lleva cada parte en vuelo, etags ordenados al completar | M | **Hecho (2026-10-29):** tamaño, pool de 3, journal y `multipartComplete` ordenados, progreso sin doble conteo; [shared.test.ts](../apps/mobile/src/queue/shared.test.ts) cubre el pool (límite, corte tras fallo) y el test de multipart cubre 13 partes en 2 lotes. **Falta** la medición en dispositivo del 2,5× y el corte a mitad con `upload_id` (necesita R2 dev) |
| **U3** ✅ | Prefirmar partes de 12 en 12 (`PART_PRESIGN_BATCH_SIZE`): antes se firmaban **todas** las faltantes con TTL 900 s ([s3.ts:62](../apps/api/src/lib/s3.ts)) y con 205 partes las últimas caducaban en vuelo | S | **Cumplido (2026-10-29):** nativo y web piden el lote y lo suben antes de firmar el siguiente; el test comprueba `partUploadsAtPresign = [0, 12]` (ninguna URL espera a su turno) además del corte en `[[1..12],[13]]` |
| **U4** ✅ | MB/s y ETA como ventana móvil de 8 s dentro de `computeSyncProgress` ([progress.ts](../apps/mobile/src/queue/progress.ts)), que ya suma `bytes_sent`: sin archivo nuevo ni estado duplicado. `bytesPerSecond`/`etaSeconds` viven en `SyncProgressState` y también los refresca `publishByteTick` | S | **Cumplido (2026-10-29):** la tarjeta de respaldo muestra `1,2 MB/s · quedan 3:41` ([backup.tsx](../apps/mobile/src/app/(tabs)/backup.tsx)); [progress.test.ts](../apps/mobile/src/queue/progress.test.ts) cubre dos muestras, pausa (sin velocidad ni ETA) y retroceso del contador (reinicia la ventana) |

**Riesgo y reversa:** U1–U4 se pueden apagar volviendo `MULTIPART_PART_SIZE` a 5 MiB y
`PART_UPLOAD_CONCURRENCY` a 1 ([constants.ts](../packages/shared/src/constants.ts),
[shared.ts](../apps/mobile/src/queue/shared.ts)); los dos clientes (`processor.ts` y
`processor.web.ts`) comparten el contrato, así que no hay migración de datos ni cambio de esquema.
El coste asumido es de memoria: hasta 3 × 16 MiB de `ArrayBuffer` en vuelo (~48 MiB de pico).

### 3.2 Detalle de H1.9 — qué permite de verdad el sistema operativo

| Hecho | Evidencia |
| :--- | :--- |
| `sessionType` es iOS-only; en Android «sessions always work in the background and you can't change it» | `expo-file-system/build/legacy/FileSystem.types.d.ts:85-89` |
| La sesión nativa sobrevive a la suspensión, pero el `UploadTask` de JS **no se restaura** si la app se mata | `expo-file-system/build/NetworkTasks.types.d.ts:76-89` |
| **No hay reenganche ni con la app viva**: expo crea la sesión con `URLSessionConfiguration.background(withIdentifier: UUID().uuidString)` — identificador nuevo por arranque, y Apple solo reengancha tareas con identificador estable | `expo/expo@sdk-54` `FileSystem/ios/Legacy/NetworkingHelpers.swift`; ninguna de las dos APIs expone `getAllTasks` |
| En Android no hay sesión de fondo: la subida es OkHttp en el proceso (`call.enqueue`), sin FGS ni WorkManager → muere con el proceso | `expo/expo@sdk-54` `FileSystem/android/.../legacy/FileSystemLegacyModule.kt` ~L517 |
| La tarea de fondo que hay hoy es `expo-background-task`: Android `OneTimeWorkRequest` (~9–10 min de worker, cadencia ≥15 min, **no corre en Doze**); iOS `BGProcessingTask` solo con el dispositivo idle y muere si el usuario usa el móvil ([background.ts:29](../apps/mobile/src/queue/background.ts)) | `expo-background-task` scheduler; docs Android/Apple |
| Android >10 min exige FGS `dataSync` (tope 6 h/24 h en A15 + `onTimeout` obligatorio) o **UIDT** (A14+, sin tope documentado, exento de cuotas, schedule solo desde foreground) | docs Android: FGS service types, behavior-changes-15, user-initiated data transfers |
| `FOREGROUND_SERVICE_DATA_SYNC` está declarado en `app.json` y ningún módulo lo usa | [app.json](../apps/mobile/app.json) |
| Notificaciones de progreso: Android las soporta, pero AOSP descarta updates por encima de **5/s por paquete** (`DEFAULT_MAX_NOTIFICATION_ENQUEUE_RATE = 5f`) → ≤1/s; iOS no tiene notificación persistente actualizable (Live Activity, y en iOS 26 `BGContinuedProcessingTask`) | AOSP `NotificationManagerService.java` L426-427 |

Salidas, en orden de coste:

- **(a) Decir la verdad, sin código de plataforma.** Copy de Android igual a `noteIos`, retirar el
  permiso huérfano, y que la UI distinga «subiendo» de «en pausa por el sistema». Coste ~0.
- **(b) Fase 0, sin rebuild (`upload-engine` no).** Todo lo de H1.8 (§3.1) más: reutilizar la cola
  SQLite como journal de partes con ETags y verificar al arrancar con `HEAD`/`ListParts` qué quedó
  subido. No hace que la subida continúe con la app cerrada —eso no lo da ninguna API actual— pero sí
  que **no se pierda nada** al matar el proceso. Es lo que hacen Immich (cola + `allowPause` por
  ciclos de 9 min) y Nextcloud (`FileUploadWorker` + cola SQLite). Coste S–M.
- **(c) Fase 1, con rebuild: módulo propio `upload-engine`.** Android: `CoroutineWorker` +
  `setForeground(dataSync)` con progreso ≤1/s, y UIDT para subidas iniciadas por el usuario. iOS:
  `URLSession` background con **identificador estable** + `getAllTasks` + `taskDescription` = id de
  ítem, y `BGProcessingTask` como bomba. Coste M–L (semanas de nativo, prebuild, dev-client nuevo,
  revisión de Play). Sin librería que ahorre el trabajo: Notifee descontinuada (abr-2026),
  `expo-foreground-actions` congelada (mar-2024, ~30 s en iOS) y `react-native-background-actions`
  viva pero con la issue de New Architecture abierta.

Un **PUT único** (R2 admite 5 GiB por PUT y el API ya tiene ese tope,
[uploads.ts:270](../apps/api/src/routes/uploads.ts)) no compra durabilidad: la sesión se crea con UUID
aleatorio y en Android el transporte vive en el proceso. Solo evita el bucle JS por partes, así que
entra en (b) como simplificación, no como arreglo del segundo plano.

Recomendación: (a) + (b) en H1; (c) solo si el uso real demuestra que la gente sube vídeos largos con
la app cerrada — y entonces, con la medición de H1.8 en la mano para justificar las semanas.

---

## 4. H2 — Operar y medir (semanas 4–8)

**Objetivo:** que un fallo se detecte, se entienda y se recupere sin madrugar.
**Calendario (owner: Luis):** H2.1–H2.2 → S4; H2.3–H2.4 → S5–S6; H2.5–H2.6 → S7–S8.

| ID | Resultado | Trabajo | Evidencia | Semana |
| :--- | :--- | :--- | :--- | :---: |
| **H2.1** | SLOs y alertas | 4 SLOs (respaldo, 5xx, cron, restore), dashboards, alertas y on-call de una persona | Simulación de fallo y alerta recibida | S4 |
| **H2.2** | Entrega reversible | Staging real, deploy por tag, canary, rollback probado, `/version` | Deploy y reversa en staging | S4 |
| **H2.3** | Calidad nativa | E2E Android (Maestro/Detox): onboarding, permiso limitado, 30 MB, kill/resume, restore; matriz API 34/35/36 + un físico | Run por release con artefactos | S5 |
| **H2.4** | Calidad de datos | Contract tests, migraciones desde cero, carga 100k, inyección de fallos, cobertura crítica ≥80 % | CI con presupuesto p95 y cobertura | S6 |
| **H2.5** | Límites D1 (validación remota) | El chunking de `check-hashes`/álbumes/export/reconcile ya está en H1 (I-06); H2 valida contra D1 remoto y añade estrés de 1.200 filas, export 101 álbumes y 500 hashes | <1.000 queries; 500 hashes OK; export 101 álbumes OK | S7 |
| **H2.6** | Coste y capacidad | Modelo R2/D1/Workers/IA/Sentry, presupuesto mensual, alertas, rate limits de abuso | Informe mensual y alerta de gasto | S8 |

**DoD de H2:** SLO con alerta probada; staging + rollback; E2E nativo en 2 dispositivos; cobertura y
carga en CI; informe de coste con umbral.

---

## 5. H3 — Producto y sostenibilidad (semanas 9–16)

**Objetivo:** que el respaldo se entienda, se use y se mantenga.
**Calendario (owner: Luis):** H3.1–H3.2 → S9–S11; H3.3–H3.4 → S12–S14; H3.5 → S15–S16.

| ID | Resultado | Trabajo | Evidencia | Semana |
| :--- | :--- | :--- | :--- | :---: |
| **H3.1** | Onboarding y restore comprensibles | Journeys: primer arranque → permisos → primer backup → verificación → liberar espacio → restore; estados vacío/error/offline; notificaciones | Test con 5 usuarios; tiempo al primer backup <5 min | S9 |
| **H3.2** | Accesibilidad e i18n | TalkBack/VoiceOver, roles/labels/acciones, reduce motion, contraste, catálogo de textos | Auditoría y fixes en las 5 pantallas | S10 |
| **H3.3** | Shares y cuenta completos | Paginación, descarga configurable, revocación, re-autenticación para borrar, export ZIP o decisión documentada | Tests de abuso y restore de export | S12 |
| **H3.4** | Plataforma decidida | ADR iOS/Play/PWA; si no, fuera del checklist y del plan | ADR firmado | S13 |
| **H3.5** | Documentación sostenible | ADRs, runbooks, arquitectura, changelog, onboarding técnico | Docs enlazados y revisados | S15 |

**DoD de H3:** usuario nuevo completa el primer backup sin ayuda; a11y auditada; shares/export
probados; decisión de plataforma; documentación operativa completa.

---

## 6. Métricas y SLOs

| Área | Métrica | Objetivo |
| :--- | :--- | :--- |
| Confianza | % de biblioteca seleccionada respaldada | ≥99 % |
| Confianza | Restore exitoso en drill | 100 % |
| Integridad | Checksum mismatch / drift de cuota | 0 |
| Disponibilidad | Upload success / API 5xx | ≥99 % / <0.5 % |
| Operación | Cron diario / alerta <5 min | 100 % / sí |
| Recuperación | RTO / RPO | <4 h / <24 h |
| Seguridad | Hallazgos altos abiertos >30 días | 0 |
| Autorización | Rutas con test A/B de ownership | 100 % |
| Calidad | Cobertura módulos críticos | ≥80 % |
| Calidad | Flake rate / E2E pass | <2 % / ≥99 % |
| Producto | Primer backup completado | ≥80 % de altas |
| Producto | Tiempo al primer backup | <5 min |
| Coste | Coste mensual por usuario | Presupuesto definido |
| Plan | Etapas con evidencia enlazada | 100 % |

---

## 7. Riesgos

| Riesgo | Prob. | Impacto | Mitigación H1/H2 |
| :--- | :---: | :---: | :--- |
| Pérdida de fotos por restore no probado | Media | **Existencial** | H1.5 restore drill + offsite |
| Exposición por IDOR/share | Media | Alto | H1.6 tests A/B + límites |
| Coste por cuota/IA | Media | Alto | H1.2 + H2.6 presupuesto |
| APK obsoleto | Alta | Alto | H1.4 tag + APK + `/version` |
| Incidente sin runbook | Media | Alto | H2.1 alertas + runbooks |
| Burnout / deuda | Media | Alto | H2.6 + H3.5 + presupuesto de mantenimiento |
| Plan teatro | Alta | Medio | Regla de evidencia + revisión semanal |

---

## 8. Decisiones de H1 (propuestas; confirmar en la semana 1)

La crítica externa tiene razón: H1.2/H1.5/H1.7 no pueden cerrarse con estas decisiones abiertas. Se
adoptan como **defaults operativos** y se revisan al cerrar H1:

| # | Decisión | Default propuesto | Estado |
| :-- | :--- | :--- | :---: |
| 1 | Producto personal o multiusuario | **Personal** (una cuenta, sin colaboración); multiusuario pasa a H3.4 | Propuesto |
| 2 | iOS / Play Store en 2026 | **No**; Android + web. iOS queda en P2 y fuera del checklist | Propuesto |
| 3 | RPO / RTO | **RPO 24 h / RTO 4 h** (backup D1 diario + restore drill) | Propuesto |
| 4 | Presupuesto mensual | Definir antes de H2.6; techo inicial: free tier de R2/D1/Workers + Sentry free | Pendiente de cifra |
| 5 | On-call | **Luis, best-effort** (sin 24/7); alertas por email; sin SLA contractual | Propuesto |
| 6 | Cuota 10 GB | **Dura** (`STORAGE_QUOTA_BYTES`); el usuario debe liberar papelera | Propuesto |
| 7 | Plan v2 como tablero único | **Adoptado** el 2026-10-23; `ROADMAP`/`PLAN_GENERAL` históricos con banner | Adoptado |

> Si alguna propuesta no se acepta, se cambia aquí antes de tocar H1.2/H1.5/H1.7.

---

## 9. Backlog no ahora (P2)

Se revisa al cerrar H2; no antes.

| Idea | Por qué esperar | Criterio para promover |
| :--- | :--- | :--- |
| App iOS publicada | Cuenta/perfiles/QA; foco Android/web | H3.4 + presupuesto |
| Álbumes colaborativos | Cambia permisos y shares | H3.3 + threat model |
| PWA/offline completo | Requiere caché de originales | H2.3 + coste |
| Live Photos (HEIC+MOV) | Cambia modelo de media/dedup | H2.4 + datos |
| Reconocimiento de personas | Coste/privacidad | H3.2 + consentimiento |
| Preview de vídeo transcodificado | CPU/coste | H2.6 + demanda |
| Dedup global entre usuarios | Rediseño de claves | H2.6 + ahorro medido |
| Limpieza automática de espacio | Después de cuota/UX | H3.1 + opt-in |

---

## 10. Anexo: evidencia y enlaces

- Investigación técnica completa: [INVESTIGACION_HUECOS_PLAN.md](INVESTIGACION_HUECOS_PLAN.md).
- Revisión de cobertura (insumo del Plan v2): [REVISION_COBERTURA_PLAN.md](REVISION_COBERTURA_PLAN.md).
- Decisiones de diseño: [decisions.md](decisions.md).
- Pruebas: [docs/testing/PLAN_PRUEBAS.md](testing/PLAN_PRUEBAS.md).
- Baseline actual: 144 API + 232 mobile + 31 pipeline; `pnpm lint` 232 archivos; `db:generate` sin
  cambios.
- Etapas 0–5: histórico en la sección 1.3; los detalles de implementación quedan en el historial de
  git y en `docs/fases/`.

**Regla final:** si una tarea no tiene evidencia, no está hecha. Si un horizonte no tiene su DoD, no
se abre el siguiente.
