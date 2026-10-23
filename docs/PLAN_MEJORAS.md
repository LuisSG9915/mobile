# Plan de trabajo — mejoras posteriores a la Fase 22

> Documento de planificación. No implementa cambios.
> Referencias: `docs/PLAN_GENERAL.md`, `ROADMAP.md`, `docs/decisions.md`, `docs/testing/PLAN_PRUEBAS.md`.

## 0. Resumen ejecutivo

El plan inicial está cerrado: las 5 fases del `ROADMAP.md` y las 22 fases de
`docs/PLAN_GENERAL.md` figuran completadas, y la arquitectura base (Worker sin
binarios, R2 prefirmado, D1, cola híbrida, papelera, cuota y tests) está
implementada.

Lo que falta no son fases del plan viejo, sino **deuda de producto y operación**
que el plan no cubría:

1. **Integridad**: la cuota tiene una carrera conocida, el barrido de huérfanos
   de R2 no avanza más allá de las primeras 5.000 claves y el vaciado de
   papelera no está acotado.
2. **Escala**: el visor descarga el original completo, la galería local se corta
   en 2.000 assets, el salto temporal carga páginas de una en una y varias
   consultas no tienen paginación.
3. **Operación**: quedan pendientes el rate limit de auth en producción, Resend,
   el token de Sentry en EAS, la verificación de backups y el despliegue
   continuo. La documentación además está desincronizada.

La propuesta es **6 etapas cortas**, priorizando quick wins y luego integridad
antes que funcionalidades nuevas.

## 1. Estado de partida

### Lo que ya está bien

- **Arquitectura**: el Worker nunca recibe binarios; el cliente sube directo a
  R2 con URLs prefirmadas (`apps/api/src/lib/s3.ts`, `uploads.ts`).
- **Deduplicación**: SHA-256 por usuario + `check-hashes` + índice único.
- **Respaldo**: cola persistente nativa (SQLite) y web (IndexedDB), pausa
  persistente, reintentos con backoff, watchdog de subidas y exclusión por
  Web Locks.
- **Higiene**: papelera de 30 días, cron de purga, reconciliación de cuota,
  rate limit de subidas, Sentry opcional y backups D1 diarios.
- **Calidad**: ~95 casos de test en API y ~195 en mobile, además de E2E web,
  Miniflare local y checklist nativo.

### Señales de que “100%” no significa “terminado”

- `docs/testing/PLAN_IMPLEMENTACION_DEVIN.md` sigue con las 7 fases en `[ ]`,
  aunque `docs/PLAN_GENERAL.md` las marca `[x]`.
- `README.md` dice “46 tests API + 116 mobile”; los archivos actuales declaran
  ~95 y ~195. `ROADMAP.md` también cita 39/97.
- `docs/decisions.md` tiene un apartado **Pendiente operativo** con el
  `AUTH_LIMITER` y Resend.
- No hay un backlog posterior a la Fase 22: el roadmap dice 100%, pero no dice
  qué sigue.

> Nota de verificación: en esta sesión no se pudieron ejecutar `pnpm lint`,
> `pnpm typecheck` ni los tests porque `node_modules` no está instalado. El
> diagnóstico es estático (código, migraciones, workflows y documentación).

## 2. Hallazgos priorizados

| ID | Hallazgo | Evidencia | Impacto | Prioridad |
| :-- | :--- | :--- | :--- | :---: |
| **M-01** | Documentación y tablero desincronizados | `PLAN_IMPLEMENTACION_DEVIN.md` con `[ ]`; README con 46/116 tests; ROADMAP sin siguiente etapa | Una sesión futura no sabe qué está hecho ni qué sigue | P0 |
| **M-02** | Operación incompleta | `AUTH_LIMITER` pendiente de deploy; `RESEND_API_KEY`/`EMAIL_FROM`; `SENTRY_AUTH_TOKEN` en EAS; `EXPO_PUBLIC_ADMIN_EMAIL` no está en `eas.json` | Sin freno de fuerza bruta en prod, sin recuperación real de contraseña ni source maps; el panel admin puede quedar oculto en el APK | P0 |
| **M-03** | Carrera de cuota | `docs/decisions.md` la documenta: dos `/uploads/init` concurrentes pueden superar los 10 GB | Se puede exceder la cuota y generar coste | P0 |
| **M-04** | El barrido de huérfanos R2 no progresa | `cron/cleanup.ts` empieza siempre en `cursor = undefined` y corta a 5.000 claves; con más objetos vuelve a escanear el mismo prefijo | Objetos huérfanos fuera del primer bloque nunca se borran; coste silencioso | P0 |
| **M-05** | Vaciar papelera y cron no están acotados | `media.ts` selecciona toda la papelera y hace un `removeStorageUsage` por item; `trash` devuelve 500 con `nextCursor: null` | Con miles de elementos se pueden agotar subrequests/tiempo y quedar cuota desincronizada; elementos >500 invisibles | P0 |
| **M-06** | El visor descarga el original completo | `app/media/[id].tsx` usa `detail.data.originalUrl` para mostrar la foto remota | Fotos de 20 MP y vídeos 4K gastan datos, memoria y tiempo de apertura | P1 |
| **M-07** | Subidas grandes no reanudables | Nativo: un único PUT; web: el archivo entero va como `ArrayBuffer` a IndexedDB | Un fallo al 99% reinicia todo; un vídeo grande puede no caber en el navegador | P1 |
| **M-08** | Galería local limitada a 2.000 assets | `listLocalAssets(2000)` y `getQueueItems(2000)` | Bibliotecas grandes no muestran fotos locales antiguas (ni pendientes) | P1 |
| **M-09** | Salto temporal costoso | `app/(tabs)/index.tsx` busca el mes con `fetchNextPage()` repetido; la Fase 5 pedía `?before=` | Saltar a un año antiguo puede encadenar decenas de peticiones | P1 |
| **M-10** | Invalidación de queries incompleta | `trash.tsx` invalida `["user-storage"]`, pero Ajustes usa `["storage"]`; borrar/restaurar no invalida `timeline-months`, álbumes, búsqueda, mapa ni recuerdos | La barra de cuota, el scrubber y los contadores quedan obsoletos | P1 |
| **M-11** | Un archivo demasiado grande pausa todo el respaldo | `uploads/init` devuelve 413 `file_too_large`; ambos procesadores tratan cualquier 413 como cuota y pausan la cola | Un vídeo de >5 GB bloquea el respaldo hasta que el usuario lo note | P1 |
| **M-12** | Consultas sin techo ni índice | `memories` y `places` cargan todo; `tags` parsea todas las filas; `search` hace `%LIKE%` + `count(*)` por página; álbum y papelera no paginan | Memoria/CPU del Worker y latencia crecientes con la biblioteca | P1 |
| **M-13** | Backups sin verificación real | `scripts/backup-r2.mjs` solo compara tamaño; la restauración D1 es manual | Una copia corrupta puede pasar meses sin detectarse | P1 |
| **M-14** | Ciclo de cuenta y privacidad incompletos | Sin borrado de cuenta, exportación completa, sesiones revocables, verificación de email ni caducidad de enlaces públicos; el manifiesto Android pide `READ_MEDIA_AUDIO` y `WRITE_EXTERNAL_STORAGE` | Difícil cumplir expectativas de privacidad; fricción en Play Store; enlaces públicos eternos | P2 |
| **M-15** | Entrega y QA manuales | CI no ejecuta E2E; no hay deploy continuo de API/web; la matriz nativa es manual | Regresiones de auth/cola/subida se descubren tarde | P2 |

## 3. Plan por etapas

### Etapa 0 — Quick wins y orden (2–3 días) [x] Completado

**Objetivo:** dejar el tablero fiable y corregir los errores pequeños de mayor
retorno.

Tareas:

1. Actualizar `PLAN_IMPLEMENTACION_DEVIN.md` (marcar fases), README (números
   reales de tests) y ROADMAP (enlace a este plan).
2. Verificar y completar el checklist operativo de `docs/decisions.md`:
   `wrangler deploy` con `AUTH_LIMITER`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `SENTRY_AUTH_TOKEN` y `EXPO_PUBLIC_ADMIN_EMAIL` en EAS.
3. Corregir `trash.tsx`: `["user-storage"]` → `["storage"]`.
4. Crear un helper único de invalidación (`invalidateMediaLifecycleQueries`) y usarlo en
   borrar/restaurar/vaciar/editar; incluir `timeline-months`, `album`,
   `albums`, `search`, `locations`, `memories` y `storage`.
5. Distinguir `file_too_large` de `quota_exceeded` en los dos procesadores:
   - `file_too_large`: item `failed`, sin pausar la cola.
   - `quota_exceeded`: item `failed`/`queued`, pausar y ofrecer reintento al
     reanudar.
6. Añadir un test de regresión para cada corrección (`processor.test.ts` y `processor.web.test.ts`).

**Criterio de aceptación:** documentación coherente, checklist operativo
cerrado, y tests que fallen si vuelve la invalidación incorrecta o si un 413 de
tamaño pausa la cola.

**Esfuerzo:** S.

---

### Etapa 1 — Integridad de datos y cuota (1 semana) [x] Completado

**Objetivo:** que D1, R2 y la cuota cuenten la misma historia.

Tareas:

1. **Cuota atómica**:
   - Columna `reserved_bytes` en `user_storage_stats` con migración DDL (`0009_stale_grandmaster.sql`).
   - `reserveStorageQuota` atómica en `POST /uploads/init` con `WHERE (used_bytes + reserved_bytes + bytes) <= max_bytes`.
   - `confirmStorageUsage` en `POST /uploads/{id}/complete` que transiciona bytes reservados a usados.
   - Liberación de reserva en `POST /uploads/init` (bloque `catch`) y en el cron diario para uploads `pending` expirados.
   - Test concurrente con `Promise.all` verificando que de dos subidas concurrentes que exceden la cuota, exactamente una recibe 201 y la otra 413 `quota_exceeded`.
2. **Barrido de huérfanos con cursor persistente**:
   - Tabla `system_state` (`r2_orphan_sweep_cursor`).
   - Límite de 5 páginas (5.000 objetos) por ejecución del cron diario, guardando el cursor o reseteando a `null` al llegar al fin.
   - Test con simulación de >5.000 claves en R2 verificando avance de cursor y eliminación de huérfanos del final en dos corridas consecutivas.
3. **Papelera acotada**:
   - `GET /trash` con paginación real por cursor opaco `(deletedAt, id)` y `nextCursor`.
   - `POST /trash/empty` acotado a 250 elementos por llamada, con eliminación en batch de R2 y D1, devolviendo `{ ok, deletedCount, remainingCount, hasMore }`.
   - Bucle automático en cliente móvil (`trash.tsx`).
   - Test de paginación en `GET /trash` y vaciado de >1.000 items en `POST /trash/empty`.
4. **Backups verificables**:
   - Comparación incremental por ETag y hash MD5 en `scripts/backup-r2.mjs`.
   - Flag `--verify-sample [N]` para verificación criptográfica de SHA-256 en muestra aleatoria de objetos.
   - Paso post-dump en `.github/workflows/backup-d1.yml` con simulación de restauración en SQLite efímero (`sqlite3 :memory: < backup.sql`) ejecutando `PRAGMA integrity_check;` y validación de tablas.
   - Documentación actualizada en `docs/ops/D1_BACKUP.md`, `docs/backup-321.md` y `docs/decisions.md`.

**Criterio de aceptación:** test de concurrencia de cuota; auditoría con 0
diferencias inexplicables; vaciar 5.000 elementos no agota límites; restore
probado al menos una vez.

**Esfuerzo:** M.

---

### Etapa 2 — Escala de consultas y navegación (1–2 semanas) [x] Completado

**Objetivo:** que la app siga siendo rápida con decenas de miles de elementos.

Tareas:

1. **Paginación real**:
   - Álbum (`albumDetail`), papelera, lugares y recuerdos.
   - `memories`: límite por año y total; no devolver todos los items.
   - `places`: agregación en SQL (`GROUP BY city, country`) en vez de cargar
     todas las filas en memoria.
2. **Salto temporal directo**:
   - Añadir `before`/`date` al timeline (la Fase 5 ya lo pedía).
   - Usarlo desde el modal de mes y el scrubber; evitar `fetchNextPage` en
     cadena.
3. **Búsqueda**:
   - Evaluar FTS5 en D1 para `caption`, `tags`, ciudad/país y extensión.
   - Si FTS5 no encaja, crear tabla `media_tag` normalizada e indexada.
   - `tags`: dejar de cargar todas las filas y contar en SQL.
   - Limitar `count(*)` a la primera página o a un máximo conocido.
4. **Índices y presupuesto de consultas**:
   - Medir con un dataset sintético de ~100k filas.
   - Objetivo: timeline < 150 ms, búsqueda < 300 ms, meses < 150 ms en local.

**Criterio de aceptación:** ninguna ruta devuelve listas ilimitadas; salto a
2016 hace una sola petición; presupuesto de latencia medido y documentado.

**Esfuerzo:** M/L.

---

### Etapa 3 — Subidas grandes y visor (2 semanas) [x] Completado

**Objetivo:** que respaldar un vídeo de varios GB sea interrumpible y que ver
una foto remota no descargue 20 MB.

Tareas:

1. **Subida reanudable**:
   - Multipart upload de R2 con partes de 8–16 MB (o TUS si se prefiere).
   - Persistir `uploadId`, `partNumber`, `etag` y bytes confirmados.
   - Reanudar tras matar la app, perder red o recargar la pestaña.
   - Web: chunks en IndexedDB, no un único `ArrayBuffer`.
   - UI: progreso por item, cancelar, reintentar y “subir ahora” por item.
2. **Preview de visualización**:
   - Generar al subir una derivada de ~1.600 px WebP (y póster para vídeo).
   - Guardar `r2KeyPreview`/`previewSize`; servirla en el visor y el carrusel.
   - El original queda para descarga, edición y zoom de alta calidad.
3. **Galería paginada**:
   - `listLocalAssets` y la cola con cursor, no tope fijo de 2.000.
   - `FlashList` con `onEndReached` y ventana de precarga.
4. **Cuota y limpieza**:
   - Mostrar desglose (originales, miniaturas, papelera) en Ajustes.
   - Opción “liberar espacio automáticamente tras N días” (opt-in).

**Criterio de aceptación:** matar la red al 80% y reanudar sin re-subir todo;
un vídeo de 1 GB completa; una foto remota de 20 MP abre con <500 KB de
descarga; galería de 20.000 assets navega sin cortes.

**Esfuerzo:** L.

---

### Etapa 4 — Seguridad, privacidad y ciclo de cuenta (1–2 semanas) [x] Completado

**Objetivo:** cerrar el ciclo de vida de una cuenta y reducir superficie.

Tareas:

1. **Verificación de email con periodo de gracia**:
   - No bloquear a usuarios existentes; marcar verificados o dar 30 días.
   - Reutilizar `email.ts` y la infraestructura de Resend.
2. **Sesiones**:
   - Listar dispositivos, cerrar sesión remota y revocar todas.
3. **Borrado y exportación de cuenta**:
   - `DELETE /v1/account` con confirmación y cascada D1 + borrado de
     `users/{userId}/` en R2 por lotes.
   - Exportación ZIP con originales + metadatos (reutilizar batch download).
4. **Enlaces públicos**:
   - Caducidad configurable, rotación y opción de desactivar descarga de
     originales.
   - Rate limit/caché en `/v1/shared/*`.
5. **Android**:
   - Quitar permisos no usados (`READ_MEDIA_AUDIO`, `WRITE_EXTERNAL_STORAGE`,
     duplicados) y revisar `ACCESS_MEDIA_LOCATION`.
6. **Admin**:
   - Confirmar `EXPO_PUBLIC_ADMIN_EMAIL` en el entorno de EAS.

**Criterio de aceptación:** una cuenta se puede borrar por completo y dejar 0
objetos; exportación restaurable; enlace compartido caduca; manifiesto Android
mínimo.

**Esfuerzo:** M.

---

### Etapa 5 — Calidad, entrega y observabilidad (1 semana + continuo) [x] Completado

**Objetivo:** que los errores se detecten antes de publicar, no en el móvil.

Tareas:

1. **CI**:
   - Nightly de E2E web (o en cada PR si el coste es aceptable).
   - `expo-doctor` y build web en PR.
   - Cobertura mínima en módulos críticos (cola, processor, storage, auth).
2. **CD**:
   - Workflow de deploy de API + web en tag, con migraciones, smoke test y
     rollback documentado.
   - Staging con bucket `photos-media-dev` y datos de prueba.
3. **Observabilidad**:
   - Heartbeat del cron y alerta si no corre.
   - Alertas de drift de cuota, huérfanos, 5xx y fallos de backup.
   - Sentry separado cliente/servidor (opcional).
4. **Nativo**:
   - Checklist por release en Android (API 34/35/36) e iOS si se publica.
   - Al menos un dispositivo físico por release; recoger logs de cola.

**Criterio de aceptación:** deploy de una tag sin pasos manuales; alerta si el
cron o el backup fallan; checklist nativo firmado por release.

**Esfuerzo:** M + continuo.

## 4. Backlog P2 (no ahora)

| Idea | Por qué posponerla |
| :--- | :--- |
| App iOS publicada | Requiere cuenta Apple, perfiles y QA; el foco actual es Android/web |
| Álbumes colaborativos | Cambia el modelo de permisos y shares; no es necesario para uso personal |
| PWA/offline completo | El offline ya está cubierto por la cola; el visor offline requiere caché de originales |
| Live Photos (HEIC+MOV) | Cambia el modelo de media y la deduplicación |
| Reconocimiento de personas | Coste/privacidad; AI tags ya cubre parte |
| Preview de vídeo transcodificado | Coste de CPU; primero medir el preview de imagen |
| Dedup global entre usuarios | Descartado en `decisions.md`: ahorro pequeño, rediseño grande |
| Limpieza automática de espacio | Útil, pero después de previews y cuota |

## 5. Orden, dependencias y estimación

```text
Etapa 0 (2-3 d)
   ↓
Etapa 1 (5-7 d)  ← cuota y R2 primero: sin esto, escalar multiplica el riesgo
   ↓
Etapa 2 (7-10 d) ← consultas y paginación
   ↓
Etapa 3 (10-15 d) ← uploads y visor; depende de cuota/preview
   ↓
Etapa 4 (7-10 d) ← seguridad y cuenta
   ↓
Etapa 5 (5-8 d + continuo)
```

Total orientativo: **6–8 semanas a tiempo completo** o **3 meses a tiempo
parcial**. No incluye el backlog P2.

Dependencias clave:

- La cuota atómica debe ir antes de permitir más concurrencia o subidas
  reanudables.
- El preview del visor depende de una nueva clave en R2 y de la migración de
  `media`.
- La paginación de álbumes/papelera conviene antes de tocar la UI de selección.
- La verificación de email no debe activarse sin migrar a los usuarios
  existentes.

## 6. Definition of Done

Una etapa se considera cerrada cuando:

- [ ] Tiene tests unitarios y, si toca API, test Miniflare sin red externa.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm test:pipeline` pasan.
- [ ] Si toca UI, se probó en web y en un dispositivo Android real.
- [ ] Si toca API, se probó el flujo completo con `wrangler dev` y R2 dev.
- [ ] Se actualizaron `PLAN_GENERAL.md`, README y este documento.
- [ ] No añade coste externo obligatorio ni requiere `--remote` en tests.
- [ ] Tiene plan de rollback si toca migraciones o cron.

## 7. Primera semana (checklist concreta)

1. Instalar dependencias y ejecutar la suite completa para fijar la línea base
   real (`pnpm install && pnpm test:all --skip native`).
2. Corregir la invalidación `["user-storage"]` y añadir su test.
3. Distinguir `file_too_large` de `quota_exceeded` en nativo y web.
4. Actualizar tablero, README y ROADMAP.
5. Verificar el checklist operativo (limiter, Resend, Sentry, admin email).
6. Abrir un issue/ADR por cada hallazgo M-03…M-13 y decidir cuáles entran en la
   Etapa 1.
7. Medir el estado actual con `node scripts/audit-prod.mjs` (solo lectura) y
   guardar el resultado como línea base.

## 8. Decisiones que no se tocan

- El Worker no recibe binarios; se mantiene el flujo prefirmado.
- Los tests siguen siendo 100% locales y sin `--remote`.
- La deduplicación global entre usuarios no entra en el alcance.
- La UI y los mensajes visibles siguen en español.
- No se compilan builds nativos salvo que el cambio lo exija.
