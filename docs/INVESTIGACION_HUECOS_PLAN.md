# Investigación: huecos del plan de trabajo

> **Estado de aplicación (2026-10-23):** parcial. Se aplicaron snapshots, multipart/cuota y
> documentación; falta la prueba E2E de kill/resume. Además, `/uploads/multipart/complete` colisionaba
> con `/uploads/{id}/complete` (el router lo enviaba al handler single); la ruta correcta es
> `/uploads/multipart/finalize`. El estado vigente y la evidencia se llevan en
> [`PLAN_MEJORAS.md`](PLAN_MEJORAS.md) (Plan v2).
>
> **Fecha:** 2026-10-23 · **Alcance:** `docs/PLAN_MEJORAS.md` (plan vigente), `ROADMAP.md`,
> `docs/PLAN_GENERAL.md`, código de `apps/api` y `apps/mobile`, workflows, scripts y docs de operación.
> **Método:** auditoría estática del árbol actual + suite local + un experimento controlado de migraciones.
> **Regla de lectura:** una casilla `[x]` solo cuenta si existe una prueba reproducible de su criterio
> de aceptación. Este documento no modifica el plan; lo audita.

---

## 0. Veredicto en una página

**El plan está cerrado en el tablero, no en la realidad.** De las 6 etapas de `PLAN_MEJORAS.md`,
ninguna tiene evidencia completa de su criterio de aceptación; 2 fallan en el criterio central y el
resto son parciales. El propio *Definition of Done* del plan sigue con las 7 casillas en `[ ]`.

Los bloqueantes P0 se agrupan en tres frentes (cinco hallazgos) y hay que arreglarlos antes de decir “100%”:

1. **La subida multipart nativa nunca completa.** Todo archivo > 20 MB (es decir, prácticamente todos
   los vídeos) sube las partes, pero llama al endpoint equivocado al final; el objeto nunca se ensambla
   y el ítem acaba en `failed`. La web sí usa el endpoint correcto.
2. **La cuota se puede saltar por dos vías.** `/uploads/multipart/complete` no valida el tamaño real
   del objeto; se puede declarar 1 byte y almacenar 5 GiB. Además, re-iniciar una subida `pending`
   no vuelve a reservar cuota y permite superar el máximo.
3. **La cadena de migraciones está rota para el próximo `db:generate`.** El journal tiene 13 entradas
   y `meta/` solo 11 snapshots; el generador vuelve a emitir `ALTER TABLE ... ADD` de cuatro columnas
   que ya existen. Reproducido en esta sesión y revertido.

Y cuatro huecos de entrega/operación que explican por qué “100%” no significa “entregado”:

- **No hay release de app (APK) con el trabajo del plan.** El último tag es `v1.0.9` (`93c469c`, 20-oct), anterior
  a `23b6c54` (plan) y a `9665a5d`. Ningún APK publicado es posterior al commit del plan; el flujo
  de release se dispara por tag y no se creó ninguno.
- **CD directo a producción sin staging, aprobación ni rollback declarados.** Cada push a `master` migra D1
  remoto y despliega; el workflow no define entorno intermedio ni runbook de reversa.
- **Los gates post-deploy son decorativos.** El smoke corre con `--optional` y siempre sale 0; la
  auditoría de producción nunca devuelve código de error; R2 ni siquiera se audita en CI.
- **No hay heartbeat del cron ni alertas versionadas en el repo.** Un fallo del cron o del backup no
  avisa a nadie.

**En una frase:** el plan demuestra que se escribió código; no demuestra que el respaldo funcione para
el caso que lo justifica (vídeos grandes), ni que el resultado esté publicado, ni que un fallo se detecte.

### Semáforo por etapa

| Etapa | Qué prometía | Estado real | Veredicto |
| :--- | :--- | :--- | :---: |
| **0** | Docs coherentes, checklist operativo, 413 bien distinguido, invalidación única | Invalidación y 413 corregidos; `decisions.md` sigue con pendientes; README/ROADMAP/AGENTS desincronizados | ⚠️ Parcial |
| **1** | Cuota atómica, sweep con cursor, papelera acotada, backups verificables | Cuota atómica solo para altas nuevas; sweep y paginación sí; backups manuales y sin restore drill; `trash/empty` omite previews | ⚠️ Parcial |
| **2** | Paginación real, salto directo, FTS5, presupuesto de latencia medido | Paginación/FTS5 sí; sin medición; álbum remoto, papelera y UI siguen sin paginar; límites D1 de 100 parámetros | ⚠️ Parcial |
| **3** | Subida reanudable, preview, galería sin tope, desglose de cuota | Multipart nativo roto, reanudación rota, web guarda el archivo entero, visor web descarga el original, cola nativa topada en 2.000 | ❌ No cumple |
| **4** | Verificación de email, sesiones, borrado/export, shares con caducidad y sin originales, Android mínimo | Sesiones y borrado sí; export es JSON con URLs de 12 h; shares sin rate limit ni flag de descarga; verificación sin reenvío ni redirect; IDOR de portada | ⚠️ Parcial |
| **5** | E2E nightly, expo-doctor/build web en PR, cobertura, CD en tag con rollback, staging, heartbeat/alertas, checklist nativo | E2E y CD existen; faltan staging, rollback, cobertura, build web en PR, heartbeat, alertas y gate nativo; no hay tag | ❌ No cumple |

**Ninguna etapa está “completamente verificada”.** Dos fallan en el criterio que las define; cuatro
son parciales. El detalle, con evidencia y experimento de cierre, está en las secciones 3 y 4.

---

## 1. Qué se auditó y cómo

### 1.1 Documentos

- `docs/PLAN_MEJORAS.md` — plan vigente, 6 etapas, 342 líneas.
- `ROADMAP.md` — 5 fases iniciales, marcadas 100%.
- `docs/PLAN_GENERAL.md` — 22 fases, todas `[x]`.
- `docs/decisions.md` — decisiones de hardening y pendientes operativos.
- `docs/testing/PLAN_PRUEBAS.md`, `docs/testing/PLAN_IMPLEMENTACION_DEVIN.md`, `docs/ops/*`,
  `docs/backup-321.md`, `AGENTS.md`, `README.md`.

### 1.2 Código y automatización

- API: `apps/api/src/{routes,lib,cron,db}`, `apps/api/migrations`, `apps/api/test`, `wrangler.jsonc`.
- Móvil: `apps/mobile/src/{queue,lib,web,app,api}`, `app.json`, `eas.json`, `e2e`.
- CI/CD: `.github/workflows/{ci,backup-d1,release-apk}.yml`, `scripts/*.mjs`.
- Contratos: `packages/shared/src/{schemas,constants}.ts`.

### 1.3 Suite ejecutada

| Comando | Resultado |
| :--- | :--- |
| `pnpm lint` | 223 archivos, 0 errores |
| `pnpm typecheck` | 2 paquetes OK (turbo reutilizó caché) |
| `pnpm --filter @photos/api test` | 18 archivos, **132 tests**, 188,6 s |
| `pnpm --filter @photos/mobile test` | 21 archivos, **228 tests**, 5,3 s |
| `pnpm test:pipeline` | **27/27** |

> Nota de entorno: el primer `pnpm test` falló porque el binario nativo de `workerd` faltaba en
> `node_modules` (instalación incompleta del binario nativo). Se reparó con `node node_modules/workerd/install.js`;
> no es un defecto del repositorio. La suite quedó verde con el árbol actual, incluidos los cambios
> sin commitear.

### 1.4 Lo que **no** se pudo verificar

- **E2E Playwright**: no hay `apps/api/.dev.vars` ni credenciales R2 en este entorno. El E2E escribe
  en el bucket real `photos-media-dev`; no se ejecutó.
- **Nativo**: sin dispositivo/emulador; el checklist nativo es manual.
- **Producción**: sin acceso al dashboard, secretos ni D1/R2 reales; no se corrió `audit-prod.mjs`.
- **Carga/concurrencia real**: los límites de D1 se contrastaron con la documentación oficial
  ([100 bindings/consulta, 1.000 consultas/invocación en Paid](https://developers.cloudflare.com/d1/platform/limits/)),
  no con un D1 remoto.
- **Exploits**: se describen y se proponen tests; no se ejecutaron contra producción.

---

## 2. El plan frente a la evidencia

### 2.1 Tres tableros que no se hablan

| Documento | Qué contiene | Problema |
| :--- | :--- | :--- |
| `ROADMAP.md` | Fases 1–5, 100% | No menciona `PLAN_MEJORAS`; cifras de tests de hace varias semanas |
| `docs/PLAN_GENERAL.md` | Fases 1–22 con commit | Termina en la Fase 22; no incluye las etapas 0–5 |
| `docs/PLAN_MEJORAS.md` | Etapas 0–5, todas `[x]` | Es el único que describe el trabajo reciente; no lo enlaza nadie |

`README.md` dice “El plan de fases y sus commits viven en `docs/PLAN_GENERAL.md`”, que ya no es
cierto para el trabajo posterior. Un lector nuevo no tiene una fuente única de verdad.

Además:

- `PLAN_MEJORAS.md` afirma que `README` dice 46/116 y que `PLAN_IMPLEMENTACION_DEVIN` sigue en `[ ]`;
  ambas cosas ya cambiaron (el segundo está `[x]`). El plan se escribió como *changelog*, no como
  planificación: el documento se añadió con las 6 etapas ya en `[x]` en el commit de cierre
  (`23b6c54`), no como un plan previo a la implementación.
- Las cifras reales no coinciden: **132 tests API + 228 mobile** (hoy), README 118/223,
  `PLAN_MEJORAS` ~95/~195, `ROADMAP` 39/97.
- El *Definition of Done* (sección 6) sigue con las 7 casillas en `[ ]`, incluida “plan de rollback”.
- No hay propietario, fecha, presupuesto, registro de riesgos, métricas de éxito ni criterio de
  “siguiente etapa”. Tampoco un backlog después de la etapa 5.

### 2.2 Lo que sí está bien (para no tirar lo bueno)

- Cuota atómica para **altas nuevas**: `reserveStorageQuota` con `WHERE (used + reserved + bytes) <= max`
  y test concurrente con `Promise.all` (`apps/api/test/uploads.test.ts:169`).
- Sweep de huérfanos con cursor persistente en `system_state`, no reinicia en cada corrida.
- `GET /trash` paginado por cursor y `POST /trash/empty` acotado a 250.
- Búsqueda FTS5 con triggers de inserción/actualización/borrado.
- Preview WebP de 1.600 px generada al subir y servida en el carrusel nativo.
- Sesiones listables/revocables, borrado de cuenta y exportación de metadatos.
- CI con lint/typecheck/tests/E2E, deploy automático, backup D1 diario con `sha256` y dry-run SQLite.
- Tests de cola, processor, cuota, papelera y E2E web; el árbol actual pasa lint, typecheck y 360 tests.

El problema no es que no se haya hecho nada: es que el plan mide “código escrito”, no “capacidad
verificada y entregada”.

---

## 3. Hallazgos priorizados

### 3.1 P0 — bloquean release / integridad

#### I-01 · La subida multipart nativa nunca completa

**Evidencia.** En nativo, todo archivo > 20 MB entra en la rama multipart y, tras subir las partes,
llama `api.completeUpload(init.id)` (`apps/mobile/src/queue/processor.ts:236-345`, línea 345). Ese
endpoint solo hace `HEAD` del original (`apps/api/src/routes/uploads.ts:475-497`); un multipart no
materializa el objeto hasta `CompleteMultipartUpload`. La variante web sí llama
`api.multipartComplete` (`apps/mobile/src/queue/processor.web.ts:237`).

**Impacto.** El `HEAD` devuelve 409 `object_missing`; el ítem se reintenta 6 veces y termina `failed`.
Los PUT de las partes sí salieron a R2, pero no hay objeto final. **Ningún vídeo o foto > 20 MB se
respalda en Android/iOS**, que es el caso de uso principal. Contradice la etapa 3 `[x]` y el criterio
“un vídeo de 1 GB completa”.

**Confianza.** Alta (estático y contractual). No se reprodujo en dispositivo; se propone test con
`fileSize > 20 MB` que espere `multipartComplete` (hoy `processor.test.ts` solo mockea `initUpload`/
`completeUpload` con tamaño 1.000).

**Cierre.** Llamar `multipartComplete` en nativo, igual que web; test unitario que falle si se llama
`completeUpload` en la rama multipart; prueba manual con un vídeo de 30 MB.

#### I-02 · `/uploads/multipart/complete` no valida tamaño ni MIME: bypass de cuota

**Evidencia.** El endpoint comprueba que existen thumb/original/preview, pero **no** compara
`head().size` con lo declarado y luego ejecuta `confirmStorageUsage` con los bytes declarados
(`apps/api/src/routes/uploads.ts:855-915`). El flujo single sí valida tamaños y MIME
(`uploads.ts:516-559`). `presignUploadPart` no firma `content-length` (`apps/api/src/lib/s3.ts:193-207`)
y `totalParts` se deriva del `fileSize` declarado (`uploads.ts:760-761`).

**Impacto.** Una cuenta autenticada puede iniciar multipart con `fileSize: 1`, `thumbSize: 1`,
`previewSize: 1`, subir una parte de 6 MiB y completar: R2 guarda 6 MiB y D1 contabiliza 3 bytes.
Es repetible con SHA distintos; la cuota de 10 GB deja de ser un control de coste. Además, un
ensamblado truncado se marca `ready` sin verificación.

**Confianza.** Alta. Es el hallazgo de mayor severidad económica; no se ejecutó el exploit.

**Cierre.** Validar `size` (y `contentType`) de los tres objetos en `multipartComplete`, como en el
single; si no coincide, borrar el objeto y devolver 409. Test: init 1/1/1, parte de 6 MiB, complete →
409 y `used_bytes` sin cambios.

#### I-03 · La “reanudación” multipart no reanuda

**Evidencia.** Cada intento llama `multipartInit` (`processor.ts:237`), que **siempre** crea una MPU
nueva (`uploads.ts:691-702`). No hay columna `upload_id` en D1 (`apps/api/src/db/schema.ts:65-132`).
El cliente nunca manda `item.upload_id` y reutiliza los etags viejos de `item.parts`
(`processor.ts:280-296`); `recoverInterrupted` conserva `parts`/`upload_id` y solo resetea el estado
(`apps/mobile/src/queue/db.ts:396-402`; web `db.web.ts:187-195`). Al reanudar se omiten partes que no
existen en la nueva MPU y se completa con etags de la anterior.

**Impacto.** Cualquier corte después de la primera parte deja partes viejas que envenenan todos los
reintentos: `/multipart/complete` devuelve 409 y el ítem acaba `failed`. En nativo se suma I-01. Cada
reintento deja además una MPU huérfana con partes (coste de almacenamiento hasta que el cron la aborte).
Contradice la etapa 3 `[x]` y el criterio “matar la app/recargar la pestaña y reanudar”.

**Confianza.** Alta. El E2E de persistencia (`queue-persistence.spec.ts:191`) solo prueba un JPEG
pequeño y retiene `/init`, no multipart.

**Cierre.** Persistir `uploadId` en D1 y reutilizarlo (o abortar la MPU anterior y reiniciar limpio);
enviar `uploadId` desde el cliente; test que sube la parte 1, simula caída y verifica que la segunda
pasada completa sin re-subir todo.

#### I-04 · La cadena de migraciones está desalineada

**Evidencia.** `_journal.json` tiene 13 entradas (`0000`–`0012`), pero `meta/` solo 11 snapshots
(`0000`–`0010`). `0011_preview_and_multipart.sql` y `0012_share_expiration_and_revocation.sql` se
añadieron a mano sin snapshot. El esquema actual ya incluye esas columnas
(`schema.ts:88,91,173-174`).

**Reproducido en esta sesión.** `pnpm --filter @photos/api db:generate` generó
`0013_omniscient_frank_castle.sql` con:

```sql
ALTER TABLE `album` ADD `share_expires_at` integer;
ALTER TABLE `album` ADD `share_revoked_at` integer;
ALTER TABLE `media` ADD `r2_key_preview` text;
ALTER TABLE `media` ADD `preview_size` integer;
```

Es decir, la próxima migración volverá a añadir columnas existentes. Se restauró el estado original
(`git status apps/api/migrations` limpio).

**Impacto.** El próximo `db:generate` + deploy aplica `ALTER TABLE ... ADD` sobre columnas existentes:
`duplicate column`, migración fallida y deploy bloqueado (o peor, aplicado a medias). No hay staging
que lo detecte.

**Cierre.** Generar los snapshots de `0011`/`0012` o rehacer la cadena; comprobar en CI que
`journal.entries.length === snapshots.length` y que `db:generate` no produce SQL nuevo.

#### I-05 · La cuota también se salta re-iniciando una subida `pending`

**Evidencia.** `bytesToReserve = existing?.status === "pending" ? 0 : totalBytes`
(`uploads.ts:316-317`). Un re-init del mismo SHA sobrescribe `fileSize`, `thumbSize` y `previewSize`
sin ajustar la reserva (`uploads.ts:403-409`); `/complete` resta el total nuevo del pool global de
`reserved_bytes` (`uploads.ts:577-579`, `storage-stats.ts:10-19`).

**Impacto.** Con `used ≈ 9,9 GB`, un init de 100 MB reserva 100 MB; un re-init del mismo SHA con 5 GB
no reserva nada; al completar, `used` puede quedar en 14,9 GB. También consume reservas de otras
subidas. La cuota atómica solo protege altas nuevas, no reintentos.

**Cierre.** Si `existing` es `pending`, reservar la diferencia (`nuevoTotal - reservado`) o rechazar
el cambio de tamaño; test con `max_bytes` pequeño y re-init mayor.

### 3.2 P1 — producto, seguridad y operación

#### I-06 · Límite de 100 parámetros de D1 en endpoints por lote

**Evidencia.** D1 admite **100 parámetros vinculados por consulta**. `check-hashes` acepta 500 hashes
(`packages/shared/src/schemas.ts:149-151`) y los pasa a `inArray` (`uploads.ts:219-229`): 98 hashes ya
son 101 bindings (3 condiciones fijas + 98). `addAlbumMedia` acepta 500 IDs (`schemas.ts:363-365`) e `inArray` (`albums.ts:607-610`):
100 IDs fallan. `createAlbum` no limita `mediaIds` (`schemas.ts:353-357`). Export usa `inArray` con
todos los álbumes (`user.ts:209-214`); `reconcileStorageStats` con todos los usuarios
(`storage-stats.ts:316-320`).

**Impacto.** `free-space.ts:41-48` envía **todos** los hashes sincronizados; con > 500 da 400 y con
99–500 da 500. El `catch` devuelve `[]` y “Liberar espacio” no borra nada, sin explicar por qué. Con
> 100 álbumes la exportación falla; con > 100 usuarios falla la última query del cron. La suite local
(Miniflare) no reproduce el tope.

**Cierre.** Chunking de 50–90 IDs por consulta o `json_each`; límites de array coherentes; tests que
cuenten placeholders y un test de integración remoto controlado.

#### I-07 · El cron puede superar las 1.000 consultas D1 por invocación

**Evidencia.** `runCleanup` procesa hasta 10 × 500 filas `pending` y 10 × 500 de papelera, con **una
query por fila** (`releaseStorageReservation`/`removeStorageUsage`; `cleanup.ts:42-88`). Después vienen
sesiones, reconcile, sweep y abort de MPUs (`cleanup.ts:119-122`). Con ~500 pending + ~500 trash ya se
supera el presupuesto de 1.000 queries de Workers Paid (50 en Free).

**Impacto.** Al superar el tope, el cron falla y **no** ejecuta reconcile, sweep ni abort: la papelera
queda a medias, los objetos siguen facturando y el fallo se repite cada día con el mismo stock. No hay
heartbeat que lo detecte.

**Cierre.** Agrupar los ajustes de cuota por usuario en una sola query (`SUM` por `user_id` y un
`UPDATE` por usuario) o usar `batch()`; test con un proxy D1 que cuente statements y 1.200 filas.

#### I-08 · `trash/empty` omite previews, no libera reservas y puede descontar dos veces

**Evidencia.** Borra solo `r2KeyThumb` y `r2KeyOriginal` (`media.ts:545`) y suma solo
`fileSize + thumbSize` (`media.ts:556-560`); el cron sí incluye preview y `previewSize`
(`cleanup.ts:73-85`). No comprueba `changes` antes de descontar y llama `removeStorageUsage` en cada
invocación (`media.ts:535-564`): dos vaciados concurrentes descuentan dos veces. Una fila
`pending + deletedAt` se borra sin `releaseStorageReservation`.

**Impacto.** El preview queda huérfano en R2 y la cuota no baja por él; la concurrencia puede dejar
`used_bytes` por debajo del real y permitir sobrepasar la cuota; una reserva pending queda inflada.

**Cierre.** Incluir preview en claves y bytes; descontar una sola vez por fila (o `DELETE ... RETURNING`
+ cálculo); liberar reserva si `pending`; test con preview y dos POST concurrentes.

#### I-09 · El álbum público no pagina, no limita y siempre entrega originales

**Evidencia.** `shared.ts:61-92` devuelve **todos** los ítems y tres URLs prefirmadas por ítem
(thumb, original, download), sin límite, paginación ni `Cache-Control`. `index.ts:80-100` exime
`/v1/shared/*` del rate limit; los limiters solo cubren `/uploads/init` y `/multipart/init`. No existe
flag para desactivar la descarga de originales (la migración `0012` solo añade expiración/revocación);
siempre se devuelve `downloadUrl`.

**Impacto.** Un álbum de 10.000 fotos genera 30.000 firmas y un JSON enorme por request; sin rate
limit ni caché es un amplificador de CPU/coste. Cualquiera con el enlace descarga originales, y no se
puede revocar la descarga sin revocar todo el enlace. Contradice la etapa 4 `[x]` y “ninguna ruta
devuelve listas ilimitadas” de la etapa 2.

**Cierre.** Paginar por cursor, limitar/cachear, flag `allowOriginalDownload` y rate limit en
`/v1/shared/*`; test con álbum grande y 429.

#### I-10 · IDOR en `coverMediaId`: portada de otro usuario

**Evidencia.** `updateAlbum` acepta cualquier `coverMediaId` sin comprobar pertenencia
(`albums.ts:509-513`). `getAlbum`/`listAlbums` buscan la portada solo por `id` y `deletedAt`
(`albums.ts:452-457`, `243-248`) y devuelven `coverThumbUrl` prefirmada (`471-472`, `263`). Los
enlaces públicos exponen ids de media (`shared.ts:71`).

**Impacto.** B puede tomar el id de una foto de A (por ejemplo, de un álbum compartido) y ponerla como
portada de su álbum; la API le devuelve una URL firmada de la miniatura de A, incluso después de
revocar el share. Es una fuga de lectura entre usuarios, no solo un error de UI.

**Cierre.** Validar `coverMediaId` contra `media.userId = user.id` en update/create; test de dos
usuarios con PATCH cruzado → 400/404.

#### I-11 · Verificación de email: bloqueo silencioso y sin salida

**Evidencia.** Tras 7 días sin verificar, `/uploads/init` y `/multipart/init` devuelven 403
`email_unverified` (`uploads.ts:238-248`, `616-627`). Ambos procesadores tratan **todo** 403 como
sesión caída: reencolan y cortan la pasada sin `last_error` (`processor.ts:571-576`,
`processor.web.ts:471-478`). No hay pantalla, llamada de reenvío ni endpoint de reenvío en el
cliente. El enlace de verificación usa `callbackURL=%2F` (API), no la web ni `photos://`.

**Impacto.** Si Resend no está configurado en producción, el correo nunca llega; a los 7 días el
respaldo se detiene sin aviso y el usuario no tiene forma de desbloquearlo desde la app. Si el enlace
se abre, aterriza en la raíz del API (404), no en la app.

**Cierre.** Botón “reenviar verificación” y pantalla de estado; `callbackURL` a la web/app; tratar
`email_unverified` como error de producto (no como 401) y mostrarlo; decidir si el periodo de gracia
se activa solo con Resend configurado.

#### I-12 · La cola nativa sigue topada en 2.000 (y la web en 20.000)

**Evidencia.** `getQueueItems(limit = 2000)` (`apps/mobile/src/queue/db.ts:362`); todos los
consumidores lo llaman sin límite: `free-space.ts:17`, `progress.ts:75`, `use-hybrid-gallery.ts:122`
y `:166`. Existe `offset`, pero nadie pagina. Web usa 20.000 (`db.web.ts:440`).

**Impacto.** Con > 2.000 elementos respaldados, “Liberar espacio” ignora los antiguos,
`hasLocalCopy`/`deleteLocalCopy` fallan, el anillo de progreso no cuadra con `getQueueStats()` y la
galería muestra estados distintos en nativo y web. Contradice M-08 y la etapa 3 `[x]`.

**Cierre.** Cursor/ventana en la cola o al menos un límite alto y paginado; tests con 2.501 filas y
una `queued` antigua.

#### I-13 · Web: el archivo entero va a IndexedDB y el visor descarga el original

**Evidencia.** `enqueueAsset` hace `await file.arrayBuffer()` y lo persiste en una sola fila
(`db.web.ts:296-306`); no hay `navigator.storage.persist()`. El visor web pasa `currentOriginalUrl`
a `WebImageViewer` (`media/[id].tsx:1321-1325`), que solo usa `uri || thumbUrl` (`:446-480`); la
preview se calcula pero no se usa en esa rama. En web `createVideoPreview` devuelve `null`
(`video-optimizer.web.ts:45-48`).

**Impacto.** Un vídeo grande ocupa RAM al elegirlo y otra copia al persistirlo; el navegador puede
lanzar `QuotaExceededError` o desalojar IndexedDB y perder pendientes. Abrir una foto remota en web
sigue descargando el original completo; no se cumple el objetivo de < 500 KB.

**Cierre.** Chunks de archivo en IndexedDB con `storage.persist()`; usar `previewUrl` en
`WebImageViewer` y reservar el original para zoom/descarga; test de Playwright que intercepte
`/originals/` al abrir.

#### I-14 · Álbum remoto, papelera y salto temporal sin paginar en la UI

**Evidencia.** `api.albumDetail(albumId)` sin cursor (`use-hybrid-gallery.ts:102-106`; default 60);
`onEndReached` pagina el timeline, no el álbum (`(tabs)/index.tsx:957-960`). `api.trash()` sin cursor
(`trash.tsx:15`; default 100), sin `onEndReached`. El salto temporal fija `timelineBefore`
(`index.tsx:452-455`, `:1014`) y solo lo limpia el pull-to-refresh (`:965`); `before` forma parte de
la queryKey (`timeline.ts:11-15`).

**Impacto.** Un álbum > 60 muestra solo 60; una papelera > 100 solo 100; tras saltar a 2016 el
timeline queda anclado a “≤ 2016” y los remotos más nuevos sin copia local desaparecen hasta refrescar.
Contradice las etapas 1 y 2 `[x]`.

**Cierre.** Cursor en álbum/papelera con `onEndReached`; limpiar `timelineBefore` al volver arriba o
al cambiar de filtro; tests de 120 elementos y salto/retorno.

#### I-15 · Entrega: no hay release con el plan y el CD no tiene reversa

**Evidencia.** El release se dispara por tag (`release-apk.yml:3-5`). El último tag es `v1.0.9`
(`93c469c`, 20-oct), y `git tag --contains 23b6c54` está vacío: **según el repositorio**, ningún APK
contiene las etapas 0–5. El deploy se dispara en cada push a `master`, aplica migraciones remotas y
despliega API y web (`ci.yml:98-148`), sin `environment`, aprobación ni rollback en el workflow. El
smoke corre con `--optional` (`ci.yml:141-145`; `prod-smoke.mjs:143-149`) y `audit-prod.mjs` no
devuelve error por drift/huérfanos.

**Impacto.** Los usuarios de APK no tienen previews, multipart, sesiones ni borrado de cuenta; el
“100%” no está entregado. Un deploy/migración mala no tiene reversa; el smoke puede estar verde con
la subida rota; el audit no bloquea.

**Cierre.** Tag + APK después de los P0; deploy por tag con `environment` y aprobación; staging real;
smoke bloqueante; `audit-prod` con exit code; runbook de rollback probado.

#### I-16 · Backups: manuales, en el mismo bucket y sin restore drill

**Evidencia.** `backup-r2.mjs` solo se ejecuta a mano (`package.json:22`), registra `errorCount` pero
termina en `exit 0` (`backup-r2.mjs:267-283`), para ETags multipart cae a comparación de tamaño
(`:225-247`) y `--verify-sample` solo valida `originals` (`:127-160`). El backup D1 sube a
`photos-media/backups/d1/`, el **mismo bucket** de producción (`backup-d1.yml:85-90`); la retención
de 90 días es un comando manual (`docs/ops/D1_BACKUP.md:46-59`); el restore es manual y no hay
evidencia de un drill.

**Impacto.** Un backup parcial se reporta como éxito; la pérdida de la cuenta/bucket se lleva catálogo
y backup; la copia 3-2-1 real no está automatizada. El criterio “restore probado al menos una vez” no
está acreditado.

**Cierre.** `exit 1` si `errorCount > 0`; job programado con `--verify-sample`; destino separado;
lifecycle verificado en CI; restore mensual a una base nueva con smoke.

**Estado (2026-10-29).** Cerrado en código: `exit 1` ante cualquier fallo o bucket vacío
(`scripts/lib/backup-r2-result.mjs` + `scripts/backup-r2-result.test.mjs`), destino separado
(`photos-backups` con *Guard* en `backup-d1.yml`), verificación semanal
(`.github/workflows/backup-r2-verify.yml`). Queda el restore mensual firmado, que necesita secrets
reales y decisión de fecha.

#### I-17 · Sin heartbeat ni alertas; telemetría sin destino

**Evidencia.** El handler solo hace `ctx.waitUntil(runCleanup(env))` (`index.ts:133-135`); no hay
`cron_last_run` ni monitor versionado en el repo. `wrangler.jsonc` no declara
`analytics_engine_datasets`, aunque `Bindings.ANALYTICS` existe y `recordApiMetric` cae a
`console.log`. Sentry es opcional y el `check-sentry` de CI usa el secret de GitHub, no el del Worker
(`--optional` sale 0).

**Impacto.** Si el cron deja de correr, se acumulan papelera, reservas y huérfanos sin aviso; si el
backup falla, nadie se entera; las métricas de subida no llegan a ningún dashboard.

**Cierre.** Persistir `cron_last_run` y alertar si `now - last_run > 26 h`; alertas de drift,
huérfanos, 5xx y backup; binding de Analytics o eliminar el código muerto; healthcheck real.

#### I-18 · El plan no es un plan operativo

**Evidencia.** Las 6 etapas están `[x]` sin commit, fecha ni evidencia; el DoD está `[ ]`; no hay
riesgos, dependencias externas, presupuesto ni criterio de salida. `decisions.md:151-155` sigue
marcando `AUTH_LIMITER` y Resend como pendientes, aunque la etapa 0 se marcó `[x]`. Las cifras de
tests y el estado de `PLAN_IMPLEMENTACION_DEVIN` que cita el plan ya son falsos.

**Impacto.** Una sesión futura no sabe qué está hecho, qué falta ni qué se puede romper. El “100%” es
una convención social, no un estado verificable.

**Cierre.** Un solo tablero, una fila por entrega con evidencia (comando/test/artefacto), DoD aplicado
por etapa y un backlog posterior a la etapa 5.

### 3.3 P2 — deuda que no bloquea, pero se acumula

| ID | Hallazgo | Evidencia | Por qué importa |
| :--- | :--- | :--- | :--- |
| I-19 | Web sin CSP/HSTS/X-Frame-Options | `apps/mobile/wrangler.jsonc` no tiene `_headers`; solo el API añade 3 cabeceras (`apps/api/src/index.ts:33-57`) | El token Bearer vive en `localStorage`; un XSS lo exfiltra |
| I-20 | Privacidad de IA/geocodificación | `lib/ai.ts` envía miniaturas a Workers AI; `lib/geo.ts` envía GPS a BigDataCloud/Nominatim | Sin aviso ni opt-out; contradice el objetivo de privacidad de la etapa 4 |
| I-21 | Borrado de cuenta sin re-autenticación y export no restaurable | `user.ts:239-301` no pide contraseña; `user.ts:170-238` devuelve JSON con URLs de 12 h, no ZIP | Una sesión robada borra todo; la exportación no se puede restaurar |
| I-22 | Reconciliación de 2 h borra subidas activas | `storage-stats.ts:170-187` elimina `pending` con `updatedAt > 2 h`; una subida multipart no toca D1 durante las partes | Un vídeo lento puede perder su fila y fallar el `complete` |
| I-23 | Purga de MPUs sin paginación | `abortStaleMultipartUploads` lista solo la primera página de 1.000 (`s3.ts:291-294`) | Mismo patrón que el bug de huérfanos que se corrigió en la etapa 1 |
| I-24 | 5 GiB no se puede presignar de una vez | `partNumbers.max(1000)` y partes de 5 MiB → 1.024 partes (`schemas.ts:118-122`, `constants.ts:40`) | Archivos > ~4,88 GiB fallan al pedir todas las URLs |
| I-25 | Permisos limitados/revocados silenciosos | `permissions.ts:4-5` solo devuelve `granted`; no lee `accessPrivileges` | Android 14/iOS limitado respalda un subconjunto y dice “todo al día” |
| I-26 | Background no respeta la ventana del SO | `background.ts:28-34` fija `deadlineMs` después del scan; partes sin sesión background | El respaldo grande solo avanza con la app abierta |
| I-27 | Temporales y memoria sin `finally` | `processor.ts:307-319` borra la parte solo si el PUT resuelve; previews no se limpian si falla `init` | Caché de cientos de MB y OOM en gama media |
| I-28 | Accesibilidad | celdas sin rol/fecha/estado (`index.tsx:126-127`), scrubber solo-gesto (`FastScrubber.tsx:169-174`) | TalkBack/VoiceOver no puede usar la galería |
| I-29 | Documentación desincronizada | README 118/223; ROADMAP 39/97; AGENTS solo `thumbs/` y `originals/`, sin `previews/`; `decisions.md` describe 413 como pausa total, el código distingue `file_too_large` | Los agentes y humanos toman decisiones con datos falsos |
| I-30 | Trabajo sin commitear fuera del plan | 25 archivos modificados + 2 untracked, 1.294 inserciones (cabeceras, purge multipart, admin reconcile, D1 retry, telemetría, drag&drop, atajos) | No está en ningún tablero ni en el commit desplegado; se puede perder |
| I-31 | CI no valida el artefacto web ni cobertura | `ci.yml:39-49` solo corre Biome/typecheck/tests/pipeline; no hay `expo-doctor`, `build:web`, `expo lint` ni coverage; el E2E usa `expo start`, no el export (`playwright.config.ts:44-53`) | Un PR verde no garantiza un build desplegable; la promesa de cobertura de la etapa 5 no existe |

---

## 4. Investigaciones detalladas

### 4.1 Multipart: tres fallos encadenados

El flujo actual, simplificado:

```text
Nativo:
  multipartInit() -> MPU nueva (up1)
  PUT partes 1..N a up1
  completeUpload(id)        <-- endpoint equivocado: HEAD del original
  -> 409 object_missing (el MPU no se completó)
  -> reintento: multipartInit() -> MPU nueva (up2), reusa partes de up1
  -> complete(up2) con etags de up1 -> 409
  -> failed tras MAX_ATTEMPTS

Web:
  multipartInit() -> up1
  PUT partes 1..N a up1
  multipartComplete(up1) -> OK
```

Tres defectos independientes:

1. **Endpoint equivocado en nativo** (I-01): una línea; afecta a todo > 20 MB.
2. **Reanudación mal modelada** (I-03): el servidor no conoce la MPU; el cliente no puede reanudar
   contra una MPU nueva con etags viejos.
3. **Sin validación de tamaño** (I-02): el servidor confía en los bytes declarados y confirma cuota
   sin mirar el objeto.

**Diseño recomendado (mínimo):**

- Añadir `upload_id` (y `upload_parts` o `parts_etags`) a `media`, o una tabla `upload_parts`.
- `POST /uploads/multipart/init` devuelve la MPU existente si la fila `pending` ya tiene `upload_id`
  y no ha expirado; si expiró, aborta y crea una nueva.
- `POST /uploads/multipart/complete` valida `parts.length === totalParts`, `head().size === fileSize`,
  `contentType` y `thumbSize`/`previewSize` antes de `ready` y `confirmStorageUsage`.
- Si R2 completó pero D1 falló, el reintento debe detectar el objeto (`HEAD`) y marcar `ready` sin
  volver a completar; o hacer `complete` idempotente por `upload_id` + `ETag`.
- Test de aceptación real: vídeo de 30 MB, cortar red al 80 %, matar app/recargar pestaña, reanudar y
  verificar que se suben solo las partes faltantes y que el objeto final pesa lo declarado.

### 4.2 Cuota: dos puertas traseras

La cuota atómica está bien pensada para **altas nuevas**:

```sql
UPDATE user_storage_stats
SET reserved_bytes = reserved_bytes + :bytes
WHERE user_id = :uid AND (used_bytes + reserved_bytes + :bytes) <= max_bytes
```

Pero hay dos caminos que no pasan por esa condición:

1. **Multipart sin validación** (I-02): declaras 1 byte, subes 5 GiB, `confirmStorageUsage` suma 1.
2. **Re-init de `pending`** (I-05): no reservas la diferencia y `confirm` resta el total nuevo de un
   pool que no lo contenía.

**Prueba de cierre propuesta** (Miniflare, sin red):

- `max_bytes = 2 MB`, `used = 1,5 MB`.
- `init` 0,4 MB → 201 (reserva 0,4).
- Re-init mismo SHA con 2 MB → debe ser 413 (o reservar la diferencia); hoy sería 200.
- Subir 2 MB y `complete` → `used` no puede superar `max_bytes`.
- Multipart `fileSize=1`, parte de 6 MiB → `complete` 409, `used` sin cambios, objeto borrado.

### 4.3 Migraciones: el experimento y el arreglo

El journal y los snapshots son la fuente de verdad de Drizzle. Al faltar los snapshots de 0011/0012,
`db:generate` parte de 0010 y cree que las columnas no existen. El experimento produjo el SQL de
I-04; se restauró el estado.

**Arreglo posible A (preferido):** regenerar la cadena en una rama desechable, crear los snapshots
`0011`/`0012` con el estado real y verificar que `db:generate` no produce nada. Si el esfuerzo es
alto, **B:** squash de 0011/0012 en una migración nueva con snapshots y baseline de producción
(requiere comprobar que las columnas ya existen antes de aplicar).

**Guardarraíl de CI:** un test node que lea `_journal.json` y `meta/*.json`, falle si
`entries.length !== snapshots.length` y falle si `db:generate` sale con SQL nuevo. Es barato y evita
que vuelva a pasar.

### 4.4 Entrega: del commit al usuario

```text
23b6c54 (plan)  -> 9665a5d (headers, purge, drag&drop)  -> master
                                                          |
                                                          +--> CI deploy API/web (push)
                                                          |
v1.0.9 (93c469c, 20-oct) <--------------------------------+  ningún tag después
                                                          |
                                                          +--> release-apk solo por tag
```

Consecuencias:

- El APK que un usuario instala hoy no incluye el cierre de las etapas 0–5 (multipart, previews,
  sesiones, borrado). Aunque I-01 se arregle en código, sin un tag no llega a nadie.
- El deploy de API/web sí ocurre en cada push, pero no hay forma de saber qué commit está vivo
  (no hay `/version`), ni de volver atrás si la migración o el deploy salen mal.
- El smoke de producción usa `e2e-prod-web@example.com` / `password-e2e-123` hardcodeados
  (`prod-smoke.mjs:17-18`), intenta **registrar** la cuenta si no existe (`:94-109`) e imprime el
  prefijo del token (`:141-142`). Si el repo es público, cualquiera conoce esa cuenta; cada deploy
  además deja el media de prueba sin limpiar.
- `audit-prod.mjs` imprime drift/huérfanos pero no sale con error; `ci.yml:103-107` no pasa `R2_*`,
  así que el audit omite R2. El “deploy verde” no prueba nada.

**Cierre mínimo:** tag `v1.1.0` después de los P0; `environment: production` con aprobación; migración
con backup previo y `PRAGMA integrity_check`; smoke bloqueante con usuario/secretos dedicados y
cleanup; `audit-prod` con exit code; runbook de rollback (`wrangler rollback` + restore D1) probado
una vez.

### 4.5 Límites D1: dos números que rompen la escala

| Límite | Valor | Dónde se rompe |
| :--- | :--- | :--- |
| Parámetros vinculados por consulta | **100** | `check-hashes` (500), `addAlbumMedia` (500), `createAlbum` (sin tope), export (todos los álbumes), reconcile (todos los usuarios) |
| Consultas por invocación | **1.000** Paid / **50** Free | cron con una query por fila de cuota (hasta 10.000) |

La suite local no los reproduce; por eso el DoD “100% local” no los detecta. Hay que testear con un
proxy que cuente statements o con un D1 remoto controlado.

---

## 5. Qué haría ahora: Etapa 6 — “Cierre real”

El orden importa: primero se arregla lo que rompe el respaldo, luego lo que lo entrega, luego lo que
lo opera, y al final el producto. No abriría ninguna funcionalidad nueva hasta cerrar los P0
(I-01…I-05).

### Bloque A — “El respaldo respalda” (esta semana)

| # | Trabajo | Cierre verificable | Esfuerzo |
| :-- | :--- | :--- | :---: |
| 0 | Congelar y commitear el árbol actual (25+2 archivos) en commits atómicos; tag `v1.1.0-rc.1` | `git status` limpio; CI verde; tag contiene el commit | S |
| 1 | Multipart nativo: llamar `multipartComplete`; validar tamaño/MIME en servidor; idempotencia | Vídeo 30 MB completa; test de quota bypass 409; test de reintento tras R2 OK/D1 KO | M |
| 2 | Reanudación real: persistir `uploadId`/partes o abortar y reiniciar limpio; no reusar etags de otra MPU | Corte al 80 %, kill/recarga, reanudar; solo partes faltantes | M |
| 3 | Cuota: re-init reserva la diferencia o 413; `trash/empty` incluye preview y no descuenta dos veces | Tests de I-05 e I-08 | S/M |
| 4 | Migraciones: snapshots 0011/0012 o squash; check journal=snapshots; `db:generate` no-op | `db:generate` sin SQL; CI check | S |
| 5 | Release: tag + APK; `/version` con commit; deploy por tag/staging/rollback | APK instalado muestra versión y features; rollback probado | M |

### Bloque B — “La operación avisa” (siguiente)

| # | Trabajo | Cierre verificable | Esfuerzo |
| :-- | :--- | :--- | :---: |
| 6 | Chunking D1 en `check-hashes`, álbumes, export, reconcile; límites de array | 500 hashes → 200; >100 álbumes export OK; test de placeholders | M |
| 7 | Cron por lotes: una query de cuota por usuario; test de 1.200 filas | < 1.000 queries; sweep/reconcile avanzan | M |
| 8 | Backups: R2 `exit 1` si hay errores; job programado; destino separado; restore drill mensual | Backup falla ruidoso; restore a base nueva + smoke | M |
| 9 | Heartbeat/alerta de cron y backup; Analytics o borrar el código muerto | Alerta de prueba si el cron no corre 26 h | S |
| 10 | Smoke/audit bloqueantes; usuario smoke por secretos y cleanup; R2 en CI | Deploy falla si la subida o el drift fallan | S |
| 11 | CI: `expo-doctor`, `build:web`, `expo lint`, coverage mínima, checklist nativo obligatorio | PR verde = artefacto desplegable; umbral de cobertura | M |

### Bloque C — “El producto no miente” (después)

| # | Trabajo | Cierre verificable | Esfuerzo |
| :-- | :--- | :--- | :---: |
| 12 | Cola nativa sin tope de 2.000 (cursor o página); liberar espacio/progreso sobre toda la cola | 2.501 filas: libera la antigua, progreso correcto | M |
| 13 | Web: chunks en IndexedDB + `storage.persist()`; visor usa preview | Vídeo 1 GB no revienta; Playwright no pide `/originals/` al abrir | L |
| 14 | Álbum remoto, papelera y salto temporal paginados; limpiar `before` al volver | 120 álbum / 150 papelera / salto 2016 + retorno | M |
| 15 | Verificación de email: reenvío, estado, `callbackURL` correcto, 403 no tratado como sesión | Usuario sin verificar ve banner y puede resolverlo | M |
| 16 | Shares: paginación, rate limit, `allowDownload`, revocación de URLs; IDOR de portada | 500 ítems paginados; PATCH ajeno 400 | M |
| 17 | Export ZIP restaurable o decisión explícita de JSON; borrado con re-auth | ZIP con originales+metadatos; DELETE pide contraseña | M |
| 18 | Web headers (CSP/HSTS), privacidad IA/geo, permisos limitados, a11y, temporales | Checklist de seguridad/privacidad y test de a11y | M |

**No haría** en esta etapa: iOS, álbumes colaborativos, Live Photos, reconocimiento de personas,
dedup global, PWA offline completo. Siguen en P2 y no desbloquean nada de lo anterior.

---

## 6. Registro de riesgos

| Riesgo | Prob. | Impacto | Señal temprana | Mitigación |
| :--- | :---: | :---: | :--- | :--- |
| Migración 0013 rompe el deploy | Alta | Crítico | `db:generate` produce `ALTER TABLE` | Snapshots + check CI + staging |
| Coste R2 por bypass de cuota | Media | Alto | `used_bytes` << tamaño real en R2 | Validar sizes + reconciliación + alerta |
| Vídeos > 20 MB no se respaldan | Alta | Alto | `failed` con `object_missing` | I-01 + test de 30 MB |
| Corte de red pierde un vídeo | Alta | Alto | 409 en `/multipart/complete` | Reanudación server-side + test |
| Deploy malo sin rollback | Media | Alto | Smoke opcional en verde | Staging + tag + rollback probado |
| Pérdida de D1/R2 sin backup offsite | Baja/Media | Crítico | Restore nunca probado | Destino separado + drill |
| Cuenta borrada por sesión robada | Baja | Alto | `DELETE` sin re-auth | Confirmación con contraseña |
| Portada de otro usuario (IDOR) | Media | Medio | `coverMediaId` ajeno devuelve URL | Ownership check |
| Cron silenciosamente muerto | Media | Alto | Papelera/huérfanos crecen | Heartbeat + alerta |
| Documentación engañosa | Alta | Medio | Cifras y `[x]` no cuadran | Tablero único + evidencia |

---

## 7. Preguntas abiertas (decisiones que cambian el orden)

1. **¿La cuota es control de coste o solo UX?** Si debe resistir clientes maliciosos, I-02/I-05 son
   P0 de negocio y se arreglan antes que cualquier feature.
2. **¿Están desplegados `AUTH_LIMITER`, `RESEND_API_KEY`/`EMAIL_FROM` y `ADMIN_EMAIL`?** Si Resend no
   está, la verificación de email bloqueará subidas a los 7 días y hay que desactivar la gracia o
   priorizar el reenvío.
3. **¿El deploy debe seguir en cada push a `master` o pasar a tag + `environment` con aprobación?**
   ¿Cuál es el RTO/RPO aceptado? ¿Se acepta perder hasta 24 h de catálogo?
4. **¿La cuenta `e2e-prod-web@example.com` existe en producción con la contraseña del repo?** ¿Se
   rota, se pasa a secretos y se limpia su media?
5. **¿El enlace público debe permitir originales?** ¿La revocación debe invalidar URLs ya emitidas?
   ¿Rate limit en Worker o en el borde?
6. **¿La exportación debe ser un ZIP restaurable o basta el JSON con URLs?** ¿Incluye papelera?
7. **¿iOS/Play Store están en el alcance de 2026?** Si no, decirlo en el plan y dejar de puntuar
   “iOS” en el checklist.
8. **¿Los 25 archivos sin commitear son parte de la etapa 5 o trabajo nuevo?** ¿Se commitean antes del
   próximo tag/deploy?

---

## 8. Anexo: evidencia, reproducción y límites

### 8.1 Comandos y resultados

```text
$ pnpm lint
Checked 223 files in 552ms. No fixes applied.

$ pnpm typecheck
Tasks: 2 successful, 2 total (cache hit)

$ pnpm --filter @photos/api test
Test Files  18 passed (18)
Tests       132 passed (132)
Duration    188.60s

$ pnpm --filter @photos/mobile test
Test Files  21 passed (21)
Tests       228 passed (228)
Duration    5.29s

$ pnpm test:pipeline
tests 27 · pass 27 · fail 0
```

### 8.2 Reproducción de I-04 (migraciones)

```bash
# en una rama/árbol desechable, con backup de apps/api/migrations
pnpm --filter @photos/api db:generate
cat apps/api/migrations/0013_*.sql
# salida: ALTER TABLE album ADD share_expires_at / share_revoked_at
#         ALTER TABLE media ADD r2_key_preview / preview_size
# restaurar migrations y comprobar:
git status --porcelain apps/api/migrations   # vacío
```

### 8.3 Reproducción de I-01/I-02/I-03 (multipart)

1. **Nativo**: subir un vídeo de 30 MB con la app; en logs, confirmar que se llama
   `/uploads/{id}/complete` y no `/uploads/multipart/complete`; el ítem acaba `failed` con
   `object_missing`.
2. **Cuota**: test de Miniflare con `fileSize=1`, `thumbSize=1`, `previewSize=1`, una parte de 6 MiB;
   `POST /multipart/complete` → hoy 200; `used_bytes=3`; `head(original).size=6 MiB`.
3. **Reanudación**: retener el PUT de la parte 2 (Playwright/proxy), recargar, liberar; el segundo
   intento crea otra MPU y falla al completar con etags viejos.

### 8.4 Reproducción de I-06/I-07 (D1)

- Contar placeholders del SQL de `check-hashes` con 101 hashes; contra D1 remoto debe dar error de
  bindings (100). En local puede pasar.
- Pasar un proxy a `runCleanup` que cuente statements; sembrar 1.200 filas caducadas; comprobar
  > 1.000 queries y que el cursor de sweep no avanza.

### 8.5 Archivos clave revisados

- `apps/api/src/routes/{uploads,media,albums,user,shared}.ts`
- `apps/api/src/lib/{storage-stats,s3,geo,ai}.ts`
- `apps/api/src/cron/cleanup.ts`, `apps/api/src/{index,auth,env}.ts`
- `apps/api/src/db/{schema,client}.ts`, `apps/api/migrations/*`
- `apps/mobile/src/queue/{processor,processor.web,db,db.web,background,progress}.ts`
- `apps/mobile/src/lib/{free-space,use-hybrid-gallery,local-assets,gallery,query-client}.ts`
- `apps/mobile/src/app/{media/[id],(tabs)/index,(tabs)/settings,trash}.tsx`
- `apps/mobile/src/ui/ShareMediaModal.tsx`
- `.github/workflows/*.yml`, `scripts/{audit-prod,backup-r2,check-sentry}.mjs`
- `docs/{PLAN_MEJORAS,PLAN_GENERAL,decisions}.md`, `ROADMAP.md`, `README.md`, `AGENTS.md`

### 8.6 Límites de esta investigación

- No se ejecutó E2E (falta `.dev.vars`/R2 dev), ni build nativo, ni restore real, ni auditoría de
  producción.
- Los exploits de cuota y el IDOR se deducen del código y de los contratos; no se ejecutaron contra
  producción.
- Los límites de D1 se tomaron de la documentación oficial; no se probaron contra un D1 remoto.
- Las líneas citadas son del árbol actual, que incluye cambios sin commitear; pueden moverse al
  commitear.
- `expo lint` no se pudo ejecutar en este entorno por `EPERM` al crear `~/.expo`; CI tampoco lo
  ejecuta, lo que es parte del hallazgo I-18.

---

**Conclusión.** El trabajo real es considerable: cuota atómica, sweep con cursor, FTS5, previews,
sesiones, backups D1 y una suite de 360 tests. Pero el plan confundió “implementado” con “verificado y
entregado”. Los P0 (multipart nativo, bypass de cuota en dos variantes, migraciones) y los cuatro
huecos de entrega (release, CD, backups, alertas) son la diferencia entre un buen prototipo y un
respaldo en el que se puede confiar. La Etapa 6 propuesta cierra esa diferencia antes de añadir una
sola función nueva.
