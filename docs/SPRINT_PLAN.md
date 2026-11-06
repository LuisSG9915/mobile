# Plan de Sprints — Photos Platform (revisado 2026-11-06 PM)

> Revisión tras análisis de código + evidencia real de bug (screenshot `screenshot-now.png`):
> la galería queda **en negro** tras saltar de mes con el FastScrubber — solo se pinta el
> header "Agosto de 2026" y ninguna celda. El plan anterior lo trataba como mejora (S1-6);
> ahora es **P0 del Sprint 1**. Los cambios de API pasan a segundo plano.

**Evidencia del bug (P0):** salto a mes no cargado → `setTimelineBefore(ymToEndOfMonthIso())` →
`key` change remonta FlashList → nueva query con 60 items iniciales → lista en blanco.
El remontaje existente (comentario en `index.tsx:961-964`) NO cubre este caso.

---

## Estado de ejecución (2026-11-06)

- **S1 (P0) cerrado**: la lista se remonta solo cuando la query del mes resolvió con filas (nunca con `data`
  vacía ni conservando el offset anterior). Overlay de carga/error/vacío, chip «Desde <mes> · N» con
  «Ver todas», modal con mes activo y entrada «Volver a todas». `keyExtractor`/`getItemType`/
  `overrideItemLayout`/`renderItem` estables.
- **S2 cerrado**: `presignGetBatch` + `POST /v1/media/presign-batch` con esquema en `@photos/shared`
  (`presignBatchRequestSchema`, `presignBatchResponseSchema`, `PRESIGN_BATCH_MAX_KEYS`), usado en timeline,
  recuerdos, papelera y álbum paginado. Test unitario `apps/api/test/presign-batch.test.ts`.
- **Adelanto de S6 (rendimiento)**: lecturas SQLite memorizadas por tick en Respaldo/Ajustes, una sola
  suscripción de `useSyncProgressAuto`, comparador de `PhotoCell` sin depender de la URL prefirmada y caché
  de 60 s del escaneo de MediaLibrary al abrir el visor.
- **Verificación**: typecheck de mobile/API/shared, 261 tests de mobile, 3 tests del lote de presign y Biome
  sobre los archivos tocados. El E2E `jump-month` quedó reescrito pero no puede ejecutarse sin credenciales R2
  en `apps/api/.dev.vars`; la suite del API tampoco arranca aquí por `SQLITE_CANTOPEN`/binding AI remoto.
- **Pendiente**: S3 (cola de subida), S4 (tags), S5 (web parity/PWA), resto de S6 (refactor) y S7 (observabilidad).

---

## Sprint 1 (P0): Galería estable — arreglar pantalla en negro (1 semana)

**Objetivo:** el usuario toca cualquier mes del scrubber/modal y SIEMPRE ve fotos. Cero pantallas negras.

| Ticket | Descripción | Archivos | Esfuerzo |
|--------|-------------|----------|----------|
| **S1-1** | **Reproducir y aislar el bug**: script manual (saltar a 5 meses distintos, воздуш проверка) + log `rows.length`, `query.status`, `timelineBefore` al saltar | `(tabs)/index.tsx`, `FastScrubber.tsx` | 0.5d |
| **S1-2** | **Candidato A**: actualizar `@shopify/flash-list` a la última 2.x (el blank-swap es bug conocido corregido upstream); verificar con repro | `apps/mobile/package.json` | 0.5d |
| **S1-3** | **Candidato B**: si la 2.x no basta, reemplazar remontaje por "empty-guard": mientras `query.isPending` tras salto mostrar `<EmptyState>`/spinner en vez de la lista vacía a medias | `(tabs)/index.tsx` | 0.5d |
| **S1-4** | **Candidato C**: quitar `key` remount al cambiar `timelineBefore`; mantener lista montada y usar `refetch` (el swap de data grande por `before` es lo que dispara el blank) + `onEndReached` carga el resto | `(tabs)/index.tsx` | 1d |
| **S1-5** | Guard de seguridad user-facing: si `rows.length <= 1` y `!query.isPending && !query.hasNextPage`, mostrar "No hay fotos en este mes" + botón "Volver a todas" (limpia `timelineBefore`) — evita el negro final incluso si el layout falla | `(tabs)/index.tsx` | 0.5d |
| **S1-6** | Escribir test Playwright `e2e/jump-month.spec.ts`: saltar a mes cargado y no cargado → assertion `count(PhotoCell rendered) > 0` | `apps/mobile/e2e/` | 0.5d |
| **S1-7** | `PhotoCell` memo refinado: comparar `photo.remote?.id` + `remote?.thumbUrl` (el objeto `remote` cambia ref por página nueva) | `(tabs)/index.tsx` | 0.5d |

**Entregable:** saltar a cualquier mes → celdas visibles o mensaje claro; nunca en negro.
**Done criteria:** S1-6 en CI verde tras 10 saltos consecutivos entre meses alternos.

---

## Sprint 2: Batch Presign — rendimiento API (1 semana, API-first)

**Objetivo:** -70% latencia R2 en timeline (N+1 `presignGet` → 1 lote).

| Ticket | Descripción | Archivos | Esfuerzo |
|--------|-------------|----------|----------|
| **S2-1** | `presignGetBatch(env, keys)` en `lib/s3.ts` (ya WIP en stash `sprint0-1-wip`) — validar ownership: el caller solo pasa keys del usuario actual | `s3.ts` | 0.5d |
| **S2-2** | Endpoint `POST /v1/media/presign-batch` `{keys: string[] max 100}` → `{urls: Record<key,url>}` + schema en `@photos/shared` | `media.ts`, `schemas.ts` | 0.5d |
| **S2-3** | Timeline: firmar thumbs en 1 batch tras el SELECT (en lugar de `Promise.all` por item) | `timeline.ts` | 0.5d |
| **S2-4** | Trash y album detail: mismo batch | `media.ts`, `albums.ts` | 0.5d |
| **S2-5** | Client mobile: consumir sin cambio de API (URLs llegan igual en `thumbUrl`) — regresión E2E galería | — | 0.5d |
| **S2-6** | Métrica `presign_batch_ms` p95 en logs estructurados (base de Sprint 0) | `lib/telemetry.ts` | 0.5d |

**Entregable:** p95 timeline < 500ms con 60 items.

---

## Sprint 3: Robustez cola de subida (1.5 semanas)

Igual que el plan anterior (S2 old), sin cambios: `prechecked_hashes` persistida,
`STALL_MS` dinámico, journal `parts` por lote, lock TTL web, `RetryPolicy` pura,
test de kill/resume.

**Entregable:** vídeo de 2 GB sobrevive force-close + modo avión + reinicio.

---

## Sprint 4: Tags normalizados & búsqueda (1 semana)

Igual que el plan anterior (S3 old): migración `media_tags`, endpoint `/v1/tags`,
filtro `tag:` en timeline, UI picker, dual-write 1 release.

---

## Sprint 5: Web parity + background upload (2 semanas)

Igual que el plan anterior (S4 old): Service Worker con `background-sync`,
quota UI, drag&drop carpetas, HEIC WASM, token refresh, PWA.

---

## Sprint 6: Refactor arquitectura (2 semanas)

Igual que el plan anterior (S5 old): extraer `MultipartUploader`/`SingleUploader`/
`RetryPolicy`, dividir `useHybridGallery`, merge en Web Worker, coverage >80% lógica pura.

---

## Sprint 7: Observabilidad & operación (1 semana)

Igual que el plan anterior (S6 old): cron alerting, Sentry tracing distribuido,
dashboard, runbook, verify-backup.

---

## Cambios vs. plan original (changelog del plan)

1. **S1-6/1-7 (FlashList) suben de "mejora" a P0** — evidencia: screenshot de galería en negro.
2. **Bug nuevo S1-5** (empty-state guard) — defensa en profundidad para el usuario final.
3. **Batch presign baja a Sprint 2** — importante pero invisible para el usuario frente al bug P0.
4. **Cronología total:** 1+1+1.5+1+2+2+1 = **9.5 semanas** (sin cambio neto).

## Orden de ejecución recomendado HOY

```bash
git stash pop                 # restaurar WIP sprint0-1-wip (batch presign parcial)
# Sprint 1: empezar por S1-1 (repro) — medir antes de tocar FlashList
# No expandir alcance API hasta tener el repro verde/rojo documentado
```
